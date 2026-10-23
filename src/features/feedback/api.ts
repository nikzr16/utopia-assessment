import type { FeedbackAnswers, FeedbackForm, OrderFeedback } from '../../domain'
import { client, run } from '../../lib/api'

export { ApiError } from '../../lib/api'

/**
 * Every database call customer feedback makes. The customer page calls the
 * two functions signed-out visitors may use (`feedback_form`,
 * `submit_feedback`); staff read `order_feedback` under row-level security
 * and record a landline customer's rating with `record_phone_feedback`. Each
 * function throws an `ApiError` with a message that can be shown as it is.
 */

// ---------------------------------------------------------------------------
// Customer page (no sign-in)
// ---------------------------------------------------------------------------

/** Where the link stands and, while usable, which job it is for. */
export async function fetchFeedbackForm(token: string): Promise<FeedbackForm> {
  const rows = await run(client().rpc('feedback_form', { p_token: token }))
  const row = (rows as FeedbackForm[] | null)?.[0]
  return row ?? { state: 'not_found', order_no: null, service_type: null, technician_name: null, job_done_at: null }
}

/** Store the customer's answers; rejected with the page's message when the link cannot be used. */
export async function submitFeedback(token: string, answers: FeedbackAnswers): Promise<void> {
  await run(
    client().rpc('submit_feedback', {
      p_token: token,
      p_rating: answers.rating,
      p_working_well: answers.workingWell,
      p_comment: answers.comment,
    }),
  )
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

/** Every visit's feedback of an order, latest visit first. */
export async function fetchOrderFeedback(orderId: string): Promise<OrderFeedback[]> {
  const rows = await run(
    client().from('order_feedback').select('*').eq('order_id', orderId).order('job_done_at', { ascending: false }),
  )
  return (rows as OrderFeedback[]).map((f) => ({ ...f, rating: Number(f.rating) }))
}

/** A landline customer's rating, taken on the call by an Admin or a covering Manager. */
export async function recordPhoneFeedback(messageId: string, answers: FeedbackAnswers): Promise<void> {
  await run(
    client().rpc('record_phone_feedback', {
      p_message_id: messageId,
      p_rating: answers.rating,
      p_working_well: answers.workingWell,
      p_comment: answers.comment,
    }),
  )
}
