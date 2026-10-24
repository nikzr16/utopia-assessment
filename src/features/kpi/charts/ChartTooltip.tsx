import type { ReactNode } from 'react'
import { CHART_INK, CHART_SURFACE } from './theme'

export interface TooltipLine {
  text: string
  /** Series colour swatch; none for single-series charts. */
  color?: string
}

/**
 * The hover card every chart shares: a bold heading and one line per series
 * ("Ali — 8 jobs"). Text is slate; the swatch carries the series colour.
 */
export function TooltipBox({ heading, lines }: { heading?: string; lines: TooltipLine[] }): ReactNode {
  return (
    <div
      className="rounded-md border border-slate-300 px-3 py-2 text-sm shadow-md"
      style={{ background: CHART_SURFACE, color: CHART_INK }}
    >
      {heading ? <p className="font-medium">{heading}</p> : null}
      {lines.map((line) => (
        <p key={line.text} className="flex items-center gap-2">
          {line.color ? <span aria-hidden="true" className="inline-block size-2.5 rounded-sm" style={{ background: line.color }} /> : null}
          {line.text}
        </p>
      ))}
    </div>
  )
}

/** `8 jobs`, `1 job`. */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`
}
