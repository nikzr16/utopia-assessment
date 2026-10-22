/**
 * Money rules for typed amounts. Quoted price mirrors `_check_quoted_price`
 * (`supabase/migrations/20261022000005_admin_order_portal.sql`); extra
 * charges mirror `_check_extra_charges`
 * (`supabase/migrations/20261022000006_technician_job_portal.sql`).
 * `tests/db/parity.test.ts` runs the same cases through both.
 */
export const QUOTED_PRICE_MAX = 100000
export const EXTRA_CHARGES_MAX = 100000

export const PRICE_REQUIRED_MESSAGE = 'Quoted price is required'
export const PRICE_NEGATIVE_MESSAGE = 'Quoted price must be zero or more'
export const PRICE_TOO_HIGH_MESSAGE = 'Quoted price cannot be more than RM 100,000.00'
export const PRICE_DECIMALS_MESSAGE = 'Quoted price can have at most 2 decimal places'
export const PRICE_NOT_A_NUMBER_MESSAGE = 'Enter the quoted price as a number, for example 250 or 250.50'

export const EXTRA_NEGATIVE_MESSAGE = 'Extra charges cannot be negative'
export const EXTRA_TOO_HIGH_MESSAGE = 'Extra charges cannot be more than RM 100,000.00'
export const EXTRA_DECIMALS_MESSAGE = 'Extra charges can have at most 2 decimal places'
export const EXTRA_NOT_A_NUMBER_MESSAGE = 'Enter the extra charges as a number, for example 50 or 50.50'

export type PriceResult = { ok: true; value: number } | { ok: false; error: string }

interface MoneyRule {
  /** Value for an empty field, or null when the field is required. */
  empty: number | null
  max: number
  messages: { required: string; negative: string; tooHigh: string; decimals: string; notANumber: string }
}

/**
 * Parses what a person typed (`250`, `1,250.50`, `RM 80`) and applies the
 * rule. The value is in ringgit with at most 2 decimals.
 */
function parseRinggit(input: string, rule: MoneyRule): PriceResult {
  const text = input.trim().replace(/^RM\s*/i, '').replace(/,/g, '')
  if (text === '') {
    return rule.empty === null ? { ok: false, error: rule.messages.required } : { ok: true, value: rule.empty }
  }
  const m = /^(-)?(\d+)(?:\.(\d*))?$/.exec(text)
  if (!m) return { ok: false, error: rule.messages.notANumber }
  const value = Number(text)
  if (m[1] && value !== 0) return { ok: false, error: rule.messages.negative }
  if (value > rule.max) return { ok: false, error: rule.messages.tooHigh }
  // Trailing zeros do not count as extra decimals (250.500 is 250.50).
  if ((m[3] ?? '').replace(/0+$/, '').length > 2) return { ok: false, error: rule.messages.decimals }
  return { ok: true, value: Math.abs(value) }
}

/** Quoted price: required, RM 0.00 – 100,000.00, at most 2 decimals. */
export function parseQuotedPrice(input: string): PriceResult {
  return parseRinggit(input, {
    empty: null,
    max: QUOTED_PRICE_MAX,
    messages: {
      required: PRICE_REQUIRED_MESSAGE,
      negative: PRICE_NEGATIVE_MESSAGE,
      tooHigh: PRICE_TOO_HIGH_MESSAGE,
      decimals: PRICE_DECIMALS_MESSAGE,
      notANumber: PRICE_NOT_A_NUMBER_MESSAGE,
    },
  })
}

/** Extra charges: empty means RM 0; RM 0.00 – 100,000.00, at most 2 decimals. */
export function parseExtraCharges(input: string): PriceResult {
  return parseRinggit(input, {
    empty: 0,
    max: EXTRA_CHARGES_MAX,
    messages: {
      required: '',
      negative: EXTRA_NEGATIVE_MESSAGE,
      tooHigh: EXTRA_TOO_HIGH_MESSAGE,
      decimals: EXTRA_DECIMALS_MESSAGE,
      notANumber: EXTRA_NOT_A_NUMBER_MESSAGE,
    },
  })
}
