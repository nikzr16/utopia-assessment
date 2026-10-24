import { useEffect, useState } from 'react'
import { CircleCheck, RefreshCw, ShieldAlert, ShieldCheck, Sparkles } from 'lucide-react'
import { BUTTON, CARD, INPUT } from '../../components/styles'
import { Badge, Skeleton } from '../../components/ui'
import {
  CHECK_NOTE_MAX,
  WARNING_RULE_LABELS,
  checkNoteError,
  formatMalaysiaDateTime,
  supervisorRunText,
  type OrderStatus,
} from '../../domain'
import { staffName } from '../../lib/staffStatus'
import { useLoad, type LoadState } from '../../lib/useLoad'
import { useRefreshOnReturn } from '../../lib/useRefreshOnReturn'
import { checkWarning, fetchOrderWarnings, recheckOrder, subscribeToWarnings, type OrderWarning, type OrderWarnings } from './api'

/** An order's warnings, kept current (Realtime, and while an AI check runs, every 5 seconds). */
export function useOrderWarnings(orderId: string): [LoadState<OrderWarnings>, () => void] {
  const [state, reload] = useLoad(() => fetchOrderWarnings(orderId), orderId)
  useEffect(() => {
    try {
      return subscribeToWarnings(orderId, reload)
    } catch {
      return undefined // not connected (the page shows the load error)
    }
  }, [orderId, reload])
  const running = state.status === 'ready' && (state.data.run?.status === 'pending' || state.data.run?.status === 'running')
  useEffect(() => {
    if (!running) return undefined
    const timer = setInterval(reload, 5000)
    return () => clearInterval(timer)
  }, [running, reload])
  useRefreshOnReturn(reload)
  return [state, reload]
}

/** How many warnings still need a Manager's check. */
export function openWarnings(state: LoadState<OrderWarnings>): number {
  return state.status === 'ready' ? state.data.warnings.filter((w) => w.status === 'open').length : 0
}

/** Statuses in which the box is shown (the checks run from Job Done on). */
const SHOWN: readonly OrderStatus[] = ['job_done', 'reviewed', 'closed']

/**
 * The Warnings box on an order page (0009 PRD Q7): rule warnings and "AI"
 * warnings, who checked each and their note. A covering Manager checks open
 * warnings with a note while the job waits for review, and can re-run the AI
 * check. Admins and Finance read it.
 */
export function WarningsBox({
  orderId,
  orderStatus,
  isManager,
  onOpenCount,
}: {
  orderId: string
  orderStatus: OrderStatus
  /** A Manager covering the order's branch (may check and re-check while Job Done). */
  isManager: boolean
  /** Told how many warnings are open (null while loading or on error), e.g. to hold Approve. */
  onOpenCount?: (open: number | null) => void
}) {
  const [state, reload] = useOrderWarnings(orderId)
  const [rechecking, setRechecking] = useState(false)
  const [recheckError, setRecheckError] = useState<string | null>(null)
  const open = state.status === 'ready' ? openWarnings(state) : null
  useEffect(() => {
    onOpenCount?.(open)
  }, [open, onOpenCount])

  if (!SHOWN.includes(orderStatus) && !(state.status === 'ready' && state.data.warnings.length > 0)) return null
  const canAct = isManager && orderStatus === 'job_done'

  const recheck = async () => {
    setRechecking(true)
    setRecheckError(null)
    try {
      await recheckOrder(orderId)
    } catch (e) {
      setRecheckError((e as Error).message)
    } finally {
      setRechecking(false)
      reload()
    }
  }

  let body
  if (state.status === 'loading') {
    body = (
      <div className="space-y-2">
        <span className="sr-only">Loading warnings…</span>
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    )
  } else if (state.status === 'error') {
    body = (
      <p className="text-sm text-danger-ink">
        Could not load the warnings: {state.message}
      </p>
    )
  }
  else {
    const { warnings, run } = state.data
    const runText = rechecking ? 'AI check running…' : supervisorRunText(run?.status ?? null)
    body = (
      <>
        {warnings.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-ink-muted">
            <ShieldCheck className="size-4 shrink-0 text-success" aria-hidden="true" />
            {run?.status === 'done' || !run ? 'No warnings for this job.' : 'No rule warnings for this job.'}
          </p>
        ) : (
          <>
            {canAct && (open ?? 0) > 0 ? (
              <p className="text-sm text-warning-ink">
                Check each warning with a short note before approving, or return the job for rework.
              </p>
            ) : null}
            <ul className="space-y-3">
              {warnings.map((w) => (
                <WarningItem key={w.id} warning={w} canCheck={canAct} onChecked={reload} />
              ))}
            </ul>
          </>
        )}
        {runText ? (
          <p role="status" className="flex items-center gap-2 text-sm text-ink-muted">
            <Sparkles className="size-4 shrink-0 text-ink-faint" aria-hidden="true" />
            {canAct || !runText.includes('Re-check') ? runText : "AI check didn't run."}
          </p>
        ) : null}
        {recheckError ? (
          <p className="text-sm text-danger-ink">
            {recheckError}
          </p>
        ) : null}
        {canAct ? (
          <button
            type="button"
            onClick={recheck}
            disabled={rechecking || run?.status === 'pending' || run?.status === 'running'}
            className={`${BUTTON.secondary} min-h-11 max-sm:w-full`}
          >
            <RefreshCw aria-hidden="true" />
            Re-check with AI
          </button>
        ) : null}
      </>
    )
  }

  return (
    <section className={CARD} aria-labelledby="order-warnings">
      <h3 id="order-warnings" className="flex flex-wrap items-center gap-2 text-base font-semibold text-ink">
        <ShieldAlert className={`size-4.5 ${(open ?? 0) > 0 ? 'text-warning' : 'text-brand'}`} aria-hidden="true" />
        Warnings
        {state.status === 'ready' && openWarnings(state) > 0 ? (
          <Badge tone="warning">{openWarnings(state)} to check</Badge>
        ) : null}
      </h3>
      <div className="mt-3 space-y-3">{body}</div>
    </section>
  )
}

function WarningItem({ warning: w, canCheck, onChecked }: { warning: OrderWarning; canCheck: boolean; onChecked: () => void }) {
  const [editing, setEditing] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const ai = w.source === 'ai'
  const id = `warning-note-${w.id}`

  const save = async () => {
    const problem = checkNoteError(note)
    if (problem) {
      setError(problem)
      return
    }
    setSaving(true)
    setError(null)
    try {
      await checkWarning(w.id, note)
      setEditing(false)
      onChecked()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <li
      className={`rounded-lg border px-3 py-2.5 ${w.status === 'open' ? 'border-warning/40 bg-warning-soft' : 'border-line bg-sunken'}`}
    >
      <p className="text-sm text-ink">
        <span
          className={`mr-2 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 align-middle text-xs font-semibold ${
            ai ? 'bg-info-soft text-info-ink ring-1 ring-inset ring-info/30' : 'bg-surface text-ink ring-1 ring-inset ring-line-strong'
          }`}
          title={ai ? 'Found by the AI from the written job record' : 'Found by a fixed rule'}
        >
          {WARNING_RULE_LABELS[w.rule]}
        </span>
        <span className="break-words">{w.message}</span>
      </p>
      {w.status === 'checked' ? (
        <p className="mt-1.5 flex gap-1.5 text-xs text-ink-muted">
          <CircleCheck className="mt-px size-3.5 shrink-0 text-success" aria-hidden="true" />
          <span className="min-w-0">
            Checked by {staffName(w.checked_by_name, w.checked_by) ?? 'a Manager'} · {formatMalaysiaDateTime(w.checked_at)}
            <span className="block break-words text-ink">“{w.check_note}”</span>
          </span>
        </p>
      ) : null}
      {w.status === 'open' && canCheck && !editing ? (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className={`${BUTTON.secondary} mt-2 min-h-11 max-sm:w-full`}
        >
          <CircleCheck aria-hidden="true" />
          Mark as checked
        </button>
      ) : null}
      {editing ? (
        <div className="mt-2 space-y-2">
          <label htmlFor={id} className="block text-sm font-medium text-ink">
            What did you check?
          </label>
          <textarea
            id={id}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={CHECK_NOTE_MAX}
            rows={2}
            aria-invalid={Boolean(error)}
            className={INPUT}
          />
          {error ? <p className="text-sm text-danger-ink">{error}</p> : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={save} disabled={saving} className={`${BUTTON.primary} min-h-11`}>
              {saving ? 'Saving…' : 'Save check'}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false)
                setError(null)
              }}
              className={`${BUTTON.secondary} min-h-11`}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </li>
  )
}
