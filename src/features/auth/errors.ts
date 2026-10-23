/** Pure helpers for the sign-in form: input checks and friendly error messages. */

export const GENERIC_SIGN_IN_ERROR = 'Could not sign in. Please try again.'

/** Shown when a deactivated person signs in, or is signed out because they were deactivated (0006). */
export const DEACTIVATED_MESSAGE = 'Your account is no longer active. Ask your administrator if this is a mistake.'

export interface AuthErrorLike {
  message?: unknown
  code?: unknown
  status?: unknown
  name?: unknown
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * Turns a Supabase Auth error into a message a non-technical staff member can
 * act on. Never echoes server internals; unknown errors get a generic message.
 */
export function mapAuthError(error: unknown): string {
  if (!error || typeof error !== 'object') return GENERIC_SIGN_IN_ERROR
  const e = error as AuthErrorLike
  const code = text(e.code).toLowerCase()
  const message = text(e.message).toLowerCase()
  const status = typeof e.status === 'number' ? e.status : null

  if (code === 'invalid_credentials' || message.includes('invalid login credentials')) {
    return 'Email or password is incorrect.'
  }
  if (code === 'email_not_confirmed' || message.includes('email not confirmed')) {
    return 'Your account is not confirmed yet. Ask your administrator for help.'
  }
  if (code === 'user_banned' || message.includes('banned')) {
    return DEACTIVATED_MESSAGE
  }
  if (
    code === 'over_request_rate_limit' ||
    code === 'over_email_send_rate_limit' ||
    status === 429 ||
    message.includes('rate limit')
  ) {
    return 'Too many attempts. Wait a minute, then try again.'
  }
  if (
    text(e.name) === 'AuthRetryableFetchError' ||
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('network request failed') ||
    status === 0
  ) {
    return 'Cannot reach the server. Check your internet connection and try again.'
  }
  return GENERIC_SIGN_IN_ERROR
}

export interface SignInInput {
  email: string
  password: string
}

/** Returns a message for the first problem with the form input, or null when it is fine to submit. */
export function validateSignInInput({ email, password }: SignInInput): string | null {
  const trimmed = email.trim()
  if (!trimmed) return 'Enter your email address.'
  if (!/^[^\s@]+@[^\s@]+$/.test(trimmed)) return 'Enter a valid email address.'
  if (!password) return 'Enter your password.'
  return null
}
