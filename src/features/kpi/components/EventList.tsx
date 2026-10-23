import { Link } from 'react-router'
import { CARD, LINK } from '../../../components/styles'
import { RESCHEDULE_REASON_LABELS, formatMYR, formatMalaysiaDateTime } from '../../../domain'
import type { KpiEvent, KpiEventKind } from '../api'

const GROUPS: { kind: KpiEventKind; title: string; when: string; none: string }[] = [
  { kind: 'completed', title: 'Completed jobs', when: 'Approved', none: 'No jobs were approved in this period.' },
  { kind: 'rescheduled', title: 'Rescheduled', when: 'Logged', none: 'No reschedules in this period.' },
  { kind: 'postponed', title: 'Postponed (no new date)', when: 'Logged', none: 'No postponements in this period.' },
  { kind: 'returned', title: 'Returned for rework', when: 'Returned', none: 'No returns for rework in this period.' },
]

const PARTY_LABELS = { customer: 'Customer', technician: 'Technician', admin: 'Admin' } as const

function Detail({ event }: { event: KpiEvent }) {
  const parts: string[] = []
  if (event.kind === 'completed') {
    if (event.amount !== null) parts.push(`Final amount ${formatMYR(event.amount)}`)
    if (event.rating === null) parts.push('Not rated')
    else parts.push(`Rated ${event.rating} of 5${event.working_well === false ? ', not working well' : ''}`)
  } else if (event.kind === 'rescheduled' || event.kind === 'postponed') {
    if (event.reason) parts.push(`Reason: ${RESCHEDULE_REASON_LABELS[event.reason]}`)
    if (event.requested_by) parts.push(`Asked by ${PARTY_LABELS[event.requested_by].toLowerCase()}`)
  }
  if (event.note) parts.push(event.note)
  return parts.length > 0 ? <p className="mt-1 break-words text-sm text-slate-700">{parts.join(' · ')}</p> : null
}

/**
 * The rows behind a technician's numbers (PRD Q16), grouped by kind: each
 * order opens in the person's own portal through `orderPath`. Cards at every
 * width, so it reads the same on a phone.
 */
export function EventList({ events, orderPath }: { events: readonly KpiEvent[]; orderPath: (orderNo: string) => string }) {
  return (
    <div className="space-y-6">
      {GROUPS.map((group) => {
        const rows = events.filter((e) => e.kind === group.kind)
        return (
          <section key={group.kind} aria-label={group.title}>
            <h3 className="text-base font-semibold">
              {group.title} <span className="font-normal text-slate-600">({rows.length})</span>
            </h3>
            {rows.length === 0 ? (
              <p className="mt-2 text-sm text-slate-600">{group.none}</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {rows.map((event, i) => (
                  <li key={`${event.order_id}-${event.happened_at}-${i}`} className={CARD}>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <p>
                        <Link to={orderPath(event.order_no)} className={LINK}>
                          {event.order_no}
                        </Link>{' '}
                        <span className="text-sm text-slate-700">
                          {event.service_type} · {event.branch_name}
                        </span>
                      </p>
                      <p className="text-sm text-slate-600">
                        {group.when} {formatMalaysiaDateTime(event.happened_at)}
                      </p>
                    </div>
                    <Detail event={event} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        )
      })}
    </div>
  )
}
