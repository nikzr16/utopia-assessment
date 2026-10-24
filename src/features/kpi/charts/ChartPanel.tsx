import { useId, useState, type ReactNode } from 'react'
import { ChartColumn, Table2 } from 'lucide-react'
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
    <section className={`${CARD} flex h-full flex-col`} aria-labelledby={headingId}>
      <div className="flex items-start justify-between gap-3">
        <h3 id={headingId} className="min-w-0 pt-1.5 text-base font-semibold text-ink">
          {title}
        </h3>
        {canDraw ? (
          <button
            type="button"
            aria-pressed={asTable}
            onClick={() => setAsTable((v) => !v)}
            className={`${BUTTON.ghost} shrink-0 px-2.5 max-md:min-h-11`}
          >
            {asTable ? <ChartColumn aria-hidden="true" /> : <Table2 aria-hidden="true" />}
            {asTable ? 'Show as chart' : 'Show as table'}
          </button>
        ) : null}
      </div>
      {controls && !showTable ? <div className="mt-3">{controls}</div> : null}
      <div className="mt-4 flex-1">
        {showTable ? (
          table
        ) : emptyText !== null ? (
          <div className="flex min-h-40 items-center justify-center rounded-lg border border-dashed border-line-strong bg-sunken/40 px-4 text-center">
            <p className="text-sm text-ink-muted">{emptyText}</p>
          </div>
        ) : (
          <div role="img" aria-label={`${title}. ${summary}`}>
            {chart}
          </div>
        )}
      </div>
    </section>
  )
}
