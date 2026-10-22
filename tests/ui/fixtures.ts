import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import type { HistoryEntry, OrderSummary, ReferenceData } from '../../src/features/orders/api'

// Component tests replace src/features/orders/api.ts with test doubles; the
// real database behavior behind those calls is covered by tests/db.
afterEach(() => cleanup())

export const BRANCH = { shahAlam: 'b-sa', kl: 'b-kl', penang: 'b-pg' }
export const TECH = { ali: 't-ali', bala: 't-bala', john: 't-john' }

export const reference: ReferenceData = {
  branches: [
    { id: BRANCH.kl, name: 'Kuala Lumpur' },
    { id: BRANCH.penang, name: 'Penang' },
    { id: BRANCH.shahAlam, name: 'Shah Alam' },
  ],
  serviceTypes: [
    { id: 'st-clean', name: 'Aircond cleaning', active: true },
    { id: 'st-repair', name: 'Repair', active: true },
    { id: 'st-old', name: 'Old service', active: false },
  ],
  technicians: [
    { id: TECH.john, name: 'John', phone: '60120000012', branch_id: BRANCH.kl, branch_name: 'Kuala Lumpur', open_jobs: 1 },
    { id: TECH.ali, name: 'Ali', phone: '60120000011', branch_id: BRANCH.shahAlam, branch_name: 'Shah Alam', open_jobs: 2 },
    { id: TECH.bala, name: 'Bala', phone: '60120000013', branch_id: BRANCH.shahAlam, branch_name: 'Shah Alam', open_jobs: 0 },
  ],
}

export function makeOrder(overrides: Partial<OrderSummary> = {}): OrderSummary {
  return {
    id: 'o-1',
    order_no: 'ORDER1001',
    branch_id: BRANCH.shahAlam,
    branch_name: 'Shah Alam',
    customer_name: 'Puan Lim',
    customer_phone: '60123456789',
    customer_address: '8 Jalan Kenanga, Shah Alam',
    problem_description: 'Water dripping from indoor unit',
    service_type_id: 'st-repair',
    service_type_name: 'Repair',
    quoted_price: 180,
    assigned_technician_id: TECH.ali,
    technician_name: 'Ali',
    admin_notes: 'Gate code 1234',
    status: 'assigned',
    scheduled_at: '2026-10-26T02:00:00+00:00',
    created_at: '2026-10-22T01:00:00+00:00',
    updated_at: '2026-10-22T01:00:00.123456+00:00',
    extra_charges: 0,
    final_amount: 180,
    amount_paid: 0,
    balance: 180,
    overpaid_amount: 0,
    payment_status: 'unpaid',
    ...overrides,
  }
}

export const history: HistoryEntry[] = [
  {
    id: 2,
    action: 'updated',
    actor_role: 'admin',
    actor_name: 'Farid Hakim',
    from_status: null,
    to_status: null,
    note: null,
    details: { status: 'assigned', changes: { customer_phone: { from: '60123456780', to: '60123456789' } } },
    created_at: '2026-10-22T02:00:00+00:00',
  },
  {
    id: 1,
    action: 'created',
    actor_role: 'admin',
    actor_name: 'Farid Hakim',
    from_status: null,
    to_status: 'assigned',
    note: null,
    details: { technician_name: 'Ali' },
    created_at: '2026-10-22T01:00:00+00:00',
  },
]
