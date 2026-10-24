/** Malaysia time is UTC+8 with no daylight saving. */
export const MALAYSIA_UTC_OFFSET_HOURS = 8

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const OFFSET_MS = MALAYSIA_UTC_OFFSET_HOURS * HOUR_MS

export interface WeekRange {
  /** Monday 00:00 Malaysia time (inclusive), as an absolute instant. */
  start: Date
  /** The following Monday 00:00 Malaysia time (exclusive). */
  end: Date
}

/**
 * Monday-Sunday week in Malaysia time containing `now`, shifted by
 * `weekOffset` weeks (0 = this week, -1 = last week, 1 = next week).
 * Use `start <= t < end` to test membership.
 */
export function malaysiaWeekRange(now: Date = new Date(), weekOffset = 0): WeekRange {
  // Shift so UTC getters read Malaysia wall-clock fields.
  const local = new Date(now.getTime() + OFFSET_MS)
  const midnightLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate())
  const daysSinceMonday = (local.getUTCDay() + 6) % 7 // Mon=0 ... Sun=6
  const mondayLocal = midnightLocal - daysSinceMonday * DAY_MS + weekOffset * 7 * DAY_MS
  const start = new Date(mondayLocal - OFFSET_MS)
  const end = new Date(mondayLocal + 7 * DAY_MS - OFFSET_MS)
  return { start, end }
}
