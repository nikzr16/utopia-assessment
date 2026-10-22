import { MALAYSIA_UTC_OFFSET_HOURS } from './week'

/**
 * Malaysia-time (UTC+8) conversions for form fields and display. They never
 * use the browser's own time zone, so an Admin whose laptop is set to another
 * zone still enters and sees Malaysia times.
 */
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const OFFSET_MS = MALAYSIA_UTC_OFFSET_HOURS * HOUR_MS

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const pad = (n: number) => String(n).padStart(2, '0')

/** A Date whose UTC getters read Malaysia wall-clock fields. */
function wallClock(iso: string): Date | null {
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? null : new Date(t + OFFSET_MS)
}

/** ISO instant → `datetime-local` value (`2026-10-26T10:00`) in Malaysia time; '' when empty. */
export function toMalaysiaDateTimeInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = wallClock(iso)
  if (!d) return ''
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

const DATE_TIME_INPUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/
const DATE_INPUT = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * `datetime-local` value read as Malaysia time → ISO instant.
 * Empty → null; anything that is not a real date and time → undefined.
 */
export function fromMalaysiaDateTimeInput(value: string): string | null | undefined {
  if (value.trim() === '') return null
  const m = DATE_TIME_INPUT.exec(value.trim())
  if (!m) return undefined
  const [y, mo, d, h, mi] = m.slice(1).map(Number)
  const utc = Date.UTC(y, mo - 1, d, h, mi)
  const check = new Date(utc)
  // Rejects 2026-02-30 and the like (Date.UTC would roll them over).
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d || h > 23 || mi > 59) return undefined
  return new Date(utc - OFFSET_MS).toISOString()
}

/**
 * A `date` input value (`2026-10-27`) → the Malaysia day as
 * `{ from, to }` ISO instants (`from <= t < to`); null when empty or invalid.
 */
export function malaysiaDayRange(value: string): { from: string; to: string } | null {
  const m = DATE_INPUT.exec(value.trim())
  if (!m) return null
  const [y, mo, d] = m.slice(1).map(Number)
  const midnight = Date.UTC(y, mo - 1, d)
  const check = new Date(midnight)
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null
  return {
    from: new Date(midnight - OFFSET_MS).toISOString(),
    to: new Date(midnight + DAY_MS - OFFSET_MS).toISOString(),
  }
}

/** `Mon 26 Oct 2026, 10:00 AM` in Malaysia time; '' when empty or invalid. */
export function formatMalaysiaDateTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = wallClock(iso)
  if (!d) return ''
  const h = d.getUTCHours()
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${h12}:${pad(d.getUTCMinutes())} ${h < 12 ? 'AM' : 'PM'}`
}

/** `26 Oct 2026` in Malaysia time; '' when empty or invalid. */
export function formatMalaysiaDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = wallClock(iso)
  if (!d) return ''
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}
