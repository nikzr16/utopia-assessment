import type { OrderStatus, PaymentMethod, StaffRole } from './statuses'

/**
 * Recording a payment: methods, the receipt rule, and the form sent to
 * `record_payment` (methods: `PAYMENT_METHODS` in `statuses.ts`). Mirrors
 * `record_payment` and `_payment_method_label` in
 * `supabase/migrations/20261022000006_technician_job_portal.sql`;
 * `tests/db/parity.test.ts` checks both.
 */
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  bank_transfer: 'Bank transfer',
  card: 'Card',
  ewallet: 'E-wallet',
}

/** Statuses in which a payment can be recorded. */
export const PAYMENT_STATUSES: readonly OrderStatus[] = ['in_progress', 'job_done', 'reviewed']

/** The assigned technician or Finance, while In Progress, Job Done or Reviewed. */
export function canRecordPayment(status: OrderStatus, role: StaffRole, isAssignedTechnician: boolean): boolean {
  const who = (role === 'technician' && isAssignedTechnician) || role === 'finance'
  return who && PAYMENT_STATUSES.includes(status)
}

/** Bank transfer, card and e-wallet payments need a receipt; cash does not. */
export function receiptRequired(method: PaymentMethod): boolean {
  return method !== 'cash'
}

export const PAYMENT_AMOUNT_REQUIRED_MESSAGE = 'Enter the payment amount'
export const PAYMENT_AMOUNT_POSITIVE_MESSAGE = 'Payment amount must be greater than zero'
export const PAYMENT_AMOUNT_DECIMALS_MESSAGE = 'Payment amount can have at most 2 decimal places'
export const PAYMENT_AMOUNT_NOT_A_NUMBER_MESSAGE = 'Enter the amount as a number, for example 250 or 250.50'
export const PAYMENT_METHOD_REQUIRED_MESSAGE = 'Select a payment method'
export const RECEIPT_REQUIRED_MESSAGE = 'Attach a receipt for bank transfer, card or e-wallet payments'

export interface PaymentFormValues {
  amount: string
  /** '' = not chosen yet. */
  method: PaymentMethod | ''
  note: string
}

export type PaymentFormField = keyof PaymentFormValues | 'receipt'
export type PaymentFormErrors = Partial<Record<PaymentFormField, string>>

export interface PaymentInput {
  amount: number
  method: PaymentMethod
  note: string | null
}

export type PaymentFormResult = { ok: true; input: PaymentInput } | { ok: false; errors: PaymentFormErrors }

/** Field order, used to focus the first field with an error. */
export const PAYMENT_FORM_FIELDS: readonly PaymentFormField[] = ['amount', 'method', 'receipt', 'note']

/**
 * `hasReceipt`: a receipt has been chosen (and uploaded). The database
 * enforces the same receipt rule and the amount being above zero; the screen
 * also refuses more than 2 decimals instead of letting them be rounded.
 */
export function validatePaymentForm(values: PaymentFormValues, hasReceipt: boolean): PaymentFormResult {
  const errors: PaymentFormErrors = {}

  let amount = 0
  const text = values.amount.trim().replace(/^RM\s*/i, '').replace(/,/g, '')
  const m = /^(\d+)(?:\.(\d*))?$/.exec(text)
  if (text === '') errors.amount = PAYMENT_AMOUNT_REQUIRED_MESSAGE
  else if (/^-\d/.test(text)) errors.amount = PAYMENT_AMOUNT_POSITIVE_MESSAGE
  else if (!m) errors.amount = PAYMENT_AMOUNT_NOT_A_NUMBER_MESSAGE
  else if (Number(text) <= 0) errors.amount = PAYMENT_AMOUNT_POSITIVE_MESSAGE
  else if ((m[2] ?? '').replace(/0+$/, '').length > 2) errors.amount = PAYMENT_AMOUNT_DECIMALS_MESSAGE
  else amount = Number(text)

  if (!values.method) errors.method = PAYMENT_METHOD_REQUIRED_MESSAGE
  else if (receiptRequired(values.method) && !hasReceipt) errors.receipt = RECEIPT_REQUIRED_MESSAGE

  if (Object.keys(errors).length > 0 || !values.method) return { ok: false, errors }
  const note = values.note.trim()
  return { ok: true, input: { amount, method: values.method, note: note || null } }
}

/** How much a payment is above the balance (0 when it is not), to confirm before saving. */
export function amountOverBalance(amount: number, balance: number): number {
  return Math.max(0, (Math.round(amount * 100) - Math.round(balance * 100)) / 100)
}

/** The amount field pre-filled with the balance (`150.00`), or '' when nothing is owed. */
export function defaultPaymentAmount(balance: number): string {
  return balance > 0 ? balance.toFixed(2) : ''
}
