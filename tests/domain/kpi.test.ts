import { describe, expect, it } from 'vitest'
import {
  CSV_BOM,
  CSV_HEADERS,
  KPI_TREND_COUNTS,
  addDays,
  ariaSort,
  canShowNextPeriod,
  competitionRanks,
  compareLeaderboard,
  csvField,
  currentPeriod,
  defaultSortDirection,
  emptyPeriodMessage,
  formatAverageRating,
  isEmptyPeriod,
  isKpiDay,
  isoWeekCode,
  kpiAddress,
  leaderboardCsv,
  leaderboardCsvFileName,
  malaysiaToday,
  monthStartOf,
  nextSort,
  parseKpiAddress,
  periodCode,
  periodLabel,
  periodRange,
  periodShortLabel,
  periodStartOf,
  rankLeaderboard,
  ratedLabel,
  shiftPeriod,
  sortLeaderboardRows,
  weekStartOf,
  type CsvLeaderboardRow,
} from '../../src/domain'

// Malaysia is UTC+8: 2026-10-23 10:00 MYT = 02:00 UTC (a Friday).
const FRIDAY = new Date('2026-10-23T02:00:00Z')

describe('Malaysia today', () => {
  it('reads the Malaysia calendar day, not the UTC one', () => {
    expect(malaysiaToday(FRIDAY)).toBe('2026-10-23')
    // 23:30 UTC on Friday is already Saturday 07:30 in Malaysia.
    expect(malaysiaToday(new Date('2026-10-23T23:30:00Z'))).toBe('2026-10-24')
    // 15:59:59 UTC is Friday 23:59:59 in Malaysia; 16:00:00 UTC is Saturday 00:00.
    expect(malaysiaToday(new Date('2026-10-23T15:59:59Z'))).toBe('2026-10-23')
    expect(malaysiaToday(new Date('2026-10-23T16:00:00Z'))).toBe('2026-10-24')
  })
})

describe('week and month starts', () => {
  it('finds the Monday of any day, Sunday included', () => {
    expect(weekStartOf('2026-10-19')).toBe('2026-10-19') // Monday
    expect(weekStartOf('2026-10-21')).toBe('2026-10-19') // Wednesday
    expect(weekStartOf('2026-10-25')).toBe('2026-10-19') // Sunday belongs to the week that ends
    expect(weekStartOf('2026-10-26')).toBe('2026-10-26')
  })

  it('crosses month and year ends', () => {
    expect(weekStartOf('2026-11-01')).toBe('2026-10-26') // Sunday 1 Nov
    expect(weekStartOf('2027-01-01')).toBe('2026-12-28') // Friday 1 Jan
    expect(weekStartOf('2024-03-01')).toBe('2024-02-26') // a leap year
    expect(monthStartOf('2026-10-31')).toBe('2026-10-01')
    expect(monthStartOf('2024-02-29')).toBe('2024-02-01')
  })

  it('snaps a day to the start of its period for either view', () => {
    expect(periodStartOf('week', '2026-10-23')).toBe('2026-10-19')
    expect(periodStartOf('month', '2026-10-23')).toBe('2026-10-01')
  })

  it('adds days across month ends', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29')
  })

  it('knows a real day from an impossible one', () => {
    expect(isKpiDay('2026-02-28')).toBe(true)
    expect(isKpiDay('2026-02-30')).toBe(false)
    expect(isKpiDay('26-10-01')).toBe(false)
    expect(isKpiDay('')).toBe(false)
  })
})

describe('period ranges and stepping', () => {
  it('gives a Monday-to-Monday range for a week and a 1st-to-1st range for a month', () => {
    expect(periodRange('week', '2026-10-23')).toEqual({ start: '2026-10-19', end: '2026-10-26' })
    expect(periodRange('month', '2026-10-23')).toEqual({ start: '2026-10-01', end: '2026-11-01' })
    expect(periodRange('month', '2026-12-15')).toEqual({ start: '2026-12-01', end: '2027-01-01' })
    expect(periodRange('month', '2024-02-10')).toEqual({ start: '2024-02-01', end: '2024-03-01' })
  })

  it('steps to the previous and next period across month and year ends', () => {
    expect(shiftPeriod('week', '2026-10-19', -1)).toBe('2026-10-12')
    expect(shiftPeriod('week', '2026-12-28', 1)).toBe('2027-01-04')
    expect(shiftPeriod('month', '2026-01-01', -1)).toBe('2025-12-01')
    expect(shiftPeriod('month', '2026-12-01', 1)).toBe('2027-01-01')
    expect(shiftPeriod('month', '2026-10-15', 3)).toBe('2027-01-01')
  })

  it('finds the period holding today', () => {
    expect(currentPeriod('week', FRIDAY)).toEqual({ start: '2026-10-19', end: '2026-10-26' })
    expect(currentPeriod('month', FRIDAY)).toEqual({ start: '2026-10-01', end: '2026-11-01' })
    // Sunday 23:59 Malaysia is still this week; Monday 00:00 is the next.
    expect(currentPeriod('week', new Date('2026-10-25T15:59:59Z')).start).toBe('2026-10-19')
    expect(currentPeriod('week', new Date('2026-10-25T16:00:00Z')).start).toBe('2026-10-26')
  })

  it('never offers a future period', () => {
    expect(canShowNextPeriod('week', '2026-10-12', FRIDAY)).toBe(true) // last week -> this week
    expect(canShowNextPeriod('week', '2026-10-19', FRIDAY)).toBe(false) // this week
    expect(canShowNextPeriod('month', '2026-09-01', FRIDAY)).toBe(true)
    expect(canShowNextPeriod('month', '2026-10-01', FRIDAY)).toBe(false)
  })

  it('trends cover 8 weeks or 6 months', () => {
    expect(KPI_TREND_COUNTS).toEqual({ week: 8, month: 6 })
  })
})

describe('labels and codes', () => {
  it('labels a week and a month', () => {
    expect(periodLabel('week', '2026-10-19')).toBe('Mon 19 – Sun 25 Oct 2026')
    expect(periodLabel('week', '2026-10-23')).toBe('Mon 19 – Sun 25 Oct 2026') // any day in the week
    expect(periodLabel('month', '2026-10-23')).toBe('October 2026')
  })

  it('labels a week that crosses a month or a year', () => {
    expect(periodLabel('week', '2026-10-26')).toBe('Mon 26 Oct – Sun 1 Nov 2026')
    expect(periodLabel('week', '2026-12-28')).toBe('Mon 28 Dec 2026 – Sun 3 Jan 2027')
  })

  it('has short chart labels', () => {
    expect(periodShortLabel('week', '2026-10-19')).toBe('19 Oct')
    expect(periodShortLabel('month', '2026-10-19')).toBe('Oct')
  })

  it('writes ISO week codes, including the year boundary', () => {
    expect(isoWeekCode('2026-10-19')).toBe('2026-W43')
    expect(isoWeekCode('2026-10-25')).toBe('2026-W43')
    expect(isoWeekCode('2025-12-29')).toBe('2026-W01') // the Monday of the week holding 1 Jan 2026
    expect(isoWeekCode('2027-01-01')).toBe('2026-W53')
    expect(isoWeekCode('2021-01-03')).toBe('2020-W53')
    expect(isoWeekCode('2026-01-05')).toBe('2026-W02')
  })

  it('codes a period for file names', () => {
    expect(periodCode('week', '2026-10-21')).toBe('2026-W43')
    expect(periodCode('month', '2026-10-21')).toBe('2026-10')
  })

  it('says what an empty period is', () => {
    expect(emptyPeriodMessage('week')).toBe('No jobs completed in this week')
    expect(emptyPeriodMessage('month')).toBe('No jobs completed in this month')
    const zero = { jobs_completed: 0, collected: 0, rescheduled: 0, postponed: 0, returned: 0 }
    expect(isEmptyPeriod(zero)).toBe(true)
    expect(isEmptyPeriod({ ...zero, postponed: 1 })).toBe(false)
    expect(isEmptyPeriod({ ...zero, collected: 10 })).toBe(false)
  })
})

describe('the address keeps the choice', () => {
  it('defaults to this week with every branch', () => {
    expect(parseKpiAddress('', FRIDAY)).toEqual({ view: 'week', start: '2026-10-19', branch: null })
  })

  it('reads view, start and branch', () => {
    expect(parseKpiAddress('?view=month&start=2026-08-01&branch=abc', FRIDAY)).toEqual({
      view: 'month', start: '2026-08-01', branch: 'abc',
    })
    expect(parseKpiAddress('view=week&start=2026-09-02', FRIDAY).start).toBe('2026-08-31') // snaps to the Monday
    expect(parseKpiAddress('view=month&start=2026-09-17', FRIDAY).start).toBe('2026-09-01')
  })

  it('falls back to the current period for anything invalid, and never goes into the future', () => {
    expect(parseKpiAddress('view=year&start=nonsense', FRIDAY)).toEqual({ view: 'week', start: '2026-10-19', branch: null })
    expect(parseKpiAddress('start=2026-02-30', FRIDAY).start).toBe('2026-10-19')
    expect(parseKpiAddress('start=2027-03-01', FRIDAY).start).toBe('2026-10-19')
    expect(parseKpiAddress('view=month&start=2027-03-01', FRIDAY).start).toBe('2026-10-01')
    expect(parseKpiAddress('branch=%20', FRIDAY).branch).toBeNull()
  })

  it('round-trips through the address', () => {
    const address = { view: 'month' as const, start: '2026-08-01', branch: 'b1' }
    expect(kpiAddress(address)).toBe('view=month&start=2026-08-01&branch=b1')
    expect(parseKpiAddress(kpiAddress(address), FRIDAY)).toEqual(address)
    expect(kpiAddress({ view: 'week', start: '2026-10-22', branch: null })).toBe('view=week&start=2026-10-19')
  })
})

const row = (name: string, jobs: number, amount: number) => ({ name, jobs_completed: jobs, total_amount: amount })

describe('leaderboard order and ranks', () => {
  it('orders by jobs, then amount, then name (any letter case)', () => {
    const rows = [row('bala', 2, 100), row('Ali', 2, 100), row('Yusoff', 3, 50), row('John', 2, 300), row('Zed', 0, 0)]
    expect([...rows].sort(compareLeaderboard).map((r) => r.name)).toEqual(['Yusoff', 'John', 'Ali', 'bala', 'Zed'])
  })

  it('shares ranks between equal jobs and amount (1, 1, 3)', () => {
    expect(competitionRanks([row('A', 5, 500), row('B', 5, 500), row('C', 4, 900)])).toEqual([1, 1, 3])
    expect(competitionRanks([row('A', 5, 500), row('B', 5, 400), row('C', 5, 400), row('D', 1, 0), row('E', 0, 0), row('F', 0, 0)])).toEqual([1, 2, 2, 4, 5, 5])
    expect(competitionRanks([])).toEqual([])
  })

  it('compares amounts in whole cents', () => {
    expect(competitionRanks([row('A', 1, 0.1 + 0.2), row('B', 1, 0.3)])).toEqual([1, 1])
  })

  it('ranks rows after ordering them', () => {
    const ranked = rankLeaderboard([row('B', 1, 10), row('A', 1, 10), row('C', 2, 5)])
    expect(ranked.map((r) => [r.name, r.rank])).toEqual([['C', 1], ['A', 2], ['B', 2]])
  })
})

const sortable = (name: string, over: Partial<ReturnType<typeof base>> = {}) => ({ ...base(name), ...over })
function base(name: string) {
  return {
    name, rank: null as number | null, branch_name: 'Shah Alam', jobs_completed: 1, total_amount: 100,
    collected: 0, reschedules: 0, returned: 0, average_rating: null as number | null, poor_ratings: 0,
  }
}

describe('sorting by column', () => {
  const rows = [
    sortable('Ali', { jobs_completed: 3, average_rating: 4.5, branch_name: 'Shah Alam', returned: 0 }),
    sortable('Bala', { jobs_completed: 2, average_rating: null, branch_name: 'Kuala Lumpur', returned: 3 }),
    sortable('Chong', { jobs_completed: 2, average_rating: 3.2, branch_name: 'Penang', returned: 1, total_amount: 500 }),
  ]

  it('uses a sensible first direction per column', () => {
    expect(defaultSortDirection('name')).toBe('asc')
    expect(defaultSortDirection('rank')).toBe('asc')
    expect(defaultSortDirection('jobs_completed')).toBe('desc')
    expect(defaultSortDirection('average_rating')).toBe('desc')
  })

  it('sorts text and numbers, either way', () => {
    expect(sortLeaderboardRows(rows, 'name').map((r) => r.name)).toEqual(['Ali', 'Bala', 'Chong'])
    expect(sortLeaderboardRows(rows, 'name', 'desc').map((r) => r.name)).toEqual(['Chong', 'Bala', 'Ali'])
    expect(sortLeaderboardRows(rows, 'branch_name').map((r) => r.branch_name)).toEqual(['Kuala Lumpur', 'Penang', 'Shah Alam'])
    expect(sortLeaderboardRows(rows, 'returned').map((r) => r.name)).toEqual(['Bala', 'Chong', 'Ali'])
  })

  it('keeps equal values in the default order', () => {
    // Bala and Chong both have 2 jobs; Chong's higher amount comes first by default.
    expect(sortLeaderboardRows(rows, 'jobs_completed').map((r) => r.name)).toEqual(['Ali', 'Chong', 'Bala'])
  })

  it('puts empty ratings last in both directions', () => {
    expect(sortLeaderboardRows(rows, 'average_rating', 'desc').map((r) => r.name)).toEqual(['Ali', 'Chong', 'Bala'])
    expect(sortLeaderboardRows(rows, 'average_rating', 'asc').map((r) => r.name)).toEqual(['Chong', 'Ali', 'Bala'])
  })

  it('does not change the rows or their ranks', () => {
    const ranked = rows.map((r, i) => ({ ...r, rank: i + 1 }))
    const sorted = sortLeaderboardRows(ranked, 'name', 'desc')
    expect(sorted.map((r) => [r.name, r.rank])).toEqual([['Chong', 3], ['Bala', 2], ['Ali', 1]])
    expect(ranked.map((r) => r.name)).toEqual(['Ali', 'Bala', 'Chong'])
  })

  it('says which header is sorted, and flips on a second click', () => {
    const sorted = { column: 'jobs_completed' as const, direction: 'desc' as const }
    expect(ariaSort('jobs_completed', sorted)).toBe('descending')
    expect(ariaSort('name', sorted)).toBe('none')
    expect(ariaSort('name', { column: 'name', direction: 'asc' })).toBe('ascending')
    expect(nextSort('jobs_completed', sorted)).toEqual({ column: 'jobs_completed', direction: 'asc' })
    expect(nextSort('name', sorted)).toEqual({ column: 'name', direction: 'asc' })
    expect(nextSort('returned', sorted)).toEqual({ column: 'returned', direction: 'desc' })
  })
})

describe('display', () => {
  it('shows an average with one decimal, or a dash', () => {
    expect(formatAverageRating(4)).toBe('4.0')
    expect(formatAverageRating(3.8)).toBe('3.8')
    expect(formatAverageRating(null)).toBe('–')
    expect(ratedLabel(3, 5)).toBe('3 of 5 rated')
  })
})

const csvRow = (over: Partial<CsvLeaderboardRow> = {}): CsvLeaderboardRow => ({
  ...base('Ali'),
  rank: 1,
  active: true,
  jobs_completed: 8,
  total_amount: 1234.5,
  collected: 1000,
  rescheduled: 1,
  postponed: 2,
  reschedules: 3,
  returned: 3,
  rated: 4,
  average_rating: 4.25,
  poor_ratings: 1,
  needs_attention: true,
  ...over,
})

describe('CSV', () => {
  it('quotes only what needs it and doubles quotes', () => {
    expect(csvField('plain')).toBe('plain')
    expect(csvField('Tan, Wei "Ming"')).toBe('"Tan, Wei ""Ming"""')
    expect(csvField('two\nlines')).toBe('"two\nlines"')
    expect(csvField(7)).toBe('7')
    expect(csvField(null)).toBe('')
  })

  it('stops a spreadsheet running a name as a formula', () => {
    expect(csvField('=1+1')).toBe("'=1+1")
    expect(csvField('+60123')).toBe("'+60123")
    expect(csvField('-x')).toBe("'-x")
    expect(csvField('@sum')).toBe("'@sum")
    expect(csvField(-5)).toBe('-5') // a real negative number is left alone
  })

  it('writes a BOM, a header, one row per technician and CRLF line ends', () => {
    const csv = leaderboardCsv([csvRow(), csvRow({ name: 'Tan, Wei Ming', rank: 2, active: false, average_rating: null, needs_attention: false, total_amount: 0, collected: 0, jobs_completed: 0 })])
    expect(csv.startsWith(CSV_BOM)).toBe(true)
    const lines = csv.slice(1).split('\r\n')
    expect(lines.at(-1)).toBe('') // ends with a line break
    expect(lines[0]).toBe(CSV_HEADERS.join(','))
    expect(lines[1]).toBe('1,Ali,Active,Shah Alam,8,1234.50,1000.00,1,2,3,3,Yes,4,4.3,1')
    expect(lines[2]).toBe('2,"Tan, Wei Ming",Inactive,Shah Alam,0,0.00,0.00,1,2,3,3,No,4,,1')
    expect(lines).toHaveLength(4)
  })

  it('is just the header for no technicians', () => {
    expect(leaderboardCsv([])).toBe(`${CSV_BOM}${CSV_HEADERS.join(',')}\r\n`)
  })

  it('names the file after the period and branch', () => {
    expect(leaderboardCsvFileName('week', '2026-10-21', null)).toBe('kpi-2026-W43-all-branches.csv')
    expect(leaderboardCsvFileName('month', '2026-10-01', 'Shah Alam')).toBe('kpi-2026-10-shah-alam.csv')
    expect(leaderboardCsvFileName('week', '2026-10-19', "Kota Kinabalu (KK)")).toBe('kpi-2026-W43-kota-kinabalu-kk.csv')
  })
})
