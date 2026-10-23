import { Link } from 'react-router'
import type { StaffRole } from '../../domain'
import { BUTTON, LINK } from '../../components/styles'
import { EXAMPLE_QUESTIONS } from './examples'
import { RecordTable } from './RecordTable'
import type { AskResult, DashboardLink } from './types'

const CHIP =
  'rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-left text-sm text-sky-900 hover:bg-sky-100 focus:outline-none focus:ring-2 focus:ring-sky-300 disabled:opacity-60'

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
    <div className="space-y-2">
      <p className="whitespace-pre-line text-sm text-slate-900">{result.answer}</p>
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
        <Link className={`${BUTTON.secondary} px-3 py-1`} to={orderPath(result.orderNo)}>
          Open {result.orderNo}
        </Link>
      )}
      {result.tables.map((t, i) => (
        <RecordTable key={i} table={t} orderPath={orderPath} />
      ))}
      {result.dashboard && (
        <p>
          <Link className={`${LINK} text-sm`} to={dashboardPath(role, result.dashboard)}>
            Open in {role === 'technician' ? 'My week' : 'Dashboard'}
          </Link>
        </p>
      )}
      {result.found.length > 0 && (
        <div className="rounded-md bg-slate-50 p-2 text-xs text-slate-600">
          <p className="font-medium text-slate-700">How I found this</p>
          <ul className="mt-1 space-y-0.5">
            {result.found.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
