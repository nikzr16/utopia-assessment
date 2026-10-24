import { isSupabaseConfigured, supabase } from '../../lib/supabase'
import { mapAuthError } from './errors'

/**
 * Password calls (0006): the email link (invite / reset) and "Change my
 * password". Each resolves to an error message, or null on success. UI tests
 * replace this module with test doubles.
 */

export type EmailLinkType = 'invite' | 'recovery'

export const LINK_EXPIRED_MESSAGE =
  'This link has expired or was already used. Ask your administrator to send a new one.'

/** Use the token from the email link: signs the person in for setting a password. */
export async function verifyEmailLink(tokenHash: string, type: EmailLinkType): Promise<string | null> {
  if (!isSupabaseConfigured || !supabase) return 'The app is not connected to the database.'
  try {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
    if (!error) return null
    const mapped = mapAuthError(error)
    return /expired|invalid|otp|token/i.test(String(error.message)) || (error as { code?: string }).code === 'otp_expired'
      ? LINK_EXPIRED_MESSAGE
      : mapped
  } catch (e) {
    return mapAuthError(e)
  }
}

/** Save a new password for the signed-in account. */
export async function setNewPassword(password: string): Promise<string | null> {
  if (!supabase) return 'The app is not connected to the database.'
  try {
    const { error } = await supabase.auth.updateUser({ password })
    if (!error) return null
    if ((error as { code?: string }).code === 'same_password') return 'Choose a password you have not used before.'
    if ((error as { code?: string }).code === 'weak_password') return 'Choose a stronger password.'
    return mapAuthError(error)
  } catch (e) {
    return mapAuthError(e)
  }
}

/** Check the current password (by signing in with it again), then save the new one. */
export async function changeOwnPassword(email: string, current: string, next: string): Promise<string | null> {
  if (!supabase) return 'The app is not connected to the database.'
  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password: current })
    if (error) {
      return (error as { code?: string }).code === 'invalid_credentials' || /invalid login/i.test(error.message)
        ? 'Your current password is incorrect.'
        : mapAuthError(error)
    }
  } catch (e) {
    return mapAuthError(e)
  }
  return setNewPassword(next)
}
