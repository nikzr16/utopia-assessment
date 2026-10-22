import { useRef, useState, type FormEvent } from 'react'
import { Dialog } from '../../../components/Dialog'
import { Field } from '../../../components/Field'
import { BUTTON, INPUT } from '../../../components/styles'
import { cancelOrder, type OrderSummary } from '../api'

/** Cancel with a required reason through `transition_order`. */
export function CancelDialog({
  order,
  onClose,
  onDone,
}: {
  order: OrderSummary
  onClose: () => void
  onDone: () => void
}) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const inFlight = useRef(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (inFlight.current) return
    if (!reason.trim()) {
      setError('A reason is required to cancel an order')
      return
    }
    inFlight.current = true
    setSaving(true)
    setError(null)
    try {
      await cancelOrder(order.id, reason.trim())
      onDone()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }

  return (
    <Dialog title={`Cancel ${order.order_no}`} onClose={onClose}>
      <form noValidate onSubmit={submit} className="space-y-4">
        <p className="text-sm text-slate-700">
          Cancelling is final: the order can no longer be changed.
          {order.technician_name ? ` Let ${order.technician_name} know it is off.` : ''}
        </p>
        <Field id="cancel-reason" label="Reason" error={error ?? undefined}>
          {(control) => (
            <textarea
              {...control}
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value)
                setError(null)
              }}
              className={INPUT}
            />
          )}
        </Field>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className={BUTTON.secondary} disabled={saving}>
            Keep order
          </button>
          <button type="submit" className={BUTTON.danger} disabled={saving}>
            {saving ? 'Cancelling…' : 'Cancel order'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
