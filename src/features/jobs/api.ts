import type { CompletionInput, JobView, RescheduleParty, RescheduleReason } from '../../domain'
import { client, run, toOrderSummary, type OrderSummary } from '../../lib/api'
import { fetchOrderRecords, type OrderRecords } from '../../lib/orderRecords'

export { ApiError, type OrderSummary } from '../../lib/api'
export type { Completion, Payment, ReworkNote } from '../../lib/orderRecords'
export { recordPayment } from '../payments/api'

/**
 * Every database call the Technician portal makes. Reads run under row-level
 * security (a technician sees only their own jobs); writes go only through
 * RPCs. Each function throws an `ApiError` with a message that can be shown
 * to the technician as it is.
 */

export interface JobDetail extends OrderRecords {
  job: OrderSummary
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** One tab of the signed-in technician's job list (`my_jobs`). */
export async function fetchMyJobs(view: JobView): Promise<OrderSummary[]> {
  const rows = await run(client().rpc('my_jobs', { p_view: view }))
  return (rows as Record<string, unknown>[]).map(toOrderSummary)
}

/** The job with this number, or null when there is none the technician can see. */
export async function fetchJob(orderNo: string): Promise<JobDetail | null> {
  const rows = await run(client().from('order_summary').select('*').eq('order_no', orderNo).limit(1))
  const row = (rows as Record<string, unknown>[])[0]
  if (!row) return null
  const job = toOrderSummary(row)
  return { job, ...(await fetchOrderRecords(job.id)) }
}

// ---------------------------------------------------------------------------
// Writes (RPCs)
// ---------------------------------------------------------------------------

/** Accept the job: Assigned → Acknowledged. */
export async function acceptJob(orderId: string): Promise<void> {
  await run(client().rpc('transition_order', { p_order_id: orderId, p_to_status: 'acknowledged' }))
}

/** Start the job: Assigned / Acknowledged → In Progress (starting counts as accepting). */
export async function startJob(orderId: string): Promise<void> {
  await run(client().rpc('transition_order', { p_order_id: orderId, p_to_status: 'in_progress' }))
}

export async function rescheduleJob(
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

/** Submit the completion record: In Progress → Job Done; the branch's managers are told. */
export async function submitCompletion(orderId: string, input: CompletionInput): Promise<void> {
  await run(
    client().rpc('submit_completion', {
      p_order_id: orderId,
      p_work_done: input.workDone,
      p_extra_charges: input.extraCharges,
      p_remarks: input.remarks,
    }),
  )
}
