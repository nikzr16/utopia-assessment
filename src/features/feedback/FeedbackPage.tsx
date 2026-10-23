import { useRef, useState, type ReactNode } from 'react'
import { useParams } from 'react-router'
import { BUTTON, CARD } from '../../components/styles'
import {
  EMPTY_FEEDBACK_FORM,
  FEEDBACK_STATE_MESSAGES,
  formatMalaysiaDateTime,
  validateFeedbackForm,
  type FeedbackForm,
  type FeedbackFormErrors,
  type FeedbackFormValues,
} from '../../domain'
import { isNetworkError } from '../../lib/api'
import { useLoad } from '../../lib/useLoad'
import { fetchFeedbackForm, submitFeedback } from './api'
import { FeedbackQuestions } from './FeedbackQuestions'

/**
 * The customer's feedback page at `/f/<token>` (PRD AC2–AC5, AC14): no
 * sign-in, phone-first. Shows only the job's order number, service type,
 * technician and Job Done date, then the three questions. A link that is
 * used, replaced, expired or unknown gets a clear page instead. On a network
 * failure the answers stay and Send can be tried again.
 */
export function FeedbackPage() {
  const { token = '' } = useParams()
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-lg px-4 py-3">
          <p className="text-lg font-semibold">Sejuk Sejuk Service</p>
          <p className="text-sm text-slate-600">Customer feedback</p>
        </div>
      </header>
      <main className="mx-auto max-w-lg px-4 py-6">
        <FeedbackContent token={token} />
      </main>
    </div>
  )
}

function FeedbackContent({ token }: { token: string }) {
  const [state, reload] = useLoad(() => fetchFeedbackForm(token), token)
  const [thanked, setThanked] = useState(false)

  if (thanked) {
    return (
      <Message title="Thank you!" tone="success">
        We have received your feedback. It helps us look after you better.
      </Message>
    )
  }
  if (state.status === 'loading') {
    return <p className="text-sm text-slate-600">Loading…</p>
  }
  if (state.status === 'error') {
    return (
      <Message title="Could not load the feedback form" tone="error">
        <p>{state.message}</p>
        <button type="button" onClick={reload} className={`${BUTTON.primary} mt-3 min-h-11 w-full`}>
          Try again
        </button>
      </Message>
    )
  }
  const form = state.data
  if (form.state === 'open') {
    return <OpenForm token={token} form={form} onDone={() => setThanked(true)} onStale={reload} />
  }
  return (
    <div className="space-y-4">
      <Message
        title={form.state === 'submitted' ? 'Feedback received' : 'This link cannot be used'}
        tone={form.state === 'submitted' ? 'success' : 'info'}
      >
        {FEEDBACK_STATE_MESSAGES[form.state]}.
      </Message>
      {form.state === 'submitted' ? <JobFacts form={form} /> : null}
    </div>
  )
}

function OpenForm({
  token,
  form,
  onDone,
  onStale,
}: {
  token: string
  form: FeedbackForm
  onDone: () => void
  /** The link stopped being usable meanwhile: reload to show why. */
  onStale: () => void
}) {
  const [values, setValues] = useState<FeedbackFormValues>(EMPTY_FEEDBACK_FORM)
  const [errors, setErrors] = useState<FeedbackFormErrors>({})
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const inFlight = useRef(false)

  async function send() {
    if (inFlight.current) return
    const checked = validateFeedbackForm(values)
    if (!checked.ok) {
      setErrors(checked.errors)
      return
    }
    setErrors({})
    setError(null)
    inFlight.current = true
    setSending(true)
    try {
      await submitFeedback(token, checked.value)
      onDone()
    } catch (e) {
      if (isNetworkError(e)) setError((e as Error).message)
      else onStale()
    } finally {
      inFlight.current = false
      setSending(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">How did we do?</h1>
        <p className="mt-1 text-sm text-slate-600">Please check the work and tell us how it went. It takes under a minute.</p>
      </div>
      <JobFacts form={form} />
      <form
        noValidate
        className={`${CARD} space-y-5`}
        onSubmit={(e) => {
          e.preventDefault()
          void send()
        }}
      >
        <FeedbackQuestions
          values={values}
          errors={errors}
          disabled={sending}
          onChange={setValues}
          onAnswered={(field) => setErrors(({ [field]: _answered, ...rest }) => rest)}
        />
        {error ? (
          <p role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
            {error} Your answers are kept.
          </p>
        ) : null}
        <button type="submit" disabled={sending} className={`${BUTTON.primary} min-h-12 w-full text-base`}>
          {sending ? 'Sending…' : 'Send feedback'}
        </button>
      </form>
    </div>
  )
}

/** Which job the link is for: never the customer's name, phone, address or any amount. */
function JobFacts({ form }: { form: FeedbackForm }) {
  return (
    <section aria-label="Your job" className={CARD}>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-slate-600">Order</dt>
        <dd className="font-medium">{form.order_no}</dd>
        <dt className="text-slate-600">Service</dt>
        <dd>{form.service_type}</dd>
        <dt className="text-slate-600">Technician</dt>
        <dd>{form.technician_name ?? '—'}</dd>
        <dt className="text-slate-600">Completed</dt>
        <dd>{formatMalaysiaDateTime(form.job_done_at)}</dd>
      </dl>
    </section>
  )
}

const MESSAGE_TONES = {
  info: 'border-sky-200 bg-sky-50 text-sky-950',
  success: 'border-green-300 bg-green-50 text-green-950',
  error: 'border-red-300 bg-red-50 text-red-950',
}

function Message({
  title,
  tone = 'info',
  children,
}: {
  title: string
  tone?: keyof typeof MESSAGE_TONES
  children: ReactNode
}) {
  return (
    <section role={tone === 'error' ? 'alert' : 'status'} className={`rounded-lg border p-5 ${MESSAGE_TONES[tone]}`}>
      <h1 className="text-lg font-semibold">{title}</h1>
      <div className="mt-2 text-sm">{children}</div>
    </section>
  )
}
