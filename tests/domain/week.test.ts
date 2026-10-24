import { describe, expect, it } from 'vitest'
import { malaysiaWeekRange } from '../../src/domain'

// Malaysia is UTC+8: Monday 00:00 MYT = Sunday 16:00 UTC.
describe('Malaysia-time Monday-Sunday week range', () => {
  it('starts on Monday 00:00 MYT for a mid-week date', () => {
    // Wed 2026-10-21 10:00 MYT
    const { start, end } = malaysiaWeekRange(new Date('2026-10-21T02:00:00Z'))
    expect(start.toISOString()).toBe('2026-10-18T16:00:00.000Z') // Mon 19 Oct 00:00 MYT
    expect(end.toISOString()).toBe('2026-10-25T16:00:00.000Z') // Mon 26 Oct 00:00 MYT
  })

  it('keeps Sunday evening MYT in the week that is ending', () => {
    // Sun 2026-10-25 23:30 MYT = 15:30 UTC
    const { start, end } = malaysiaWeekRange(new Date('2026-10-25T15:30:00Z'))
    expect(start.toISOString()).toBe('2026-10-18T16:00:00.000Z')
    expect(end.toISOString()).toBe('2026-10-25T16:00:00.000Z')
  })

  it('rolls to the next week exactly at Monday 00:00 MYT', () => {
    // Mon 2026-10-26 00:00 MYT = Sun 16:00 UTC
    const { start } = malaysiaWeekRange(new Date('2026-10-25T16:00:00Z'))
    expect(start.toISOString()).toBe('2026-10-25T16:00:00.000Z')
  })

  it('uses Malaysia date, not UTC date, near midnight', () => {
    // Sun 2026-10-25 20:00 UTC is already Mon 26 Oct 04:00 MYT
    const { start } = malaysiaWeekRange(new Date('2026-10-25T20:00:00Z'))
    expect(start.toISOString()).toBe('2026-10-25T16:00:00.000Z')
  })

  it('supports last week via a negative offset', () => {
    const { start, end } = malaysiaWeekRange(new Date('2026-10-21T02:00:00Z'), -1)
    expect(start.toISOString()).toBe('2026-10-11T16:00:00.000Z')
    expect(end.toISOString()).toBe('2026-10-18T16:00:00.000Z')
  })

  it('spans exactly seven days', () => {
    const { start, end } = malaysiaWeekRange(new Date('2026-03-04T05:00:00Z'))
    expect(end.getTime() - start.getTime()).toBe(7 * 24 * 60 * 60 * 1000)
  })
})
