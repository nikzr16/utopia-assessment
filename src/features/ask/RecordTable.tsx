import { Link } from 'react-router'
import {
  RESCHEDULE_REASON_LABELS,
  formatMYR,
  formatMalaysiaDate,
  formatMalaysiaDateTime,
  statusLabel,
  type OrderStatus,
  type RescheduleReason,
} from '../../domain'
import { LINK } from '../../components/styles'
import type { AskTable, TableKind } from './types'

/**
 * The records behind an answer, drawn by the app from the database rows (the
 * AI never writes them; PRD Q8). A table from 640 px, cards below. Columns
 * with no value in any row are left out. Orders link to the person's portal.
 */

type Format = 'order' | 'status' | 'money' | 'datetime' | 'date' | 'text' | 'number' | 'rating' | 'kind' | 'reason' | 'method' | 'person'

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
      return statusLabel(v as OrderStatus)
    case 'money':
      return formatMYR(Number(v))
    case 'datetime':
      return formatMalaysiaDateTime(String(v))
    case 'date':
      return formatMalaysiaDate(`${String(v)}T00:00:00+08:00`)
    case 'number':
      return String(v)
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

export function RecordTable({ table, orderPath }: { table: AskTable; orderPath: (orderNo: string) => string }) {
  if (table.kind === 'summary') {
    const row = table.rows[0] ?? {}
    return (
      <section aria-label={table.title} className="mt-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{table.title}</h4>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          {SUMMARY.filter((col) => !empty(row[col.key])).map((col) => (
            <div key={col.key} className="flex justify-between gap-2 border-b border-slate-100 py-1">
              <dt className="text-slate-600">{col.label}</dt>
              <dd className="font-medium text-slate-900">{show(row, col, orderPath)}</dd>
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
      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{table.title}</h4>
      {table.rows.length === 0 ? (
        <p className="mt-1 text-sm text-slate-600">No records.</p>
      ) : (
        <>
          <div className="mt-2 hidden overflow-x-auto sm:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500">
                  {columns.map((col) => (
                    <th key={col.key} scope="col" className="whitespace-nowrap py-1 pr-3 font-medium">
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, i) => (
                  <tr key={i} className="border-b border-slate-100 align-top">
                    {columns.map((col) => (
                      <td key={col.key} className="py-1 pr-3 text-slate-800">
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
              <li key={i} className="rounded-md border border-slate-200 p-2 text-sm">
                <dl className="space-y-0.5">
                  {columns.map((col) => (
                    <div key={col.key} className="flex justify-between gap-3">
                      <dt className="text-slate-500">{col.label}</dt>
                      <dd className="text-right text-slate-900">{show(row, col, orderPath)}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
        </>
      )}
      {more && (
        <p className="mt-1 text-xs text-slate-500">
          Showing {table.rows.length} of {table.total}.
        </p>
      )}
    </section>
  )
}
