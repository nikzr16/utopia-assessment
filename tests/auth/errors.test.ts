import { describe, expect, it } from 'vitest'
import {
  GENERIC_SIGN_IN_ERROR,
  mapAuthError,
  validateSignInInput,
} from '../../src/features/auth/errors'

describe('mapAuthError', () => {
  it('maps invalid credentials by code and by message', () => {
    expect(mapAuthError({ code: 'invalid_credentials', message: 'x', status: 400 })).toBe(
      'Email or password is incorrect.',
    )
    expect(mapAuthError({ message: 'Invalid login credentials' })).toBe(
      'Email or password is incorrect.',
    )
  })

  it('maps unconfirmed and disabled accounts', () => {
    expect(mapAuthError({ code: 'email_not_confirmed' })).toMatch(/not confirmed/i)
    // 0006: a deactivated person's sign-in is blocked (banned).
    expect(mapAuthError({ code: 'user_banned' })).toBe('Your account is no longer active. Ask your administrator if this is a mistake.')
  })

  it('maps rate limiting', () => {
    expect(mapAuthError({ code: 'over_request_rate_limit' })).toMatch(/too many attempts/i)
    expect(mapAuthError({ status: 429, message: 'slow down' })).toMatch(/too many attempts/i)
  })

  it('maps network failures', () => {
    expect(mapAuthError({ name: 'AuthRetryableFetchError', message: 'x', status: 0 })).toMatch(
      /cannot reach the server/i,
    )
    expect(mapAuthError(new TypeError('Failed to fetch'))).toMatch(/cannot reach the server/i)
  })

  it('falls back to a generic message and never leaks the raw error', () => {
    const msg = mapAuthError({ message: 'duplicate key value violates constraint "pg_internal"' })
    expect(msg).toBe(GENERIC_SIGN_IN_ERROR)
    expect(mapAuthError(null)).toBe(GENERIC_SIGN_IN_ERROR)
    expect(mapAuthError('boom')).toBe(GENERIC_SIGN_IN_ERROR)
    expect(mapAuthError(undefined)).toBe(GENERIC_SIGN_IN_ERROR)
  })
})

describe('validateSignInInput', () => {
  it('requires an email', () => {
    expect(validateSignInInput({ email: '  ', password: 'x' })).toBe('Enter your email address.')
  })

  it('rejects a malformed email', () => {
    expect(validateSignInInput({ email: 'ali', password: 'x' })).toBe(
      'Enter a valid email address.',
    )
    expect(validateSignInInput({ email: 'a li@x.com', password: 'x' })).toBe(
      'Enter a valid email address.',
    )
  })

  it('requires a password', () => {
    expect(validateSignInInput({ email: 'ali@example.com', password: '' })).toBe(
      'Enter your password.',
    )
  })

  it('accepts a valid pair, trimming the email', () => {
    expect(validateSignInInput({ email: ' ali@example.com ', password: 'secret' })).toBeNull()
  })
})
