import type { CustomerMessageChannel, CustomerMessageState, FinanceView, ManagerView } from '../../domain'
import { client, run, toNumber, toOrderSummary, type OrderSummary } from '../../lib/api'

export { ApiError, type OrderSummary } from '../../lib/api'
export { fetchOrderHistory, type HistoryEntry } from '../orders/api'
export { recordPayment } from '../payments/api'

/**
 * Every database call the Manager and Finance portals make (0004). Reads run
 * under row-level security (a Manager sees the branches they cover; Finance
 * sees every branch); writes go only through RPCs. Each function throws an
 * `ApiError` with a message that can be shown as it is.
 */

/** One row of `order_review_summary`: `order_summary` plus what review and close need. */
export interface OrderReview extends OrderSummary {
  completed_at: string | null
  completion_technician_name: string | null
  return_count: number
  last_returned_at: string | null
  last_return_note: string | null
  latest_message_id: string | null
  latest_message_channel: CustomerMessageChannel | null
  latest_message_status: CustomerMessageState | null
  payment_count: number
  unverified_count: number
  reviewed_at: string | null
  reviewed_by_name: string | null
  review_note: string | null
  closed_at: string | null
  closed_by_name: string | null
  /** 0005: the latest visit's customer rating (1-5), or null when there is none. */
  latest_rating: number | null
  latest_working_well: boolean | null
  /** 0006: the ids behind the names, for "(inactive)" tags. */
  completion_technician_id?: string | null
  reviewed_by_id?: string | null
  closed_by_id?: string | null
  /** 0009: open supervisor warnings (the Manager's To review list only). */
  open_warnings?: number
}

/** Who approved and closed an order, and when (shown to Admins and technicians too). */
export type ReviewFacts = Pick<
  OrderReview,
  'reviewed_at' | 'reviewed_by_name' | 'reviewed_by_id' | 'review_note' | 'closed_at' | 'closed_by_name' | 'closed_by_id'
>

export interface BranchOption {
  id: string
  name: string
}

export function toOrderReview(row: Record<string, unknown>): OrderReview {
  return {
    ...(row as unknown as OrderReview),
    ...toOrderSummary(row),
    return_count: toNumber(row.return_count),
    payment_count: toNumber(row.payment_count),
    unverified_count: toNumber(row.unverified_count),
    latest_rating: row.latest_rating === null || row.latest_rating === undefined ? null : Number(row.latest_rating),
    latest_working_well: (row.latest_working_well as boolean | null | undefined) ?? null,
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** The order with this number, or null when there is none the person can see. */
export async function fetchOrderReview(orderNo: string): Promise<OrderReview | null> {
  const rows = await run(client().from('order_review_summary').select('*').eq('order_no', orderNo).limit(1))
  const row = (rows as Record<string, unknown>[])[0]
  return row ? toOrderReview(row) : null
}

/** Who approved and closed the order; null when it cannot be read. */
export async function fetchReviewFacts(orderId: string): Promise<ReviewFacts | null> {
  const rows = await run(
    client()
      .from('order_review_summary')
      .select('reviewed_at, reviewed_by_name, reviewed_by_id, review_note, closed_at, closed_by_name, closed_by_id')
      .eq('id', orderId)
      .limit(1),
  )
  return (rows as ReviewFacts[])[0] ?? null
}

/** One tab of the signed-in Manager's review queue, optionally one branch. */
export async function fetchManagerOrders(view: ManagerView, branchId: string | null): Promise<OrderReview[]> {
  const rows = await run(client().rpc('manager_orders', { p_view: view, p_branch_id: branchId }))
  return (rows as Record<string, unknown>[]).map(toOrderReview)
}

/** One tab of Finance's queue, optionally one branch. */
export async function fetchFinanceOrders(view: FinanceView, branchId: string | null): Promise<OrderReview[]> {
  const rows = await run(client().rpc('finance_orders', { p_view: view, p_branch_id: branchId }))
  return (rows as Record<string, unknown>[]).map(toOrderReview)
}

/** The signed-in Manager's branches, home first. */
export async function fetchCoveredBranches(): Promise<BranchOption[]> {
  const rows = await run(client().rpc('covered_branches'))
  return (rows as { id: string; name: string }[]).map(({ id, name }) => ({ id, name }))
}

/** Every branch, by name (Finance's branch filter). */
export async function fetchBranches(): Promise<BranchOption[]> {
  return (await run(client().from('branches').select('id, name').order('name'))) as BranchOption[]
}

// ---------------------------------------------------------------------------
// Writes (RPCs)
// ---------------------------------------------------------------------------

/** Approve: Job Done → Reviewed, with an optional note; Finance and the technician are told. */
export async function approveOrder(orderId: string, note: string | null): Promise<void> {
  await run(client().rpc('transition_order', { p_order_id: orderId, p_to_status: 'reviewed', p_note: note }))
}

/** Return for rework: Job Done → In Progress with a required note; the technician is told. */
export async function returnForRework(orderId: string, note: string): Promise<void> {
  await run(client().rpc('transition_order', { p_order_id: orderId, p_to_status: 'in_progress', p_note: note }))
}

/** Close: Reviewed → Closed (fully paid, every receipt verified); the technician is told. */
export async function closeOrder(orderId: string): Promise<void> {
  await run(client().rpc('transition_order', { p_order_id: orderId, p_to_status: 'closed' }))
}

/** Tick a non-cash payment as verified (Finance). */
export async function verifyPayment(paymentId: string): Promise<void> {
  await run(client().rpc('verify_payment', { p_payment_id: paymentId }))
}

/** Undo the tick while the order is not Closed (Finance). */
export async function unverifyPayment(paymentId: string): Promise<void> {
  await run(client().rpc('unverify_payment', { p_payment_id: paymentId }))
}
