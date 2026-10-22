import { describe, expect, it } from 'vitest'
import { PHONE_INVALID_MESSAGE, formatMyPhone, isMyMobile, normalizeMyPhone } from '../../src/domain'

// The accept / reject table itself is shared with the database in tests/db/parity.test.ts.
describe('normalizeMyPhone', () => {
  it('stores mobile and landline numbers as digits with the country code', () => {
    expect(normalizeMyPhone('012-345 6789')).toEqual({ ok: true, value: '60123456789' })
    expect(normalizeMyPhone('+60 11-2345 6789')).toEqual({ ok: true, value: '601123456789' })
    expect(normalizeMyPhone('(03) 1234 5678')).toEqual({ ok: true, value: '60312345678' })
    expect(normalizeMyPhone('088-123 456')).toEqual({ ok: true, value: '6088123456' })
  })

  it('rejects numbers that are too short, too long, or foreign', () => {
    for (const bad of ['012-345 678', '012-345 67890', '+65 9123 4567', '1234567', 'abc']) {
      expect(normalizeMyPhone(bad)).toEqual({ ok: false, error: PHONE_INVALID_MESSAGE })
    }
  })
})

describe('formatMyPhone', () => {
  it.each([
    ['60123456789', '+60 12-345 6789'],
    ['601123456789', '+60 11-2345 6789'],
    ['60312345678', '+60 3-1234 5678'],
    ['6041234567', '+60 4-123 4567'],
    ['6082123456', '+60 82-123 456'],
  ])('%s → %s', (stored, shown) => {
    expect(formatMyPhone(stored)).toBe(shown)
  })

  it('round-trips: the display form normalises back to the stored form', () => {
    for (const stored of ['60123456789', '601123456789', '60312345678', '6041234567', '6082123456']) {
      expect(normalizeMyPhone(formatMyPhone(stored))).toEqual({ ok: true, value: stored })
    }
  })

  it('leaves anything else unchanged', () => {
    expect(formatMyPhone('012 345')).toBe('012 345')
    expect(formatMyPhone('6599999999')).toBe('6599999999')
  })
})

describe('isMyMobile', () => {
  it('is true for mobiles only', () => {
    expect(isMyMobile('60123456789')).toBe(true)
    expect(isMyMobile('601123456789')).toBe(true)
    expect(isMyMobile('60312345678')).toBe(false)
  })
})
