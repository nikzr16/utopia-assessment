/**
 * The one palette and shape rules every KPI chart uses (0007, PRD Q12).
 *
 * Categorical colours are used in this fixed order: the first series is always
 * blue, the second orange, the third aqua. A chart with a single series uses
 * blue. Text, grid and axes are slate (never a series colour) so a colour only
 * ever means "this series".
 *
 * Contrast on the white card surface (WCAG ratio): blue 4.4:1, orange 3.2:1,
 * aqua 2.8:1, ink 10.3:1, muted 4.8:1. Aqua sits just under the 3:1 a graphic
 * needs, and orange sits next to aqua at 1.1:1, so colour is never the only cue:
 * every series is named in a legend and the tooltip, stacked segments are split
 * by a 2px surface-coloured gap, and each chart has a "Show as table" view with
 * the same figures.
 */
export const CHART_BLUE = '#2a78d6'
export const CHART_ORANGE = '#eb6834'
export const CHART_AQUA = '#1baf7a'

/** Categorical slots in their fixed order. */
export const SERIES_COLORS = [CHART_BLUE, CHART_ORANGE, CHART_AQUA] as const

/** Card surface: the gap drawn between stacked segments. */
export const CHART_SURFACE = '#ffffff'
/** Chart text: slate-700. */
export const CHART_INK = '#334155'
/** Quiet text (tick labels): slate-600. */
export const CHART_MUTED = '#475569'
/** Thin, recessive grid lines: slate-200. */
export const CHART_GRID = '#e2e8f0'
/** Axis lines: slate-300. */
export const CHART_AXIS = '#cbd5e1'

/** Bars end in a 4px rounded corner; segments in a stack are 2px apart. */
export const BAR_RADIUS = 4
export const STACK_GAP = 2
export const LINE_WIDTH = 2

export const TICK = { fill: CHART_MUTED, fontSize: 12 } as const
export const MARGIN = { top: 8, right: 16, bottom: 4, left: 0 } as const
