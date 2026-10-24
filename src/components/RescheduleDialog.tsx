import { useRef, useState, type FormEvent } from 'react'
import { Dialog } from './Dialog'
import { Field } from './Field'
import { CalendarCheck, CalendarClock } from 'lucide-react'
import { BUTTON, INPUT } from './styles'
import {
  RESCHEDULE_PARTIES,
  RESCHEDULE_REASONS,
  RESCHEDULE_REASON_LABELS,
  formatMalaysiaDateTime,
  fromMalaysiaDateTimeInput,
  type RescheduleParty,
  type RescheduleReason,
} from '../domain'

const PARTY_LABELS: Record<RescheduleParty, string> = {
  customer: 'Customer',
  technician: 'Technician',
  admin: 'Admin (office)',
}

type Errors = Partial<Record<'date' | 'reason' | 'requestedBy' | 'note', string>>

/** Saves a reschedule through `reschedule_order`; throws an error with a message to show. */
export type SaveReschedule = (
  newScheduledAt: string | null,
  reason: RescheduleReason,
  requestedBy: RescheduleParty,
  note: string | null,
) => Promise<void>

/**
 * Reschedule or postpone with a reason (0001 PRD Q10, 0002 AC11). Shared by
 * the Admin and Technician portals; each passes its own `save`.
 */
export function RescheduleDialog({
  order,
  save,
  onClose,
  onDone,
}: {
  order: { order_no: string; scheduled_at: string | null }
  save: SaveReschedule
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
      await save(iso ?? null, reason, requestedBy, note.trim() || null)
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
        <p className="flex items-center gap-2.5 rounded-lg border border-line bg-sunken px-3 py-2.5 text-sm text-ink-muted">
          <CalendarClock className="size-4 shrink-0 text-ink-faint" aria-hidden="true" />
          <span>
            Currently: {order.scheduled_at ? formatMalaysiaDateTime(order.scheduled_at) : 'not scheduled'}.
          </span>
        </p>
        {serverError ? (
          <p role="alert" className="rounded-lg border border-danger/35 bg-danger-soft px-3 py-2 text-sm text-danger-ink">
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
        <label
          className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm text-ink transition-colors ${
            postpone ? 'border-brand/40 bg-brand-soft' : 'border-line-strong bg-surface hover:bg-sunken'
          }`}
        >
          <input
            type="checkbox"
            checked={postpone}
            onChange={(e) => setPostpone(e.target.checked)}
            className="size-4 shrink-0 rounded border-line-strong accent-brand"
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
        <div className="flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className={`${BUTTON.secondary} min-h-11`} disabled={saving}>
            Back
          </button>
          <button type="submit" className={`${BUTTON.primary} min-h-11`} disabled={saving}>
            <CalendarCheck aria-hidden="true" />
            {saving ? 'Saving…' : 'Save new date'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
