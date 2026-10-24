import { describe, expect, it } from 'vitest'
import {
  EXTRA_DECIMALS_MESSAGE,
  EXTRA_NEGATIVE_MESSAGE,
  EXTRA_NOT_A_NUMBER_MESSAGE,
  EXTRA_TOO_HIGH_MESSAGE,
  PRICE_DECIMALS_MESSAGE,
  PRICE_NEGATIVE_MESSAGE,
  PRICE_NOT_A_NUMBER_MESSAGE,
  PRICE_REQUIRED_MESSAGE,
  PRICE_TOO_HIGH_MESSAGE,
  parseExtraCharges,
  parseQuotedPrice,
} from '../../src/domain'

describe('parseQuotedPrice', () => {
  it('accepts what an Admin types: plain, with RM, with thousands commas', () => {
    expect(parseQuotedPrice('250')).toEqual({ ok: true, value: 250 })
    expect(parseQuotedPrice(' RM 1,250.50 ')).toEqual({ ok: true, value: 1250.5 })
    expect(parseQuotedPrice('rm80')).toEqual({ ok: true, value: 80 })
    expect(parseQuotedPrice('0')).toEqual({ ok: true, value: 0 })
    expect(parseQuotedPrice('100000.00')).toEqual({ ok: true, value: 100000 })
    expect(parseQuotedPrice('12.')).toEqual({ ok: true, value: 12 })
  })

  it('explains what is wrong', () => {
    expect(parseQuotedPrice('')).toEqual({ ok: false, error: PRICE_REQUIRED_MESSAGE })
    expect(parseQuotedPrice('-5')).toEqual({ ok: false, error: PRICE_NEGATIVE_MESSAGE })
    expect(parseQuotedPrice('100000.01')).toEqual({ ok: false, error: PRICE_TOO_HIGH_MESSAGE })
    expect(parseQuotedPrice('9.999')).toEqual({ ok: false, error: PRICE_DECIMALS_MESSAGE })
    expect(parseQuotedPrice('two hundred')).toEqual({ ok: false, error: PRICE_NOT_A_NUMBER_MESSAGE })
    expect(parseQuotedPrice('1e3')).toEqual({ ok: false, error: PRICE_NOT_A_NUMBER_MESSAGE })
  })
})

describe('parseExtraCharges', () => {
  it('treats an empty field as RM 0 and accepts what a technician types', () => {
    expect(parseExtraCharges('')).toEqual({ ok: true, value: 0 })
    expect(parseExtraCharges('   ')).toEqual({ ok: true, value: 0 })
    expect(parseExtraCharges('50')).toEqual({ ok: true, value: 50 })
    expect(parseExtraCharges('RM 1,200.5')).toEqual({ ok: true, value: 1200.5 })
    expect(parseExtraCharges('100000')).toEqual({ ok: true, value: 100000 })
    expect(parseExtraCharges('-0')).toEqual({ ok: true, value: 0 })
  })

  it('explains what is wrong', () => {
    expect(parseExtraCharges('-1')).toEqual({ ok: false, error: EXTRA_NEGATIVE_MESSAGE })
    expect(parseExtraCharges('100000.01')).toEqual({ ok: false, error: EXTRA_TOO_HIGH_MESSAGE })
    expect(parseExtraCharges('5.555')).toEqual({ ok: false, error: EXTRA_DECIMALS_MESSAGE })
    expect(parseExtraCharges('fifty')).toEqual({ ok: false, error: EXTRA_NOT_A_NUMBER_MESSAGE })
  })
})
