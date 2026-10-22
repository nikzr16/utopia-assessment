export type PaymentStatus = 'unpaid' | 'partial' | 'paid'

const toCents = (amount: number): number => Math.round(amount * 100)

/** Final amount = quoted price + extra charges, rounded to sen. Never typed in by a person. */
export function finalAmount(quoted: number, extra: number): number {
  return (toCents(quoted) + toCents(extra)) / 100
}

/**
 * `paid` when paid >= final (overpayment counts as paid), `unpaid` when
 * nothing has been paid, otherwise `partial`.
 * A zero-amount order owes nothing, so it is `paid`.
 * Mirrors the `payment_status` column of the `order_summary` view.
 */
export function paymentStatus(final: number, paid: number): PaymentStatus {
  const finalCents = toCents(final)
  const paidCents = toCents(paid)
  if (paidCents >= finalCents) return 'paid'
  if (paidCents <= 0) return 'unpaid'
  return 'partial'
}

/** Amount still owed; never negative. */
export function balance(final: number, paid: number): number {
  return Math.max(0, (toCents(final) - toCents(paid)) / 100)
}

/** Amount paid above the final amount (0 when not overpaid). */
export function overpaid(final: number, paid: number): number {
  return Math.max(0, (toCents(paid) - toCents(final)) / 100)
}

export function formatMYR(amount: number): string {
  return `RM ${amount.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
