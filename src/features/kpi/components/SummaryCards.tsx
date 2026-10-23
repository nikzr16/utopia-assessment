import type { ReactNode } from 'react'
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

function Card({ label, value, children }: { label: string; value: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
      <dt className="text-xs font-medium text-slate-600">{label}</dt>
      <dd className="mt-1">
        <span className="block break-words text-2xl font-semibold tabular-nums">{value}</span>
        {children ? <span className="mt-1 block text-xs text-slate-600">{children}</span> : null}
      </dd>
    </div>
  )
}

/**
 * The period's numbers (PRD Q2-Q7, Q10): jobs completed with the approval hint,
 * total amount with "Collected" beside it, rescheduled / postponed by who
 * asked, returned, average rating, and active technicians (left out when the
 * figures are one person's). Two columns on a phone, one row on a desktop.
 */
export function SummaryCards({ figures }: { figures: SummaryFigures }) {
  const f = figures
  const showActive = f.active_technicians !== undefined
  return (
    <section aria-label="Summary">
      <dl className={`grid grid-cols-2 gap-3 md:grid-cols-3 ${showActive ? 'lg:grid-cols-6' : 'lg:grid-cols-5'}`}>
        <Card label="Jobs completed" value={String(f.jobs_completed)}>
          Counted when a Manager approves the job
        </Card>
        <Card label="Total amount" value={formatMYR(f.total_amount)}>
          Collected {formatMYR(f.collected)}
        </Card>
        <Card label="Rescheduled / Postponed" value={`${f.rescheduled} / ${f.postponed}`}>
          Asked by customer {f.requested_by_customer}, technician {f.requested_by_technician}, admin {f.requested_by_admin}
        </Card>
        <Card label="Returned" value={String(f.returned)}>
          Sent back for rework
        </Card>
        <Card label="Average rating" value={formatAverageRating(f.average_rating)}>
          {ratedLabel(f.rated, f.jobs_completed)}, {f.poor_ratings} poor
        </Card>
        {showActive ? (
          <Card label="Active technicians" value={String(f.active_technicians)}>
            At the end of the period
          </Card>
        ) : null}
      </dl>
    </section>
  )
}
