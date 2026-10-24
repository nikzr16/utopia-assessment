import type { ReactNode } from 'react'
import { Banknote, CalendarClock, CircleCheckBig, RotateCcw, Star, UsersRound, type LucideIcon } from 'lucide-react'
import { formatAverageRating, formatMYR, ratedLabel } from '../../../domain'
import type { KpiSummary } from '../api'

/** What the cards need: the summary's figures (a technician's row has the same ones, minus active technicians). */
export type SummaryFigures = Pick<
  KpiSummary,
  | 'jobs_completed'
  | 'total_amount'
  | 'collected'
  | 'rescheduled'
  | 'postponed'
  | 'requested_by_customer'
  | 'requested_by_technician'
  | 'requested_by_admin'
  | 'returned'
  | 'rated'
  | 'average_rating'
  | 'poor_ratings'
> & { active_technicians?: number }

/** The tile grid: two per row on a phone, three on a tablet, one row on a wide screen. */
export function tileGridClass(count: number): string {
  return `grid grid-cols-2 gap-3 sm:grid-cols-3 ${count >= 6 ? '2xl:grid-cols-6' : '2xl:grid-cols-5'}`
}

/**
 * One number tile: label with an icon, the number, a one-line caption. The
 * label, number and caption sit directly in the tile's `div` (no wrapper), so
 * a reader of the label finds its number in the same box.
 */
function Tile({ label, value, icon: Icon, children }: { label: string; value: string; icon: LucideIcon; children?: ReactNode }) {
  return (
    <div className="flex flex-col rounded-xl border border-line bg-surface p-3.5 shadow-card sm:p-4">
      <dt className="flex items-start justify-between gap-2 text-xs font-medium leading-snug text-ink-muted">
        {label}
        <span aria-hidden="true" className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">
          <Icon className="size-4" />
        </span>
      </dt>
      <dd className="mt-auto pt-2">
        <span className="block break-words text-xl font-semibold leading-tight tracking-tight text-ink tabular sm:text-2xl">{value}</span>
        {children ? <span className="mt-1 block text-xs leading-snug text-ink-faint">{children}</span> : null}
      </dd>
    </div>
  )
}

/**
 * The period's numbers (PRD Q2-Q7, Q10): jobs completed with the approval hint,
 * total amount with "Collected" beside it, rescheduled / postponed by who
 * asked, returned, average rating, and active technicians (left out when the
 * figures are one person's). Two tiles per row on a phone (PRD 0011 Q15).
 */
export function SummaryCards({ figures }: { figures: SummaryFigures }) {
  const f = figures
  const showActive = f.active_technicians !== undefined
  return (
    <section aria-label="Summary">
      <dl className={tileGridClass(showActive ? 6 : 5)}>
        <Tile label="Jobs completed" value={String(f.jobs_completed)} icon={CircleCheckBig}>
          Counted when a Manager approves the job
        </Tile>
        <Tile label="Total amount" value={formatMYR(f.total_amount)} icon={Banknote}>
          Collected {formatMYR(f.collected)}
        </Tile>
        <Tile label="Rescheduled / Postponed" value={`${f.rescheduled} / ${f.postponed}`} icon={CalendarClock}>
          Asked by customer {f.requested_by_customer}, technician {f.requested_by_technician}, admin {f.requested_by_admin}
        </Tile>
        <Tile label="Returned" value={String(f.returned)} icon={RotateCcw}>
          Sent back for rework
        </Tile>
        <Tile label="Average rating" value={formatAverageRating(f.average_rating)} icon={Star}>
          {ratedLabel(f.rated, f.jobs_completed)}, {f.poor_ratings} poor
        </Tile>
        {showActive ? (
          <Tile label="Active technicians" value={String(f.active_technicians)} icon={UsersRound}>
            At the end of the period
          </Tile>
        ) : null}
      </dl>
    </section>
  )
}
