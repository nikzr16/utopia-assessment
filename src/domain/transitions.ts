import type { OrderStatus, StaffRole } from './statuses'

/**
 * TypeScript mirror of the `order_status_transitions` table.
 * The database is the authority; `tests/db/parity.test.ts` fails if this list
 * and the seeded table ever differ. The UI uses it only to decide which
 * buttons to show.
 *
 * Creating an order (-> new / -> assigned) is handled by `create_order`, not by
 * this table. Reaching `job_done` is only possible through `submit_completion`.
 */
export interface TransitionRule {
  from: OrderStatus
  to: OrderStatus
  role: StaffRole
  /** Only the technician currently assigned to the order may do it. */
  assignedTechnicianOnly: boolean
  /** A note / reason must be supplied. */
  noteRequired: boolean
  /** Payment status must be `paid`. */
  paidRequired: boolean
}

function rule(
  from: OrderStatus,
  to: OrderStatus,
  role: StaffRole,
  opts: { assignedTechnicianOnly?: boolean; noteRequired?: boolean; paidRequired?: boolean } = {},
): TransitionRule {
  return {
    from,
    to,
    role,
    assignedTechnicianOnly: opts.assignedTechnicianOnly ?? false,
    noteRequired: opts.noteRequired ?? false,
    paidRequired: opts.paidRequired ?? false,
  }
}

export const TRANSITION_RULES: readonly TransitionRule[] = [
  // Assign / reassign (Admin)
  rule('new', 'assigned', 'admin'),
  rule('assigned', 'assigned', 'admin'),
  rule('acknowledged', 'assigned', 'admin'),
  // Technician work
  rule('assigned', 'acknowledged', 'technician', { assignedTechnicianOnly: true }),
  rule('assigned', 'in_progress', 'technician', { assignedTechnicianOnly: true }),
  rule('acknowledged', 'in_progress', 'technician', { assignedTechnicianOnly: true }),
  rule('in_progress', 'job_done', 'technician', { assignedTechnicianOnly: true }),
  // Manager review
  rule('job_done', 'reviewed', 'manager'),
  rule('job_done', 'in_progress', 'manager', { noteRequired: true }),
  // Finance close
  rule('reviewed', 'closed', 'finance', { paidRequired: true }),
  // Cancel (Admin, reason required)
  rule('new', 'cancelled', 'admin', { noteRequired: true }),
  rule('assigned', 'cancelled', 'admin', { noteRequired: true }),
  rule('acknowledged', 'cancelled', 'admin', { noteRequired: true }),
]

export function findTransition(
  from: OrderStatus,
  to: OrderStatus,
  role: StaffRole,
): TransitionRule | undefined {
  return TRANSITION_RULES.find((r) => r.from === from && r.to === to && r.role === role)
}

/** Transitions a role may attempt from a status (for showing action buttons). */
export function availableTransitions(from: OrderStatus, role: StaffRole): TransitionRule[] {
  return TRANSITION_RULES.filter((r) => r.from === from && r.role === role)
}

export function canTransition(from: OrderStatus, to: OrderStatus, role: StaffRole): boolean {
  return findTransition(from, to, role) !== undefined
}
