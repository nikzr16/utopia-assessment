/**
 * Quoted price rules. Mirrors `_check_quoted_price` in
 * `supabase/migrations/20261022000005_admin_order_portal.sql`;
 * `tests/db/parity.test.ts` runs the same cases through both.
 */
export const QUOTED_PRICE_MAX = 100000

export const PRICE_REQUIRED_MESSAGE = 'Quoted price is required'
export const PRICE_NEGATIVE_MESSAGE = 'Quoted price must be zero or more'
export const PRICE_TOO_HIGH_MESSAGE = 'Quoted price cannot be more than RM 100,000.00'
export const PRICE_DECIMALS_MESSAGE = 'Quoted price can have at most 2 decimal places'
export const PRICE_NOT_A_NUMBER_MESSAGE = 'Enter the quoted price as a number, for example 250 or 250.50'

export type PriceResult = { ok: true; value: number } | { ok: false; error: string }

/**
 * Parses what the Admin typed (`250`, `1,250.50`, `RM 80`) and applies the
 * rules. The value is in ringgit with at most 2 decimals.
 */
export function parseQuotedPrice(input: string): PriceResult {
  const text = input.trim().replace(/^RM\s*/i, '').replace(/,/g, '')
  if (text === '') return { ok: false, error: PRICE_REQUIRED_MESSAGE }
  const m = /^(-)?(\d+)(?:\.(\d*))?$/.exec(text)
  if (!m) return { ok: false, error: PRICE_NOT_A_NUMBER_MESSAGE }
  const value = Number(text)
  if (m[1] && value !== 0) return { ok: false, error: PRICE_NEGATIVE_MESSAGE }
  if (value > QUOTED_PRICE_MAX) return { ok: false, error: PRICE_TOO_HIGH_MESSAGE }
  // Trailing zeros do not count as extra decimals (250.500 is 250.50).
  if ((m[3] ?? '').replace(/0+$/, '').length > 2) return { ok: false, error: PRICE_DECIMALS_MESSAGE }
  return { ok: true, value: Math.abs(value) }
}
