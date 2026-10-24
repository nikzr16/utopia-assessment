import { useId, useRef, useState } from 'react'
import { CircleX, Clock, PhoneCall, RotateCw, Save, Star, TriangleAlert } from 'lucide-react'
import { Dialog } from '../../components/Dialog'
import { BUTTON, CARD } from '../../components/styles'
import {
  EMPTY_FEEDBACK_FORM,
  FEEDBACK_LINK_DAYS,
  FEEDBACK_RATING_LABELS,
  FEEDBACK_RATING_MAX,
  canRecordPhoneFeedback,
  customerMessageOffered,
  feedbackSourceLabel,
  formatMalaysiaDateTime,
  isLowFeedback,
  ratingStars,
  validateFeedbackForm,
  type CustomerMessage,
  type FeedbackFormErrors,
  type FeedbackFormValues,
  type OrderFeedback,
  type OrderStatus,
  type StaffRole,
} from '../../domain'
import { isNetworkError } from '../../lib/api'
import { useLoad } from '../../lib/useLoad'
import { staffName, useInactiveStaff } from '../../lib/staffStatus'
import { useRefreshOnReturn } from '../../lib/useRefreshOnReturn'
import { fetchLatestCustomerMessage } from '../customer-messages/api'
import { fetchOrderFeedback, recordPhoneFeedback } from './api'
import { FeedbackQuestions } from './FeedbackQuestions'

interface CardData {
  feedback: OrderFeedback[]
  latest: CustomerMessage | null
}

/**
 * "Customer feedback" on the Admin order detail, the technician job page and
 * the Manager / Finance order page (PRD AC7, AC9): every visit's rating,
 * latest first, how it came in, and a "Poor rating" tag. While the latest
 * visit has none, it says whether the customer's link is still open, and an
 * Admin or a covering Manager can record a landline customer's rating taken
 * by phone. Shows nothing before the first Job Done.
 */
export function FeedbackCard({
  orderId,
  orderStatus,
  role,
  coversBranch = false,
  refreshKey = 0,
}: {
  orderId: string
  orderStatus: OrderStatus
  role: StaffRole
  /** A Manager covers the order's branch. */
  coversBranch?: boolean
  /** Change it to reload, e.g. after the customer was told by phone. */
  refreshKey?: number
}) {
  const [state, reload] = useLoad<CardData>(
    async () => {
      // The latest message matters only while it is offered (not during a rework).
      const [feedback, latest] = await Promise.all([
        fetchOrderFeedback(orderId),
        customerMessageOffered(orderStatus) ? fetchLatestCustomerMessage(orderId) : Promise.resolve(null),
      ])
      return { feedback, latest }
    },
    `${orderId}:${orderStatus}:${refreshKey}`,
  )
  useRefreshOnReturn(reload)
  const [recording, setRecording] = useState(false)
  const headingId = useId()

  if (state.status === 'loading') return null
  if (state.status === 'error') {
    return (
      <section className={CARD} aria-label="Customer feedback">
        <p role="alert" className="flex gap-2 text-sm text-danger-ink">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0">Could not load the customer feedback. {state.message}</span>
        </p>
        <button type="button" onClick={reload} className={`${BUTTON.secondary} mt-3 min-h-11`}>
          <RotateCw aria-hidden="true" />
          Try again
        </button>
      </section>
    )
  }
  const { feedback, latest } = state.data
  if (feedback.length === 0 && !customerMessageOffered(orderStatus)) return null

  const latestRated = latest !== null && feedback.some((f) => f.message_id === latest.id)
  const canRecord =
    latest !== null && canRecordPhoneFeedback(role, coversBranch, orderStatus, latest, latestRated)

  return (
    <section className={CARD} aria-labelledby={headingId}>
      <h3 id={headingId} className="flex items-center gap-2 text-base font-semibold text-ink">
        <Star className="size-4.5 text-warning" aria-hidden="true" />
        Customer feedback
      </h3>

      {latest && !latestRated && customerMessageOffered(orderStatus) ? (
        <p className="mt-3 flex gap-2 text-sm text-ink-muted">
          <Clock className="mt-0.5 size-4 shrink-0 text-ink-faint" aria-hidden="true" />
          <span className="min-w-0">{waitingText(latest)}</span>
        </p>
      ) : null}

      {feedback.length > 0 ? (
        <ol className="mt-3 space-y-3">
          {feedback.map((f) => (
            <li
              key={f.id}
              className={`rounded-lg border px-3 py-2.5 ${
                isLowFeedback(f.rating, f.working_well) ? 'border-danger/30 bg-danger-soft/40' : 'border-line bg-sunken/50'
              }`}
            >
              <FeedbackItem feedback={f} showVisit={feedback.length > 1} />
            </li>
          ))}
        </ol>
      ) : null}

      {canRecord ? (
        <button
          type="button"
          onClick={() => setRecording(true)}
          className={`${BUTTON.secondary} mt-3 min-h-11 w-full sm:w-auto`}
        >
          <PhoneCall aria-hidden="true" />
          Record rating taken by phone
        </button>
      ) : null}

      {recording && latest ? (
        <PhoneFeedbackDialog
          messageId={latest.id}
          onClose={() => setRecording(false)}
          onDone={() => {
            setRecording(false)
            reload()
          }}
        />
      ) : null}
    </section>
  )
}

function waitingText(latest: CustomerMessage): string {
  if (latest.channel === 'phone') {
    return latest.status === 'told_by_phone'
      ? 'No rating yet. This customer has no WhatsApp; an Admin or the branch Manager can record their rating taken by phone.'
      : 'No rating yet. Call the customer first; their rating can then be recorded here.'
  }
  const until = new Date(new Date(latest.created_at).getTime() + FEEDBACK_LINK_DAYS * 24 * 60 * 60 * 1000)
  const when = formatMalaysiaDateTime(until.toISOString())
  if (until.getTime() <= Date.now()) return `No feedback. The customer's link expired on ${when}.`
  return latest.status === 'not_sent'
    ? `No feedback yet. The link goes out with the customer message and works until ${when}.`
    : `No feedback yet. The customer's link works until ${when}.`
}

function FeedbackItem({ feedback: f, showVisit }: { feedback: OrderFeedback; showVisit: boolean }) {
  useInactiveStaff() // re-render with "(inactive)" tags once known
  const low = isLowFeedback(f.rating, f.working_well)
  return (
    <div className="space-y-1 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span
          role="img"
          aria-label={`${f.rating} out of ${FEEDBACK_RATING_MAX} stars`}
          className="text-lg leading-none text-warning"
        >
          {ratingStars(f.rating)}
        </span>
        <span className="font-medium">{FEEDBACK_RATING_LABELS[f.rating]}</span>
        {low ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-danger-soft px-2.5 py-0.5 text-xs font-medium text-danger-ink ring-1 ring-inset ring-danger/30">
            <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
            Poor rating
          </span>
        ) : null}
      </div>
      <p>
        Aircon working well now: <span className="font-medium">{f.working_well ? 'Yes' : 'No'}</span>
      </p>
      {f.comment ? (
        <blockquote className="whitespace-pre-line break-words border-l-2 border-line-strong pl-3 text-ink">
          {f.comment}
        </blockquote>
      ) : null}
      <p className="text-xs text-ink-faint">
        {feedbackSourceLabel({ ...f, recorded_by_name: staffName(f.recorded_by_name, f.recorded_by) })}
        {showVisit ? ` · visit done ${formatMalaysiaDateTime(f.job_done_at)}` : ''}
      </p>
    </div>
  )
}

/** The three questions for staff asking a landline customer on the phone. */
function PhoneFeedbackDialog({
  messageId,
  onClose,
  onDone,
}: {
  messageId: string
  onClose: () => void
  onDone: () => void
}) {
  const [values, setValues] = useState<FeedbackFormValues>(EMPTY_FEEDBACK_FORM)
  const [errors, setErrors] = useState<FeedbackFormErrors>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const inFlight = useRef(false)

  async function save() {
    if (inFlight.current) return
    const checked = validateFeedbackForm(values)
    if (!checked.ok) {
      setErrors(checked.errors)
      return
    }
    setErrors({})
    setError(null)
    inFlight.current = true
    setSaving(true)
    try {
      await recordPhoneFeedback(messageId, checked.value)
      onDone()
    } catch (e) {
      setError((e as Error).message + (isNetworkError(e) ? ' The answers are kept.' : ''))
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }

  return (
    <Dialog title="Record rating taken by phone" onClose={onClose}>
      <form
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <p className="text-sm text-ink-muted">Ask the customer these questions and enter their answers.</p>
        <FeedbackQuestions
          values={values}
          errors={errors}
          disabled={saving}
          onChange={setValues}
          onAnswered={(field) => setErrors(({ [field]: _answered, ...rest }) => rest)}
          byPhone
        />
        {error ? (
          <p role="alert" className="flex gap-2 rounded-lg border border-danger/35 bg-danger-soft px-3 py-2 text-sm text-danger-ink">
            <CircleX className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0">{error}</span>
          </p>
        ) : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} disabled={saving} className={`${BUTTON.secondary} min-h-11`}>
            Cancel
          </button>
          <button type="submit" disabled={saving} className={`${BUTTON.primary} min-h-11`}>
            <Save aria-hidden="true" />
            {saving ? 'Saving…' : 'Save rating'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
