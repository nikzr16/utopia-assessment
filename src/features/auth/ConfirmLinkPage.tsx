import { useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router'
import { Field } from '../../components/Field'
import { CircleCheckBig, KeyRound, Link as LinkIcon } from 'lucide-react'
import { BUTTON, CARD, INPUT } from '../../components/styles'
import { AuthLayout } from './AuthLayout'
import { LINK_EXPIRED_MESSAGE, setNewPassword, verifyEmailLink, type EmailLinkType } from './api'
import { PASSWORD_MIN, checkNewPassword } from './password'

type Step =
  | { name: 'start' }
  | { name: 'checking' }
  | { name: 'password' }
  | { name: 'done' }
  | { name: 'failed'; message: string }

const TITLES: Record<EmailLinkType, { title: string; intro: string }> = {
  invite: {
    title: 'Set up your sign-in',
    intro: 'Welcome to Sejuk Sejuk Service. Continue to choose the password you will sign in with.',
  },
  recovery: {
    title: 'Choose a new password',
    intro: 'Continue to choose a new password for your sign-in.',
  },
}

/**
 * Where the invite and password reset emails lead (0006). The link is used
 * only when the person presses Continue, so a mail scanner opening it does
 * not use it up; then they choose a password. Needs no sign-in.
 */
export function ConfirmLinkPage() {
  const [params] = useSearchParams()
  const tokenHash = params.get('token_hash') ?? ''
  const rawType = params.get('type')
  const type: EmailLinkType | null = rawType === 'invite' || rawType === 'recovery' ? rawType : null
  const [step, setStep] = useState<Step>(
    tokenHash && type ? { name: 'start' } : { name: 'failed', message: 'This link is not complete. Open the full link from your email.' },
  )

  const onContinue = async () => {
    setStep({ name: 'checking' })
    const error = await verifyEmailLink(tokenHash, type!)
    setStep(error ? { name: 'failed', message: error } : { name: 'password' })
  }

  const text = TITLES[type ?? 'invite']

  return (
    <AuthLayout panel={false}>
      {step.name === 'failed' ? (
        <section role="alert" className={`${CARD} text-center`}>
          <span className="mx-auto mb-3 inline-flex size-12 items-center justify-center rounded-full bg-danger-soft text-danger" aria-hidden="true">
            <LinkIcon className="size-5" />
          </span>
          <h2 className="text-lg font-semibold">{step.message === LINK_EXPIRED_MESSAGE ? 'This link no longer works' : 'Cannot use this link'}</h2>
          <p className="mt-1.5 text-sm text-ink-muted">{step.message}</p>
          <p className="mt-4 text-xs text-ink-faint">Need a new link? Ask your manager or an Admin to send one.</p>
        </section>
      ) : step.name === 'done' ? (
        <section role="status" className={`${CARD} text-center`}>
          <span className="mx-auto mb-3 inline-flex size-12 items-center justify-center rounded-full bg-success-soft text-success" aria-hidden="true">
            <CircleCheckBig className="size-6" />
          </span>
          <h2 className="text-lg font-semibold">Your password is saved</h2>
          <p className="mt-1.5 text-sm text-ink-muted">You are signed in.</p>
          <a href="/" className={`${BUTTON.primary} mt-5 w-full`}>
            Open the app
          </a>
        </section>
      ) : step.name === 'password' ? (
        <NewPasswordForm title={text.title} onSaved={() => setStep({ name: 'done' })} />
      ) : (
        <section className={CARD} aria-labelledby="confirm-title">
          <span className="mb-3 inline-flex size-11 items-center justify-center rounded-xl bg-brand-soft text-brand" aria-hidden="true">
            <KeyRound className="size-5" />
          </span>
          <h2 id="confirm-title" className="text-xl font-semibold tracking-tight">
            {text.title}
          </h2>
          <p className="mt-1.5 text-sm text-ink-muted">{text.intro}</p>
          <button type="button" className={`${BUTTON.primary} mt-5 min-h-11 w-full`} disabled={step.name === 'checking'} onClick={() => void onContinue()}>
            {step.name === 'checking' ? 'Checking the link…' : 'Continue'}
          </button>
        </section>
      )}
    </AuthLayout>
  )
}

function NewPasswordForm({ title, onSaved }: { title: string; onSaved: () => void }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const problem = checkNewPassword(password, confirm)
    if (problem) {
      setError(problem)
      return
    }
    setError(null)
    setSaving(true)
    const failure = await setNewPassword(password)
    setSaving(false)
    if (failure) setError(failure)
    else onSaved()
  }

  return (
    <form onSubmit={onSubmit} noValidate className={`${CARD} space-y-4`} aria-labelledby="new-password-title">
      <h2 id="new-password-title" className="text-xl font-semibold tracking-tight">
        {title}
      </h2>
      <PasswordPair password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} disabled={saving} />
      {error ? (
        <p role="alert" className="rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger-ink">
          {error}
        </p>
      ) : null}
      <button type="submit" className={`${BUTTON.primary} min-h-11 w-full`} disabled={saving}>
        {saving ? 'Saving…' : 'Save password'}
      </button>
    </form>
  )
}

/** "New password" and "Type it again", with the length hint. */
export function PasswordPair({
  password,
  confirm,
  onPassword,
  onConfirm,
  disabled,
}: {
  password: string
  confirm: string
  onPassword: (v: string) => void
  onConfirm: (v: string) => void
  disabled?: boolean
}) {
  return (
    <>
      <Field id="new-password" label="New password" hint={`At least ${PASSWORD_MIN} characters.`}>
        {(p) => (
          <input
            {...p}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => onPassword(e.target.value)}
            disabled={disabled}
            className={INPUT}
          />
        )}
      </Field>
      <Field id="confirm-password" label="Type the new password again">
        {(p) => (
          <input
            {...p}
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => onConfirm(e.target.value)}
            disabled={disabled}
            className={INPUT}
          />
        )}
      </Field>
    </>
  )
}
