import { useId, useState, type ReactNode } from 'react'
import { BUTTON, CARD } from '../../../components/styles'

/**
 * A chart's card: title, a "Show as table" switch, and either the chart
 * (announced to a screen reader by `summary`, which lists the figures) or the
 * same figures as a table. `emptyText` replaces the chart when there is
 * nothing to draw; `chartless` shows only the table.
 */
export function ChartPanel({
  title,
  summary,
  chart,
  table,
  emptyText = null,
  chartless = false,
  controls,
}: {
  title: string
  /** One sentence listing the figures; the chart's accessible name. */
  summary: string
  chart: ReactNode
  table: ReactNode
  emptyText?: string | null
  chartless?: boolean
  /** Extra controls above the chart, e.g. a measure picker. */
  controls?: ReactNode
}) {
  const [asTable, setAsTable] = useState(false)
  const headingId = useId()
  const showTable = chartless || asTable
  const canDraw = !chartless && emptyText === null
  return (
    <section className={CARD} aria-labelledby={headingId}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={headingId} className="text-base font-semibold">
          {title}
        </h3>
        {canDraw ? (
          <button type="button" aria-pressed={asTable} onClick={() => setAsTable((v) => !v)} className={`${BUTTON.secondary} min-h-11`}>
            {asTable ? 'Show as chart' : 'Show as table'}
          </button>
        ) : null}
      </div>
      {controls && !showTable ? <div className="mt-3">{controls}</div> : null}
      <div className="mt-3">
        {showTable ? (
          table
        ) : emptyText !== null ? (
          <p className="text-sm text-slate-600">{emptyText}</p>
        ) : (
          <div role="img" aria-label={`${title}. ${summary}`}>
            {chart}
          </div>
        )}
      </div>
    </section>
  )
}
