import { useRef, useState, type FormEvent } from 'react'
import { Dialog } from '../../components/Dialog'
import { Field } from '../../components/Field'
import { BUTTON, INPUT } from '../../components/styles'
import { REWORK_NOTE_REQUIRED_MESSAGE, formatMYR } from '../../domain'
import { approveOrder, closeOrder, returnForRework, type OrderReview } from './api'

/** Runs one write at a time and keeps its error to show; `onDone` after success. */
function useWrite(onDone: () => void) {
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const inFlight = useRef(false)
  async function write(action: () => Promise<void>) {
    if (inFlight.current) return
    inFlight.current = true
    setSaving(true)
    setError(null)
    try {
      await action()
      onDone()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }
  return { error, setError, saving, write }
}

const Alert = ({ message }: { message: string | null }) =>
  message ? (
    <p role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
      {message}
    </p>
  ) : null

/** Approve with an optional note (0004 PRD Q5); Finance reads it in the history. */
export function ApproveDialog({ order, onClose, onDone }: { order: OrderReview; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('')
  const { error, saving, write } = useWrite(onDone)

  function submit(e: FormEvent) {
    e.preventDefault()
    void write(() => approveOrder(order.id, note.trim() || null))
  }

  return (
    <Dialog title={`Approve ${order.order_no}`} onClose={onClose}>
      <form noValidate onSubmit={submit} className="space-y-4">
        <p className="text-sm text-slate-700">
          The job moves to Reviewed. Finance and {order.technician_name ?? 'the technician'} are told.
        </p>
        <Field id="approve-note" label="Note for Finance" optional>
          {(control) => (
            <textarea
              {...control}
              rows={3}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className={INPUT}
            />
          )}
        </Field>
        <Alert message={error} />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className={`${BUTTON.secondary} min-h-11`} disabled={saving}>
            Not yet
          </button>
          <button type="submit" className={`${BUTTON.primary} min-h-11`} disabled={saving}>
            {saving ? 'Approving…' : 'Approve job'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

/** Return for rework with a required note, shown to the technician (0000 stage 7). */
export function ReturnDialog({ order, onClose, onDone }: { order: OrderReview; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('')
  const { error, setError, saving, write } = useWrite(onDone)

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!note.trim()) {
      setError(REWORK_NOTE_REQUIRED_MESSAGE)
      return
    }
    void write(() => returnForRework(order.id, note.trim()))
  }

  return (
    <Dialog title={`Return ${order.order_no} for rework`} onClose={onClose}>
      <form noValidate onSubmit={submit} className="space-y-4">
        <p className="text-sm text-slate-700">
          The job goes back to In Progress. {order.technician_name ?? 'The technician'} gets your note.
        </p>
        <Field id="return-note" label="What needs fixing" error={error ?? undefined}>
          {(control) => (
            <textarea
              {...control}
              rows={4}
              maxLength={500}
              value={note}
              onChange={(e) => {
                setNote(e.target.value)
                setError(null)
              }}
              className={INPUT}
            />
          )}
        </Field>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className={`${BUTTON.secondary} min-h-11`} disabled={saving}>
            Keep for review
          </button>
          <button type="submit" className={`${BUTTON.danger} min-h-11`} disabled={saving}>
            {saving ? 'Returning…' : 'Return for rework'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

/** Close a Reviewed, fully paid order whose receipts are verified (0000 stage 8). */
export function CloseDialog({ order, onClose, onDone }: { order: OrderReview; onClose: () => void; onDone: () => void }) {
  const { error, saving, write } = useWrite(onDone)
  return (
    <Dialog title={`Close ${order.order_no}`} onClose={onClose}>
      <p className="text-sm text-slate-700">
        Final amount {formatMYR(order.final_amount)}, paid {formatMYR(order.amount_paid)}. Closing is final: the order can
        no longer be changed.
      </p>
      <div className="mt-3">
        <Alert message={error} />
      </div>
      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" onClick={onClose} className={`${BUTTON.secondary} min-h-11`} disabled={saving}>
          Not yet
        </button>
        <button
          type="button"
          onClick={() => void write(() => closeOrder(order.id))}
          className={`${BUTTON.primary} min-h-11`}
          disabled={saving}
        >
          {saving ? 'Closing…' : 'Close order'}
        </button>
      </div>
    </Dialog>
  )
}
