import type { SignInState, StaffFormField, StaffHistoryAction, StaffRole, StaffStatusFilter, OrderStatus } from '../../domain'
import { ApiError, NETWORK_ERROR_MESSAGE, client, run, toApiError } from '../../lib/api'
import { forgetInactiveStaff } from '../../lib/staffStatus'

export { ApiError } from '../../lib/api'

/**
 * Every call the staff screens make (0006). Reads are staff RPCs (the
 * database decides who sees whom); every write goes through the
 * `staff-access` server function, which runs the staff RPC as the signed-in
 * person and then the sign-in step with the secret key. Each function throws
 * an `ApiError` with a message that can be shown as it is.
 */

export interface StaffRow {
  id: string
  name: string
  email: string
  phone: string
  role: StaffRole
  branch_id: string
  branch_name: string
  additional_branch_ids: string[]
  additional_branch_names: string[]
  active: boolean
  joined_at: string
  left_at: string | null
  sign_in_state: SignInState
  can_manage: boolean
}

export interface StaffListQuery {
  search?: string
  role?: StaffRole
  branchId?: string
  status: StaffStatusFilter
  limit: number
  offset: number
}

export interface StaffPermissions {
  can_edit: boolean
  can_change_role: boolean
  /** Admins only: the email is the sign-in. */
  can_change_email?: boolean
  can_change_cover: boolean
  can_deactivate: boolean
  can_reactivate: boolean
  can_send_invite: boolean
  can_reset_password: boolean
  /** Why deactivating would be refused right now (open jobs, last Manager, …). */
  deactivate_blocker: string | null
}

export interface OpenJob {
  order_id: string
  order_no: string
  status: OrderStatus
  branch_name: string
}

export interface StaffHistoryEntry {
  id: number
  action: StaffHistoryAction
  changes: Record<string, { from?: string | string[] | null; to?: string | string[] | null }>
  actor_id: string | null
  actor_name: string | null
  created_at: string
}

export interface StaffDetail {
  staff: Omit<StaffRow, 'can_manage'>
  permissions: StaffPermissions
  open_jobs: OpenJob[]
  history: StaffHistoryEntry[]
}

export interface BranchCoverRow {
  branch_id: string
  branch_name: string
  managers: { id: string; name: string; home: boolean }[]
  active_staff: number
  has_manager: boolean
}

export interface BranchOption {
  id: string
  name: string
}

export interface StaffFormInput {
  name: string
  email: string
  phone: string
  role: StaffRole
  branchId: string
  /** Admins only; null keeps the current cover. */
  additionalBranchIds: string[] | null
}

export interface FormProblem {
  field: StaffFormField
  message: string
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------
export async function listStaff(q: StaffListQuery): Promise<{ rows: StaffRow[]; total: number }> {
  const rows = (await run(
    client().rpc('staff_list', {
      p_search: q.search?.trim() || null,
      p_role: q.role ?? null,
      p_branch_id: q.branchId ?? null,
      p_status: q.status,
      p_limit: q.limit,
      p_offset: q.offset,
    }),
  )) as (StaffRow & { total_count: number | string })[]
  return { rows: rows ?? [], total: rows?.length ? Number(rows[0].total_count) : 0 }
}

export async function fetchStaffDetail(staffId: string): Promise<StaffDetail> {
  return (await run(client().rpc('staff_detail', { p_staff_id: staffId }))) as StaffDetail
}

export async function fetchBranchCover(): Promise<BranchCoverRow[]> {
  return ((await run(client().rpc('branch_cover_overview'))) as BranchCoverRow[]) ?? []
}

/** Branches the signed-in person may choose: every branch for Admins, covered ones for Managers. */
export async function fetchBranchOptions(role: StaffRole): Promise<BranchOption[]> {
  if (role === 'manager') {
    return ((await run(client().rpc('covered_branches'))) as BranchOption[]) ?? []
  }
  return ((await run(client().from('branches').select('id, name').order('name'))) as BranchOption[]) ?? []
}

/** What would stop this form from saving, without saving it. */
export async function checkStaffForm(staffId: string | null, input: StaffFormInput, active = true): Promise<FormProblem[]> {
  return (
    ((await run(
      client().rpc('staff_form_check', {
        p_staff_id: staffId,
        p_name: input.name,
        p_email: input.email,
        p_phone: input.phone,
        p_role: input.role,
        p_branch_id: input.branchId || null,
        p_additional_branch_ids: input.additionalBranchIds,
        p_active: active,
      }),
    )) as FormProblem[]) ?? []
  )
}

// ---------------------------------------------------------------------------
// Writes (the staff-access server function)
// ---------------------------------------------------------------------------
export type StaffAccessAction =
  | 'create'
  | 'update'
  | 'deactivate'
  | 'reactivate'
  | 'resend_invite'
  | 'reset_password'
  | 'retry_block'
  | 'retry_unblock'
  | 'retry_email'

export type RetryAction = Extract<StaffAccessAction, 'resend_invite' | 'reset_password' | 'retry_block' | 'retry_unblock' | 'retry_email'>

export interface StaffAccessResult {
  staffId: string
  message: string
  /** Set when the change was saved but its sign-in step failed. */
  warning?: string
  retry?: RetryAction
}

export async function staffAccess(
  action: StaffAccessAction,
  opts: { staffId?: string; staff?: StaffFormInput } = {},
): Promise<StaffAccessResult> {
  let response: { data: unknown; error: unknown }
  try {
    response = await client().functions.invoke('staff-access', {
      // Email links always open the live app; staff-access sets the address (0010).
      body: { action, staffId: opts.staffId, staff: opts.staff },
    })
  } catch (e) {
    throw toApiError(e as { message?: string })
  }
  let body = response.data as { ok?: boolean; error?: string } | null
  if (response.error) {
    // A non-2xx answer still carries the function's message.
    const context = (response.error as { context?: { json?: () => Promise<unknown> } }).context
    body = context?.json ? ((await context.json().catch(() => null)) as typeof body) : null
    if (!body?.error) {
      const name = (response.error as { name?: string }).name
      throw new ApiError(name === 'FunctionsFetchError' ? NETWORK_ERROR_MESSAGE : 'The staff service did not answer. Try again.')
    }
  }
  if (!body || body.ok !== true) throw new ApiError(body?.error || 'The staff service did not answer. Try again.')
  if (action === 'deactivate' || action === 'reactivate') forgetInactiveStaff()
  return body as unknown as StaffAccessResult
}
