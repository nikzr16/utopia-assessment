import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { RESCHEDULE_REASON_LABELS } from '../../../domain'
import { RESCHEDULE_PARTIES, RESCHEDULE_REASONS, type ReasonByRequester, type ReschedulePartyName } from '../api'
import { ChartPanel } from './ChartPanel'
import { TooltipBox, legendText } from './ChartTooltip'
import { DataTable } from './DataTable'
import { BAR_RADIUS, CHART_AXIS, CHART_CURSOR, CHART_GRID, CHART_SURFACE, MARGIN, SERIES_COLORS, STACK_GAP, TICK } from './theme'
import { useReducedMotion } from './useReducedMotion'

const PARTY_LABELS: Record<ReschedulePartyName, string> = { customer: 'Customer', technician: 'Technician', admin: 'Admin' }

interface Row {
  reason: string
  customer: number
  technician: number
  admin: number
  total: number
}

/**
 * Reschedules and postponements by reason, stacked by who asked for them
 * (customer, technician, admin: the three categorical colours in order).
 */
export function ReschedulesByReasonChart({ data }: { data: ReasonByRequester }) {
  const reduced = useReducedMotion()
  const rows: Row[] = RESCHEDULE_REASONS.map((reason) => {
    const by = data[reason]
    return {
      reason: RESCHEDULE_REASON_LABELS[reason],
      customer: by.customer,
      technician: by.technician,
      admin: by.admin,
      total: by.customer + by.technician + by.admin,
    }
  })
  const total = rows.reduce((sum, r) => sum + r.total, 0)
  const summary = rows
    .map((r) => `${r.reason} ${r.total} (customer ${r.customer}, technician ${r.technician}, admin ${r.admin})`)
    .join('; ')
  return (
    <ChartPanel
      title="Reschedules and postponements by reason"
      summary={`By reason, split by who asked: ${summary}.`}
      emptyText={total === 0 ? 'No reschedules or postponements in this period' : null}
      chart={
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={rows} layout="vertical" margin={MARGIN} barCategoryGap="25%">
            <CartesianGrid horizontal={false} stroke={CHART_GRID} strokeDasharray="3 3" />
            <XAxis type="number" allowDecimals={false} tick={TICK} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="reason" width={132} tick={TICK} stroke={CHART_AXIS} tickLine={false} interval={0} />
            <Legend iconType="circle" iconSize={8} formatter={legendText} wrapperStyle={{ paddingTop: 8 }} />
            <Tooltip
              cursor={CHART_CURSOR}
              content={({ active, payload }) => {
                const row = active ? (payload?.[0]?.payload as Row | undefined) : undefined
                if (!row) return null
                return (
                  <TooltipBox
                    heading={row.reason}
                    lines={RESCHEDULE_PARTIES.map((party, i) => ({
                      text: `${PARTY_LABELS[party]}: ${row[party]}`,
                      color: SERIES_COLORS[i],
                    }))}
                  />
                )
              }}
            />
            {RESCHEDULE_PARTIES.map((party, i) => (
              <Bar
                key={party}
                dataKey={party}
                name={PARTY_LABELS[party]}
                stackId="requester"
                fill={SERIES_COLORS[i]}
                stroke={CHART_SURFACE}
                strokeWidth={STACK_GAP}
                radius={BAR_RADIUS}
                maxBarSize={22}
                isAnimationActive={!reduced}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      }
      table={
        <DataTable
          caption="Reschedules and postponements by reason and who asked"
          rows={rows}
          rowKey={(r) => r.reason}
          columns={[
            { header: 'Reason', cell: (r) => r.reason },
            { header: 'Customer', cell: (r) => r.customer, numeric: true },
            { header: 'Technician', cell: (r) => r.technician, numeric: true },
            { header: 'Admin', cell: (r) => r.admin, numeric: true },
            { header: 'Total', cell: (r) => r.total, numeric: true },
          ]}
        />
      }
    />
  )
}
