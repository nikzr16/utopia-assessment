/**
 * Named periods → Malaysia calendar days (0008, PRD Q6). The AI only names a
 * period ("last_week"); the server turns it into `[start, end)` days, end
 * exclusive, the way the 0007 KPI functions take them, plus a label the
 * answer repeats ("last week (12–18 Oct 2026)"). Weeks run Monday–Sunday.
 *
 * Plain TypeScript with no imports (the Edge Function cannot import `src/`);
 * tests/functions/ask-periods.test.ts keeps it equal to src/domain/kpi.ts.
 */

export const PERIOD_KINDS = [
  'today',
  'yesterday',
  'tomorrow',
  'this_week',
  'last_week',
  'next_week',
  'this_month',
  'last_month',
  'next_month',
  'last_n_days',
  'month',
  'range',
] as const
export type PeriodKind = (typeof PERIOD_KINDS)[number]

/** What the AI sends: a kind plus the fields that kind needs (others null). */
export interface PeriodInput {
  kind: PeriodKind
  /** last_n_days: how many days, today included (1–400). */
  n: number | null
  /** month: `YYYY-MM`. */
  month: string | null
  /** range: first and last day, both included, `YYYY-MM-DD`. */
  start: string | null
  end: string | null
}

export interface ResolvedPeriod {
  /** First day (inclusive). */
  start: string
  /** The day after the last (exclusive). */
  end: string
  /** For the answer and "How I found this". */
  label: string
  /** A whole Monday–Sunday week or calendar month (the Dashboard can open it). */
  view: 'week' | 'month' | null
}

export const MAX_PERIOD_DAYS = 400

const DAY_MS = 24 * 60 * 60 * 1000
const MALAYSIA_OFFSET_MS = 8 * 60 * 60 * 1000
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const pad = (n: number) => String(n).padStart(2, '0')

function toUtc(day: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!m) return null
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const d = new Date(t)
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3])
    ? t
    : null
}

function fromUtc(t: number): string {
  const d = new Date(t)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

function day(d: string): number {
  const t = toUtc(d)
  if (t === null) throw new Error(`Not a day: ${d}`)
  return t
}

/** Is this a real `YYYY-MM-DD` day? */
export const isDay = (d: string): boolean => toUtc(d) !== null

/** Today in Malaysia time as `YYYY-MM-DD`. */
export function malaysiaToday(now: Date): string {
  return fromUtc(now.getTime() + MALAYSIA_OFFSET_MS)
}

export function addDays(d: string, days: number): string {
  return fromUtc(day(d) + days * DAY_MS)
}

/** The Monday of the week holding the day. */
export function weekStartOf(d: string): string {
  const t = day(d)
  return fromUtc(t - ((new Date(t).getUTCDay() + 6) % 7) * DAY_MS)
}

/** The 1st of the month holding the day. */
export function monthStartOf(d: string): string {
  const x = new Date(day(d))
  return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-01`
}

/** The 1st of the month `delta` months after the one holding the day. */
export function shiftMonth(d: string, delta: number): string {
  const x = new Date(day(monthStartOf(d)))
  return fromUtc(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + delta, 1))
}

/** Days between two days (end − start). */
export const daysBetween = (start: string, end: string): number => Math.round((day(end) - day(start)) / DAY_MS)

/** `Sat 24 Oct 2026` */
export function dayLabel(d: string): string {
  const x = new Date(day(d))
  return `${WEEKDAYS[x.getUTCDay()]} ${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]} ${x.getUTCFullYear()}`
}

/** `October 2026` */
export function monthLabel(d: string): string {
  const x = new Date(day(d))
  return `${MONTH_NAMES[x.getUTCMonth()]} ${x.getUTCFullYear()}`
}

/** Days `[start, end)` as `12–18 Oct 2026`, `28 Sep – 4 Oct 2026`, `29 Dec 2026 – 4 Jan 2027`, or one day. */
export function rangeLabel(start: string, end: string): string {
  const a = new Date(day(start))
  const b = new Date(day(end) - DAY_MS)
  if (a.getTime() === b.getTime()) return dayLabel(start)
  const sameYear = a.getUTCFullYear() === b.getUTCFullYear()
  const sameMonth = sameYear && a.getUTCMonth() === b.getUTCMonth()
  const tail = `${b.getUTCDate()} ${MONTHS[b.getUTCMonth()]} ${b.getUTCFullYear()}`
  if (sameMonth) return `${a.getUTCDate()}–${tail}`
  if (sameYear) return `${a.getUTCDate()} ${MONTHS[a.getUTCMonth()]} – ${tail}`
  return `${a.getUTCDate()} ${MONTHS[a.getUTCMonth()]} ${a.getUTCFullYear()} – ${tail}`
}

function viewOf(start: string, end: string): 'week' | 'month' | null {
  if (weekStartOf(start) === start && daysBetween(start, end) === 7) return 'week'
  if (monthStartOf(start) === start && shiftMonth(start, 1) === end) return 'month'
  return null
}

const period = (start: string, end: string, name: string | null): ResolvedPeriod => {
  const view = viewOf(start, end)
  const dates = view === 'month' ? monthLabel(start) : rangeLabel(start, end)
  return { start, end, view, label: name ? `${name} (${dates})` : dates }
}

/**
 * The days of a named period, or a plain-language reason it cannot be used.
 * `today` is the Malaysia day the question was asked.
 */
export function resolvePeriod(input: PeriodInput, today: string): ResolvedPeriod | { error: string } {
  const week = weekStartOf(today)
  const month = monthStartOf(today)
  switch (input.kind) {
    case 'today':
      return period(today, addDays(today, 1), 'today')
    case 'yesterday':
      return period(addDays(today, -1), today, 'yesterday')
    case 'tomorrow':
      return period(addDays(today, 1), addDays(today, 2), 'tomorrow')
    case 'this_week':
      return period(week, addDays(week, 7), 'this week')
    case 'last_week':
      return period(addDays(week, -7), week, 'last week')
    case 'next_week':
      return period(addDays(week, 7), addDays(week, 14), 'next week')
    case 'this_month':
      return period(month, shiftMonth(month, 1), 'this month')
    case 'last_month':
      return period(shiftMonth(month, -1), month, 'last month')
    case 'next_month':
      return period(shiftMonth(month, 1), shiftMonth(month, 2), 'next month')
    case 'last_n_days': {
      const n = input.n
      if (n === null || !Number.isInteger(n) || n < 1 || n > MAX_PERIOD_DAYS) {
        return { error: 'Choose a period of up to a year' }
      }
      return period(addDays(today, 1 - n), addDays(today, 1), n === 1 ? 'today' : `the last ${n} days`)
    }
    case 'month': {
      const m = /^(\d{4})-(\d{2})$/.exec(input.month ?? '')
      if (!m || !isDay(`${m[1]}-${m[2]}-01`)) return { error: 'I could not read that month' }
      const first = `${m[1]}-${m[2]}-01`
      return period(first, shiftMonth(first, 1), null)
    }
    case 'range': {
      if (!input.start || !input.end || !isDay(input.start) || !isDay(input.end)) {
        return { error: 'I could not read those dates' }
      }
      const end = addDays(input.end, 1)
      if (end <= input.start) return { error: 'The period must end after it starts' }
      if (daysBetween(input.start, end) > MAX_PERIOD_DAYS) return { error: 'Choose a period of up to a year' }
      return period(input.start, end, null)
    }
  }
}
