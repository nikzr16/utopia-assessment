import type { OrderInput, OrderStatus, RescheduleParty, RescheduleReason, StaffRole } from '../../domain'
import { callAiAssist } from '../../lib/aiAssist'
import { client, run, toNumber, toOrderSummary, type OrderSummary } from '../../lib/api'

export { ApiError, toApiError, type OrderSummary } from '../../lib/api'
export { fetchOrderRecords, type OrderRecords } from '../../lib/orderRecords'

/**
 * Every database call the Admin portal makes. Writes go only through RPCs;
 * the database resolves the actor from the session. Each function throws an
 * `ApiError` with a message that can be shown to the Admin as it is.
 */

export interface Branch {
  id: string
  name: string
}

export interface ServiceType {
  id: string
  name: string
  active: boolean
}

export interface TechnicianOption {
  id: string
  name: string
  phone: string
  branch_id: string
  branch_name: string
  open_jobs: number
}

export interface ReferenceData {
  branches: Branch[]
  serviceTypes: ServiceType[]
  technicians: TechnicianOption[]
}


export interface OrderDetail {
  order: OrderSummary
  /** The assigned technician's phone (stored form), for WhatsApp. */
  technicianPhone: string | null
}

/** One row of `list_orders`. */
export interface OrderListRow {
  id: string
  order_no: string
  status: OrderStatus
  branch_id: string
  branch_name: string
  customer_name: string
  customer_phone: string
  service_type_name: string
  quoted_price: number
  assigned_technician_id: string | null
  technician_name: string | null
  scheduled_at: string | null
  created_at: string
  total_count: number
}

export interface OrderListQuery {
  search?: string
  statuses?: OrderStatus[]
  branchId?: string
  technicianId?: string
  scheduledFrom?: string
  scheduledTo?: string
  limit: number
  offset: number
}

export interface HistoryEntry {
  id: number
  action: string
  actor_role: StaffRole
  /** 0006: for the "(inactive)" tag. */
  actor_id?: string
  actor_name: string
  from_status: OrderStatus | null
  to_status: OrderStatus | null
  note: string | null
  details: Record<string, unknown>
  created_at: string
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function fetchReferenceData(): Promise<ReferenceData> {
  const db = client()
  const [branches, serviceTypes, technicians] = await Promise.all([
    run(db.from('branches').select('id, name').order('name')),
    run(db.from('service_types').select('id, name, active').order('name')),
    run(db.rpc('technician_options')),
  ])
  return {
    branches: branches as Branch[],
    serviceTypes: serviceTypes as ServiceType[],
    technicians: (technicians as Record<string, unknown>[]).map((t) => ({
      ...(t as unknown as TechnicianOption),
      open_jobs: toNumber(t.open_jobs),
    })),
  }
}

export async function listOrders(query: OrderListQuery): Promise<{ rows: OrderListRow[]; total: number }> {
  const data = await run(
    client().rpc('list_orders', {
      p_search: query.search?.trim() || null,
      p_statuses: query.statuses && query.statuses.length > 0 ? query.statuses : null,
      p_branch_id: query.branchId || null,
      p_technician_id: query.technicianId || null,
      p_scheduled_from: query.scheduledFrom || null,
      p_scheduled_to: query.scheduledTo || null,
      p_limit: query.limit,
      p_offset: query.offset,
    }),
  )
  const rows = (data as Record<string, unknown>[]).map((r) => ({
    ...(r as unknown as OrderListRow),
    quoted_price: toNumber(r.quoted_price),
    total_count: toNumber(r.total_count),
  }))
  return { rows, total: rows[0]?.total_count ?? 0 }
}

/** The order with this number, or null when there is none (or it is not visible). */
export async function fetchOrder(orderNo: string): Promise<OrderDetail | null> {
  const db = client()
  const rows = await run(db.from('order_summary').select('*').eq('order_no', orderNo).limit(1))
  const row = (rows as Record<string, unknown>[])[0]
  if (!row) return null
  const order = toOrderSummary(row)
  let technicianPhone: string | null = null
  if (order.assigned_technician_id) {
    const staff = await run(db.from('staff').select('phone').eq('id', order.assigned_technician_id).limit(1))
    technicianPhone = ((staff as { phone: string }[])[0]?.phone as string | undefined) ?? null
  }
  return { order, technicianPhone }
}

export async function fetchOrderHistory(orderId: string): Promise<HistoryEntry[]> {
  const rows = await run(
    client()
      .from('audit_log')
      .select('id, action, actor_id, actor_role, from_status, to_status, note, details, created_at, actor:staff!audit_log_actor_id_fkey(name)')
      .eq('order_id', orderId)
      .order('id', { ascending: false }),
  )
  return (rows as Record<string, unknown>[]).map((r) => {
    const actor = Array.isArray(r.actor) ? r.actor[0] : r.actor
    return {
      ...(r as unknown as HistoryEntry),
      actor_name: (actor as { name?: string } | null)?.name ?? 'Unknown',
      details: (r.details as Record<string, unknown>) ?? {},
    }
  })
}

// ---------------------------------------------------------------------------
// Writes (RPCs)
// ---------------------------------------------------------------------------

/** Creates the order; returns its order number. */
/** Saves a new order; returns its id and number. */
export async function createOrder(input: OrderInput): Promise<{ id: string; orderNo: string }> {
  const row = await run(
    client().rpc('create_order', {
      p_branch_id: input.branchId,
      p_customer_name: input.customerName,
      p_customer_phone: input.customerPhone,
      p_customer_address: input.customerAddress,
      p_problem_description: input.problemDescription,
      p_service_type_id: input.serviceTypeId,
      p_quoted_price: input.quotedPrice,
      p_scheduled_at: input.scheduledAt,
      p_admin_notes: input.adminNotes,
      p_technician_id: input.technicianId,
    }),
  )
  const created = row as { id: string; order_no: string }
  return { id: created.id, orderNo: created.order_no }
}

export async function updateOrder(orderId: string, expectedUpdatedAt: string, input: OrderInput): Promise<void> {
  await run(
    client().rpc('update_order', {
      p_order_id: orderId,
      p_expected_updated_at: expectedUpdatedAt,
      p_branch_id: input.branchId,
      p_customer_name: input.customerName,
      p_customer_phone: input.customerPhone,
      p_customer_address: input.customerAddress,
      p_problem_description: input.problemDescription,
      p_service_type_id: input.serviceTypeId,
      p_quoted_price: input.quotedPrice,
      p_scheduled_at: input.scheduledAt,
      p_admin_notes: input.adminNotes,
    }),
  )
}

export async function assignTechnician(orderId: string, technicianId: string): Promise<void> {
  await run(
    client().rpc('transition_order', {
      p_order_id: orderId,
      p_to_status: 'assigned',
      p_note: null,
      p_technician_id: technicianId,
    }),
  )
}

export async function cancelOrder(orderId: string, reason: string): Promise<void> {
  await run(
    client().rpc('transition_order', {
      p_order_id: orderId,
      p_to_status: 'cancelled',
      p_note: reason,
      p_technician_id: null,
    }),
  )
}

export async function rescheduleOrder(
  orderId: string,
  newScheduledAt: string | null,
  reason: RescheduleReason,
  requestedBy: RescheduleParty,
  note: string | null,
): Promise<void> {
  await run(
    client().rpc('reschedule_order', {
      p_order_id: orderId,
      p_new_scheduled_at: newScheduledAt,
      p_reason: reason,
      p_requested_by: requestedBy,
      p_note: note,
    }),
  )
}

// ---------------------------------------------------------------------------
// Read from photo (0009): the ai-assist Edge Function reads the five fields.
// ---------------------------------------------------------------------------
/** The fields read from a paper order form (null = not on the form). */
export interface ReadFormFields {
  customerName: string | null
  serviceTypeId: string | null
  serviceTypeName: string | null
  problemDescription: string | null
  quotedPrice: string | null
  scheduledDate: string | null
  scheduledTime: string | null
}

export type ReadFormResult = { ok: true; fields: ReadFormFields } | { ok: false; message: string }

/** The browser gives up after 40 seconds (the server after 35). */
export const READ_FORM_TIMEOUT_MS = 40_000

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

export async function readOrderFormPhoto(file: Blob, mime: string, name: string): Promise<ReadFormResult> {
  const data = toBase64(new Uint8Array(await file.arrayBuffer()))
  const reply = await callAiAssist<{ fields?: ReadFormFields; error?: { message: string } }>(
    { action: 'read_form', file: { name, type: mime, data } },
    READ_FORM_TIMEOUT_MS,
  )
  if (reply.fields) return { ok: true, fields: reply.fields }
  return { ok: false, message: reply.error?.message ?? "Couldn't read this form. Fill the form by hand." }
}
