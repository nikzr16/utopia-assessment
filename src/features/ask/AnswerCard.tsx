import { Link } from 'react-router'
import type { StaffRole } from '../../domain'
import { ArrowUpRight, ChartLine, ExternalLink, Search } from 'lucide-react'
import { BUTTON, LINK } from '../../components/styles'
import { EXAMPLE_QUESTIONS } from './examples'
import { RecordTable } from './RecordTable'
import type { AskResult, DashboardLink } from './types'

const CHIP =
  'inline-flex min-h-9 items-center gap-1.5 rounded-full border border-brand/30 bg-brand-soft px-3 py-1.5 text-left text-sm text-brand-ink transition-colors hover:border-brand/60 hover:bg-brand/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-60'

/** The Dashboard (or My week) for the same week / month as a KPI answer. */
export function dashboardPath(role: StaffRole, link: DashboardLink): string {
  const params = new URLSearchParams({ view: link.view, start: link.start })
  if (link.branchId && role !== 'technician') params.set('branch', link.branchId)
  if (role === 'technician') return `/my-week?${params}`
  if (link.technicianId) return `/dashboard/technicians/${encodeURIComponent(link.technicianId)}?${params}`
  return `/dashboard?${params}`
}

/** One answer: the sentence, buttons for a choice, the records, and how it was found in plain words (PRD Q8, Q9; decision 0016). */
export function AnswerCard({
  result,
  role,
  orderPath,
  onAsk,
  busy,
}: {
  result: AskResult
  role: StaffRole
  orderPath: (orderNo: string) => string
  onAsk: (question: string) => void
  busy: boolean
}) {
  const buttons = result.kind === 'out_of_scope' ? EXAMPLE_QUESTIONS[role] : result.options
  return (
    <div className="space-y-3">
      <p className="whitespace-pre-line break-words text-sm leading-relaxed text-ink">{result.answer}</p>
      {buttons.length > 0 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label={result.kind === 'out_of_scope' ? 'Example questions' : 'Choose an answer'}>
          {buttons.map((b) => (
            <button key={b} type="button" className={CHIP} disabled={busy} onClick={() => onAsk(b)}>
              {b}
            </button>
          ))}
        </div>
      )}
      {result.kind === 'cannot_change' && result.orderNo && (
        <Link className={`${BUTTON.secondary} min-h-10 px-3`} to={orderPath(result.orderNo)}>
          <ExternalLink aria-hidden="true" />
          Open {result.orderNo}
        </Link>
      )}
      {result.tables.map((t, i) => (
        <RecordTable key={i} table={t} orderPath={orderPath} />
      ))}
      {result.dashboard && (
        <p>
          <Link className={`${LINK} inline-flex min-h-9 items-center gap-1.5 text-sm`} to={dashboardPath(role, result.dashboard)}>
            <ChartLine className="size-4" aria-hidden="true" />
            Open in {role === 'technician' ? 'My week' : 'Dashboard'}
            <ArrowUpRight className="size-3.5" aria-hidden="true" />
          </Link>
        </p>
      )}
      {result.found.length > 0 && (
        <div className="rounded-lg border border-line bg-sunken/70 px-3 py-2 text-xs text-ink-muted">
          <p className="flex items-center gap-1.5 font-medium text-ink-muted">
            <Search className="size-3.5" aria-hidden="true" />
            How I found this
          </p>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-5 marker:text-ink-faint">
            {result.found.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
