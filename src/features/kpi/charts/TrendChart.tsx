import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatAverageRating, formatMYR, periodLabel, periodShortLabel, type KpiView } from '../../../domain'
import type { KpiTrendPoint } from '../api'
import { ChartPanel } from './ChartPanel'
import { TooltipBox, plural } from './ChartTooltip'
import { DataTable } from './DataTable'
import { CHART_AXIS, CHART_BLUE, CHART_GRID, LINE_WIDTH, MARGIN, TICK } from './theme'
import { useReducedMotion } from './useReducedMotion'

interface Point {
  start: string
  axis: string
  label: string
  jobs: number
}

/**
 * Jobs completed over the last 8 weeks or 6 months: a soft area under a 2px
 * line, one colour. The table view adds amount, reschedules and rating.
 */
export function TrendChart({
  points,
  view,
  title = 'Jobs completed over time',
}: {
  points: readonly KpiTrendPoint[]
  view: KpiView
  title?: string
}) {
  const reduced = useReducedMotion()
  const data: Point[] = points.map((p) => ({
    start: p.period_start,
    axis: periodShortLabel(view, p.period_start),
    label: periodLabel(view, p.period_start),
    jobs: p.jobs_completed,
  }))
  const summary = data.map((p) => `${p.axis} ${p.jobs}`).join(', ') || 'No periods.'
  return (
    <ChartPanel
      title={title}
      summary={`Jobs completed per ${view}: ${summary}.`}
      chart={
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={data} margin={MARGIN}>
            <CartesianGrid vertical={false} stroke={CHART_GRID} />
            <XAxis dataKey="axis" tick={TICK} stroke={CHART_AXIS} />
            <YAxis allowDecimals={false} tick={TICK} stroke={CHART_AXIS} width={36} />
            <Tooltip
              content={({ active, payload }) => {
                const p = active ? (payload?.[0]?.payload as Point | undefined) : undefined
                return p ? <TooltipBox heading={p.label} lines={[{ text: plural(p.jobs, 'job') }]} /> : null
              }}
            />
            <Area
              type="monotone"
              dataKey="jobs"
              name="Jobs completed"
              stroke={CHART_BLUE}
              strokeWidth={LINE_WIDTH}
              fill={CHART_BLUE}
              fillOpacity={0.15}
              dot={{ r: 3, fill: CHART_BLUE, stroke: CHART_BLUE }}
              activeDot={{ r: 5 }}
              isAnimationActive={!reduced}
            />
          </AreaChart>
        </ResponsiveContainer>
      }
      table={
        <DataTable
          caption={`${title}, per ${view}`}
          rows={points}
          rowKey={(p) => p.period_start}
          columns={[
            { header: view === 'week' ? 'Week' : 'Month', cell: (p) => periodLabel(view, p.period_start) },
            { header: 'Jobs completed', cell: (p) => p.jobs_completed, numeric: true },
            { header: 'Total amount', cell: (p) => formatMYR(p.total_amount), numeric: true },
            { header: 'Reschedules', cell: (p) => p.reschedules, numeric: true },
            { header: 'Average rating', cell: (p) => formatAverageRating(p.average_rating), numeric: true },
          ]}
        />
      }
    />
  )
}
