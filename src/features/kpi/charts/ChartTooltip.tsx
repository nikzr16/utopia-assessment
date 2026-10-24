import type { ReactNode } from 'react'
import { CHART_INK } from './theme'

export interface TooltipLine {
  text: string
  /** Series colour swatch; none for single-series charts. */
  color?: string
}

/**
 * The hover card every chart shares: a bold heading and one line per series
 * ("Ali — 8 jobs"). Raised surface and ink tokens, so it reads in light and
 * dark; the swatch carries the series colour.
 */
export function TooltipBox({ heading, lines }: { heading?: string; lines: TooltipLine[] }): ReactNode {
  return (
    <div className="min-w-32 rounded-lg border border-line bg-raised px-3 py-2 text-sm text-ink shadow-lg">
      {heading ? <p className="mb-1 text-xs font-medium text-ink-muted">{heading}</p> : null}
      {lines.map((line) => (
        <p key={line.text} className="flex items-center gap-2 font-medium tabular">
          {line.color ? <span aria-hidden="true" className="inline-block size-2.5 shrink-0 rounded-sm" style={{ background: line.color }} /> : null}
          {line.text}
        </p>
      ))}
    </div>
  )
}

/** A legend label in the neutral chart ink (Recharts colours it like the series otherwise). */
export function legendText(value: string): ReactNode {
  return <span style={{ color: CHART_INK, fontSize: 12 }}>{value}</span>
}

/** `8 jobs`, `1 job`. */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`
}
