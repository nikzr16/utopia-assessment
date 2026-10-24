import { formatMalaysiaDateTime } from './malaysiaTime'
import type { PaymentStatus } from './money'
import { receiptRequired } from './paymentForm'
import type { OrderStatus, PaymentMethod, StaffRole } from './statuses'

/**
 * Manager review and Finance close (0004): branch cover, the review and
 * payment queues, the approve and close guards, payment verification, and
 * the customer message a Manager sends on behalf of the technician. Mirrors
 * `supabase/migrations/20261023000002_review_and_close.sql`
 * (`_covers_branch`, `manager_orders`, `finance_orders`,
 * `_authorize_transition`, `_payment_verify_error`,
 * `_customer_on_behalf_message`); `tests/db/parity.test.ts` checks both.
 */

// ---------------------------------------------------------------------------
// Branch cover
// ---------------------------------------------------------------------------
export interface BranchCover {
  role: StaffRole
  branchId: string
  additionalBranchIds: readonly string[]
}

/** A Manager covers their home branch and every additional branch. */
export function coversBranch(staff: BranchCover, branchId: string): boolean {
  return staff.role === 'manager' && (staff.branchId === branchId || staff.additionalBranchIds.includes(branchId))
}

// ---------------------------------------------------------------------------
// Queues
// ---------------------------------------------------------------------------
export const MANAGER_VIEWS = ['to_review', 'returned', 'reviewed'] as const
export type ManagerView = (typeof MANAGER_VIEWS)[number]

export const MANAGER_VIEW_LABELS: Record<ManagerView, string> = {
  to_review: 'To review',
  returned: 'Returned',
  reviewed: 'Reviewed',
}

export const FINANCE_VIEWS = ['not_reviewed', 'ready', 'outstanding', 'closed'] as const
export type FinanceView = (typeof FINANCE_VIEWS)[number]

export const FINANCE_VIEW_LABELS: Record<FinanceView, string> = {
  not_reviewed: 'Not yet reviewed',
  ready: 'Ready to close',
  outstanding: 'Payment outstanding',
  closed: 'Closed',
}

/** The Reviewed (Manager) and Closed (Finance) tabs show the last this many days. */
export const QUEUE_HISTORY_DAYS = 30

/** A job returned this many times or more is flagged "Needs attention". */
export const NEEDS_ATTENTION_RETURNS = 3

export function needsAttention(returnCount: number): boolean {
  return returnCount >= NEEDS_ATTENTION_RETURNS
}

/** The Manager tab an order belongs in (ignoring the 30-day window), or null. */
export function managerViewOf(order: { status: OrderStatus; return_count: number; reviewed_at: string | null }): ManagerView | null {
  if (order.status === 'job_done') return 'to_review'
  if (order.status === 'in_progress' && order.return_count > 0) return 'returned'
  if ((order.status === 'reviewed' || order.status === 'closed') && order.reviewed_at) return 'reviewed'
  return null
}

/** The Finance tab an order belongs in (ignoring the 30-day window), or null. */
export function financeViewOf(order: {
  status: OrderStatus
  payment_status: PaymentStatus
  payment_count: number
}): FinanceView | null {
  if ((order.status === 'in_progress' || order.status === 'job_done') && order.payment_count > 0) return 'not_reviewed'
  if (order.status === 'reviewed') return order.payment_status === 'paid' ? 'ready' : 'outstanding'
  if (order.status === 'closed') return 'closed'
  return null
}

// ---------------------------------------------------------------------------
// Approve and close
// ---------------------------------------------------------------------------
export const APPROVE_CUSTOMER_NOT_TOLD_MESSAGE = 'Tell the customer the job is done before approving'
export const REWORK_NOTE_REQUIRED_MESSAGE = 'A review note is required to return a job for rework'

/** Why Approve is not possible yet, or null when it is (for a covering Manager). */
export function approveBlockReason(order: {
  status: OrderStatus
  latest_message_status: string | null
}): string | null {
  if (order.status !== 'job_done') return 'Only a Job Done order can be approved'
  if (order.latest_message_status === 'not_sent') return APPROVE_CUSTOMER_NOT_TOLD_MESSAGE
  return null
}

/** Bank transfer, card and e-wallet payments are verified by Finance; cash is not. */
export function paymentNeedsVerifying(method: PaymentMethod): boolean {
  return receiptRequired(method)
}

/** `Verify every receipt before closing (2 not verified yet)`, as the database says it. */
export function unverifiedMessage(count: number): string {
  return `Verify every receipt before closing (${count} not verified yet)`
}

/** Why Close is not possible yet, or null when it is (for Finance). */
export function closeBlockReason(order: {
  status: OrderStatus
  payment_status: PaymentStatus
  balance: number
  unverified_count: number
}): string | null {
  if (order.status !== 'reviewed') return 'Only a Reviewed order can be closed'
  if (order.payment_status !== 'paid') {
    return `Order must be fully paid before closing (outstanding balance RM ${order.balance.toFixed(2)})`
  }
  if (order.unverified_count > 0) return unverifiedMessage(order.unverified_count)
  return null
}

/** Finance may tick or untick a payment: non-cash only, while the order is not Closed. */
export function canVerifyPayment(role: StaffRole, method: PaymentMethod, orderStatus: OrderStatus): boolean {
  return role === 'finance' && paymentNeedsVerifying(method) && orderStatus !== 'closed' && orderStatus !== 'cancelled'
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------
function byAt(what: string, who: string | null, at: string | null): string | null {
  if (!at) return null
  const when = formatMalaysiaDateTime(at)
  return `${what} by ${who ?? 'someone'}${when ? ` at ${when}` : ''}`
}

/** `Approved by Nurul Huda at Thu 22 Oct 2026, 3:20 PM`; null before approval. */
export function approvedLabel(order: { reviewed_at: string | null; reviewed_by_name: string | null }): string | null {
  return byAt('Approved', order.reviewed_by_name, order.reviewed_at)
}

/** `Closed by Siti Aminah at …`; null before closing. */
export function closedLabel(order: { closed_at: string | null; closed_by_name: string | null }): string | null {
  return byAt('Closed', order.closed_by_name, order.closed_at)
}

/** `Verified by Siti Aminah at …`; null when not verified. */
export function verifiedLabel(payment: { verified_at: string | null; verified_by_name: string | null }): string | null {
  return byAt('Verified', payment.verified_by_name, payment.verified_at)
}

// ---------------------------------------------------------------------------
// Customer message from a Manager
// ---------------------------------------------------------------------------
export interface OnBehalfMessageInput {
  customerName: string
  orderNo: string
  managerName: string
  branchName: string
  technicianName: string
  completedAt: string
}

/** The WhatsApp text a Manager sends on behalf of the technician. */
export function customerOnBehalfMessage(m: OnBehalfMessageInput): string {
  return (
    `Hi ${m.customerName}, this is ${m.managerName}, Manager at Sejuk Sejuk Service ${m.branchName}, ` +
    `on behalf of Technician ${m.technicianName}. Job ${m.orderNo} was completed at ` +
    `${formatMalaysiaDateTime(m.completedAt)}. Please check and leave feedback. Thank you!`
  )
}
