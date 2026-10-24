import { Link } from 'react-router'
import {
  RESCHEDULE_REASON_LABELS,
  formatMYR,
  formatMalaysiaDate,
  formatMalaysiaDateTime,
  type OrderStatus,
  type RescheduleReason,
} from '../../domain'
import { ChartColumn, TableProperties } from 'lucide-react'
import { StatusBadge } from '../../components/StatusBadge'
import { LINK } from '../../components/styles'
import type { AskTable, TableKind } from './types'

/**
 * The records behind an answer, drawn by the app from the database rows (the
 * AI never writes them; PRD Q8). A table from 640 px, cards below. Columns
 * with no value in any row are left out. Orders link to the person's portal.
 */

type Format = 'order' | 'status' | 'money' | 'datetime' | 'date' | 'text' | 'number' | 'rating' | 'kind' | 'reason' | 'method' | 'person' | 'insight'

interface Column {
  key: string
  label: string
  format: Format
}

const c = (key: string, label: string, format: Format = 'text'): Column => ({ key, label, format })

const COLUMNS: Record<Exclude<TableKind, 'summary'>, Column[]> = {
  events: [
    c('order_no', 'Order', 'order'), c('kind', 'Record', 'kind'), c('service_type', 'Service'), c('branch_name', 'Branch'),
    c('happened_at', 'When', 'datetime'), c('amount', 'Amount', 'money'), c('rating', 'Rating', 'rating'),
    c('reason', 'Reason', 'reason'),
  ],
  jobs: [
    c('order_no', 'Order', 'order'), c('status', 'Status', 'status'), c('service_type', 'Service'),
    c('customer_name', 'Customer'), c('customer_phone', 'Phone'), c('customer_address', 'Address'),
    c('technician_name', 'Technician', 'person'), c('branch_name', 'Branch'), c('scheduled_at', 'Scheduled', 'datetime'),
    c('job_done_at', 'Job done', 'datetime'), c('approved_at', 'Approved', 'datetime'), c('closed_at', 'Closed', 'datetime'),
    c('final_amount', 'Amount', 'money'), c('balance', 'Balance', 'money'), c('payment_status', 'Payment'),
  ],
  payments: [
    c('order_no', 'Order', 'order'), c('customer_name', 'Customer'), c('technician_name', 'Technician'),
    c('branch_name', 'Branch'), c('amount', 'Paid', 'money'), c('method', 'Method', 'method'),
    c('recorded_at', 'Recorded', 'datetime'), c('verified_at', 'Verified', 'datetime'),
    c('job_done_at', 'Job done', 'datetime'), c('final_amount', 'Amount', 'money'), c('balance', 'Balance', 'money'),
    c('payment_status', 'Payment'),
  ],
  technicians: [
    c('rank', 'Rank', 'number'), c('name', 'Technician', 'person'), c('branch_name', 'Branch'),
    c('jobs_completed', 'Jobs', 'number'), c('total_amount', 'Amount', 'money'), c('collected', 'Collected', 'money'),
    c('reschedules', 'Reschedules', 'number'), c('returned', 'Returned', 'number'), c('average_rating', 'Rating', 'rating'),
    c('poor_ratings', 'Poor', 'number'),
  ],
  branches: [
    c('branch_name', 'Branch'), c('jobs_completed', 'Jobs', 'number'), c('total_amount', 'Amount', 'money'),
    c('collected', 'Collected', 'money'), c('reschedules', 'Reschedules', 'number'), c('returned', 'Returned', 'number'),
    c('average_rating', 'Rating', 'rating'), c('active_technicians', 'Active technicians', 'number'),
  ],
  insights: [
    c('kind', 'Insight', 'kind'), c('technician_name', 'Technician', 'person'), c('branch_name', 'Branch'),
    c('value', 'Now', 'insight'), c('previous', 'Before', 'insight'), c('team_average', 'Team average', 'insight'),
    c('days', 'Oldest (days)', 'number'),
  ],
  trend: [
    c('period_start', 'From', 'date'), c('jobs_completed', 'Jobs', 'number'), c('total_amount', 'Amount', 'money'),
    c('reschedules', 'Reschedules', 'number'), c('average_rating', 'Rating', 'rating'),
  ],
}

const SUMMARY: Column[] = [
  c('jobs_completed', 'Jobs completed', 'number'), c('total_amount', 'Total amount', 'money'),
  c('collected', 'Collected', 'money'), c('rescheduled', 'Rescheduled', 'number'), c('postponed', 'Postponed', 'number'),
  c('returned', 'Returned for rework', 'number'), c('average_rating', 'Average rating', 'rating'),
  c('rated', 'Rated jobs', 'number'), c('poor_ratings', 'Poor ratings', 'number'),
  c('active_technicians', 'Active technicians', 'number'),
]

const KIND_LABELS: Record<string, string> = {
  completed: 'Completed', rescheduled: 'Rescheduled', postponed: 'Postponed', returned: 'Returned for rework',
  recorded: 'Payment', unverified: 'Not verified', unpaid: 'Unpaid', partly_paid: 'Partly paid',
  busy: 'Busy', quiet: 'Quiet', review_backlog: 'Waiting for review', reschedules_up: 'Rising reschedules',
  rating_drop: 'Rating drop',
}
const METHOD_LABELS: Record<string, string> = { cash: 'Cash', bank_transfer: 'Bank transfer', card: 'Card', ewallet: 'E-wallet' }

const empty = (v: unknown) => v === null || v === undefined || v === ''

function show(row: Record<string, unknown>, col: Column, orderPath: (orderNo: string) => string) {
  const v = row[col.key]
  if (empty(v)) return '—'
  switch (col.format) {
    case 'order':
      return (
        <Link className={LINK} to={orderPath(String(v))}>
          {String(v)}
        </Link>
      )
    case 'status':
      return <StatusBadge status={v as OrderStatus} />
    case 'money':
      return formatMYR(Number(v))
    case 'datetime':
      return formatMalaysiaDateTime(String(v))
    case 'date':
      return formatMalaysiaDate(`${String(v)}T00:00:00+08:00`)
    case 'number':
      return String(v)
    case 'insight':
      // Averages and ratings with one decimal (6.3, 2.0); counts as they are.
      return col.key === 'team_average' || row.kind === 'rating_drop' ? Number(v).toFixed(1) : String(v)
    case 'rating':
      return `${Number(v).toFixed(col.key === 'average_rating' ? 1 : 0)} ★`
    case 'kind':
      return KIND_LABELS[String(v)] ?? String(v)
    case 'reason':
      return RESCHEDULE_REASON_LABELS[v as RescheduleReason] ?? String(v)
    case 'method':
      return METHOD_LABELS[String(v)] ?? String(v)
    case 'person': {
      const inactive = row.technician_active === false || (col.key === 'name' && row.active === false)
      return `${String(v)}${inactive && !String(v).endsWith('(inactive)') ? ' (inactive)' : ''}`
    }
    default:
      return String(v).replace(/^(unpaid|partial|paid)$/, (s) => (s === 'partial' ? 'Partly paid' : s[0].toUpperCase() + s.slice(1)))
  }
}

/** Numbers line up on the right in the table. */
const NUMERIC: ReadonlySet<Format> = new Set<Format>(['money', 'number', 'rating', 'insight'])

const TITLE = 'flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-faint'

export function RecordTable({ table, orderPath }: { table: AskTable; orderPath: (orderNo: string) => string }) {
  if (table.kind === 'summary') {
    const row = table.rows[0] ?? {}
    return (
      <section aria-label={table.title} className="mt-3">
        <h4 className={TITLE}>
          <ChartColumn className="size-3.5" aria-hidden="true" />
          {table.title}
        </h4>
        <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
          {SUMMARY.filter((col) => !empty(row[col.key])).map((col) => (
            <div key={col.key} className="min-w-0 rounded-lg border border-line bg-sunken/60 px-3 py-2">
              <dt className="truncate text-xs text-ink-muted">{col.label}</dt>
              <dd className="mt-0.5 text-base font-semibold text-ink tabular">{show(row, col, orderPath)}</dd>
            </div>
          ))}
        </dl>
      </section>
    )
  }

  const columns = COLUMNS[table.kind].filter((col) => table.rows.some((r) => !empty(r[col.key])))
  const more = table.total > table.rows.length
  return (
    <section aria-label={table.title} className="mt-3">
      <h4 className={TITLE}>
        <TableProperties className="size-3.5" aria-hidden="true" />
        {table.title}
      </h4>
      {table.rows.length === 0 ? (
        <p className="mt-1.5 rounded-lg border border-dashed border-line-strong px-3 py-2 text-sm text-ink-muted">No records.</p>
      ) : (
        <>
          <div className="mt-2 hidden overflow-x-auto rounded-lg border border-line sm:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-sunken/70 text-xs font-medium uppercase tracking-wide text-ink-faint">
                <tr>
                  {columns.map((col) => (
                    <th
                      key={col.key}
                      scope="col"
                      className={`whitespace-nowrap px-3 py-2 font-medium ${NUMERIC.has(col.format) ? 'text-right' : ''}`}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, i) => (
                  <tr key={i} className="border-b border-line align-top last:border-0 hover:bg-sunken/60">
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={`px-3 py-2 text-ink ${NUMERIC.has(col.format) ? 'whitespace-nowrap text-right tabular' : ''} ${
                          col.format === 'datetime' || col.format === 'date' ? 'whitespace-nowrap tabular' : ''
                        }`}
                      >
                        {show(row, col, orderPath)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="mt-2 space-y-2 sm:hidden">
            {table.rows.map((row, i) => (
              <li key={i} className="rounded-lg border border-line bg-surface px-3 py-2.5 text-sm">
                <dl className="divide-y divide-line">
                  {columns.map((col) => (
                    <div key={col.key} className="flex items-baseline justify-between gap-3 py-1 first:pt-0 last:pb-0">
                      <dt className="shrink-0 text-xs text-ink-faint">{col.label}</dt>
                      <dd className={`min-w-0 break-words text-right text-ink ${NUMERIC.has(col.format) ? 'tabular' : ''}`}>
                        {show(row, col, orderPath)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
        </>
      )}
      {more && (
        <p className="mt-1.5 text-xs text-ink-faint">
          Showing {table.rows.length} of {table.total}.
        </p>
      )}
    </section>
  )
}
