import { describe, expect, it } from 'vitest'
import { balance, finalAmount, overpaid, paymentStatus } from '../../src/domain'

describe('AC9 final amount = quoted + extra', () => {
  it('adds quoted price and extra charges', () => {
    expect(finalAmount(250, 80)).toBe(330)
  })

  it('treats zero extra charges as quoted price', () => {
    expect(finalAmount(250, 0)).toBe(250)
  })

  it('does not drift on floating point sums', () => {
    expect(finalAmount(0.1, 0.2)).toBe(0.3)
    expect(finalAmount(19.99, 5.01)).toBe(25)
  })
})

describe('AC10 payment status', () => {
  it('is unpaid when nothing has been paid', () => {
    expect(paymentStatus(330, 0)).toBe('unpaid')
  })

  it('is partial when 0 < paid < final', () => {
    expect(paymentStatus(330, 100)).toBe('partial')
    expect(paymentStatus(330, 329.99)).toBe('partial')
  })

  it('is paid when paid equals final', () => {
    expect(paymentStatus(330, 330)).toBe('paid')
  })

  it('is paid when overpaid (paid >= final)', () => {
    expect(paymentStatus(330, 400)).toBe('paid')
  })

  it('treats a zero-amount order as paid (nothing owed)', () => {
    expect(paymentStatus(0, 0)).toBe('paid')
  })

  it('computes balance and overpaid amounts without going negative', () => {
    expect(balance(330, 100)).toBe(230)
    expect(balance(330, 400)).toBe(0)
    expect(overpaid(330, 400)).toBe(70)
    expect(overpaid(330, 100)).toBe(0)
  })
})
