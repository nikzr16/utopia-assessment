import { useRef, useState, type FormEvent } from 'react'
import { Dialog } from '../../../components/Dialog'
import { Field } from '../../../components/Field'
import { BUTTON } from '../../../components/styles'
import { assignTechnician, fetchReferenceData, type OrderSummary } from '../api'
import { TechnicianSelect } from '../TechnicianSelect'
import { useLoad } from '../useLoad'

/** Assign (New) or reassign (Assigned / Acknowledged) through `transition_order`. */
export function AssignDialog({
  order,
  onClose,
  onDone,
}: {
  order: OrderSummary
  onClose: () => void
  /** Called with the chosen technician's name once the database accepted it. */
  onDone: (technicianName: string) => void
}) {
  const reassign = order.assigned_technician_id !== null
  const [reference] = useLoad(fetchReferenceData, 'reference')
  const [technicianId, setTechnicianId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const inFlight = useRef(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (inFlight.current) return
    if (!technicianId) {
      setError('Select a technician')
      return
    }
    inFlight.current = true
    setSaving(true)
    setError(null)
    try {
      await assignTechnician(order.id, technicianId)
      const name =
        reference.status === 'ready' ? reference.data.technicians.find((t) => t.id === technicianId)?.name : undefined
      onDone(name ?? 'the technician')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }

  return (
    <Dialog title={reassign ? `Reassign ${order.order_no}` : `Assign ${order.order_no}`} onClose={onClose}>
      {reference.status === 'loading' ? (
        <p className="text-sm text-slate-600">Loading technicians…</p>
      ) : reference.status === 'error' ? (
        <p role="alert" className="text-sm text-red-700">
          {reference.message}
        </p>
      ) : (
        <form noValidate onSubmit={submit} className="space-y-4">
          {reassign ? (
            <p className="text-sm text-slate-700">
              Currently assigned to <strong>{order.technician_name}</strong>. The new technician must acknowledge
              the job again.
            </p>
          ) : null}
          <Field id="assign-technician" label="Technician" error={error ?? undefined}>
            {(control) => (
              <TechnicianSelect
                control={control}
                value={technicianId}
                onChange={(v) => {
                  setTechnicianId(v)
                  setError(null)
                }}
                technicians={reference.data.technicians}
                branches={reference.data.branches}
                orderBranchId={order.branch_id}
                excludeId={order.assigned_technician_id}
              />
            )}
          </Field>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={onClose} className={BUTTON.secondary} disabled={saving}>
              Back
            </button>
            <button type="submit" className={BUTTON.primary} disabled={saving}>
              {saving ? 'Saving…' : reassign ? 'Reassign' : 'Assign'}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  )
}
