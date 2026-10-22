import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, expectRejects, type TestDb } from './helpers'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

describe('AC2 every action is recorded under the acting user', () => {
  it('records the caller (not anyone else) as the actor of each step', async () => {
    const { people } = t
    const o = await t.createOrder({ actor: people.admin2 })
    const id = o.id as string
    await t.transition(people.admin2, id, 'assigned', null, people.ali)
    await t.transition(people.ali, id, 'acknowledged')
    await t.transition(people.ali, id, 'in_progress')
    await t.rpcAs(people.ali, 'submit_completion', { p_order_id: id, p_work_done: 'Done' })
    await t.transition(people.managerSA, id, 'reviewed')
    await t.pay(people.finance, id, 250)
    await t.transition(people.finance, id, 'closed')

    const log = await t.audit(id)
    expect(log.map((e) => [e.action, e.actor_id, e.actor_role])).toEqual([
      ['created', people.admin2, 'admin'],
      ['assigned', people.admin2, 'admin'],
      ['acknowledged', people.ali, 'technician'],
      ['started', people.ali, 'technician'],
      ['completion_submitted', people.ali, 'technician'],
      ['reviewed', people.managerSA, 'manager'],
      ['payment_recorded', people.finance, 'finance'],
      ['closed', people.finance, 'finance'],
    ])
  })

  it('records the order creator as the acting Admin', async () => {
    const o = await t.createOrder({ actor: t.people.admin2 })
    expect(o.created_by).toBe(t.people.admin2)
  })

  it('records payments and reschedules under the acting user', async () => {
    const { people } = t
    const o = await t.createOrder({ technician: people.bala })
    const id = o.id as string
    await t.advance(id, 'in_progress')
    const payment = await t.pay(people.bala, id, 50)
    expect(payment.recorded_by).toBe(people.bala)
    const entry = await t.rpcAs(people.admin, 'reschedule_order', {
      p_order_id: id,
      p_new_scheduled_at: '2026-11-02T02:00:00Z',
      p_reason: 'weather',
      p_requested_by: 'customer',
      p_note: null,
    })
    expect(entry.performed_by).toBe(people.admin)
  })

  it('rejects an account with no staff profile or an inactive staff member, and logs nothing', async () => {
    const o = await t.createOrder({ technician: t.people.ali })
    const before = (await t.audit(o.id as string)).length
    const stranger = await t.createAuthUser('stranger@example.com')
    await expectRejects(
      t.rpcAs({ role: 'authenticated', sub: stranger }, 'transition_order', {
        p_order_id: o.id,
        p_to_status: 'acknowledged',
      }),
      'Your account has no active staff profile',
    )
    await t.q('update staff set active = false where id = $1', [t.people.yusoff])
    await expectRejects(
      t.transition(t.people.yusoff, o.id as string, 'acknowledged'),
      'Your account has no active staff profile',
    )
    await t.q('update staff set active = true where id = $1', [t.people.yusoff])
    expect((await t.audit(o.id as string)).length).toBe(before)
  })
})

describe('AC12 every status change creates an audit entry with actor, role, from, to, and time', () => {
  it('creates exactly one entry per status change, in order, with from/to/time', async () => {
    const { people } = t
    const o = await t.createOrder()
    const id = o.id as string
    await t.transition(people.admin, id, 'assigned', null, people.ali)
    await t.transition(people.ali, id, 'in_progress')
    await t.rpcAs(people.ali, 'submit_completion', { p_order_id: id, p_work_done: 'Done' })
    await t.transition(people.managerSA, id, 'in_progress', 'Redo the filter')
    await t.rpcAs(people.ali, 'submit_completion', { p_order_id: id, p_work_done: 'Redone' })
    await t.transition(people.managerSA, id, 'reviewed')

    const changes = (await t.audit(id)).filter((e) => e.to_status !== null)
    expect(changes.map((e) => [e.from_status, e.to_status])).toEqual([
      [null, 'new'],
      ['new', 'assigned'],
      ['assigned', 'in_progress'],
      ['in_progress', 'job_done'],
      ['job_done', 'in_progress'],
      ['in_progress', 'job_done'],
      ['job_done', 'reviewed'],
    ])
    for (const e of changes) {
      expect(e.actor_id).toBeTruthy()
      expect(e.actor_role).toBeTruthy()
      expect(new Date(e.created_at).getTime()).not.toBeNaN()
    }
    const rework = changes[4]
    expect(rework.action).toBe('returned_for_rework')
    expect(rework.actor_role).toBe('manager')
    expect(rework.note).toBe('Redo the filter')
  })

  it('records a cancellation with its reason', async () => {
    const o = await t.createOrder({ technician: t.people.ali })
    await t.transition(t.people.admin, o.id as string, 'cancelled', 'Customer found another provider')
    const entry = (await t.audit(o.id as string)).at(-1)!
    expect(entry).toMatchObject({
      action: 'cancelled',
      from_status: 'assigned',
      to_status: 'cancelled',
      actor_role: 'admin',
      note: 'Customer found another provider',
    })
  })

  it('records the order creation, including whether a technician was selected', async () => {
    const withTech = await t.createOrder({ technician: t.people.john })
    const entry = (await t.audit(withTech.id as string))[0]
    expect(entry).toMatchObject({ action: 'created', from_status: null, to_status: 'assigned' })
    expect(entry.details).toMatchObject({ technician_name: 'John', order_no: withTech.order_no })
  })

  it('does not write an audit entry when a change is rejected', async () => {
    const o = await t.createOrder({ technician: t.people.ali })
    const before = (await t.audit(o.id as string)).length
    await expectRejects(t.transition(t.people.admin, o.id as string, 'closed'), 'Only Finance')
    expect((await t.audit(o.id as string)).length).toBe(before)
  })

  it('keeps the audit log append-only', async () => {
    const o = await t.createOrder()
    await expectRejects(
      t.q('update audit_log set note = $1 where order_id = $2', ['tampered', o.id]),
      'The audit log cannot be changed',
    )
    await expectRejects(t.q('delete from audit_log where order_id = $1', [o.id]), 'The audit log cannot be changed')
  })
})
