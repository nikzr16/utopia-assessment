import { useState } from 'react'
import { formatAverageRating, formatMYR, type KpiView } from '../../../domain'
import type { KpiBranchRow } from '../api'
import { BranchBarChart, type BranchBar } from '../charts/BranchBarChart'
import { ChartPanel } from '../charts/ChartPanel'
import { plural } from '../charts/ChartTooltip'
import { DataTable } from '../charts/DataTable'

const MEASURES = ['jobs', 'amount', 'reschedules', 'rating'] as const
type Measure = (typeof MEASURES)[number]

const MEASURE_LABELS: Record<Measure, string> = {
  jobs: 'Jobs completed',
  amount: 'Total amount',
  reschedules: 'Reschedules',
  rating: 'Average rating',
}

function barFor(row: KpiBranchRow, measure: Measure): BranchBar {
  switch (measure) {
    case 'jobs':
      return { id: row.branch_id, name: row.branch_name, value: row.jobs_completed, text: plural(row.jobs_completed, 'job') }
    case 'amount':
      return { id: row.branch_id, name: row.branch_name, value: row.total_amount, text: formatMYR(row.total_amount) }
    case 'reschedules':
      return { id: row.branch_id, name: row.branch_name, value: row.reschedules, text: plural(row.reschedules, 'reschedule') }
    case 'rating':
      return {
        id: row.branch_id,
        name: row.branch_name,
        value: row.average_rating,
        text: row.average_rating === null ? 'no ratings' : `${formatAverageRating(row.average_rating)} stars on average`,
      }
  }
}

/**
 * Every visible branch side by side (PRD Q9): a table with all measures, and
 * a chart of one measure at a time. `drawChart` false (an empty period) shows
 * only the table.
 */
export function BranchComparison({
  rows,
  view,
  drawChart,
}: {
  rows: readonly KpiBranchRow[]
  view: KpiView
  drawChart: boolean
}) {
  const [measure, setMeasure] = useState<Measure>('jobs')
  const bars = rows.map((r) => barFor(r, measure))
  return (
    <ChartPanel
      title="Branch comparison"
      summary={`${MEASURE_LABELS[measure]} per branch this ${view}: ${bars.map((b) => `${b.name} ${b.text}`).join(', ')}.`}
      chartless={!drawChart}
      controls={
        <div role="radiogroup" aria-label="Measure" className="grid grid-cols-2 gap-1 rounded-xl bg-sunken p-1 ring-1 ring-inset ring-line sm:grid-cols-4 xl:grid-cols-2 2xl:grid-cols-4">
          {MEASURES.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={measure === m}
              onClick={() => setMeasure(m)}
              className={`inline-flex min-h-9 flex-1 items-center justify-center whitespace-nowrap rounded-lg px-2.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-focus max-md:min-h-11 sm:text-sm ${
                measure === m ? 'bg-surface text-ink shadow-card ring-1 ring-line' : 'text-ink-muted hover:text-ink'
              }`}
            >
              {MEASURE_LABELS[m]}
            </button>
          ))}
        </div>
      }
      chart={<BranchBarChart bars={bars} allowDecimals={measure === 'amount' || measure === 'rating'} domain={measure === 'rating' ? [0, 5] : undefined} />}
      table={
        <DataTable
          caption="Branch comparison"
          rows={rows}
          rowKey={(r) => r.branch_id}
          columns={[
            { header: 'Branch', cell: (r) => r.branch_name },
            { header: 'Jobs completed', cell: (r) => r.jobs_completed, numeric: true },
            { header: 'Total amount', cell: (r) => formatMYR(r.total_amount), numeric: true },
            { header: 'Reschedules', cell: (r) => r.reschedules, numeric: true },
            { header: 'Average rating', cell: (r) => formatAverageRating(r.average_rating), numeric: true },
            { header: 'Active technicians', cell: (r) => r.active_technicians, numeric: true },
          ]}
        />
      }
    />
  )
}
