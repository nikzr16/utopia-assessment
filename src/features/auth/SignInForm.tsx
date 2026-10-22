import { useId, useState, type FormEvent } from 'react'
import { validateSignInInput } from './errors'
import { useAuth } from './useAuth'

const INPUT_CLASS =
  'mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-base shadow-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200 disabled:bg-slate-100'

export function SignInForm() {
  const { signIn } = useAuth()
  const emailId = useId()
  const passwordId = useId()
  const errorId = useId()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
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
    <section
      aria-labelledby="sign-in-title"
      className="mx-auto w-full max-w-sm rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
    >
      <h2 id="sign-in-title" className="text-xl font-semibold">
        Sign in
      </h2>
      <p className="mt-1 text-sm text-slate-600">Use the email and password your company gave you.</p>

      <form onSubmit={handleSubmit} noValidate className="mt-4 space-y-4">
        <div>
          <label htmlFor={emailId} className="block text-sm font-medium text-slate-700">
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
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={submitting}
            aria-describedby={error ? errorId : undefined}
            className={INPUT_CLASS}
          />
        </div>
        <div>
          <label htmlFor={passwordId} className="block text-sm font-medium text-slate-700">
            Password
          </label>
          <input
            id={passwordId}
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={submitting}
            aria-describedby={error ? errorId : undefined}
            className={INPUT_CLASS}
          />
        </div>

        {error ? (
          <p
            id={errorId}
            role="alert"
            className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900"
          >
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-sky-700 px-4 py-2.5 text-base font-medium text-white hover:bg-sky-800 focus:outline-none focus:ring-2 focus:ring-sky-300 disabled:cursor-not-allowed disabled:bg-sky-400"
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </section>
  )
}
