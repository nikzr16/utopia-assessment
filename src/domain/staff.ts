import { isMyMobile, normalizeMyPhone } from './phone'
import { coversBranch } from './review'
import { ROLE_LABELS, type OrderStatus, type StaffRole } from './statuses'

/**
 * Staff management (0006): the staff form's checks, who may change whom, the
 * phone rule by role, open jobs, history labels, and the "(inactive)" tag.
 * Mirrors `supabase/migrations/20261023000004_staff_management.sql`
 * (`_check_staff_name`, `_check_staff_email`, `_staff_phone_role_error`,
 * `_staff_open_jobs_error`, `_staff_manage_error`, `staff_list`);
 * `tests/db/parity.test.ts` checks both. The rules that need other staff rows
 * ("Manager first", last Admin / Finance, phone or email in use) stay in the
 * database; the form asks it with `staff_form_check`.
 */

export const STAFF_PAGE_SIZE = 25

export const STAFF_STATUS_FILTERS = ['active', 'inactive', 'all'] as const
export type StaffStatusFilter = (typeof STAFF_STATUS_FILTERS)[number]

export const STAFF_STATUS_FILTER_LABELS: Record<StaffStatusFilter, string> = {
  active: 'Active',
  inactive: 'Inactive',
  all: 'All',
}

/** A technician with orders in these statuses cannot be deactivated or change role. */
export const OPEN_JOB_STATUSES: readonly OrderStatus[] = ['assigned', 'acknowledged', 'in_progress']

export const SIGN_IN_STATES = ['none', 'invite_pending', 'ready'] as const
export type SignInState = (typeof SIGN_IN_STATES)[number]

export const SIGN_IN_STATE_LABELS: Record<SignInState, string> = {
  none: 'No invite sent',
  invite_pending: 'Invite sent, password not set yet',
  ready: 'Can sign in',
}

// ---------------------------------------------------------------------------
// The staff form
// ---------------------------------------------------------------------------
export const STAFF_NAME_MAX = 100
export const STAFF_EMAIL_MAX = 254

export const NAME_REQUIRED_MESSAGE = 'Name is required'
export const NAME_TOO_LONG_MESSAGE = 'The name can be at most 100 characters'
export const EMAIL_REQUIRED_MESSAGE = 'Email is required'
export const EMAIL_INVALID_MESSAGE = 'Enter a valid email address, for example ravi@example.com'
export const ROLE_REQUIRED_MESSAGE = 'Choose a role'
export const BRANCH_REQUIRED_MESSAGE = 'Select a valid branch'
export const TECHNICIAN_MOBILE_MESSAGE =
  'A technician needs a Malaysian mobile number for WhatsApp, for example 012-345 6789'

// Postgres btrim set used by _check_staff_name / _check_staff_email.
const TRIM = /^[ \t\r\n\f\v]+|[ \t\r\n\f\v]+$/g
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type CheckResult = { ok: true; value: string } | { ok: false; error: string }

export function checkStaffName(input: string): CheckResult {
  const name = input.replace(TRIM, '')
  if (name === '') return { ok: false, error: NAME_REQUIRED_MESSAGE }
  if ([...name].length > STAFF_NAME_MAX) return { ok: false, error: NAME_TOO_LONG_MESSAGE }
  return { ok: true, value: name }
}

export function checkStaffEmail(input: string): CheckResult {
  const email = input.replace(TRIM, '').toLowerCase()
  if (email === '') return { ok: false, error: EMAIL_REQUIRED_MESSAGE }
  if ([...email].length > STAFF_EMAIL_MAX || !EMAIL_PATTERN.test(email)) return { ok: false, error: EMAIL_INVALID_MESSAGE }
  return { ok: true, value: email }
}

/** A technician gets the assignment WhatsApp, so needs a mobile. Null = allowed. */
export function staffPhoneRoleError(role: StaffRole, storedPhone: string): string | null {
  return role === 'technician' && !isMyMobile(storedPhone) ? TECHNICIAN_MOBILE_MESSAGE : null
}

export interface StaffFormValues {
  name: string
  email: string
  phone: string
  role: StaffRole | ''
  branchId: string
  additionalBranchIds: string[]
}

export type StaffFormField = 'name' | 'email' | 'phone' | 'role' | 'branch' | 'cover' | 'active' | 'form'

export type StaffFormResult =
  | { ok: true; value: { name: string; email: string; phone: string; role: StaffRole; branchId: string; additionalBranchIds: string[] } }
  | { ok: false; errors: Partial<Record<StaffFormField, string>> }

/** The checks the form can make on its own, with the database's messages. */
export function validateStaffForm(values: StaffFormValues): StaffFormResult {
  const errors: Partial<Record<StaffFormField, string>> = {}
  const name = checkStaffName(values.name)
  if (!name.ok) errors.name = name.error
  const email = checkStaffEmail(values.email)
  if (!email.ok) errors.email = email.error
  const phone = normalizeMyPhone(values.phone)
  if (!phone.ok) errors.phone = phone.error
  if (!values.role) errors.role = ROLE_REQUIRED_MESSAGE
  else if (phone.ok) {
    const rule = staffPhoneRoleError(values.role, phone.value)
    if (rule) errors.phone = rule
  }
  if (!values.branchId) errors.branch = BRANCH_REQUIRED_MESSAGE
  if (!name.ok || !email.ok || !phone.ok || !values.role || Object.keys(errors).length > 0) return { ok: false, errors }
  return {
    ok: true,
    value: {
      name: name.value,
      email: email.value,
      phone: phone.value,
      role: values.role,
      branchId: values.branchId,
      // Only Managers cover additional branches.
      additionalBranchIds: values.role === 'manager' ? values.additionalBranchIds.filter((id) => id !== values.branchId) : [],
    },
  }
}

// ---------------------------------------------------------------------------
// Who may change whom (_staff_manage_error)
// ---------------------------------------------------------------------------
export interface StaffActor {
  role: StaffRole
  branchId: string
  additionalBranchIds: readonly string[]
}

export interface StaffShape {
  name: string
  role: StaffRole
  branchId: string
  additionalBranchIds: readonly string[]
  /** Leave out when the email is not part of the change. */
  email?: string
}

/**
 * Null = this person may make the change, else the reason. `before` is null
 * when adding; `branchName` names a branch for the message.
 */
export function staffManageError(
  actor: StaffActor,
  before: StaffShape | null,
  after: Omit<StaffShape, 'name'>,
  branchName: (id: string) => string,
): string | null {
  if (actor.role === 'admin') return null
  if (actor.role !== 'manager') return 'Only Admins and Managers can manage staff'
  if (before) {
    if (before.role !== 'technician') return 'Managers can only manage technicians'
    if (!coversBranch(actor, before.branchId)) return `Only a Manager of ${branchName(before.branchId)} can manage ${before.name}`
  }
  if (after.role !== 'technician') return before ? 'Only an Admin can change a role' : 'Managers can only add technicians'
  // The email is the sign-in: only an Admin may move it.
  if (before?.email && after.email && after.email.toLowerCase() !== before.email.toLowerCase()) {
    return 'Only an Admin can change an email'
  }
  if (after.additionalBranchIds.length > 0) return 'Only an Admin can change branch cover'
  if (after.branchId && !coversBranch(actor, after.branchId)) {
    return `You do not cover ${branchName(after.branchId)}. Choose one of your branches.`
  }
  return null
}

/** The roles a person may choose in the form. */
export function assignableRoles(actorRole: StaffRole): readonly StaffRole[] {
  return actorRole === 'admin' ? (['admin', 'technician', 'manager', 'finance'] as const) : (['technician'] as const)
}

// ---------------------------------------------------------------------------
// Messages and labels
// ---------------------------------------------------------------------------
/** Same text as `_staff_open_jobs_error`; null when there are none. */
export function openJobsError(name: string, count: number): string | null {
  if (count <= 0) return null
  return `${name} has ${count} open job${count === 1 ? '' : 's'}. Reassign ${count === 1 ? 'it' : 'them'} first.`
}

/** A staff name as shown on staff screens: tagged when the person has left. */
export function staffLabel(name: string, active: boolean | undefined): string {
  return active === false ? `${name} (inactive)` : name
}

export const STAFF_HISTORY_ACTIONS = [
  'created',
  'updated',
  'cover_changed',
  'deactivated',
  'reactivated',
  'invite_sent',
  'password_reset',
] as const
export type StaffHistoryAction = (typeof STAFF_HISTORY_ACTIONS)[number]

export const STAFF_HISTORY_LABELS: Record<StaffHistoryAction, string> = {
  created: 'Added',
  updated: 'Details changed',
  cover_changed: 'Branch cover changed',
  deactivated: 'Deactivated',
  reactivated: 'Reactivated',
  invite_sent: 'Invite email sent',
  password_reset: 'Password reset email sent',
}

const FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  email: 'Email',
  phone: 'Phone',
  role: 'Role',
  branch: 'Home branch',
  cover: 'Also covers',
}

type ChangeValue = string | string[] | null | undefined

function showValue(field: string, value: ChangeValue, formatPhone: (stored: string) => string): string {
  if (value === null || value === undefined) return '—'
  if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : 'none'
  if (field === 'role') return ROLE_LABELS[value as StaffRole] ?? value
  if (field === 'phone') return formatPhone(value)
  return value
}

/** One line per changed field: "Home branch: Shah Alam → Kuala Lumpur". */
export function describeStaffChanges(
  changes: Record<string, { from?: ChangeValue; to?: ChangeValue }>,
  formatPhone: (stored: string) => string,
): string[] {
  return Object.keys(FIELD_LABELS)
    .filter((field) => field in changes)
    .map((field) => {
      const { from, to } = changes[field]
      const label = FIELD_LABELS[field]
      return 'from' in changes[field]
        ? `${label}: ${showValue(field, from, formatPhone)} → ${showValue(field, to, formatPhone)}`
        : `${label}: ${showValue(field, to, formatPhone)}`
    })
}
