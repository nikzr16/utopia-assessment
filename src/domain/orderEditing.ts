import type { OrderStatus } from './statuses'

/**
 * Statuses in which an Admin may edit an order's details. Mirrors the check in
 * `update_order`; `tests/db/parity.test.ts` keeps both identical.
 */
export const EDITABLE_STATUSES: readonly OrderStatus[] = ['new', 'assigned', 'acknowledged']

export function canEditOrder(status: OrderStatus): boolean {
  return EDITABLE_STATUSES.includes(status)
}

/**
 * Statuses in which an order can be rescheduled or postponed. Mirrors the
 * check in `reschedule_order`; `tests/db/parity.test.ts` keeps both identical.
 */
export const RESCHEDULABLE_STATUSES: readonly OrderStatus[] = ['new', 'assigned', 'acknowledged', 'in_progress']

export function canRescheduleOrder(status: OrderStatus): boolean {
  return RESCHEDULABLE_STATUSES.includes(status)
}
