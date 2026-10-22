import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ORDER_STATUSES, STAFF_ROLES, TRANSITION_RULES } from '../../src/domain'
import { createTestDb, type TestDb } from './helpers'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

interface DbRule {
  from_status: string
  to_status: string
  actor_role: string
  assigned_technician_only: boolean
  note_required: boolean
  paid_required: boolean
}

const key = (r: { from: string; to: string; role: string }) => `${r.from}>${r.to}>${r.role}`

describe('Rules parity: src/domain transition mirror equals order_status_transitions', () => {
  it('has exactly the same rows with the same flags', async () => {
    const rows = await t.q<DbRule>(
      'select * from order_status_transitions order by from_status, to_status, actor_role',
    )
    const fromDb = rows
      .map((r) => ({
        from: r.from_status,
        to: r.to_status,
        role: r.actor_role,
        assignedTechnicianOnly: r.assigned_technician_only,
        noteRequired: r.note_required,
        paidRequired: r.paid_required,
      }))
      .sort((a, b) => key(a).localeCompare(key(b)))
    const fromTs = TRANSITION_RULES.map((r) => ({ ...r })).sort((a, b) => key(a).localeCompare(key(b)))
    expect(fromDb).toEqual(fromTs)
  })

  it('has the same status values as the order_status enum, in lifecycle order', async () => {
    const rows = await t.q<{ label: string }>(
      `select enumlabel as label from pg_enum e join pg_type ty on ty.oid = e.enumtypid
        where ty.typname = 'order_status' order by e.enumsortorder`,
    )
    expect(rows.map((r) => r.label)).toEqual([...ORDER_STATUSES])
  })

  it('has the same role values as the staff_role enum', async () => {
    const rows = await t.q<{ label: string }>(
      `select enumlabel as label from pg_enum e join pg_type ty on ty.oid = e.enumtypid
        where ty.typname = 'staff_role' order by e.enumsortorder`,
    )
    expect(rows.map((r) => r.label)).toEqual([...STAFF_ROLES])
  })
})
