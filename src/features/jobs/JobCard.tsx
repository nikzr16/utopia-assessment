import { Link } from 'react-router'
import { ChevronRight, Clock, MapPin, Wallet } from 'lucide-react'
import { StatusBadge } from '../../components/StatusBadge'
import { formatMalaysiaDateTime, formatMYR, jobArea } from '../../domain'
import { CustomerNotToldBadge } from '../customer-messages'
import type { OrderSummary } from './api'

/**
 * One job in the list: the whole card is the link to the job page.
 * `notTold` adds the "Customer not told yet" flag (Submitted tab).
 */
export function JobCard({
  job,
  overdue = false,
  notTold = false,
}: {
  job: OrderSummary
  overdue?: boolean
  notTold?: boolean
}) {
  const toCollect = job.status !== 'cancelled' && job.balance > 0
  const area = jobArea(job.customer_address)
  return (
    <li>
      <Link
        to={`/jobs/${encodeURIComponent(job.order_no)}`}
        className={`group relative block overflow-hidden rounded-xl border bg-surface p-4 shadow-card transition-colors hover:border-brand/40 active:bg-sunken ${
          overdue ? 'border-danger/40' : 'border-line'
        }`}
      >
        {overdue ? <span className="absolute inset-y-0 left-0 w-1 bg-danger" aria-hidden="true" /> : null}
        <div className="flex items-start justify-between gap-2">
          <span className="text-xs font-medium tracking-wide text-ink-faint">{job.order_no}</span>
          <StatusBadge status={job.status} />
        </div>
        <div className="mt-1 flex items-center justify-between gap-3">
          <p className="text-base font-semibold text-ink">{job.service_type_name}</p>
          <ChevronRight className="size-5 shrink-0 text-ink-faint transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
        </div>
        <p className="mt-1.5 flex items-start gap-2 break-words text-sm text-ink-muted">
          <MapPin className="mt-0.5 size-4 shrink-0 text-ink-faint" aria-hidden="true" />
          <span>
            {job.customer_name}
            {area ? ` · ${area}` : ''}
          </span>
        </p>
        <p className={`mt-1 flex items-center gap-2 text-sm ${overdue ? 'font-medium text-danger' : 'text-ink-muted'}`}>
          <Clock className={`size-4 shrink-0 ${overdue ? '' : 'text-ink-faint'}`} aria-hidden="true" />
          <span>
            {job.scheduled_at ? formatMalaysiaDateTime(job.scheduled_at) : 'No date yet'}
            {overdue ? ' · Overdue' : ''}
          </span>
        </p>
        {toCollect || notTold ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
            {toCollect ? (
              <p className="inline-flex items-center gap-1.5 rounded-lg bg-brand-soft px-2.5 py-1 text-sm font-medium text-brand-ink">
                <Wallet className="size-4" aria-hidden="true" />
                <span>To collect: {formatMYR(job.balance)}</span>
              </p>
            ) : null}
            {notTold ? <CustomerNotToldBadge /> : null}
          </div>
        ) : null}
      </Link>
    </li>
  )
}
