import { useRef, useState, type FormEvent } from 'react'
import { Dialog } from '../../../components/Dialog'
import { Field } from '../../../components/Field'
import { BUTTON, INPUT } from '../../../components/styles'
import {
  RESCHEDULE_PARTIES,
  RESCHEDULE_REASONS,
  RESCHEDULE_REASON_LABELS,
  formatMalaysiaDateTime,
  fromMalaysiaDateTimeInput,
  type RescheduleParty,
  type RescheduleReason,
} from '../../../domain'
import { rescheduleOrder, type OrderSummary } from '../api'

const PARTY_LABELS: Record<RescheduleParty, string> = {
  customer: 'Customer',
  technician: 'Technician',
  admin: 'Admin (office)',
}

type Errors = Partial<Record<'date' | 'reason' | 'requestedBy' | 'note', string>>

/** Reschedule or postpone through `reschedule_order` (PRD Q10). */
export function RescheduleDialog({
  order,
  onClose,
  onDone,
}: {
  order: OrderSummary
  onClose: () => void
  onDone: () => void
}) {
  const [date, setDate] = useState('')
  const [postpone, setPostpone] = useState(false)
  const [reason, setReason] = useState<RescheduleReason | ''>('')
  const [requestedBy, setRequestedBy] = useState<RescheduleParty | ''>('')
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const inFlight = useRef(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (inFlight.current) return
    const next: Errors = {}
    const iso = postpone ? null : fromMalaysiaDateTimeInput(date)
    if (!postpone && !iso) next.date = 'Choose the new date and time, or tick "Postpone"'
    if (!reason) next.reason = 'Select a reason for the reschedule'
    if (!requestedBy) next.requestedBy = 'Say who requested the reschedule'
    if (reason === 'other' && !note.trim()) next.note = 'Please describe the reason for the reschedule'
    setErrors(next)
    setServerError(null)
    if (Object.keys(next).length > 0 || !reason || !requestedBy) return

    inFlight.current = true
    setSaving(true)
    try {
      await rescheduleOrder(order.id, iso ?? null, reason, requestedBy, note.trim() || null)
      onDone()
    } catch (err) {
      setServerError((err as Error).message)
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }

  return (
    <Dialog title={`Reschedule ${order.order_no}`} onClose={onClose}>
      <form noValidate onSubmit={submit} className="space-y-4">
        <p className="text-sm text-slate-700">
          Currently: {order.scheduled_at ? formatMalaysiaDateTime(order.scheduled_at) : 'not scheduled'}.
        </p>
        {serverError ? (
          <p role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
            {serverError}
          </p>
        ) : null}
        <Field id="reschedule-date" label="New date and time" hint="Malaysia time" error={errors.date}>
          {(control) => (
            <input
              {...control}
              type="datetime-local"
              value={date}
              disabled={postpone}
              onChange={(e) => setDate(e.target.value)}
              className={INPUT}
            />
          )}
        </Field>
        <label className="flex items-center gap-2 text-sm text-slate-800">
          <input
            type="checkbox"
            checked={postpone}
            onChange={(e) => setPostpone(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
          />
          Postpone, no new date yet
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="reschedule-reason" label="Reason" error={errors.reason}>
            {(control) => (
              <select
                {...control}
                value={reason}
                onChange={(e) => setReason(e.target.value as RescheduleReason)}
                className={INPUT}
              >
                <option value="">Select a reason</option>
                {RESCHEDULE_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {RESCHEDULE_REASON_LABELS[r]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field id="reschedule-requested-by" label="Requested by" error={errors.requestedBy}>
            {(control) => (
              <select
                {...control}
                value={requestedBy}
                onChange={(e) => setRequestedBy(e.target.value as RescheduleParty)}
                className={INPUT}
              >
                <option value="">Select who asked</option>
                {RESCHEDULE_PARTIES.map((p) => (
                  <option key={p} value={p}>
                    {PARTY_LABELS[p]}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        <Field id="reschedule-note" label="Note" optional={reason !== 'other'} error={errors.note}>
          {(control) => (
            <textarea
              {...control}
              rows={2}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className={INPUT}
            />
          )}
        </Field>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className={BUTTON.secondary} disabled={saving}>
            Back
          </button>
          <button type="submit" className={BUTTON.primary} disabled={saving}>
            {saving ? 'Saving…' : 'Save new date'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
