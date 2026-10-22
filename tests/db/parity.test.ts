import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  EDITABLE_STATUSES,
  ORDER_STATUSES,
  RESCHEDULABLE_STATUSES,
  STAFF_ROLES,
  TRANSITION_RULES,
  normalizeMyPhone,
  parseQuotedPrice,
} from '../../src/domain'
import { createTestDb, expectRejects, type TestDb } from './helpers'

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

// One table of cases, run through the TypeScript mirror and the SQL rule.
const PHONE_CASES = [
  '012-345 6789', '0123456789', '+60 12-345 6789', '60123456789', '+60 012-345 6789',
  '011-2345 6789', '015-4123 4567', '(03) 1234 5678', '03-1234 5678', '04-123 4567',
  '07.123.4567', '082-123 456', '088-123 456', '012-345 678', '012-345 67890',
  '011-234 5678', '03-123 4567', '081-123 456', '02-1234 5678', '1234567', '+65 9123 4567',
  '+600123456789', '', '   ', 'abc', '012-345 6789 ext 2', '6012345678',
]

const PRICE_CASES = [
  '0', '-0', '0.01', '250', '250.5', '250.50', '250.500', '99999.99', '100000', '100000.00',
  '100000.01', '-1', '-0.01', '0.001', '12.345',
]

/** SQL result as { ok, value } / { ok: false, error } so both sides compare equal. */
async function sqlResult(t: TestDb, sql: string, arg: string) {
  try {
    const rows = await t.q<{ v: string }>(sql, [arg])
    return { ok: true, value: rows[0].v }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

describe('Rules parity: Malaysian phone numbers (src/domain/phone.ts = _normalize_my_phone)', () => {
  it.each(PHONE_CASES)('%j', async (input) => {
    const sql = await sqlResult(t, 'select _normalize_my_phone($1) as v', input)
    expect(sql).toEqual(normalizeMyPhone(input))
  })
})

describe('Rules parity: quoted price (src/domain/price.ts = _check_quoted_price)', () => {
  it.each(PRICE_CASES)('%j', async (input) => {
    const sql = await sqlResult(t, 'select _check_quoted_price($1::numeric)::text as v', input)
    const ts = parseQuotedPrice(input)
    if (ts.ok) {
      expect(sql.ok).toBe(true)
      expect(Number(sql.value)).toBe(ts.value)
    } else {
      expect(sql).toEqual(ts)
    }
  })
})

describe('Rules parity: editable and reschedulable statuses (src/domain/orderEditing.ts)', () => {
  it('update_order accepts exactly the EDITABLE_STATUSES; reschedule_order the RESCHEDULABLE_STATUSES', async () => {
    const reached: Record<string, string> = {}
    for (const target of ['assigned', 'acknowledged', 'in_progress', 'job_done', 'reviewed'] as const) {
      reached[target] = (await t.advance((await t.createOrder()).id as string, target)).id as string
    }
    reached.new = (await t.createOrder()).id as string
    reached.closed = (await t.closeOrder((await t.createOrder()).id as string)).id as string
    const cancelled = await t.createOrder()
    await t.transition(t.people.admin, cancelled.id as string, 'cancelled', 'Customer cancelled')
    reached.cancelled = cancelled.id as string

    for (const status of ORDER_STATUSES) {
      const order = await t.summary(reached[status])
      expect(order.status).toBe(status)
      const call = t.rpcAs(t.people.admin, 'update_order', {
        p_order_id: order.id,
        p_expected_updated_at: order.updated_at,
        p_branch_id: order.branch_id,
        p_customer_name: 'Parity Check',
        p_customer_phone: order.customer_phone,
        p_customer_address: order.customer_address,
        p_problem_description: order.problem_description,
        p_service_type_id: order.service_type_id,
        p_quoted_price: order.quoted_price,
        p_scheduled_at: order.scheduled_at,
        p_admin_notes: order.admin_notes,
      })
      if (EDITABLE_STATUSES.includes(status)) await call
      else await expectRejects(call, 'An order can only be edited while it is New, Assigned or Acknowledged')

      const reschedule = t.rpcAs(t.people.admin, 'reschedule_order', {
        p_order_id: order.id,
        p_new_scheduled_at: null,
        p_reason: 'weather',
        p_requested_by: 'customer',
        p_note: null,
      })
      if (RESCHEDULABLE_STATUSES.includes(status)) await reschedule
      else await expectRejects(reschedule, 'Only an order that is not yet completed can be rescheduled')
    }
  })
})
