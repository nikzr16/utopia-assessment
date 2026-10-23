import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { BAR_RADIUS, CHART_AXIS, CHART_BLUE, CHART_GRID, MARGIN, TICK } from './theme'
import { TooltipBox } from './ChartTooltip'
import { useReducedMotion } from './useReducedMotion'

export interface BranchBar {
  id: string
  name: string
  /** The one measure being compared; null draws no bar. */
  value: number | null
  /** The value as the tooltip says it: "8 jobs", "RM 1,200.00". */
  text: string
}

/** One measure across branches: vertical bars, one colour, a single axis (never two measures on two axes). */
export function BranchBarChart({
  bars,
  allowDecimals,
  domain,
}: {
  bars: readonly BranchBar[]
  allowDecimals: boolean
  /** Fixed value axis range (the rating chart runs 0 to 5). */
  domain?: [number, number]
}) {
  const reduced = useReducedMotion()
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={bars as BranchBar[]} margin={MARGIN} barCategoryGap="30%">
        <CartesianGrid vertical={false} stroke={CHART_GRID} />
        <XAxis dataKey="name" tick={TICK} stroke={CHART_AXIS} interval={0} />
        <YAxis allowDecimals={allowDecimals} domain={domain} tick={TICK} stroke={CHART_AXIS} width={48} />
        <Tooltip
          cursor={{ fill: '#f1f5f9' }}
          content={({ active, payload }) => {
            const bar = active ? (payload?.[0]?.payload as BranchBar | undefined) : undefined
            return bar ? <TooltipBox lines={[{ text: `${bar.name} — ${bar.text}` }]} /> : null
          }}
        />
        <Bar dataKey="value" fill={CHART_BLUE} radius={[BAR_RADIUS, BAR_RADIUS, 0, 0]} isAnimationActive={!reduced} />
      </BarChart>
    </ResponsiveContainer>
  )
}
