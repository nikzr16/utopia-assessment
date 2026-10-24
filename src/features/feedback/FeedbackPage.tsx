import { useRef, useState, type ReactNode } from 'react'
import { useParams } from 'react-router'
import { CalendarCheck, CircleCheckBig, ClipboardList, Heart, Languages, LinkIcon, RotateCw, UserRound, Wrench } from 'lucide-react'
import { Logo } from '../../components/Logo'
import { BUTTON, CARD } from '../../components/styles'
import { Skeleton } from '../../components/ui'
import {
  EMPTY_FEEDBACK_FORM,
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
import { FEEDBACK_TEXT, formatMalayDateTime, readFeedbackLang, saveFeedbackLang, type FeedbackLang, type FeedbackText } from './i18n'

/**
 * The customer's feedback page at `/f/<token>` (PRD AC2–AC5, AC14): no
 * sign-in, phone-first, branded (0011 Q18), in English or Malay (0011 Q19).
 * Shows only the job's order number, service type, technician and Job Done
 * date, then the three questions. A link that is used, replaced, expired or
 * unknown gets a clear page instead. On a network failure the answers stay
 * and Send can be tried again.
 */
export function FeedbackPage() {
  const { token = '' } = useParams()
  const [lang, setLang] = useState<FeedbackLang>(readFeedbackLang)
  const text = FEEDBACK_TEXT[lang]
  const choose = (next: FeedbackLang) => {
    setLang(next)
    saveFeedbackLang(next)
  }
  return (
    <div className="flex min-h-dvh flex-col bg-canvas text-ink" lang={lang === 'ms' ? 'ms' : 'en'}>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-lg items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <Logo showName={false} />
            <div className="min-w-0">
              <p className="truncate font-semibold leading-tight">Sejuk Sejuk Service</p>
              <p className="truncate text-xs text-ink-muted">{text.tagline}</p>
            </div>
          </div>
          <div role="group" aria-label={text.language} className="flex shrink-0 items-center gap-1 rounded-lg bg-sunken p-1 ring-1 ring-inset ring-line">
            <Languages className="ml-1 size-4 text-ink-faint" aria-hidden="true" />
            {(['en', 'ms'] as const).map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={lang === l}
                onClick={() => choose(l)}
                lang={l}
                className={`min-h-9 min-w-10 rounded-md px-2 text-xs font-semibold ${lang === l ? 'bg-surface text-ink shadow-card' : 'text-ink-muted'}`}
              >
                {l === 'en' ? 'EN' : 'BM'}
                <span className="sr-only">{l === 'en' ? ' English' : ' Bahasa Melayu'}</span>
              </button>
            ))}
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-lg flex-1 px-4 py-6">
        <FeedbackContent token={token} text={text} lang={lang} />
      </main>
      <footer className="px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-center text-xs text-ink-faint">{text.footer}</footer>
    </div>
  )
}

function FeedbackContent({ token, text, lang }: { token: string; text: FeedbackText; lang: FeedbackLang }) {
  const [state, reload] = useLoad(() => fetchFeedbackForm(token), token)
  const [thanked, setThanked] = useState(false)

  if (thanked) {
    return (
      <Message title={text.thanksTitle} tone="success" icon={<Heart className="size-6" />}>
        {text.thanksBody}
      </Message>
    )
  }
  if (state.status === 'loading') {
    return (
      <div role="status" className="space-y-4">
        <span className="sr-only">{text.loading}</span>
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-full" />
        <div className={`${CARD} space-y-3`}>
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </div>
    )
  }
  if (state.status === 'error') {
    return (
      <Message title={text.loadErrorTitle} tone="error" icon={<LinkIcon className="size-6" />}>
        <p>{state.message}</p>
        <button type="button" onClick={reload} className={`${BUTTON.primary} mt-4 min-h-11 w-full`}>
          <RotateCw aria-hidden="true" />
          {text.tryAgain}
        </button>
      </Message>
    )
  }
  const form = state.data
  if (form.state === 'open') {
    return <OpenForm token={token} form={form} text={text} lang={lang} onDone={() => setThanked(true)} onStale={reload} />
  }
  return (
    <div className="space-y-4">
      <Message
        title={form.state === 'submitted' ? text.receivedTitle : text.cannotUseTitle}
        tone={form.state === 'submitted' ? 'success' : 'info'}
        icon={form.state === 'submitted' ? <CircleCheckBig className="size-6" /> : <LinkIcon className="size-6" />}
      >
        {text.states[form.state]}.
      </Message>
      {form.state === 'submitted' ? <JobFacts form={form} text={text} lang={lang} /> : null}
    </div>
  )
}

function OpenForm({
  token,
  form,
  text,
  lang,
  onDone,
  onStale,
}: {
  token: string
  form: FeedbackForm
  text: FeedbackText
  lang: FeedbackLang
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
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{text.title}</h1>
        <p className="mt-1.5 text-sm text-ink-muted">{text.intro}</p>
      </div>
      <JobFacts form={form} text={text} lang={lang} />
      <form
        noValidate
        className={`${CARD} space-y-6`}
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
          text={text}
        />
        {error ? (
          <p role="alert" className="rounded-xl border border-danger/35 bg-danger-soft px-3 py-2.5 text-sm text-danger-ink">
            {error} {text.answersKept}
          </p>
        ) : null}
        <button type="submit" disabled={sending} className={`${BUTTON.primary} min-h-12 w-full text-base`}>
          {sending ? text.sending : text.send}
        </button>
      </form>
    </div>
  )
}

/** Which job the link is for: never the customer's name, phone, address or any amount. */
function JobFacts({ form, text, lang }: { form: FeedbackForm; text: FeedbackText; lang: FeedbackLang }) {
  const rows = [
    { icon: ClipboardList, label: text.order, value: <span className="font-semibold">{form.order_no}</span> },
    { icon: Wrench, label: text.service, value: form.service_type },
    { icon: UserRound, label: text.technician, value: form.technician_name ?? '—' },
    {
      icon: CalendarCheck,
      label: text.completed,
      value: lang === 'ms' && form.job_done_at ? formatMalayDateTime(form.job_done_at) : formatMalaysiaDateTime(form.job_done_at),
    },
  ]
  return (
    <section aria-label={text.yourJob} className={`${CARD} py-3 sm:py-4`}>
      <dl className="divide-y divide-line text-sm">
        {rows.map(({ icon: Icon, label, value }) => (
          <div key={label} className="flex items-center gap-3 py-2">
            <Icon className="size-4 shrink-0 text-ink-faint" aria-hidden="true" />
            <dt className="w-28 shrink-0 text-ink-muted">{label}</dt>
            <dd className="min-w-0 break-words text-ink">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

const MESSAGE_TONES = {
  info: 'bg-brand-soft text-brand',
  success: 'bg-success-soft text-success',
  error: 'bg-danger-soft text-danger',
}

function Message({
  title,
  tone = 'info',
  icon,
  children,
}: {
  title: string
  tone?: keyof typeof MESSAGE_TONES
  icon: ReactNode
  children: ReactNode
}) {
  return (
    <section role={tone === 'error' ? 'alert' : 'status'} className={`${CARD} px-5 py-8 text-center`}>
      <span className={`mx-auto mb-4 inline-flex size-14 items-center justify-center rounded-full ${MESSAGE_TONES[tone]}`} aria-hidden="true">
        {icon}
      </span>
      <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
      <div className="mx-auto mt-2 max-w-sm text-sm text-ink-muted">{children}</div>
    </section>
  )
}
