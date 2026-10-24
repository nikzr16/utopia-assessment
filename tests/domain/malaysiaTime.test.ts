import { describe, expect, it } from 'vitest'
import {
  formatMalaysiaDate,
  formatMalaysiaDateTime,
  fromMalaysiaDateTimeInput,
  malaysiaDayRange,
  toMalaysiaDateTimeInput,
} from '../../src/domain'

// Malaysia is UTC+8. None of these depend on the machine's own time zone:
// they use only UTC getters and explicit offsets.
describe('datetime-local values are Malaysia time', () => {
  it('reads a form value as Malaysia time', () => {
    expect(fromMalaysiaDateTimeInput('2026-10-26T10:00')).toBe('2026-10-26T02:00:00.000Z')
    // Just after midnight in Malaysia is still the previous day in UTC.
    expect(fromMalaysiaDateTimeInput('2026-10-26T00:30')).toBe('2026-10-25T16:30:00.000Z')
  })

  it('writes an instant back as the Malaysia wall clock', () => {
    expect(toMalaysiaDateTimeInput('2026-10-25T16:30:00Z')).toBe('2026-10-26T00:30')
    expect(toMalaysiaDateTimeInput('2026-10-26T02:00:00+00:00')).toBe('2026-10-26T10:00')
  })

  it('treats empty as not scheduled and nonsense as invalid', () => {
    expect(fromMalaysiaDateTimeInput('')).toBeNull()
    expect(toMalaysiaDateTimeInput(null)).toBe('')
    expect(fromMalaysiaDateTimeInput('2026-02-30T10:00')).toBeUndefined()
    expect(fromMalaysiaDateTimeInput('26/10/2026 10:00')).toBeUndefined()
    expect(fromMalaysiaDateTimeInput('2026-10-26T24:00')).toBeUndefined()
  })
})

describe('malaysiaDayRange', () => {
  it('covers one Malaysia day, end exclusive', () => {
    expect(malaysiaDayRange('2026-10-27')).toEqual({
      from: '2026-10-26T16:00:00.000Z',
      to: '2026-10-27T16:00:00.000Z',
    })
    expect(malaysiaDayRange('')).toBeNull()
    expect(malaysiaDayRange('2026-13-01')).toBeNull()
  })
})

describe('display', () => {
  it('formats in Malaysia time with a 12-hour clock', () => {
    expect(formatMalaysiaDateTime('2026-10-26T02:00:00Z')).toBe('Mon 26 Oct 2026, 10:00 AM')
    expect(formatMalaysiaDateTime('2026-10-26T04:05:00Z')).toBe('Mon 26 Oct 2026, 12:05 PM')
    expect(formatMalaysiaDateTime('2026-10-25T16:00:00Z')).toBe('Mon 26 Oct 2026, 12:00 AM')
    expect(formatMalaysiaDate('2026-10-25T16:00:00Z')).toBe('26 Oct 2026')
    expect(formatMalaysiaDateTime(null)).toBe('')
  })
})
