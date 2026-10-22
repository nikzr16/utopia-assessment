import { CARD } from '../../components/styles'
import {
  PAYMENT_METHOD_LABELS,
  RESCHEDULE_REASON_LABELS,
  ROLE_LABELS,
  STATUS_LABELS,
  formatMYR,
  formatMalaysiaDateTime,
  formatMyPhone,
  type PaymentMethod,
  type RescheduleReason,
} from '../../domain'
import type { HistoryEntry } from './api'

const ACTION_LABELS: Record<string, string> = {
  created: 'Created the order',
  assigned: 'Assigned a technician',
  reassigned: 'Reassigned the order',
  updated: 'Edited the order',
  acknowledged: 'Acknowledged the job',
  started: 'Started the job',
  completion_submitted: 'Submitted the completion record',
  returned_for_rework: 'Returned the job for rework',
  reviewed: 'Reviewed the job',
  closed: 'Closed the order',
  cancelled: 'Cancelled the order',
  rescheduled: 'Rescheduled the order',
  payment_recorded: 'Recorded a payment',
  file_added: 'Added a file',
  file_removed: 'Removed a file',
}

const FIELD_LABELS: Record<string, string> = {
  branch: 'Branch',
  customer_name: 'Customer name',
  customer_phone: 'Phone',
  customer_address: 'Address',
  problem_description: 'Problem description',
  service_type: 'Service type',
  quoted_price: 'Quoted price',
  scheduled_at: 'Scheduled',
  admin_notes: 'Admin notes',
}

function showValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '(empty)'
  if (field === 'customer_phone') return formatMyPhone(String(value))
  if (field === 'quoted_price') return formatMYR(Number(value))
  if (field === 'scheduled_at') return formatMalaysiaDateTime(String(value))
  return String(value)
}

const str = (v: unknown) => (typeof v === 'string' ? v : null)

/** Lines describing what an entry changed, in plain words. */
export function historyDetails(entry: HistoryEntry): string[] {
  const d = entry.details
  switch (entry.action) {
    case 'created':
      return str(d.technician_name) ? [`Assigned to ${d.technician_name}`] : []
    case 'assigned':
      return [`Assigned to ${str(d.technician_name) ?? 'a technician'}`]
    case 'reassigned':
      return [`From ${str(d.previous_technician_name) ?? '?'} to ${str(d.new_technician_name) ?? '?'}`]
    case 'updated': {
      const changes = (d.changes ?? {}) as Record<string, { from: unknown; to: unknown }>
      return Object.entries(changes).map(
        ([field, c]) => `${FIELD_LABELS[field] ?? field}: ${showValue(field, c.from)} → ${showValue(field, c.to)}`,
      )
    }
    case 'rescheduled': {
      const to = str(d.new_scheduled_at)
      const reason = RESCHEDULE_REASON_LABELS[d.reason as RescheduleReason] ?? String(d.reason)
      return [
        `From ${str(d.old_scheduled_at) ? formatMalaysiaDateTime(str(d.old_scheduled_at)) : 'no date'} to ${
          to ? formatMalaysiaDateTime(to) : 'no date (postponed)'
        }`,
        `Reason: ${reason} (requested by ${String(d.requested_by)})`,
      ]
    }
    case 'payment_recorded':
      return [
        `${formatMYR(Number(d.amount))} by ${PAYMENT_METHOD_LABELS[d.method as PaymentMethod] ?? String(d.method)}${
          d.receipt ? ', with receipt' : ''
        }`,
      ]
    case 'file_added':
    case 'file_removed':
      return [str(d.file_name) ?? String(d.kind ?? 'file')]
    case 'completion_submitted':
      return [`Final amount ${formatMYR(Number(d.final_amount))}`]
    default:
      return []
  }
}

/** Who did what to the order, newest first (PRD AC9). */
export function OrderHistory({ entries }: { entries: HistoryEntry[] }) {
  return (
    <section className={CARD} aria-labelledby="order-history">
      <h3 id="order-history" className="text-base font-semibold">
        History
      </h3>
      {entries.length === 0 ? (
        <p className="mt-3 text-sm text-slate-600">No history yet.</p>
      ) : (
        <ol className="mt-3 space-y-4">
          {entries.map((entry) => {
            const details = historyDetails(entry)
            return (
              <li key={entry.id} className="border-l-2 border-slate-200 pl-3">
                <p className="text-sm font-medium text-slate-900">
                  {ACTION_LABELS[entry.action] ?? entry.action}
                  {entry.from_status && entry.to_status && entry.from_status !== entry.to_status ? (
                    <span className="font-normal text-slate-600">
                      {' '}
                      · {STATUS_LABELS[entry.from_status]} → {STATUS_LABELS[entry.to_status]}
                    </span>
                  ) : !entry.from_status && entry.to_status ? (
                    <span className="font-normal text-slate-600"> · {STATUS_LABELS[entry.to_status]}</span>
                  ) : null}
                </p>
                <p className="text-xs text-slate-500">
                  {entry.actor_name} ({ROLE_LABELS[entry.actor_role]}) · {formatMalaysiaDateTime(entry.created_at)}
                </p>
                {details.length > 0 || entry.note ? (
                  <ul className="mt-1 space-y-0.5 text-sm text-slate-700">
                    {details.map((line) => (
                      <li key={line} className="break-words">
                        {line}
                      </li>
                    ))}
                    {entry.note ? <li className="break-words">Note: {entry.note}</li> : null}
                  </ul>
                ) : null}
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
