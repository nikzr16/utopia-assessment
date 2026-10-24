import { useId } from 'react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatAverageRating, formatMYR, periodLabel, periodShortLabel, type KpiView } from '../../../domain'
import type { KpiTrendPoint } from '../api'
import { ChartPanel } from './ChartPanel'
import { TooltipBox, plural } from './ChartTooltip'
import { DataTable } from './DataTable'
import { CHART_AXIS, CHART_GRID, CHART_PRIMARY, CHART_SURFACE, LINE_WIDTH, MARGIN, TICK } from './theme'
import { useReducedMotion } from './useReducedMotion'

interface Point {
  start: string
  axis: string
  label: string
  jobs: number
}

/**
 * Jobs completed over the last 8 weeks or 6 months: a soft fading area under a
 * 2px line, one colour. The table view adds amount, reschedules and rating.
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
  // An SVG id may not hold the colons React puts in its ids.
  const fillId = `kpi-trend-${useId().replace(/[^a-zA-Z0-9-]/g, '')}`
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
            <defs>
              <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={CHART_PRIMARY} stopOpacity={0.28} />
                <stop offset="100%" stopColor={CHART_PRIMARY} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke={CHART_GRID} strokeDasharray="3 3" />
            <XAxis dataKey="axis" tick={TICK} stroke={CHART_AXIS} tickLine={false} />
            <YAxis allowDecimals={false} tick={TICK} axisLine={false} tickLine={false} width={36} />
            <Tooltip
              cursor={{ stroke: CHART_AXIS, strokeWidth: 1 }}
              content={({ active, payload }) => {
                const p = active ? (payload?.[0]?.payload as Point | undefined) : undefined
                return p ? <TooltipBox heading={p.label} lines={[{ text: plural(p.jobs, 'job') }]} /> : null
              }}
            />
            <Area
              type="monotone"
              dataKey="jobs"
              name="Jobs completed"
              stroke={CHART_PRIMARY}
              strokeWidth={LINE_WIDTH}
              fill={`url(#${fillId})`}
              dot={{ r: 3, fill: CHART_SURFACE, stroke: CHART_PRIMARY, strokeWidth: 2 }}
              activeDot={{ r: 5, fill: CHART_PRIMARY, stroke: CHART_SURFACE, strokeWidth: 2 }}
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
