import { History } from 'lucide-react'
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
import { staffName, useInactiveStaff } from '../../lib/staffStatus'
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
  payment_verified: 'Verified a payment',
  payment_unverified: 'Undid a payment verification',
  file_added: 'Added a file',
  file_removed: 'Removed a file',
  order_form_added: 'Attached the paper order form',
  order_form_removed: 'Removed the paper order form',
  customer_message_edited: 'Edited the customer message',
  customer_messaged: 'Sent the customer message on WhatsApp',
  customer_called: 'Told the customer by phone',
  feedback_recorded: 'Recorded the customer rating taken by phone',
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
    case 'payment_verified':
    case 'payment_unverified':
      return [`${formatMYR(Number(d.amount))} by ${PAYMENT_METHOD_LABELS[d.method as PaymentMethod] ?? String(d.method)}`]
    case 'file_added':
    case 'file_removed':
    case 'order_form_removed':
      return [str(d.file_name) ?? String(d.kind ?? 'file')]
    case 'order_form_added':
      return [`${str(d.file_name) ?? String(d.kind ?? 'file')}${d.replaced ? ' (replaced the earlier one)' : ''}`]
    case 'completion_submitted':
      return [`Final amount ${formatMYR(Number(d.final_amount))}`]
    case 'customer_message_edited':
      return [`From: ${str(d.previous_body) ?? '(empty)'}`, `To: ${str(d.new_body) ?? '(empty)'}`]
    case 'customer_messaged':
      return [
        `To ${str(d.phone) ? formatMyPhone(String(d.phone)) : 'the customer'}${d.edited ? ' (text was edited)' : ''}`,
        `Message: ${str(d.body) ?? '(empty)'}`,
      ]
    case 'customer_called':
      return [`Called ${str(d.phone) ? formatMyPhone(String(d.phone)) : 'the customer'}`]
    case 'feedback_recorded':
      return [
        `${String(d.rating)} out of 5 stars; working well now: ${d.working_well ? 'Yes' : 'No'}`,
        ...(str(d.comment) ? [`Comment: ${String(d.comment)}`] : []),
      ]
    default:
      return []
  }
}

/** Dot colour for an entry: problems stand out, finished steps are green. */
function dotTone(action: string): string {
  if (action === 'cancelled') return 'bg-danger'
  if (action === 'returned_for_rework' || action === 'payment_unverified') return 'bg-warning'
  if (action === 'reviewed' || action === 'closed' || action === 'payment_verified') return 'bg-success'
  if (action === 'created' || action === 'assigned' || action === 'reassigned') return 'bg-brand'
  return 'bg-line-strong'
}

/** Who did what to the order, newest first (PRD AC9): a timeline of dots and lines. */
export function OrderHistory({ entries }: { entries: HistoryEntry[] }) {
  useInactiveStaff() // re-render with "(inactive)" tags once known
  return (
    <section className={CARD} aria-labelledby="order-history">
      <div className="flex items-center justify-between gap-3">
        <h3 id="order-history" className="flex items-center gap-2 text-base font-semibold text-ink">
          <History className="size-4.5 text-ink-faint" aria-hidden="true" />
          History
        </h3>
        {entries.length > 0 ? (
          <span className="text-xs text-ink-faint tabular">
            {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
          </span>
        ) : null}
      </div>
      {entries.length === 0 ? (
        <p className="mt-3 text-sm text-ink-muted">No history yet.</p>
      ) : (
        <ol className="mt-4">
          {entries.map((entry, i) => {
            const details = historyDetails(entry)
            const last = i === entries.length - 1
            return (
              <li key={entry.id} className={`relative pl-7 ${last ? '' : 'pb-5'}`}>
                {last ? null : <span aria-hidden="true" className="absolute left-[5px] top-4 bottom-0 w-0.5 rounded-full bg-line" />}
                <span
                  aria-hidden="true"
                  className={`absolute left-0 top-1 size-3 rounded-full ring-4 ring-surface ${dotTone(entry.action)}`}
                />
                <p className="text-sm font-medium text-ink">
                  {ACTION_LABELS[entry.action] ?? entry.action}
                  {entry.from_status && entry.to_status && entry.from_status !== entry.to_status ? (
                    <span className="font-normal text-ink-muted">
                      {' '}
                      · {STATUS_LABELS[entry.from_status]} → {STATUS_LABELS[entry.to_status]}
                    </span>
                  ) : !entry.from_status && entry.to_status ? (
                    <span className="font-normal text-ink-muted"> · {STATUS_LABELS[entry.to_status]}</span>
                  ) : null}
                </p>
                <p className="mt-0.5 text-xs text-ink-faint">
                  {staffName(entry.actor_name, entry.actor_id)} ({ROLE_LABELS[entry.actor_role]}) · {formatMalaysiaDateTime(entry.created_at)}
                </p>
                {details.length > 0 || entry.note ? (
                  <ul className="mt-2 space-y-1 rounded-lg bg-sunken px-3 py-2 text-sm text-ink-muted">
                    {details.map((line) => (
                      <li key={line} className="whitespace-pre-line break-words">
                        {line}
                      </li>
                    ))}
                    {entry.note ? <li className="whitespace-pre-line break-words">Note: {entry.note}</li> : null}
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
