import { MALAYSIA_UTC_OFFSET_HOURS } from './week'

/**
 * KPI dashboard rules that live in the browser (0007): periods as Malaysia
 * calendar days, the address that keeps the choice, the leaderboard order and
 * ranks, sorting by column, and the CSV. Every number itself comes from the
 * `kpi_*` database functions. Mirrors `supabase/migrations/20261023000005_kpi_dashboard.sql`
 * where the rules overlap (week and month start = `kpi_trend`'s buckets, rank =
 * `kpi_technicians.rank`); `tests/db/parity.test.ts` checks both. Poor ratings
 * reuse `isLowFeedback` and "Needs attention" reuses `needsAttention`
 * (`src/domain/review.ts`).
 *
 * A "day" here is a `YYYY-MM-DD` string read as a Malaysia calendar day (UTC+8);
 * period ends are exclusive, exactly what the database functions take.
 */

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

export const KPI_VIEWS = ['week', 'month'] as const
export type KpiView = (typeof KPI_VIEWS)[number]

export const KPI_VIEW_LABELS: Record<KpiView, string> = { week: 'Week', month: 'Month' }

/** Periods in the trend chart: 8 weeks, or 6 months. */
export const KPI_TREND_COUNTS: Record<KpiView, number> = { week: 8, month: 6 }

/** The longest period the database serves in one call. */
export const KPI_MAX_PERIOD_DAYS = 400

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/
const pad = (n: number) => String(n).padStart(2, '0')

function toUtc(day: string): number | null {
  const m = DAY.exec(day.trim())
  if (!m) return null
  const [y, mo, d] = m.slice(1).map(Number)
  const t = Date.UTC(y, mo - 1, d)
  const check = new Date(t)
  // Rejects 2026-02-30 and the like (Date.UTC would roll them over).
  return check.getUTCFullYear() === y && check.getUTCMonth() === mo - 1 && check.getUTCDate() === d ? t : null
}

function fromUtc(t: number): string {
  const d = new Date(t)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/** Is this a real `YYYY-MM-DD` day? */
export function isKpiDay(day: string): boolean {
  return toUtc(day) !== null
}

function requireDay(day: string): number {
  const t = toUtc(day)
  if (t === null) throw new Error(`Not a day: ${day}`)
  return t
}

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------
/** Today in Malaysia time (UTC+8) as `YYYY-MM-DD`. */
export function malaysiaToday(now: Date = new Date()): string {
  // Shift so the UTC getters read Malaysia wall-clock fields.
  return fromUtc(now.getTime() + MALAYSIA_UTC_OFFSET_HOURS * HOUR_MS)
}

/** Add (or subtract) whole days. */
export function addDays(day: string, days: number): string {
  return fromUtc(requireDay(day) + days * DAY_MS)
}

/** The Monday of the Monday-Sunday week holding the day (mirror of `date_trunc('week', …)`). */
export function weekStartOf(day: string): string {
  const t = requireDay(day)
  const sinceMonday = (new Date(t).getUTCDay() + 6) % 7 // Mon=0 ... Sun=6
  return fromUtc(t - sinceMonday * DAY_MS)
}

/** The 1st of the month holding the day (mirror of `date_trunc('month', …)`). */
export function monthStartOf(day: string): string {
  const d = new Date(requireDay(day))
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-01`
}

/** The first day of the week / month holding the day. */
export function periodStartOf(view: KpiView, day: string): string {
  return view === 'week' ? weekStartOf(day) : monthStartOf(day)
}

/** The first day of the period `delta` periods after (negative: before) the one starting on `start`. */
export function shiftPeriod(view: KpiView, start: string, delta: number): string {
  const first = periodStartOf(view, start)
  if (view === 'week') return addDays(first, delta * 7)
  const d = new Date(requireDay(first))
  return fromUtc(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + delta, 1))
}

export interface KpiPeriod {
  /** First day (inclusive). */
  start: string
  /** The day after the last (exclusive): what the database functions take as `p_end`. */
  end: string
}

/** The period the day belongs to, as the `p_start` / `p_end` the database functions take. */
export function periodRange(view: KpiView, day: string): KpiPeriod {
  const start = periodStartOf(view, day)
  return { start, end: shiftPeriod(view, start, 1) }
}

/** The period holding today (Malaysia time). */
export function currentPeriod(view: KpiView, now: Date = new Date()): KpiPeriod {
  return periodRange(view, malaysiaToday(now))
}

/** Periods are never in the future: is there a next one to open? */
export function canShowNextPeriod(view: KpiView, start: string, now: Date = new Date()): boolean {
  return shiftPeriod(view, start, 1) <= currentPeriod(view, now).start
}

/** `Mon 19 – Sun 25 Oct 2026` for a week, `October 2026` for a month. */
export function periodLabel(view: KpiView, start: string): string {
  const first = periodStartOf(view, start)
  const firstDate = new Date(requireDay(first))
  if (view === 'month') return `${MONTH_NAMES[firstDate.getUTCMonth()]} ${firstDate.getUTCFullYear()}`
  const lastDate = new Date(requireDay(first) + 6 * DAY_MS)
  const part = (d: Date, withMonth: boolean, withYear: boolean) =>
    `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()}${withMonth ? ` ${MONTHS[d.getUTCMonth()]}` : ''}${withYear ? ` ${d.getUTCFullYear()}` : ''}`
  const sameMonth = firstDate.getUTCMonth() === lastDate.getUTCMonth() && firstDate.getUTCFullYear() === lastDate.getUTCFullYear()
  const sameYear = firstDate.getUTCFullYear() === lastDate.getUTCFullYear()
  return `${part(firstDate, !sameMonth, !sameYear)} – ${part(lastDate, true, true)}`
}

/** A short label for a chart axis: `19 Oct` for a week, `Oct` for a month. */
export function periodShortLabel(view: KpiView, start: string): string {
  const d = new Date(requireDay(periodStartOf(view, start)))
  return view === 'week' ? `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}` : MONTHS[d.getUTCMonth()]
}

/** ISO week code of the week holding the day: `2026-W43` (for file names). */
export function isoWeekCode(day: string): string {
  const monday = requireDay(weekStartOf(day))
  // The ISO year and week come from the Thursday of the week.
  const thursday = new Date(monday + 3 * DAY_MS)
  const year = thursday.getUTCFullYear()
  const firstThursday = Date.UTC(year, 0, 4) // 4 Jan is always in ISO week 1
  const week1Monday = firstThursday - ((new Date(firstThursday).getUTCDay() + 6) % 7) * DAY_MS
  const week = Math.round((monday - week1Monday) / (7 * DAY_MS)) + 1
  return `${year}-W${pad(week)}`
}

/** `2026-W43` for a week, `2026-10` for a month. */
export function periodCode(view: KpiView, start: string): string {
  return view === 'week' ? isoWeekCode(start) : periodStartOf('month', start).slice(0, 7)
}

/** `No jobs completed in this week` / `… this month`. */
export function emptyPeriodMessage(view: KpiView): string {
  return `No jobs completed in this ${view}`
}

/** Nothing was counted in the period at all (the cards are all zero). */
export function isEmptyPeriod(summary: {
  jobs_completed: number
  collected: number
  rescheduled: number
  postponed: number
  returned: number
}): boolean {
  return (
    summary.jobs_completed === 0 &&
    summary.collected === 0 &&
    summary.rescheduled + summary.postponed === 0 &&
    summary.returned === 0
  )
}

// ---------------------------------------------------------------------------
// The address (?view=week&start=2026-10-19&branch=<id>)
// ---------------------------------------------------------------------------
export interface KpiAddress {
  view: KpiView
  /** First day of the chosen week / month. */
  start: string
  /** One branch id, or null for "All my branches". */
  branch: string | null
}

/**
 * Read the address. Anything missing or invalid falls back to this week; a day
 * inside a period snaps to the period's start; a future period becomes the
 * current one (periods are never in the future).
 */
export function parseKpiAddress(search: string, now: Date = new Date()): KpiAddress {
  const params = new URLSearchParams(search)
  const view: KpiView = params.get('view') === 'month' ? 'month' : 'week'
  const current = currentPeriod(view, now).start
  const raw = (params.get('start') ?? '').trim()
  let start = current
  if (isKpiDay(raw)) {
    const snapped = periodStartOf(view, raw)
    start = snapped > current ? current : snapped
  }
  const branch = (params.get('branch') ?? '').trim()
  return { view, start, branch: branch === '' ? null : branch }
}

/** The address for a choice, without the leading `?`. Defaults are left out of the way: view and start are always kept. */
export function kpiAddress(address: KpiAddress): string {
  const params = new URLSearchParams()
  params.set('view', address.view)
  params.set('start', periodStartOf(address.view, address.start))
  if (address.branch) params.set('branch', address.branch)
  return params.toString()
}

// ---------------------------------------------------------------------------
// Leaderboard order, ranks and sorting
// ---------------------------------------------------------------------------
export interface LeaderboardRow {
  name: string
  jobs_completed: number
  total_amount: number
}

const cents = (amount: number) => Math.round(amount * 100)

/** The default order: jobs completed (most first), then total amount, then name. */
export function compareLeaderboard(a: LeaderboardRow, b: LeaderboardRow): number {
  return (
    b.jobs_completed - a.jobs_completed ||
    cents(b.total_amount) - cents(a.total_amount) ||
    a.name.toLowerCase().localeCompare(b.name.toLowerCase())
  )
}

/**
 * Competition ranks (1, 1, 3) of rows already in default order: equal jobs
 * completed and equal total amount share a rank (mirror of `rank()` in
 * `kpi_technicians`).
 */
export function competitionRanks(rows: readonly LeaderboardRow[]): number[] {
  const ranks: number[] = []
  rows.forEach((row, i) => {
    const prev = rows[i - 1]
    const tied = prev && prev.jobs_completed === row.jobs_completed && cents(prev.total_amount) === cents(row.total_amount)
    ranks.push(tied ? ranks[i - 1] : i + 1)
  })
  return ranks
}

/** Rows in default order with their rank. */
export function rankLeaderboard<T extends LeaderboardRow>(rows: readonly T[]): (T & { rank: number })[] {
  const ordered = [...rows].sort(compareLeaderboard)
  const ranks = competitionRanks(ordered)
  return ordered.map((row, i) => ({ ...row, rank: ranks[i] }))
}

export const LEADERBOARD_COLUMNS = [
  'rank',
  'name',
  'branch_name',
  'jobs_completed',
  'total_amount',
  'collected',
  'reschedules',
  'returned',
  'average_rating',
  'poor_ratings',
] as const
export type LeaderboardColumn = (typeof LEADERBOARD_COLUMNS)[number]
export type SortDirection = 'asc' | 'desc'

/** Text columns start A-Z; number columns start with the biggest. */
export function defaultSortDirection(column: LeaderboardColumn): SortDirection {
  return column === 'name' || column === 'branch_name' || column === 'rank' ? 'asc' : 'desc'
}

export interface SortableLeaderboardRow extends LeaderboardRow {
  rank: number | null
  branch_name: string
  collected: number
  reschedules: number
  returned: number
  average_rating: number | null
  poor_ratings: number
}

/**
 * Re-sort by a column header. Equal values keep the default order, empty
 * ratings go last in either direction, and the rank is left as the default
 * one (it is not recomputed).
 */
export function sortLeaderboardRows<T extends SortableLeaderboardRow>(
  rows: readonly T[],
  column: LeaderboardColumn,
  direction: SortDirection = defaultSortDirection(column),
): T[] {
  const sign = direction === 'asc' ? 1 : -1
  const value = (row: T): number | string | null => {
    if (column === 'name' || column === 'branch_name') return row[column].toLowerCase()
    return row[column]
  }
  return [...rows].sort((a, b) => {
    const x = value(a)
    const y = value(b)
    if (x === null && y === null) return compareLeaderboard(a, b)
    if (x === null) return 1
    if (y === null) return -1
    const order = typeof x === 'string' ? x.localeCompare(y as string) : (x as number) - (y as number)
    return sign * order || compareLeaderboard(a, b)
  })
}

/** The `aria-sort` value of a column header. */
export function ariaSort(
  column: LeaderboardColumn,
  sorted: { column: LeaderboardColumn; direction: SortDirection },
): 'ascending' | 'descending' | 'none' {
  if (sorted.column !== column) return 'none'
  return sorted.direction === 'asc' ? 'ascending' : 'descending'
}

/** Click a header: the same column flips, another column starts in its default direction. */
export function nextSort(
  column: LeaderboardColumn,
  sorted: { column: LeaderboardColumn; direction: SortDirection },
): { column: LeaderboardColumn; direction: SortDirection } {
  if (sorted.column === column) return { column, direction: sorted.direction === 'asc' ? 'desc' : 'asc' }
  return { column, direction: defaultSortDirection(column) }
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------
/** Average stars with one decimal (`4.3`), or `–` when nothing is rated. */
export function formatAverageRating(average: number | null | undefined): string {
  return average === null || average === undefined ? '–' : average.toFixed(1)
}

/** `3 of 5 rated`, for the rating card and the leaderboard. */
export function ratedLabel(rated: number, completed: number): string {
  return `${rated} of ${completed} rated`
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------
export interface CsvLeaderboardRow extends SortableLeaderboardRow {
  active: boolean
  rescheduled: number
  postponed: number
  rated: number
  needs_attention: boolean
}

export const CSV_HEADERS = [
  'Rank',
  'Technician',
  'Status',
  'Branch',
  'Jobs completed',
  'Total amount (MYR)',
  'Collected (MYR)',
  'Rescheduled',
  'Postponed',
  'Reschedules',
  'Returned',
  'Needs attention',
  'Rated',
  'Average rating',
  'Poor ratings',
] as const

/**
 * One CSV field: quoted when it holds a comma, quote, or line break (quotes
 * doubled). A text starting with `=`, `+`, `-`, `@` or a tab / carriage return
 * gets a leading apostrophe so Excel does not run it as a formula.
 */
export function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  let text = String(value)
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** The UTF-8 byte order mark Excel needs to read non-English names correctly. */
export const CSV_BOM = '﻿'

/**
 * The leaderboard as CSV: one row per technician with every metric, in the
 * order given, UTF-8 BOM first, CRLF line ends. Amounts have 2 decimals; an
 * empty rating is an empty field.
 */
export function leaderboardCsv(rows: readonly CsvLeaderboardRow[]): string {
  const lines = [CSV_HEADERS.map(csvField).join(',')]
  for (const r of rows) {
    lines.push(
      [
        r.rank,
        r.name,
        r.active ? 'Active' : 'Inactive',
        r.branch_name,
        r.jobs_completed,
        r.total_amount.toFixed(2),
        r.collected.toFixed(2),
        r.rescheduled,
        r.postponed,
        r.reschedules,
        r.returned,
        r.needs_attention ? 'Yes' : 'No',
        r.rated,
        r.average_rating === null ? '' : r.average_rating.toFixed(1),
        r.poor_ratings,
      ]
        .map(csvField)
        .join(','),
    )
  }
  return `${CSV_BOM}${lines.join('\r\n')}\r\n`
}

/** `kpi-2026-W43-shah-alam.csv`, or `kpi-2026-10-all-branches.csv`. */
export function leaderboardCsvFileName(view: KpiView, start: string, branchName: string | null): string {
  const slug = (branchName ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `kpi-${periodCode(view, start)}-${slug || 'all-branches'}.csv`
}
