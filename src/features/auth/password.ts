/** A new password: 8–72 characters (Supabase hashes at most 72 bytes), typed twice. */
export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 72

export function checkNewPassword(password: string, confirm: string): string | null {
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`
  if (new TextEncoder().encode(password).length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`
  if (password !== confirm) return 'The two passwords do not match.'
  return null
}
