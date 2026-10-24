import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { staffLabel, type KpiView } from '../../../domain'
import type { KpiTechnicianRow } from '../api'
import { ChartPanel } from './ChartPanel'
import { TooltipBox, plural } from './ChartTooltip'
import { DataTable } from './DataTable'
import { BAR_RADIUS, CHART_AXIS, CHART_CURSOR, CHART_GRID, CHART_PRIMARY, MARGIN, TICK } from './theme'
import { useReducedMotion } from './useReducedMotion'

/** Bars are capped so the chart stays readable; the table lists everyone. */
export const MAX_BARS = 15
const ROW_HEIGHT = 30

interface Entry {
  id: string
  label: string
  jobs: number
}

/**
 * Jobs completed per technician: horizontal bars in leaderboard order, one
 * colour. `rows` come in the leaderboard's default order.
 */
export function JobsByTechnicianChart({ rows, view }: { rows: readonly KpiTechnicianRow[]; view: KpiView }) {
  const reduced = useReducedMotion()
  const all: Entry[] = rows.map((r) => ({ id: r.id, label: staffLabel(r.name, r.active), jobs: r.jobs_completed }))
  const bars = all.slice(0, MAX_BARS)
  const total = all.reduce((sum, r) => sum + r.jobs, 0)
  const summary = all.map((r) => `${r.label} ${r.jobs}`).join(', ') || 'No technicians.'
  return (
    <ChartPanel
      title="Jobs completed per technician"
      summary={summary}
      emptyText={total === 0 ? `No jobs completed in this ${view}` : null}
      chart={
        <>
          <ResponsiveContainer width="100%" height={Math.max(120, bars.length * ROW_HEIGHT + 36)}>
            <BarChart data={bars} layout="vertical" margin={MARGIN} barCategoryGap="25%">
              <CartesianGrid horizontal={false} stroke={CHART_GRID} strokeDasharray="3 3" />
              <XAxis type="number" allowDecimals={false} tick={TICK} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="label" width={112} tick={TICK} stroke={CHART_AXIS} tickLine={false} interval={0} />
              <Tooltip
                cursor={CHART_CURSOR}
                content={({ active, payload }) => {
                  const bar = active ? (payload?.[0]?.payload as Entry | undefined) : undefined
                  return bar ? <TooltipBox lines={[{ text: `${bar.label} — ${plural(bar.jobs, 'job')}` }]} /> : null
                }}
              />
              <Bar
                dataKey="jobs"
                name="Jobs completed"
                fill={CHART_PRIMARY}
                maxBarSize={22}
                radius={[0, BAR_RADIUS, BAR_RADIUS, 0]}
                isAnimationActive={!reduced}
              />
            </BarChart>
          </ResponsiveContainer>
          {all.length > bars.length ? (
            <p className="mt-2 text-xs text-ink-faint">
              Showing the first {bars.length} of {all.length} technicians. Show as table lists everyone.
            </p>
          ) : null}
        </>
      }
      table={
        <DataTable
          caption="Jobs completed per technician"
          rows={all}
          rowKey={(r) => r.id}
          columns={[
            { header: 'Technician', cell: (r) => r.label },
            { header: 'Jobs completed', cell: (r) => r.jobs, numeric: true },
          ]}
        />
      }
    />
  )
}
