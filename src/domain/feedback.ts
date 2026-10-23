import { CUSTOMER_MESSAGE_STATUSES, type CustomerMessage } from './customerMessages'
import { formatMalaysiaDateTime } from './malaysiaTime'
import type { OrderStatus, StaffRole } from './statuses'

/**
 * Customer feedback (0005): the link in the Job Done message, the customer's
 * answers, the poor-rating rule, and who may record a rating taken by phone.
 * Mirrors `supabase/migrations/20261023000003_customer_feedback.sql`
 * (`_customer_message_full_text`, `_check_feedback`, `_is_low_feedback`,
 * `_feedback_state_error`, `_phone_feedback_error`, `customer_feedback`
 * checks); `tests/db/parity.test.ts` checks both.
 */

export const FEEDBACK_RATING_MIN = 1
export const FEEDBACK_RATING_MAX = 5
/** A rating at or below this is poor and alerts the Managers. */
export const FEEDBACK_LOW_RATING_MAX = 2
export const FEEDBACK_COMMENT_MAX_LENGTH = 1000
/** A link works for this many days after Job Done. */
export const FEEDBACK_LINK_DAYS = 7

/** The customer page's path: `/f/<token>`. */
export const FEEDBACK_PATH_PREFIX = '/f/'
/** 22 URL-safe characters (a random UUID). */
export const FEEDBACK_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/
/** The address used while `app_settings.feedback_link_base` is not set. */
export const FEEDBACK_LINK_PLACEHOLDER = 'https://feedback-address-not-set.invalid'

/** Where a link stands (`feedback_form` state). */
export const FEEDBACK_LINK_STATES = ['open', 'submitted', 'replaced', 'expired', 'not_found'] as const
export type FeedbackLinkState = (typeof FEEDBACK_LINK_STATES)[number]

/** What the customer page says for a link that cannot be used (mirror of `_feedback_state_error`). */
export const FEEDBACK_STATE_MESSAGES: Record<Exclude<FeedbackLinkState, 'open'>, string> = {
  submitted: 'Thank you, we have already received your feedback for this job',
  replaced: 'This feedback link is no longer active. We will send you a new link when the job is done',
  expired: 'This feedback link has expired (links work for 7 days after the job is done)',
  not_found: 'This feedback link is not valid. Check that you opened the full link from our message',
}

/** How the feedback was given. Values match `customer_feedback_source_check`. */
export const FEEDBACK_SOURCES = ['link', 'phone'] as const
export type FeedbackSource = (typeof FEEDBACK_SOURCES)[number]

export const FEEDBACK_RATING_REQUIRED_MESSAGE = 'Choose a rating from 1 to 5 stars'
export const FEEDBACK_WORKING_REQUIRED_MESSAGE = 'Tell us whether your aircon is working well now'
export const FEEDBACK_COMMENT_TOO_LONG_MESSAGE = 'The comment can be at most 1,000 characters'

/** The words read out with each star. */
export const FEEDBACK_RATING_LABELS: Record<number, string> = {
  1: 'Very poor',
  2: 'Poor',
  3: 'Okay',
  4: 'Good',
  5: 'Excellent',
}

/** The audit action written when a rating taken by phone is recorded. */
export const FEEDBACK_AUDIT_ACTIONS = ['feedback_recorded'] as const

/** A row of `feedback_form(token)`: the link's state and, while usable, the job. */
export interface FeedbackForm {
  state: FeedbackLinkState
  order_no: string | null
  service_type: string | null
  technician_name: string | null
  job_done_at: string | null
}

/** A row of `order_feedback`: one visit's feedback. */
export interface OrderFeedback {
  id: string
  message_id: string
  order_id: string
  technician_id: string | null
  technician_name: string | null
  branch_id: string
  rating: number
  working_well: boolean
  comment: string | null
  source: FeedbackSource
  recorded_by: string | null
  recorded_by_name: string | null
  created_at: string
  /** When the visit reached Job Done (its message was prepared). */
  job_done_at: string
}

/** A poor rating: 1-2 stars, or the aircon is not working well (mirror of `_is_low_feedback`). */
export function isLowFeedback(rating: number, workingWell: boolean): boolean {
  return rating <= FEEDBACK_LOW_RATING_MAX || !workingWell
}

/** The text that is sent: the message, a blank line, and the fixed link line (mirror of `_customer_message_full_text`). */
export function customerMessageFullText(body: string, feedbackUrl: string | null): string {
  return feedbackUrl ? `${body}\n\nLeave feedback: ${feedbackUrl}` : body
}

/** The link's address has not been set yet (`app_settings.feedback_link_base`). */
export function feedbackLinkIsPlaceholder(feedbackUrl: string | null): boolean {
  return feedbackUrl !== null && feedbackUrl.startsWith(`${FEEDBACK_LINK_PLACEHOLDER}/`)
}

export interface FeedbackFormValues {
  rating: number | null
  workingWell: boolean | null
  comment: string
}

/** A form with nothing answered yet. */
export const EMPTY_FEEDBACK_FORM: FeedbackFormValues = { rating: null, workingWell: null, comment: '' }

export interface FeedbackAnswers {
  rating: number
  workingWell: boolean
  comment: string | null
}

export type FeedbackFormErrors = Partial<Record<keyof FeedbackFormValues, string>>

export type FeedbackFormResult = { ok: true; value: FeedbackAnswers } | { ok: false; errors: FeedbackFormErrors }

/**
 * The answers (mirror of `_check_feedback`): 1-5 stars and Yes / No are
 * required; the comment is optional, trimmed, at most 1,000 characters (an
 * emoji counts as one); an empty comment is stored as none.
 */
export function validateFeedbackForm(values: FeedbackFormValues): FeedbackFormResult {
  const errors: FeedbackFormErrors = {}
  const { rating, workingWell } = values
  if (rating === null || !Number.isInteger(rating) || rating < FEEDBACK_RATING_MIN || rating > FEEDBACK_RATING_MAX) {
    errors.rating = FEEDBACK_RATING_REQUIRED_MESSAGE
  }
  if (workingWell === null) errors.workingWell = FEEDBACK_WORKING_REQUIRED_MESSAGE
  const comment = values.comment.trim()
  if ([...comment].length > FEEDBACK_COMMENT_MAX_LENGTH) errors.comment = FEEDBACK_COMMENT_TOO_LONG_MESSAGE
  if (Object.keys(errors).length > 0 || rating === null || workingWell === null) return { ok: false, errors }
  return { ok: true, value: { rating, workingWell, comment: comment === '' ? null : comment } }
}

/**
 * Who may record a landline customer's rating taken by phone (mirror of
 * `_phone_feedback_error`, for the order's latest message): an Admin or a
 * Manager covering the branch, never the technician; a landline customer
 * already told by phone; the order Job Done, Reviewed or Closed; once per visit.
 */
export function canRecordPhoneFeedback(
  role: StaffRole,
  coversBranch: boolean,
  orderStatus: OrderStatus,
  message: Pick<CustomerMessage, 'channel' | 'status'>,
  alreadyRated: boolean,
): boolean {
  return (
    (role === 'admin' || (role === 'manager' && coversBranch)) &&
    message.channel === 'phone' &&
    CUSTOMER_MESSAGE_STATUSES.includes(orderStatus) &&
    !alreadyRated &&
    message.status === 'told_by_phone'
  )
}

/** `★★☆☆☆` for 2 stars. */
export function ratingStars(rating: number): string {
  const n = Math.max(0, Math.min(FEEDBACK_RATING_MAX, Math.round(rating)))
  return '★'.repeat(n) + '☆'.repeat(FEEDBACK_RATING_MAX - n)
}

/** `Received from the customer at T` / `Taken by phone by Nurul Huda at T`. */
export function feedbackSourceLabel(f: Pick<OrderFeedback, 'source' | 'recorded_by_name' | 'created_at'>): string {
  const when = formatMalaysiaDateTime(f.created_at)
  return f.source === 'phone'
    ? `Taken by phone by ${f.recorded_by_name ?? 'someone'} at ${when}`
    : `Received from the customer at ${when}`
}
