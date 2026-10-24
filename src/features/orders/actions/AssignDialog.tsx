import { useRef, useState, type FormEvent } from 'react'
import { Dialog } from '../../../components/Dialog'
import { Field } from '../../../components/Field'
import { UserRound, UserRoundPlus } from 'lucide-react'
import { BUTTON } from '../../../components/styles'
import { Skeleton } from '../../../components/ui'
import { assignTechnician, fetchReferenceData, type OrderSummary } from '../api'
import { TechnicianSelect } from '../TechnicianSelect'
import { useLoad } from '../../../lib/useLoad'

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
        <div role="status" className="space-y-3">
          <span className="sr-only">Loading technicians…</span>
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : reference.status === 'error' ? (
        <p role="alert" className="rounded-lg border border-danger/35 bg-danger-soft px-3 py-2 text-sm text-danger-ink">
          {reference.message}
        </p>
      ) : (
        <form noValidate onSubmit={submit} className="space-y-4">
          {reassign ? (
            <div className="flex gap-3 rounded-lg border border-line bg-sunken px-3 py-2.5 text-sm text-ink-muted">
              <UserRound className="mt-0.5 size-4 shrink-0 text-ink-faint" aria-hidden="true" />
              <p>
                Currently assigned to <strong className="font-semibold text-ink">{order.technician_name}</strong>. The new
                technician must acknowledge the job again.
              </p>
            </div>
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
          <div className="flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:justify-end">
            <button type="button" onClick={onClose} className={`${BUTTON.secondary} min-h-11`} disabled={saving}>
              Back
            </button>
            <button type="submit" className={`${BUTTON.primary} min-h-11`} disabled={saving}>
              <UserRoundPlus aria-hidden="true" />
              {saving ? 'Saving…' : reassign ? 'Reassign' : 'Assign'}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  )
}
