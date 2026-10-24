import { STATUS_LABELS, type OrderStatus } from '../domain'

const TONES: Record<OrderStatus, string> = {
  new: 'bg-slate-100 text-slate-800 ring-slate-300',
  assigned: 'bg-sky-50 text-sky-800 ring-sky-200',
  acknowledged: 'bg-indigo-50 text-indigo-800 ring-indigo-200',
  in_progress: 'bg-amber-50 text-amber-900 ring-amber-200',
  job_done: 'bg-violet-50 text-violet-800 ring-violet-200',
  reviewed: 'bg-teal-50 text-teal-800 ring-teal-200',
  closed: 'bg-green-50 text-green-800 ring-green-200',
  cancelled: 'bg-red-50 text-red-800 ring-red-200',
}

export function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  )
}
