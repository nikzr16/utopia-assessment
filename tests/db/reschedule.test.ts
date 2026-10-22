import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, expectRejects, type TestDb } from './helpers'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

const OLD = '2026-10-26T02:00:00Z'
const NEW = '2026-10-29T06:30:00Z'

function reschedule(actor: string, orderId: string, over: Record<string, unknown> = {}) {
  return t.rpcAs(actor, 'reschedule_order', {
    p_order_id: orderId,
    p_new_scheduled_at: NEW,
    p_reason: 'customer_not_home',
    p_requested_by: 'customer',
    p_note: null,
    ...over,
  })
}

describe('AC11 a reschedule creates a log entry and leaves the order status unchanged', () => {
  it('logs the old and new dates, reason and who asked, and updates the schedule', async () => {
    const o = await t.createOrder({ technician: t.people.ali, scheduledAt: OLD })
    const id = o.id as string
    const entry = await reschedule(t.people.admin, id, {
      p_reason: 'weather',
      p_requested_by: 'customer',
      p_note: 'Heavy rain forecast',
    })

    expect(new Date(entry.old_scheduled_at as string).toISOString()).toBe('2026-10-26T02:00:00.000Z')
    expect(new Date(entry.new_scheduled_at as string).toISOString()).toBe('2026-10-29T06:30:00.000Z')
    expect(entry).toMatchObject({
      order_id: id,
      reason: 'weather',
      reason_note: 'Heavy rain forecast',
      requested_by: 'customer',
      performed_by: t.people.admin,
    })

    const s = await t.summary(id)
    expect(s.status).toBe('assigned') // unchanged
    expect(new Date(s.scheduled_at as string).toISOString()).toBe('2026-10-29T06:30:00.000Z')
    expect(await t.q('select 1 from order_reschedules where order_id = $1', [id])).toHaveLength(1)
  })

  it('leaves the status unchanged at every stage before completion', async () => {
    for (const status of ['new', 'assigned', 'acknowledged', 'in_progress'] as const) {
      const o = await t.createOrder({
        technician: status === 'new' ? null : t.people.ali,
        scheduledAt: OLD,
      })
      const id = o.id as string
      if (status !== 'new') await t.advance(id, status === 'assigned' ? 'assigned' : status)
      await reschedule(t.people.admin, id)
      expect((await t.summary(id)).status).toBe(status)
    }
  })

  it('lets the assigned technician reschedule, recorded as the technician', async () => {
    const o = await t.createOrder({ technician: t.people.ali, scheduledAt: OLD })
    const entry = await reschedule(t.people.ali, o.id as string, {
      p_reason: 'parts_unavailable',
      p_requested_by: 'technician',
    })
    expect(entry.performed_by).toBe(t.people.ali)
    expect(entry.requested_by).toBe('technician')
  })

  it('supports postponing with no new date (new date empty)', async () => {
    const o = await t.createOrder({ technician: t.people.ali, scheduledAt: OLD })
    const id = o.id as string
    const entry = await reschedule(t.people.admin, id, { p_new_scheduled_at: null })
    expect(entry.new_scheduled_at).toBeNull()
    expect(entry.old_scheduled_at).not.toBeNull()
    expect((await t.summary(id)).scheduled_at).toBeNull()
    expect((await t.summary(id)).status).toBe('assigned')
  })

  it('keeps a history: a second reschedule uses the previous new date as its old date', async () => {
    const o = await t.createOrder({ technician: t.people.ali, scheduledAt: OLD })
    const id = o.id as string
    await reschedule(t.people.admin, id)
    const second = await reschedule(t.people.admin, id, { p_new_scheduled_at: '2026-11-03T02:00:00Z' })
    expect(new Date(second.old_scheduled_at as string).toISOString()).toBe('2026-10-29T06:30:00.000Z')
    expect(await t.q('select 1 from order_reschedules where order_id = $1', [id])).toHaveLength(2)
  })

  it('writes an audit entry that is not a status change', async () => {
    const o = await t.createOrder({ technician: t.people.ali, scheduledAt: OLD })
    const id = o.id as string
    await reschedule(t.people.admin, id, { p_reason: 'technician_unavailable', p_requested_by: 'admin' })
    const entry = (await t.audit(id)).at(-1)!
    expect(entry.action).toBe('rescheduled')
    expect(entry.from_status).toBeNull()
    expect(entry.to_status).toBeNull()
    expect(entry.details).toMatchObject({ reason: 'technician_unavailable', requested_by: 'admin', status: 'assigned' })
  })

  it('rejects other people, finished orders and a missing explanation for "other"', async () => {
    const o = await t.createOrder({ technician: t.people.ali, scheduledAt: OLD })
    const id = o.id as string
    for (const actor of [t.people.bala, t.people.managerSA, t.people.finance]) {
      await expectRejects(
        reschedule(actor, id),
        'Only Admin or the assigned technician can reschedule an order',
      )
    }
    await expectRejects(
      reschedule(t.people.admin, id, { p_reason: 'other', p_note: '  ' }),
      'Please describe the reason',
    )
    await t.advance(id, 'job_done')
    await expectRejects(reschedule(t.people.admin, id), 'not yet completed can be rescheduled')
    expect(await t.q('select 1 from order_reschedules where order_id = $1', [id])).toHaveLength(0)
  })
})
