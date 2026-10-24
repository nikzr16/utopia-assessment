import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { Field } from '../../components/Field'
import { BUTTON, CARD, INPUT, LINK } from '../../components/styles'
import { changeOwnPassword } from './api'
import { PasswordPair } from './ConfirmLinkPage'
import { checkNewPassword } from './password'
import { useAuth } from './useAuth'

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
    <div className="mx-auto max-w-md space-y-4">
      <Link to="/" className={`${LINK} text-sm`}>
        ← Back
      </Link>
      <form onSubmit={onSubmit} noValidate className={`${CARD} space-y-4`} aria-labelledby="change-password-title">
        <h2 id="change-password-title" className="text-xl font-semibold">
          Change my password
        </h2>
        {saved ? (
          <p role="status" className="rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-900">
            Your password is changed. Use it the next time you sign in.
          </p>
        ) : null}
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
          <p role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
            {error}
          </p>
        ) : null}
        <button type="submit" className={`${BUTTON.primary} w-full sm:w-auto`} disabled={saving}>
          {saving ? 'Saving…' : 'Change password'}
        </button>
      </form>
    </div>
  )
}
