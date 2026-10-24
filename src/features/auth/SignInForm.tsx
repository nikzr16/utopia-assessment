import { useId, useState, type FormEvent } from 'react'
import { Eye, EyeOff, LoaderCircle, LogIn } from 'lucide-react'
import { BUTTON, INPUT } from '../../components/styles'
import { AuthLayout } from './AuthLayout'
import { validateSignInInput } from './errors'
import { useAuth } from './useAuth'

export function SignInForm() {
  const { signIn, notice } = useAuth()
  const emailId = useId()
  const passwordId = useId()
  const errorId = useId()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return
    const problem = validateSignInInput({ email, password })
    if (problem) {
      setError(problem)
      return
    }
    setError(null)
    setSubmitting(true)
    const message = await signIn(email, password)
    // On success the auth state change swaps this screen out, so only failures need handling.
    if (message) {
      setError(message)
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout>
      <section aria-labelledby="sign-in-title">
        <h2 id="sign-in-title" className="text-2xl font-semibold tracking-tight">
          Sign in
        </h2>
        <p className="mt-1.5 text-sm text-ink-muted">Use your work email and the password you chose.</p>
        {notice ? (
          <p role="status" className="mt-4 rounded-xl border border-warning/40 bg-warning-soft px-3 py-2.5 text-sm text-warning-ink">
            {notice}
          </p>
        ) : null}

        <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-4">
          <div>
            <label htmlFor={emailId} className="block text-sm font-medium text-ink">
              Email
            </label>
            <input
              id={emailId}
              type="email"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              placeholder="name@sejuk.example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
              aria-describedby={error ? errorId : undefined}
              className={`${INPUT} mt-1.5 min-h-11 text-base`}
            />
          </div>
          <div>
            <label htmlFor={passwordId} className="block text-sm font-medium text-ink">
              Password
            </label>
            <div className="relative mt-1.5">
              <input
                id={passwordId}
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
                aria-describedby={error ? errorId : undefined}
                className={`${INPUT} min-h-11 pr-12 text-base`}
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                aria-pressed={showPassword}
                className="absolute inset-y-0 right-0 inline-flex w-11 items-center justify-center rounded-r-lg text-ink-faint hover:text-ink"
              >
                {showPassword ? <EyeOff className="size-4.5" aria-hidden="true" /> : <Eye className="size-4.5" aria-hidden="true" />}
                <span className="sr-only">Show password</span>
              </button>
            </div>
          </div>

          {error ? (
            <p id={errorId} role="alert" className="rounded-xl border border-danger/35 bg-danger-soft px-3 py-2.5 text-sm text-danger-ink">
              {error}
            </p>
          ) : null}

          <button type="submit" disabled={submitting} className={`${BUTTON.primary} min-h-12 w-full text-base`}>
            {submitting ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <LogIn aria-hidden="true" />}
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p className="mt-6 text-center text-xs text-ink-faint">
          Forgot your password? Ask your manager or an Admin to send you a reset email.
        </p>
      </section>
    </AuthLayout>
  )
}
