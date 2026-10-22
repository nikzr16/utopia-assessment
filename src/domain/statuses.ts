/** Order lifecycle statuses. Values match the Postgres `order_status` enum. */
export const ORDER_STATUSES = [
  'new',
  'assigned',
  'acknowledged',
  'in_progress',
  'job_done',
  'reviewed',
  'closed',
  'cancelled',
] as const

export type OrderStatus = (typeof ORDER_STATUSES)[number]

/** Staff roles. Values match the Postgres `staff_role` enum. */
export const STAFF_ROLES = ['admin', 'technician', 'manager', 'finance'] as const

export type StaffRole = (typeof STAFF_ROLES)[number]

export const STATUS_LABELS: Record<OrderStatus, string> = {
  new: 'New',
  assigned: 'Assigned',
  acknowledged: 'Acknowledged',
  in_progress: 'In Progress',
  job_done: 'Job Done – awaiting review',
  reviewed: 'Reviewed',
  closed: 'Closed',
  cancelled: 'Cancelled',
}

export const ROLE_LABELS: Record<StaffRole, string> = {
  admin: 'Admin',
  technician: 'Technician',
  manager: 'Manager',
  finance: 'Finance',
}

/** Terminal statuses accept no further transitions. */
export const TERMINAL_STATUSES: readonly OrderStatus[] = ['closed', 'cancelled']

export function statusLabel(status: OrderStatus): string {
  return STATUS_LABELS[status]
}

export function roleLabel(role: StaffRole): string {
  return ROLE_LABELS[role]
}

export function isTerminal(status: OrderStatus): boolean {
  return TERMINAL_STATUSES.includes(status)
}

export const PAYMENT_METHODS = ['cash', 'bank_transfer', 'card', 'ewallet'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

export const RESCHEDULE_REASONS = [
  'customer_not_home',
  'parts_unavailable',
  'weather',
  'technician_unavailable',
  'other',
] as const
export type RescheduleReason = (typeof RESCHEDULE_REASONS)[number]

export const RESCHEDULE_REASON_LABELS: Record<RescheduleReason, string> = {
  customer_not_home: 'Customer not home',
  parts_unavailable: 'Parts unavailable',
  weather: 'Weather',
  technician_unavailable: 'Technician unavailable',
  other: 'Other',
}

export const RESCHEDULE_PARTIES = ['customer', 'technician', 'admin'] as const
export type RescheduleParty = (typeof RESCHEDULE_PARTIES)[number]
