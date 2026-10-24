/**
 * Workflow Supervisor (0009): warnings on a finished job. Mirrors
 * `supabase/migrations/20261024000002_ai_advanced.sql`
 * (`_supervisor_over_quote`, `_supervisor_rules`, `check_order_warning`);
 * `tests/db/parity.test.ts` checks both.
 */

/** Fixed limits (plan P7); listed in the README. */
export const SUPERVISOR_LIMITS = {
  /** Final amount at least this many times the quote… */
  overQuoteRatio: 1.5,
  /** …and at least this many ringgit above it. */
  overQuoteMinimum: 100,
  /** Returned for rework this many times or more. */
  returns: 2,
  /** Rescheduled or postponed this many times or more. */
  reschedules: 3,
} as const

export const WARNING_RULES = [
  'over_quote',
  'no_photo',
  'many_returns',
  'many_reschedules',
  'low_rating',
  'ai_text',
] as const
export type WarningRule = (typeof WARNING_RULES)[number]

export const WARNING_STATUSES = ['open', 'checked', 'resolved'] as const
export type WarningStatus = (typeof WARNING_STATUSES)[number]

export const SUPERVISOR_RUN_STATUSES = ['pending', 'running', 'done', 'failed', 'not_set_up'] as const
export type SupervisorRunStatus = (typeof SUPERVISOR_RUN_STATUSES)[number]

/** Short labels for the Warnings box. */
export const WARNING_RULE_LABELS: Record<WarningRule, string> = {
  over_quote: 'Amount',
  no_photo: 'Photos',
  many_returns: 'Returns',
  many_reschedules: 'Reschedules',
  low_rating: 'Rating',
  ai_text: 'AI',
}

/** Final amount much higher than the quote. Mirrors `_supervisor_over_quote`. */
export function isOverQuote(quoted: number, final: number): boolean {
  const cents = (n: number) => Math.round(n * 100)
  return (
    cents(final) * 2 >= cents(quoted) * 2 * SUPERVISOR_LIMITS.overQuoteRatio &&
    cents(final) - cents(quoted) >= SUPERVISOR_LIMITS.overQuoteMinimum * 100
  )
}

/** A Manager's note when checking a warning: 3-300 characters. */
export const CHECK_NOTE_MIN = 3
export const CHECK_NOTE_MAX = 300

/** The note to store (spaces collapsed), or the message to show. */
export function checkNoteError(note: string): string | null {
  const text = note.replace(/\s+/g, ' ').trim()
  if (text.length < CHECK_NOTE_MIN) return 'Write a short note (at least 3 characters)'
  if (text.length > CHECK_NOTE_MAX) return 'Keep the note to 300 characters'
  return null
}

/** Approve is blocked while any warning is open (PRD Q8). */
export function approveWarningsBlock(openWarnings: number): string | null {
  return openWarnings > 0 ? `Check every warning before approving (${openWarnings} open)` : null
}

/** Plain words for the AI check's state on the order page. */
export function supervisorRunText(status: SupervisorRunStatus | null): string | null {
  switch (status) {
    case 'pending':
    case 'running':
      return 'AI check running…'
    case 'failed':
    case 'not_set_up':
      return "AI check didn't run. Press Re-check to try again."
    default:
      return null
  }
}
