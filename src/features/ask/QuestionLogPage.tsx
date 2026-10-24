import { useMemo, useState } from 'react'
import { Bot, RotateCw, SearchX } from 'lucide-react'
import { formatMalaysiaDateTime, roleLabel, type StaffRole } from '../../domain'
import { FilterPanel, type FilterChip } from '../../components/FilterPanel'
import { BUTTON, INPUT, TABLE } from '../../components/styles'
import { Badge, EmptyState, ErrorState, LoadingState, PageHeader } from '../../components/ui'
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

type Tone = 'neutral' | 'brand' | 'info' | 'success' | 'warning' | 'danger'

/** Badge colour for a result: good, worth a look, or failed. */
const OUTCOME_TONES: Record<string, Tone> = {
  answered: 'success',
  no_warnings: 'success',
  filled: 'success',
  worded: 'success',
  no_data: 'neutral',
  clarify: 'warning',
  out_of_scope: 'neutral',
  cannot_change: 'warning',
  not_found: 'warning',
  warnings: 'warning',
  unclear: 'warning',
  refused: 'danger',
  ai_unavailable: 'danger',
  not_set_up: 'danger',
  timeout: 'danger',
  error: 'danger',
}

const FEATURE_TONES: Record<string, Tone> = { ask: 'brand', supervisor: 'info', form: 'neutral', insights: 'neutral' }

const FILTER_LABEL = 'block text-xs font-medium text-ink-muted'

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

  const chips: FilterChip[] = []
  if (feature) chips.push({ key: 'feature', label: FEATURE_LABELS[feature] ?? feature, onRemove: () => setFeature('') })
  if (person) {
    chips.push({ key: 'person', label: people.find(([id]) => id === person)?.[1] ?? 'Person', onRemove: () => setPerson('') })
  }
  if (outcome) chips.push({ key: 'outcome', label: OUTCOME_LABELS[outcome] ?? outcome, onRemove: () => setOutcome('') })

  return (
    <section className="space-y-5">
      <PageHeader
        level={1}
        title="AI log"
        description="Every use of the AI in the last 7 days: Ask questions, job checks, order forms read and insights. Older entries are removed."
        actions={
          <button type="button" className={BUTTON.secondary} onClick={reload}>
            <RotateCw aria-hidden="true" />
            Refresh
          </button>
        }
      />

      <FilterPanel chips={chips}>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="log-feature" className={FILTER_LABEL}>
              Type
            </label>
            <select id="log-feature" className={`${INPUT} mt-1 max-md:min-h-11`} value={feature} onChange={(e) => setFeature(e.target.value)}>
              <option value="">All</option>
              {Object.entries(FEATURE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="log-person" className={FILTER_LABEL}>
              Person
            </label>
            <select id="log-person" className={`${INPUT} mt-1 max-md:min-h-11`} value={person} onChange={(e) => setPerson(e.target.value)}>
              <option value="">Everyone</option>
              {people.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="log-outcome" className={FILTER_LABEL}>
              Result
            </label>
            <select id="log-outcome" className={`${INPUT} mt-1 max-md:min-h-11`} value={outcome} onChange={(e) => setOutcome(e.target.value)}>
              <option value="">Any</option>
              {Object.entries(OUTCOME_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
        </div>
      </FilterPanel>

      {log.status === 'error' ? (
        <ErrorState title="Could not load the AI log" onRetry={reload}>
          <p>{log.message}</p>
        </ErrorState>
      ) : null}
      {log.status === 'loading' ? <LoadingState variant="rows" count={6} label="Loading…" /> : null}
      {log.status === 'ready' && shown.length === 0 ? (
        rows.length === 0 ? (
          <EmptyState title="Nothing logged yet." icon={<Bot className="size-5" />}>
            Questions, job checks, order forms and insights from the last 7 days show up here.
          </EmptyState>
        ) : (
          <EmptyState title="No entries match these filters." icon={<SearchX className="size-5" />}>
            Choose All, Everyone or Any to see more.
          </EmptyState>
        )
      ) : null}
      {shown.length > 0 && (
        <>
          <p className="text-sm text-ink-muted tabular">
            {shown.length} {shown.length === 1 ? 'entry' : 'entries'} · {tokens.toLocaleString('en-MY')} tokens
          </p>
          <div className={`${TABLE.wrap} hidden xl:block`}>
            <div className="overflow-x-auto">
              <table className={TABLE.table}>
                <thead className={TABLE.head}>
                  <tr>
                    {COLUMNS.map((h) => (
                      <th
                        key={h.label}
                        scope="col"
                        className={`${TABLE.th} whitespace-nowrap ${h.numeric ? 'text-right' : ''} ${h.showFrom === 'xl' ? 'hidden xl:table-cell' : h.showFrom === '2xl' ? 'hidden 2xl:table-cell' : ''}`}
                      >
                        {h.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.id} className={TABLE.row}>
                      <td className={`${TABLE.td} min-w-28 text-ink-muted tabular xl:whitespace-nowrap`}>{formatMalaysiaDateTime(r.created_at)}</td>
                      <td className={`${TABLE.td} whitespace-nowrap`}>
                        <Badge tone={FEATURE_TONES[featureOf(r)] ?? 'neutral'}>{FEATURE_LABELS[featureOf(r)]}</Badge>
                      </td>
                      <td className={`${TABLE.td} min-w-36`}>
                        <Person entry={r} />
                      </td>
                      <td className={`${TABLE.td} min-w-44 max-w-md break-words`}>{r.question}</td>
                      <td className={`${TABLE.td} hidden text-ink-muted xl:table-cell`}>{lookedUp(r)}</td>
                      <td className={`${TABLE.td} hidden text-right tabular 2xl:table-cell`}>{r.row_count ?? '—'}</td>
                      <td className={`${TABLE.td} whitespace-nowrap`}>
                        <Badge tone={OUTCOME_TONES[r.outcome] ?? 'neutral'}>{OUTCOME_LABELS[r.outcome] ?? r.outcome}</Badge>
                      </td>
                      <td className={`${TABLE.td} whitespace-nowrap text-right tabular`}>{seconds(r.duration_ms)}</td>
                      <td className={`${TABLE.td} hidden text-right tabular 2xl:table-cell`}>
                        {((r.input_tokens ?? 0) + (r.output_tokens ?? 0)).toLocaleString('en-MY')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <ul className="grid gap-3 md:grid-cols-2 xl:hidden" aria-label="AI log entries">
            {shown.map((r) => (
              <li key={r.id} className="rounded-xl border border-line bg-surface p-4 shadow-card">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={FEATURE_TONES[featureOf(r)] ?? 'neutral'}>{FEATURE_LABELS[featureOf(r)]}</Badge>
                  <Badge tone={OUTCOME_TONES[r.outcome] ?? 'neutral'}>{OUTCOME_LABELS[r.outcome] ?? r.outcome}</Badge>
                  <span className="ml-auto text-xs text-ink-faint tabular">{seconds(r.duration_ms)}</span>
                </div>
                <p className="mt-2 break-words text-sm font-medium text-ink">{r.question}</p>
                <div className="mt-1 text-xs text-ink-muted">
                  <Person entry={r} inline />
                </div>
                <p className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 border-t border-line pt-2 text-xs text-ink-faint">
                  <span>{formatMalaysiaDateTime(r.created_at)}</span>
                  <span>Looked up: {lookedUp(r)}</span>
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

/** `showFrom`: the column shows only from that width (narrower screens get the cards' details). */
const COLUMNS: Array<{ label: string; numeric?: boolean; showFrom?: 'xl' | '2xl' }> = [
  { label: 'When' },
  { label: 'Type' },
  { label: 'Person' },
  { label: 'Question or task' },
  { label: 'Looked up', showFrom: 'xl' },
  { label: 'Rows', numeric: true, showFrom: '2xl' },
  { label: 'Result' },
  { label: 'Time', numeric: true },
  { label: 'Tokens', numeric: true, showFrom: '2xl' },
]

function Person({ entry, inline = false }: { entry: QuestionLogEntry; inline?: boolean }) {
  return (
    <>
      <span className={inline ? 'font-medium text-ink' : 'block font-medium text-ink'}>
        {entry.staff_name}
        {entry.staff_active ? '' : ' (inactive)'}
      </span>
      <span className={inline ? 'text-ink-faint' : 'block text-xs text-ink-faint'}>
        {inline ? ' · ' : ''}
        {roleLabel(entry.staff_role as StaffRole)}, {entry.branch_name}
      </span>
    </>
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
