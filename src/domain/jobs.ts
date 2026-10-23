import { toMalaysiaDateTimeInput } from './malaysiaTime'
import type { OrderStatus } from './statuses'

/**
 * The technician's job list and job page. `JOB_VIEW_STATUSES` mirrors
 * `my_jobs` and `NOTIFICATION_EVENTS` the notifications event check in
 * `supabase/migrations/20261022000006_technician_job_portal.sql`;
 * `tests/db/parity.test.ts` checks both.
 */
export const JOB_VIEWS = ['open', 'submitted', 'finished'] as const
export type JobView = (typeof JOB_VIEWS)[number]

export const JOB_VIEW_LABELS: Record<JobView, string> = {
  open: 'Open',
  submitted: 'Submitted',
  finished: 'Finished',
}

export const JOB_VIEW_STATUSES: Record<JobView, readonly OrderStatus[]> = {
  open: ['assigned', 'acknowledged', 'in_progress'],
  submitted: ['job_done', 'reviewed'],
  finished: ['closed', 'cancelled'],
}

/** Finished jobs are listed for this many days after they close or are cancelled. */
export const FINISHED_JOB_DAYS = 30

export type OpenJobGroup = 'overdue' | 'today' | 'upcoming' | 'unscheduled'

export const OPEN_JOB_GROUPS: readonly OpenJobGroup[] = ['overdue', 'today', 'upcoming', 'unscheduled']

export const OPEN_JOB_GROUP_LABELS: Record<OpenJobGroup, string> = {
  overdue: 'Overdue',
  today: 'Today',
  upcoming: 'Upcoming',
  unscheduled: 'No date yet',
}

/** Malaysia calendar day (`2026-10-26`) of an instant. */
function malaysiaDay(iso: string): string {
  return toMalaysiaDateTimeInput(iso).slice(0, 10)
}

/**
 * Which group an open job falls in, by its scheduled Malaysia day: before
 * today is overdue, today is today (even if the time has passed), later is
 * upcoming, no date is unscheduled.
 */
export function openJobGroup(scheduledAt: string | null, now: Date = new Date()): OpenJobGroup {
  if (!scheduledAt) return 'unscheduled'
  const day = malaysiaDay(scheduledAt)
  if (!day) return 'unscheduled'
  const today = malaysiaDay(now.toISOString())
  if (day < today) return 'overdue'
  if (day === today) return 'today'
  return 'upcoming'
}

/**
 * Open jobs in their groups, in group order, keeping the order they came in
 * (soonest first from `my_jobs`). Empty groups are left out.
 */
export function groupOpenJobs<T extends { scheduled_at: string | null }>(
  jobs: readonly T[],
  now: Date = new Date(),
): Array<{ group: OpenJobGroup; jobs: T[] }> {
  const byGroup = new Map<OpenJobGroup, T[]>()
  for (const job of jobs) {
    const group = openJobGroup(job.scheduled_at, now)
    byGroup.set(group, [...(byGroup.get(group) ?? []), job])
  }
  return OPEN_JOB_GROUPS.filter((g) => byGroup.has(g)).map((group) => ({ group, jobs: byGroup.get(group)! }))
}

/** The area shown on a job card: the address's last part (`…, Shah Alam` → `Shah Alam`). */
export function jobArea(address: string): string {
  const parts = address
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
  return parts.length > 0 ? parts[parts.length - 1] : ''
}

/** `tel:+60123456789` for a stored phone (`60123456789`); null without digits. */
export function telUrl(phone: string): string | null {
  const digits = phone.replace(/\D/g, '')
  return digits ? `tel:+${digits}` : null
}

/** Google Maps search for an address; opens the Maps or Waze app on a phone. */
export function mapsUrl(address: string): string | null {
  const text = address.trim()
  return text ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(text)}` : null
}

/** In-app notification events. */
export const NOTIFICATION_EVENTS = [
  'assigned',
  'job_done',
  'rework',
  'reviewed',
  'order_updated',
  'cancelled',
  'reassigned_away',
  'payment_recorded',
  'job_approved',
  'job_closed',
  'low_feedback',
] as const
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number]

/**
 * Whether tapping a notification can open the job: after a reassignment
 * away the technician can no longer read the order.
 */
export function notificationOpensJob(event: NotificationEvent): boolean {
  return event !== 'reassigned_away'
}

/**
 * WhatsApp opener from the technician to the customer (for example to say
 * they are on the way). The technician edits or sends it in WhatsApp.
 */
export function customerGreeting(customerName: string, technicianName: string | null, orderNo: string): string {
  const from = technicianName ? `${technicianName} from Sejuk Sejuk Service` : 'Sejuk Sejuk Service'
  return `Hi ${customerName}, this is ${from} about your aircond job ${orderNo}.`
}

/** Short tag shown on each notification. */
export const NOTIFICATION_EVENT_LABELS: Record<NotificationEvent, string> = {
  assigned: 'New job',
  job_done: 'Job done',
  rework: 'Returned for rework',
  reviewed: 'Reviewed',
  order_updated: 'Details changed',
  cancelled: 'Cancelled',
  reassigned_away: 'Reassigned',
  payment_recorded: 'Payment recorded',
  job_approved: 'Approved',
  job_closed: 'Closed',
  low_feedback: 'Poor rating',
}
