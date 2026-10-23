import { describe, expect, it } from 'vitest'
import {
  addDays as domainAddDays,
  malaysiaToday as domainToday,
  monthStartOf as domainMonthStart,
  periodRange,
  shiftPeriod,
  weekStartOf as domainWeekStart,
} from '../../src/domain'
import {
  addDays,
  malaysiaToday,
  monthStartOf,
  rangeLabel,
  resolvePeriod,
  shiftMonth,
  weekStartOf,
  type PeriodInput,
} from '../../supabase/functions/ask/periods'

// The ask function's named periods (0008, PRD Q6): Malaysia days, Monday-Sunday
// weeks, end exclusive, and the same day maths as the dashboard (src/domain/kpi.ts).

const p = (kind: PeriodInput['kind'], over: Partial<PeriodInput> = {}): PeriodInput => ({
  kind,
  n: null,
  month: null,
  start: null,
  end: null,
  ...over,
})

// Saturday 24 October 2026.
const TODAY = '2026-10-24'

describe('named periods', () => {
  it('reads today, yesterday and tomorrow as single Malaysia days', () => {
    expect(resolvePeriod(p('today'), TODAY)).toEqual({
      start: '2026-10-24', end: '2026-10-25', view: null, label: 'today (Sat 24 Oct 2026)',
    })
    expect(resolvePeriod(p('yesterday'), TODAY)).toMatchObject({ start: '2026-10-23', end: '2026-10-24' })
    expect(resolvePeriod(p('tomorrow'), TODAY)).toMatchObject({ start: '2026-10-25', end: '2026-10-26' })
  })

  it('reads weeks as Monday to Sunday', () => {
    expect(resolvePeriod(p('this_week'), TODAY)).toEqual({
      start: '2026-10-19', end: '2026-10-26', view: 'week', label: 'this week (19–25 Oct 2026)',
    })
    expect(resolvePeriod(p('last_week'), TODAY)).toEqual({
      start: '2026-10-12', end: '2026-10-19', view: 'week', label: 'last week (12–18 Oct 2026)',
    })
    // On a Sunday, "this week" still started on Monday.
    expect(resolvePeriod(p('this_week'), '2026-10-25')).toMatchObject({ start: '2026-10-19' })
    // On a Monday, last week is the one that just ended.
    expect(resolvePeriod(p('last_week'), '2026-10-26')).toMatchObject({ start: '2026-10-19', end: '2026-10-26' })
  })

  it('reads months, a named month and month ends across the year', () => {
    expect(resolvePeriod(p('this_month'), TODAY)).toEqual({
      start: '2026-10-01', end: '2026-11-01', view: 'month', label: 'this month (October 2026)',
    })
    expect(resolvePeriod(p('last_month'), '2026-01-15')).toMatchObject({
      start: '2025-12-01', end: '2026-01-01', label: 'last month (December 2025)',
    })
    expect(resolvePeriod(p('month', { month: '2026-09' }), TODAY)).toMatchObject({
      start: '2026-09-01', end: '2026-10-01', label: 'September 2026',
    })
    expect(resolvePeriod(p('month', { month: '2026-13' }), TODAY)).toEqual({ error: 'I could not read that month' })
  })

  it('reads the last N days including today, and typed ranges with the last day included', () => {
    expect(resolvePeriod(p('last_n_days', { n: 7 }), TODAY)).toEqual({
      start: '2026-10-18', end: '2026-10-25', view: null, label: 'the last 7 days (18–24 Oct 2026)',
    })
    expect(resolvePeriod(p('range', { start: '2026-09-28', end: '2026-10-04' }), TODAY)).toEqual({
      start: '2026-09-28', end: '2026-10-05', view: 'week', label: '28 Sep – 4 Oct 2026',
    })
    expect(resolvePeriod(p('range', { start: '2026-10-05', end: '2026-10-01' }), TODAY)).toEqual({
      error: 'The period must end after it starts',
    })
    expect(resolvePeriod(p('range', { start: '2025-01-01', end: '2026-10-01' }), TODAY)).toEqual({
      error: 'Choose a period of up to a year',
    })
    expect(resolvePeriod(p('last_n_days', { n: 0 }), TODAY)).toEqual({ error: 'Choose a period of up to a year' })
    expect(resolvePeriod(p('range', { start: '1 Oct', end: '2026-10-04' }), TODAY)).toEqual({
      error: 'I could not read those dates',
    })
  })

  it('labels ranges across months and years', () => {
    expect(rangeLabel('2026-12-29', '2027-01-05')).toBe('29 Dec 2026 – 4 Jan 2027')
    expect(rangeLabel('2026-10-24', '2026-10-25')).toBe('Sat 24 Oct 2026')
  })

  it('uses Malaysia time for today (UTC+8)', () => {
    // 23 Oct 16:00 UTC is already 24 Oct midnight in Malaysia.
    expect(malaysiaToday(new Date('2026-10-23T15:59:59Z'))).toBe('2026-10-23')
    expect(malaysiaToday(new Date('2026-10-23T16:00:00Z'))).toBe('2026-10-24')
  })
})

describe('parity with the dashboard (src/domain/kpi.ts)', () => {
  const days = ['2026-01-01', '2026-02-28', '2026-03-01', '2026-10-19', '2026-10-25', '2026-12-31', '2028-02-29']

  it('has the same week and month starts, day steps and today', () => {
    for (const d of days) {
      expect(weekStartOf(d), d).toBe(domainWeekStart(d))
      expect(monthStartOf(d), d).toBe(domainMonthStart(d))
      expect(addDays(d, 9), d).toBe(domainAddDays(d, 9))
      expect(shiftMonth(d, 1), d).toBe(shiftPeriod('month', d, 1))
      expect(shiftMonth(d, -1), d).toBe(shiftPeriod('month', d, -1))
    }
    const now = new Date('2026-10-23T18:30:00Z')
    expect(malaysiaToday(now)).toBe(domainToday(now))
  })

  it('gives this week and this month the same range the dashboard uses', () => {
    for (const d of days) {
      expect(resolvePeriod(p('this_week'), d)).toMatchObject(periodRange('week', d))
      expect(resolvePeriod(p('this_month'), d)).toMatchObject(periodRange('month', d))
    }
  })
})
