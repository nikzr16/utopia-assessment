import { Link } from 'react-router'
import { CalendarClock, CircleCheckBig, CirclePause, RotateCcw, type LucideIcon } from 'lucide-react'
import { CARD, LINK } from '../../../components/styles'
import { RESCHEDULE_REASON_LABELS, formatMYR, formatMalaysiaDateTime } from '../../../domain'
import type { KpiEvent, KpiEventKind } from '../api'

const GROUPS: { kind: KpiEventKind; title: string; when: string; none: string; icon: LucideIcon; warn: boolean }[] = [
  { kind: 'completed', title: 'Completed jobs', when: 'Approved', none: 'No jobs were approved in this period.', icon: CircleCheckBig, warn: false },
  { kind: 'rescheduled', title: 'Rescheduled', when: 'Logged', none: 'No reschedules in this period.', icon: CalendarClock, warn: false },
  { kind: 'postponed', title: 'Postponed (no new date)', when: 'Logged', none: 'No postponements in this period.', icon: CirclePause, warn: false },
  { kind: 'returned', title: 'Returned for rework', when: 'Returned', none: 'No returns for rework in this period.', icon: RotateCcw, warn: true },
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
  return parts.length > 0 ? <p className="mt-1 break-words text-sm text-ink-muted">{parts.join(' · ')}</p> : null
}

/**
 * The rows behind a technician's numbers (PRD Q16), grouped by kind: each
 * order opens in the person's own portal through `orderPath`. One card per
 * group with its rows inside; one column on a phone, two on a wide screen.
 */
export function EventList({ events, orderPath }: { events: readonly KpiEvent[]; orderPath: (orderNo: string) => string }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {GROUPS.map((group) => {
        const rows = events.filter((e) => e.kind === group.kind)
        const Icon = group.icon
        return (
          <section key={group.kind} aria-label={group.title} className={`${CARD} min-w-0`}>
            <h3 className="flex items-center gap-2.5 text-base font-semibold text-ink">
              <span
                aria-hidden="true"
                className={`inline-flex size-8 shrink-0 items-center justify-center rounded-lg ${
                  group.warn ? 'bg-warning-soft text-warning' : 'bg-brand-soft text-brand'
                }`}
              >
                <Icon className="size-4" />
              </span>
              <span className="min-w-0 flex-1">{group.title}</span>
              <span className="rounded-full bg-sunken px-2 py-0.5 text-xs font-medium text-ink-muted tabular ring-1 ring-inset ring-line">
                <span className="sr-only">(</span>
                {rows.length}
                <span className="sr-only">)</span>
              </span>
            </h3>
            {rows.length === 0 ? (
              <p className="mt-3 text-sm text-ink-faint">{group.none}</p>
            ) : (
              <ul className="-mx-4 mt-3 divide-y divide-line border-t border-line sm:-mx-5">
                {rows.map((event, i) => (
                  <li key={`${event.order_id}-${event.happened_at}-${i}`} className="px-4 py-3 sm:px-5">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                      <p className="min-w-0">
                        <Link to={orderPath(event.order_no)} className={LINK}>
                          {event.order_no}
                        </Link>{' '}
                        <span className="text-sm text-ink-muted">
                          {event.service_type} · {event.branch_name}
                        </span>
                      </p>
                      <p className="text-xs text-ink-faint">
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
