import { useId, type ReactNode } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { INPUT } from '../../../components/styles'
import {
  KPI_VIEWS,
  KPI_VIEW_LABELS,
  canShowNextPeriod,
  currentPeriod,
  isKpiDay,
  malaysiaToday,
  periodLabel,
  periodStartOf,
  shiftPeriod,
  type KpiAddress,
  type KpiView,
} from '../../../domain'

/** A segment of the sunken track: the chosen one is a raised white chip. */
function Segment({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`inline-flex min-h-9 flex-1 items-center justify-center whitespace-nowrap rounded-lg px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-focus max-md:min-h-11 ${
        pressed ? 'bg-surface text-ink shadow-card ring-1 ring-line' : 'text-ink-muted hover:text-ink'
      }`}
    >
      {children}
    </button>
  )
}

const TRACK = 'flex gap-1 rounded-xl bg-sunken p-1 ring-1 ring-inset ring-line'
const STEP =
  'inline-flex size-10 shrink-0 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-sunken hover:text-ink focus-visible:outline-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent max-md:size-11'

/**
 * Week / Month toggle, "This week" / "Last week" (or month), previous and next
 * arrows around the period, and a date that snaps to its week or month. There
 * are no future periods. Changes go to `onChange`; the page keeps them in the
 * address. On a phone: Week / Month beside the date, then This / Last, then
 * the arrows around the period, each on one line (PRD 0011 Q15).
 */
export function PeriodPicker({
  view,
  start,
  onChange,
}: {
  view: KpiView
  start: string
  onChange: (change: Partial<KpiAddress>) => void
}) {
  const dateId = useId()
  const thisStart = currentPeriod(view).start
  const lastStart = shiftPeriod(view, thisStart, -1)
  const unit = view === 'week' ? 'week' : 'month'
  const pick = (value: string) => {
    if (!isKpiDay(value)) return
    const snapped = periodStartOf(view, value)
    onChange({ start: snapped > thisStart ? thisStart : snapped })
  }

  return (
    <section aria-label="Period" className="flex flex-wrap items-center gap-2.5">
      <div role="group" aria-label="View" className={`${TRACK} order-1 shrink-0`}>
        {KPI_VIEWS.map((v) => (
          <Segment key={v} pressed={view === v} onClick={() => onChange({ view: v, start: periodStartOf(v, start) })}>
            {KPI_VIEW_LABELS[v]}
          </Segment>
        ))}
      </div>

      <div className={`${TRACK} order-3 w-full sm:w-auto lg:order-2`}>
        <Segment pressed={start === thisStart} onClick={() => onChange({ start: thisStart })}>
          {`This ${unit}`}
        </Segment>
        <Segment pressed={start === lastStart} onClick={() => onChange({ start: lastStart })}>
          {`Last ${unit}`}
        </Segment>
      </div>

      <div className="order-4 flex w-full items-center gap-1 rounded-xl border border-line bg-surface p-1 shadow-xs sm:w-auto sm:min-w-72 sm:flex-1 lg:order-3 lg:flex-none">
        <button type="button" className={STEP} aria-label={`Previous ${unit}`} onClick={() => onChange({ start: shiftPeriod(view, start, -1) })}>
          <ChevronLeft className="size-5" aria-hidden="true" />
        </button>
        <p className="min-w-0 flex-1 px-1 text-center text-sm font-semibold leading-tight text-ink tabular" aria-live="polite">
          {periodLabel(view, start)}
        </p>
        <button
          type="button"
          className={STEP}
          aria-label={`Next ${unit}`}
          disabled={!canShowNextPeriod(view, start)}
          onClick={() => onChange({ start: shiftPeriod(view, start, 1) })}
        >
          <ChevronRight className="size-5" aria-hidden="true" />
        </button>
      </div>

      {/* Beside Week / Month on a phone, last on wider screens. */}
      <div className="order-2 flex min-w-0 flex-1 items-center gap-2 sm:ml-auto sm:flex-none lg:order-4">
        <label htmlFor={dateId} className="shrink-0 text-xs font-medium text-ink-muted max-sm:sr-only">
          Go to a date
        </label>
        <div className="relative min-w-0 flex-1">
          <CalendarDays className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-faint" aria-hidden="true" />
          <input
            id={dateId}
            type="date"
            value={start}
            max={malaysiaToday()}
            onChange={(e) => pick(e.target.value)}
            className={`${INPUT} pl-9 max-md:min-h-11 sm:w-44`}
          />
        </div>
      </div>
    </section>
  )
}
