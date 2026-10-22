import { describe, expect, it } from 'vitest'
import {
  PAYMENT_AMOUNT_DECIMALS_MESSAGE,
  PAYMENT_AMOUNT_NOT_A_NUMBER_MESSAGE,
  PAYMENT_AMOUNT_POSITIVE_MESSAGE,
  PAYMENT_AMOUNT_REQUIRED_MESSAGE,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHOD_REQUIRED_MESSAGE,
  PAYMENT_METHODS,
  RECEIPT_REQUIRED_MESSAGE,
  amountOverBalance,
  canRecordPayment,
  defaultPaymentAmount,
  receiptRequired,
  validatePaymentForm,
  type PaymentFormValues,
} from '../../src/domain'

const form = (values: Partial<PaymentFormValues>): PaymentFormValues => ({
  amount: '',
  method: '',
  note: '',
  ...values,
})

describe('validatePaymentForm', () => {
  it('returns clean values for record_payment', () => {
    expect(validatePaymentForm(form({ amount: 'RM 1,250.50', method: 'cash', note: '  ' }), false)).toEqual({
      ok: true,
      input: { amount: 1250.5, method: 'cash', note: null },
    })
    expect(validatePaymentForm(form({ amount: '80', method: 'ewallet', note: 'TNG' }), true)).toEqual({
      ok: true,
      input: { amount: 80, method: 'ewallet', note: 'TNG' },
    })
  })

  it('explains what is wrong with the amount', () => {
    const amountError = (amount: string) =>
      (validatePaymentForm(form({ amount, method: 'cash' }), false) as { errors?: { amount?: string } }).errors?.amount
    expect(amountError('')).toBe(PAYMENT_AMOUNT_REQUIRED_MESSAGE)
    expect(amountError('0')).toBe(PAYMENT_AMOUNT_POSITIVE_MESSAGE)
    expect(amountError('-5')).toBe(PAYMENT_AMOUNT_POSITIVE_MESSAGE)
    expect(amountError('10.005')).toBe(PAYMENT_AMOUNT_DECIMALS_MESSAGE)
    expect(amountError('ten')).toBe(PAYMENT_AMOUNT_NOT_A_NUMBER_MESSAGE)
    expect(amountError('10.500')).toBeUndefined()
  })

  it('needs a method, and a receipt for anything but cash', () => {
    expect(validatePaymentForm(form({ amount: '10' }), false)).toEqual({
      ok: false,
      errors: { method: PAYMENT_METHOD_REQUIRED_MESSAGE },
    })
    for (const method of ['bank_transfer', 'card', 'ewallet'] as const) {
      expect(validatePaymentForm(form({ amount: '10', method }), false)).toEqual({
        ok: false,
        errors: { receipt: RECEIPT_REQUIRED_MESSAGE },
      })
      expect(receiptRequired(method)).toBe(true)
    }
    expect(receiptRequired('cash')).toBe(false)
  })
})

describe('payment helpers', () => {
  it('labels every method', () => {
    expect(PAYMENT_METHODS.map((m) => PAYMENT_METHOD_LABELS[m])).toEqual(['Cash', 'Bank transfer', 'Card', 'E-wallet'])
  })

  it('pre-fills the balance and measures an amount above it', () => {
    expect(defaultPaymentAmount(150)).toBe('150.00')
    expect(defaultPaymentAmount(0)).toBe('')
    expect(amountOverBalance(200, 150)).toBe(50)
    expect(amountOverBalance(150, 150)).toBe(0)
    expect(amountOverBalance(0.3, 0.1 + 0.2)).toBe(0)
  })

  it('lets the assigned technician or Finance record, while In Progress, Job Done or Reviewed', () => {
    expect(canRecordPayment('in_progress', 'technician', true)).toBe(true)
    expect(canRecordPayment('reviewed', 'finance', false)).toBe(true)
    expect(canRecordPayment('in_progress', 'technician', false)).toBe(false)
    expect(canRecordPayment('job_done', 'admin', false)).toBe(false)
    expect(canRecordPayment('acknowledged', 'technician', true)).toBe(false)
    expect(canRecordPayment('closed', 'finance', false)).toBe(false)
  })
})
