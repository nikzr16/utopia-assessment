import { useEffect, useState } from 'react'
import { BUTTON, CARD, INPUT } from '../../components/styles'
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
  if (state.status === 'loading') body = <p className="text-sm text-slate-600">Loading warnings…</p>
  else if (state.status === 'error') body = <p className="text-sm text-red-700">Could not load the warnings: {state.message}</p>
  else {
    const { warnings, run } = state.data
    const runText = rechecking ? 'AI check running…' : supervisorRunText(run?.status ?? null)
    body = (
      <>
        {warnings.length === 0 ? (
          <p className="text-sm text-slate-600">
            {run?.status === 'done' || !run ? 'No warnings for this job.' : 'No rule warnings for this job.'}
          </p>
        ) : (
          <>
            {canAct && (open ?? 0) > 0 ? (
              <p className="text-sm text-amber-950">
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
          <p role="status" className="text-sm text-slate-600">
            {canAct || !runText.includes('Re-check') ? runText : "AI check didn't run."}
          </p>
        ) : null}
        {recheckError ? <p className="text-sm text-red-700">{recheckError}</p> : null}
        {canAct ? (
          <button
            type="button"
            onClick={recheck}
            disabled={rechecking || run?.status === 'pending' || run?.status === 'running'}
            className={`${BUTTON.secondary} min-h-11`}
          >
            Re-check with AI
          </button>
        ) : null}
      </>
    )
  }

  return (
    <section className={CARD} aria-labelledby="order-warnings">
      <h3 id="order-warnings" className="text-base font-semibold">
        Warnings
        {state.status === 'ready' && openWarnings(state) > 0 ? (
          <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
            {openWarnings(state)} to check
          </span>
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
    <li className={`rounded-md border px-3 py-2 ${w.status === 'open' ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-slate-50'}`}>
      <p className="text-sm text-slate-900">
        <span
          className={`mr-2 inline-block rounded px-1.5 py-0.5 text-xs font-semibold ${ai ? 'bg-violet-100 text-violet-900' : 'bg-slate-200 text-slate-800'}`}
          title={ai ? 'Found by the AI from the written job record' : 'Found by a fixed rule'}
        >
          {WARNING_RULE_LABELS[w.rule]}
        </span>
        <span className="break-words">{w.message}</span>
      </p>
      {w.status === 'checked' ? (
        <p className="mt-1 text-xs text-slate-600">
          Checked by {staffName(w.checked_by_name, w.checked_by) ?? 'a Manager'} · {formatMalaysiaDateTime(w.checked_at)}
          <span className="block break-words text-slate-800">“{w.check_note}”</span>
        </p>
      ) : null}
      {w.status === 'open' && canCheck && !editing ? (
        <button type="button" onClick={() => setEditing(true)} className={`${BUTTON.secondary} mt-2 min-h-11`}>
          Mark as checked
        </button>
      ) : null}
      {editing ? (
        <div className="mt-2 space-y-2">
          <label htmlFor={id} className="block text-sm font-medium text-slate-800">
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
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
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
