import { useState, type FormEvent } from 'react'
import { KeyRound } from 'lucide-react'
import { Field } from '../../components/Field'
import { BUTTON, CARD, INPUT } from '../../components/styles'
import { changeOwnPassword } from './api'
import { PasswordPair } from './ConfirmLinkPage'
import { checkNewPassword } from './password'
import { useAuth } from './useAuth'
import { Toast } from '../../components/Toast'
import { BackLink } from '../../components/ui'

/** "Change my password" for every signed-in staff member (0006, plan P7). */
export function ChangePasswordPage() {
  const { email } = useAuth()
  const [current, setCurrent] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const problem = !current ? 'Enter your current password.' : checkNewPassword(password, confirm)
    if (problem) {
      setError(problem)
      return
    }
    setError(null)
    setSaving(true)
    const failure = await changeOwnPassword(email ?? '', current, password)
    setSaving(false)
    if (failure) {
      setError(failure)
      return
    }
    setCurrent('')
    setPassword('')
    setConfirm('')
    setSaved(true)
  }

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <BackLink to="/">Back</BackLink>
      {saved ? (
        <Toast onDismiss={() => setSaved(false)}>Your password is changed. Use it the next time you sign in.</Toast>
      ) : null}
      <form onSubmit={onSubmit} noValidate className={`${CARD} space-y-5`} aria-labelledby="change-password-title">
        <div className="flex items-start gap-3">
          <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand" aria-hidden="true">
            <KeyRound className="size-5" />
          </span>
          <div>
            <h2 id="change-password-title" className="text-xl font-semibold tracking-tight">
              Change my password
            </h2>
            <p className="mt-0.5 text-sm text-ink-muted">You stay signed in on this device.</p>
          </div>
        </div>
        <Field id="current-password" label="Current password">
          {(p) => (
            <input
              {...p}
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => {
                setCurrent(e.target.value)
                setSaved(false)
              }}
              disabled={saving}
              className={INPUT}
            />
          )}
        </Field>
        <PasswordPair password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} disabled={saving} />
        {error ? (
          <p role="alert" className="rounded-xl border border-danger/35 bg-danger-soft px-3 py-2.5 text-sm text-danger-ink">
            {error}
          </p>
        ) : null}
        <button type="submit" className={`${BUTTON.primary} min-h-11 w-full sm:w-auto`} disabled={saving}>
          {saving ? 'Saving…' : 'Change password'}
        </button>
      </form>
    </div>
  )
}
