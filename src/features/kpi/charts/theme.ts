/**
 * The one palette and shape rules every KPI chart uses (0007, PRD Q12; 0011 Q15).
 *
 * Every colour is a design token (`src/index.css`), passed to Recharts as a
 * `var(--…)` string: SVG presentation attributes accept CSS variables, so the
 * charts switch with the light / dark theme by themselves.
 *
 * Categorical colours are used in this fixed order: the first series is always
 * the brand cyan (`--chart-1`), the second amber (`--chart-4`), the third light
 * cyan (`--chart-3`). A chart with a single series uses the brand cyan. Text,
 * grid and axes are neutral (never a series colour), so a colour only ever
 * means "this series".
 *
 * Colour is never the only cue: every series is named in a legend and the
 * tooltip, stacked segments are split by a 2px surface-coloured gap, and each
 * chart has a "Show as table" view with the same figures.
 */
export const CHART_PRIMARY = 'var(--chart-1)'
export const CHART_SECOND = 'var(--chart-4)'
export const CHART_THIRD = 'var(--chart-3)'

/** Categorical slots in their fixed order. */
export const SERIES_COLORS = [CHART_PRIMARY, CHART_SECOND, CHART_THIRD] as const

/** Card surface: the gap drawn between stacked segments. */
export const CHART_SURFACE = 'var(--surface)'
/** Chart text (legend, tooltip). */
export const CHART_INK = 'var(--ink-muted)'
/** Quiet text (tick labels). */
export const CHART_MUTED = 'var(--ink-faint)'
/** Thin, recessive grid lines. */
export const CHART_GRID = 'var(--chart-grid)'
/** Axis lines: the same as the grid, so the bars carry the weight. */
export const CHART_AXIS = 'var(--chart-grid)'
/** The band behind the hovered bar. */
export const CHART_CURSOR = { fill: 'var(--sunken)' } as const

/** Bars end in a 4px rounded corner; segments in a stack are 2px apart. */
export const BAR_RADIUS = 4
export const STACK_GAP = 2
export const LINE_WIDTH = 2

export const TICK = { fill: CHART_MUTED, fontSize: 12 } as const
export const MARGIN = { top: 8, right: 16, bottom: 4, left: 0 } as const

