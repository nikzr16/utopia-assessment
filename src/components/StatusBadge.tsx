import { STATUS_LABELS, type OrderStatus } from '../domain'
import { Badge } from './ui'

/** One tone per step of the job (0011 tokens; AA in light and dark). */
const TONES = {
  new: 'neutral',
  assigned: 'brand',
  acknowledged: 'brand',
  in_progress: 'warning',
  job_done: 'info',
  reviewed: 'success',
  closed: 'success',
  cancelled: 'danger',
} as const satisfies Record<OrderStatus, Parameters<typeof Badge>[0]['tone']>

export function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <Badge tone={TONES[status]} dot>
      {STATUS_LABELS[status]}
    </Badge>
  )
}
