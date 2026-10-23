import { useId } from 'react'
import { BUTTON, INPUT } from '../../../components/styles'
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

const STEP = `${BUTTON.secondary} min-h-11 min-w-11`

/**
 * Week / Month toggle, "This week" / "Last week" (or month), previous and next
 * arrows, and a date that snaps to its week or month. There are no future
 * periods. Changes go to `onChange`; the page keeps them in the address.
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
  const quick = (label: string, target: string) => (
    <button
      type="button"
      aria-pressed={start === target}
      onClick={() => onChange({ start: target })}
      className={`${BUTTON.secondary} min-h-11 ${start === target ? 'border-sky-300 bg-sky-100 text-sky-900' : ''}`}
    >
      {label}
    </button>
  )

  return (
    <section aria-label="Period" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="View" className="inline-flex gap-1 rounded-md border border-slate-200 bg-white p-1">
          {KPI_VIEWS.map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => onChange({ view: v, start: periodStartOf(v, start) })}
              className={`inline-flex min-h-9 items-center rounded px-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-sky-300 ${
                view === v ? 'bg-sky-100 text-sky-900' : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              {KPI_VIEW_LABELS[v]}
            </button>
          ))}
        </div>
        {quick(`This ${unit}`, thisStart)}
        {quick(`Last ${unit}`, lastStart)}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <button type="button" className={STEP} aria-label={`Previous ${unit}`} onClick={() => onChange({ start: shiftPeriod(view, start, -1) })}>
          <span aria-hidden="true">‹</span>
        </button>
        <p className="min-w-0 flex-1 text-base font-semibold sm:flex-none sm:px-2" aria-live="polite">
          {periodLabel(view, start)}
        </p>
        <button
          type="button"
          className={STEP}
          aria-label={`Next ${unit}`}
          disabled={!canShowNextPeriod(view, start)}
          onClick={() => onChange({ start: shiftPeriod(view, start, 1) })}
        >
          <span aria-hidden="true">›</span>
        </button>
        <div className="w-full sm:ml-3 sm:w-auto">
          <label htmlFor={dateId} className="block text-xs font-medium text-slate-600">
            Go to a date
          </label>
          <input
            id={dateId}
            type="date"
            value={start}
            max={malaysiaToday()}
            onChange={(e) => pick(e.target.value)}
            className={`${INPUT} mt-1 min-h-11`}
          />
        </div>
      </div>
    </section>
  )
}
