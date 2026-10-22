import { Link } from 'react-router'
import { StatusBadge } from '../../components/StatusBadge'
import { formatMalaysiaDateTime, formatMYR, jobArea } from '../../domain'
import type { OrderSummary } from './api'

/** One job in the list: the whole card is the link to the job page. */
export function JobCard({ job, overdue = false }: { job: OrderSummary; overdue?: boolean }) {
  const toCollect = job.status !== 'cancelled' && job.balance > 0
  return (
    <li>
      <Link
        to={`/jobs/${encodeURIComponent(job.order_no)}`}
        className="block rounded-lg border border-slate-200 bg-white p-4 shadow-sm hover:border-sky-300 focus:outline-none focus:ring-2 focus:ring-sky-300 active:bg-slate-50"
      >
        <div className="flex items-start justify-between gap-2">
          <span className="font-semibold text-slate-900">{job.order_no}</span>
          <StatusBadge status={job.status} />
        </div>
        <p className="mt-1 text-sm font-medium text-slate-800">{job.service_type_name}</p>
        <p className="mt-1 break-words text-sm text-slate-700">
          {job.customer_name}
          {jobArea(job.customer_address) ? ` · ${jobArea(job.customer_address)}` : ''}
        </p>
        <p className={`mt-1 text-sm ${overdue ? 'font-medium text-red-700' : 'text-slate-600'}`}>
          {job.scheduled_at ? formatMalaysiaDateTime(job.scheduled_at) : 'No date yet'}
          {overdue ? ' · Overdue' : ''}
        </p>
        {toCollect ? (
          <p className="mt-1 text-sm text-slate-600">To collect: {formatMYR(job.balance)}</p>
        ) : null}
      </Link>
    </li>
  )
}
