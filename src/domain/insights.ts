import { currentPeriod, periodLabel, periodStartOf, type KpiView } from './kpi'

/**
 * Operational Insight (0009): what the Insights card and Ask point out.
 * Mirrors `_insight_busy`, `_insight_quiet`, `_insight_reschedules_up`,
 * `_insight_rating_drop` and `insight_facts` in
 * `supabase/migrations/20261024000002_ai_advanced.sql`;
 * `tests/db/parity.test.ts` checks both. The fixed sentences are shown when
 * the AI wording is not there (yet); `supabase/functions/ai-assist/insights.ts`
 * builds the same ones (tests/functions/ai-assist.test.ts).
 */

/** Fixed limits (plan P7); listed in the README. */
export const INSIGHT_LIMITS = {
  /** Busy: at least this many times the team average… */
  busyRatio: 1.5,
  /** Quiet: at most this share of the team average… */
  quietRatio: 0.5,
  /** …and in both cases at least this many jobs away from it. */
  jobsApart: 3,
  /** Review backlog: Job Done for more than this many days. */
  backlogDays: 2,
  /** Rising reschedules: at least this many times the period before… */
  reschedulesRatio: 2,
  /** …and at least this many more. */
  reschedulesMore: 3,
  /** Rating drop: the average fell by at least this much… */
  ratingDrop: 1,
  /** …with at least this many ratings in each period. */
  ratingsNeeded: 3,
} as const

export const INSIGHT_KINDS = ['busy', 'quiet', 'review_backlog', 'reschedules_up', 'rating_drop'] as const
export type InsightKind = (typeof INSIGHT_KINDS)[number]

/** One row of `insight_facts`. */
export interface InsightFact {
  kind: InsightKind
  technicianId: string | null
  technicianName: string | null
  technicianActive: boolean | null
  branchId: string | null
  branchName: string | null
  value: number
  previous: number | null
  teamAverage: number | null
  days: number | null
}

const L = INSIGHT_LIMITS

export function isBusy(jobs: number, average: number): boolean {
  return jobs >= average * L.busyRatio && jobs >= average + L.jobsApart
}

export function isQuiet(jobs: number, average: number): boolean {
  return jobs <= average * L.quietRatio && jobs <= average - L.jobsApart
}

export function reschedulesUp(now: number, before: number): boolean {
  return now >= before * L.reschedulesRatio && now >= before + L.reschedulesMore
}

export function ratingDropped(now: number | null, nowRated: number, before: number | null, beforeRated: number): boolean {
  if (now === null || before === null) return false
  return nowRated >= L.ratingsNeeded && beforeRated >= L.ratingsNeeded && Math.round((before - now) * 10) >= L.ratingDrop * 10
}

const one = (n: number) => n.toFixed(1)
const jobs = (n: number) => `${n} ${n === 1 ? 'job' : 'jobs'}`
const person = (f: InsightFact) => `${f.technicianName ?? 'A technician'}${f.technicianActive === false ? ' (inactive)' : ''}`

/**
 * The plain sentence for one fact. `period` reads after a verb, e.g.
 * "this week" or "in 12–18 Oct 2026".
 */
export function insightSentence(fact: InsightFact, period: string): string {
  switch (fact.kind) {
    case 'busy':
      return `${person(fact)} completed ${jobs(fact.value)} ${period}, well above the team average of ${one(fact.teamAverage ?? 0)}.`
    case 'quiet':
      return `${person(fact)} completed ${jobs(fact.value)} ${period}, well below the team average of ${one(fact.teamAverage ?? 0)}.`
    case 'review_backlog':
      return `${jobs(fact.value)} in ${fact.branchName} ${fact.value === 1 ? 'has' : 'have'} waited more than ${L.backlogDays} days for a Manager's review (oldest ${fact.days} days).`
    case 'reschedules_up':
      return `${fact.branchName} had ${fact.value} ${fact.value === 1 ? 'reschedule' : 'reschedules'} ${period}, up from ${fact.previous ?? 0} the period before.`
    case 'rating_drop':
      return `${person(fact)}'s average rating fell to ${one(fact.value)} ${period}, from ${one(fact.previous ?? 0)} the period before.`
  }
}

/** Every number a fact's sentence may use (the AI wording is checked against these). */
export function insightNumbers(fact: InsightFact): number[] {
  return [fact.value, fact.previous, fact.teamAverage, fact.days, L.backlogDays].filter(
    (n): n is number => n !== null && n !== undefined,
  )
}

export const NO_INSIGHTS_MESSAGE = 'Nothing stands out for this period.'

/**
 * How a sentence names the period: "this week (Mon 19 – Sun 25 Oct 2026)",
 * "this month (October 2026)", or "in Mon 12 – Sun 18 Oct 2026" for an
 * earlier one.
 */
export function insightPeriodPhrase(view: KpiView, start: string, now: Date = new Date()): string {
  const label = periodLabel(view, start)
  if (periodStartOf(view, start) === currentPeriod(view, now).start) return `this ${view} (${label})`
  return `in ${label}`
}
