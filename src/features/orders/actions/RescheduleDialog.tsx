import { RescheduleDialog as SharedRescheduleDialog } from '../../../components/RescheduleDialog'
import { rescheduleOrder, type OrderSummary } from '../api'

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
  return (
    <SharedRescheduleDialog
      order={order}
      save={(newScheduledAt, reason, requestedBy, note) =>
        rescheduleOrder(order.id, newScheduledAt, reason, requestedBy, note)
      }
      onClose={onClose}
      onDone={onDone}
    />
  )
}
