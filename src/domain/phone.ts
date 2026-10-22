/**
 * Malaysian phone numbers. Mirrors `_normalize_my_phone` in
 * `supabase/migrations/20261022000005_admin_order_portal.sql`;
 * `tests/db/parity.test.ts` runs the same cases through both.
 *
 * Stored form: digits with the country code and no trunk 0 (`60123456789`).
 */
export const PHONE_REQUIRED_MESSAGE = 'Phone number is required'
export const PHONE_INVALID_MESSAGE =
  'Enter a valid Malaysian phone number, for example 012-345 6789 or 03-1234 5678'

export type PhoneResult = { ok: true; value: string } | { ok: false; error: string }

const SEPARATORS = /[\s().-]/g

const NATIONAL_PATTERNS: readonly RegExp[] = [
  /^01[02346789]\d{7}$/, // mobile, 7 digits after the prefix
  /^01[15]\d{8}$/, // mobile 011 / 015, 8 digits
  /^03\d{8}$/, // landline, Klang Valley
  /^0[4-79]\d{7}$/, // landline, other Peninsular areas
  /^08[2-9]\d{6}$/, // landline, Sabah and Sarawak
]

/** Accepts `+60` / `60` / `0` prefixes and spaces, dashes, dots and brackets. */
export function normalizeMyPhone(input: string): PhoneResult {
  const digits = input.replace(SEPARATORS, '')
  if (digits === '') return { ok: false, error: PHONE_REQUIRED_MESSAGE }

  let national: string
  if (/^\+?600?[1-9]\d*$/.test(digits)) {
    // Country code; tolerate a stray trunk 0 after it (+60 012...).
    national = '0' + digits.replace(/^\+?600?/, '')
  } else if (/^0\d+$/.test(digits)) {
    national = digits
  } else {
    return { ok: false, error: PHONE_INVALID_MESSAGE }
  }

  if (!NATIONAL_PATTERNS.some((p) => p.test(national))) {
    return { ok: false, error: PHONE_INVALID_MESSAGE }
  }
  return { ok: true, value: '60' + national.slice(1) }
}

/** True for a stored mobile number (WhatsApp-capable). */
export function isMyMobile(stored: string): boolean {
  return /^601\d{8,9}$/.test(stored)
}

/**
 * Display form of a stored number: `+60 12-345 6789`, `+60 11-2345 6789`,
 * `+60 3-1234 5678`, `+60 4-123 4567`, `+60 82-123 456`. Anything that is not
 * a stored Malaysian number is returned unchanged.
 */
export function formatMyPhone(stored: string): string {
  const m = /^60(\d+)$/.exec(stored)
  if (!m) return stored
  const n = m[1]
  let local: string | null = null
  if (/^1[15]\d{8}$/.test(n)) local = `${n.slice(0, 2)}-${n.slice(2, 6)} ${n.slice(6)}`
  else if (/^1\d{8}$/.test(n)) local = `${n.slice(0, 2)}-${n.slice(2, 5)} ${n.slice(5)}`
  else if (/^3\d{8}$/.test(n)) local = `3-${n.slice(1, 5)} ${n.slice(5)}`
  else if (/^8[2-9]\d{6}$/.test(n)) local = `${n.slice(0, 2)}-${n.slice(2, 5)} ${n.slice(5)}`
  else if (/^[4-79]\d{7}$/.test(n)) local = `${n.slice(0, 1)}-${n.slice(1, 4)} ${n.slice(4)}`
  return local ? `+60 ${local}` : stored
}
