import { useMemo, useState } from 'react'
import { formatMalaysiaDateTime, roleLabel, type StaffRole } from '../../domain'
import { BUTTON, CARD, INPUT } from '../../components/styles'
import { useLoad } from '../../lib/useLoad'
import { fetchQuestionLog, type QuestionLogEntry } from './api'

/**
 * The Admin AI log (0008 Question log, PRD Q13, P8; 0009 plan P6): every AI
 * use in the last 7 days — Ask questions, job checks, order form readings and
 * insight wordings — who it was for, what was looked up, and how it ended. No
 * answers, records or files are kept here.
 */
const OUTCOME_LABELS: Record<string, string> = {
  answered: 'Answered',
  no_data: 'Answered: nothing found',
  clarify: 'Asked to clarify',
  out_of_scope: 'Out of scope',
  cannot_change: 'Asked to change data',
  refused: 'Refused (no access)',
  not_found: 'Name not found',
  ai_unavailable: 'AI unavailable',
  not_set_up: 'Not set up',
  timeout: 'Took too long',
  error: 'Error',
  warnings: 'Found warnings',
  no_warnings: 'No warnings',
  filled: 'Form filled',
  unclear: 'Form unclear',
  worded: 'Worded',
}

const FEATURE_LABELS: Record<string, string> = {
  ask: 'Ask',
  supervisor: 'Job check',
  form: 'Order form',
  insights: 'Insights',
}
const featureOf = (r: QuestionLogEntry) => r.feature ?? 'ask'

const seconds = (ms: number | null) => (ms === null ? '—' : `${(ms / 1000).toFixed(1)} s`)

export function QuestionLogPage() {
  const [log, reload] = useLoad(fetchQuestionLog, 'question-log')
  const [person, setPerson] = useState('')
  const [outcome, setOutcome] = useState('')
  const [feature, setFeature] = useState('')

  const rows = log.status === 'ready' ? log.data : []
  const people = useMemo(
    () => [...new Map(rows.map((r) => [r.staff_id, r.staff_name])).entries()].sort((a, b) => a[1].localeCompare(b[1])),
    [rows],
  )
  const shown = rows.filter(
    (r) => (!person || r.staff_id === person) && (!outcome || r.outcome === outcome) && (!feature || featureOf(r) === feature),
  )
  const tokens = shown.reduce((n, r) => n + (r.input_tokens ?? 0) + (r.output_tokens ?? 0), 0)

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="text-xl font-semibold text-slate-900">AI log</h1>
          <p className="text-sm text-slate-600">
            Every use of the AI in the last 7 days: Ask questions, job checks, order forms read and insights. Older
            entries are removed.
          </p>
        </div>
        <div>
          <label htmlFor="log-feature" className="block text-xs font-medium text-slate-600">
            Type
          </label>
          <select id="log-feature" className={INPUT} value={feature} onChange={(e) => setFeature(e.target.value)}>
            <option value="">All</option>
            {Object.entries(FEATURE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="log-person" className="block text-xs font-medium text-slate-600">
            Person
          </label>
          <select id="log-person" className={INPUT} value={person} onChange={(e) => setPerson(e.target.value)}>
            <option value="">Everyone</option>
            {people.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="log-outcome" className="block text-xs font-medium text-slate-600">
            Result
          </label>
          <select id="log-outcome" className={INPUT} value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            <option value="">Any</option>
            {Object.entries(OUTCOME_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className={BUTTON.secondary} onClick={reload}>
          Refresh
        </button>
      </header>

      {log.status === 'error' && (
        <p role="alert" className="text-sm text-red-700">
          {log.message}
        </p>
      )}
      {log.status === 'loading' && <p className="text-sm text-slate-600">Loading…</p>}
      {log.status === 'ready' && shown.length === 0 && <p className={CARD}>Nothing logged yet.</p>}
      {shown.length > 0 && (
        <>
          <p className="text-sm text-slate-600">
            {shown.length} {shown.length === 1 ? 'entry' : 'entries'} · {tokens.toLocaleString('en-MY')} tokens
          </p>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500">
                  {['When', 'Type', 'Person', 'Question or task', 'Looked up', 'Rows', 'Result', 'Time', 'Tokens'].map((h) => (
                    <th key={h} scope="col" className="whitespace-nowrap py-2 pr-3 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100 align-top">
                    <td className="whitespace-nowrap py-2 pr-3">{formatMalaysiaDateTime(r.created_at)}</td>
                    <td className="whitespace-nowrap py-2 pr-3">{FEATURE_LABELS[featureOf(r)]}</td>
                    <td className="py-2 pr-3">
                      <Person entry={r} />
                    </td>
                    <td className="max-w-md py-2 pr-3 text-slate-900">{r.question}</td>
                    <td className="py-2 pr-3 text-slate-700">{lookedUp(r)}</td>
                    <td className="py-2 pr-3">{r.row_count ?? '—'}</td>
                    <td className="py-2 pr-3">{OUTCOME_LABELS[r.outcome] ?? r.outcome}</td>
                    <td className="whitespace-nowrap py-2 pr-3">{seconds(r.duration_ms)}</td>
                    <td className="py-2 pr-3">{(r.input_tokens ?? 0) + (r.output_tokens ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="space-y-2 md:hidden">
            {shown.map((r) => (
              <li key={r.id} className={CARD}>
                <p className="text-sm font-medium text-slate-900">{r.question}</p>
                <p className="mt-1 text-xs text-slate-600">
                  <Person entry={r} /> · {formatMalaysiaDateTime(r.created_at)}
                </p>
                <p className="mt-1 text-xs text-slate-600">
                  {FEATURE_LABELS[featureOf(r)]} · {OUTCOME_LABELS[r.outcome] ?? r.outcome} · {lookedUp(r)} ·{' '}
                  {seconds(r.duration_ms)}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

function Person({ entry }: { entry: QuestionLogEntry }) {
  return (
    <span>
      {entry.staff_name}
      {entry.staff_active ? '' : ' (inactive)'}
      <span className="text-slate-500">
        {' '}
        · {roleLabel(entry.staff_role as StaffRole)}, {entry.branch_name}
      </span>
    </span>
  )
}

/** What was looked up, in plain words (no function names). */
const LOOKUP_LABELS: Record<string, string> = {
  kpi_summary: 'totals',
  technician_leaderboard: 'technician numbers',
  branch_comparison: 'branch comparison',
  trend: 'trend',
  technician_events: "a technician's jobs",
  job_list: 'job list',
  payment_list: 'payments',
  workload_insights: 'workload insights',
}

function lookedUp(entry: QuestionLogEntry): string {
  const names = entry.lookups.filter((l) => l.status === 'done').map((l) => LOOKUP_LABELS[l.lookup] ?? 'other')
  return names.length ? [...new Set(names)].join(', ') : '—'
}
