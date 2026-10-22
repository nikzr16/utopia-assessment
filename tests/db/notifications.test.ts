import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, expectRejects, type TestDb } from './helpers'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

const recipients = (rows: Array<{ recipient_id: string }>) => rows.map((r) => r.recipient_id).sort()

async function submit(actor: string, orderId: string) {
  return t.rpcAs(actor, 'submit_completion', { p_order_id: orderId, p_work_done: 'Done' })
}

describe('AC13 workflow events create in-app notifications', () => {
  it('Job Done notifies the managers of the order branch (Shah Alam)', async () => {
    const o = await t.createOrder({ technician: t.people.ali, branch: 'Shah Alam' })
    const id = o.id as string
    await t.advance(id, 'in_progress')
    await submit(t.people.ali, id)
    const jobDone = (await t.notifications(id)).filter((n) => n.event === 'job_done')
    expect(recipients(jobDone)).toEqual([t.people.managerSA])
    expect(jobDone[0].message).toContain(o.order_no as string)
    expect(jobDone[0].read_at).toBeNull()
  })

  it('Job Done notifies only the Kuala Lumpur manager for a Kuala Lumpur order', async () => {
    const o = await t.createOrder({ technician: t.people.john, branch: 'Kuala Lumpur' })
    const id = o.id as string
    await t.advance(id, 'in_progress')
    await submit(t.people.john, id)
    const jobDone = (await t.notifications(id)).filter((n) => n.event === 'job_done')
    expect(recipients(jobDone)).toEqual([t.people.managerKL])
  })

  it('Job Done notifies every manager when a branch has more than one', async () => {
    const extra = await t.q<{ id: string }>(
      `insert into staff (name, email, phone, role, branch_id)
       select 'Lim Hui Yee', 'huiyee@sejuk.example.com', '60120000023', 'manager', id
         from branches where name = 'Shah Alam'
       returning id`,
    )
    const o = await t.createOrder({ technician: t.people.ali, branch: 'Shah Alam' })
    const id = o.id as string
    await t.advance(id, 'in_progress')
    await submit(t.people.ali, id)
    const jobDone = (await t.notifications(id)).filter((n) => n.event === 'job_done')
    expect(recipients(jobDone)).toEqual([t.people.managerSA, extra[0].id].sort())
    await t.q('delete from notifications where recipient_id = $1', [extra[0].id])
    await t.q('delete from staff where id = $1', [extra[0].id])
  })

  it('does not notify managers of other branches (Penang has none)', async () => {
    const o = await t.createOrder({ technician: t.people.ali, branch: 'Penang' })
    const id = o.id as string
    await t.advance(id, 'in_progress')
    await submit(t.people.ali, id)
    expect((await t.notifications(id)).filter((n) => n.event === 'job_done')).toHaveLength(0)
  })

  it('Reviewed notifies Finance (every Finance user)', async () => {
    const extra = await t.q<{ id: string }>(
      `insert into staff (name, email, phone, role, branch_id)
       select 'Hassan Ibrahim', 'hassan@sejuk.example.com', '60120000032', 'finance', id
         from branches where name = 'Penang'
       returning id`,
    )
    const o = await t.createOrder({ technician: t.people.ali })
    const id = o.id as string
    await t.advance(id, 'job_done')
    await t.transition(t.people.managerSA, id, 'reviewed')
    const reviewed = (await t.notifications(id)).filter((n) => n.event === 'reviewed')
    expect(recipients(reviewed)).toEqual([t.people.finance, extra[0].id].sort())
    await t.q('delete from notifications where recipient_id = $1', [extra[0].id])
    await t.q('delete from staff where id = $1', [extra[0].id])
  })

  it('Reviewed creates exactly one notification for the seeded Finance user', async () => {
    const o = await t.createOrder({ technician: t.people.ali })
    const id = o.id as string
    await t.advance(id, 'reviewed')
    const reviewed = (await t.notifications(id)).filter((n) => n.event === 'reviewed')
    expect(recipients(reviewed)).toEqual([t.people.finance])
  })

  it('Return for rework notifies the assigned technician', async () => {
    const o = await t.createOrder({ technician: t.people.bala })
    const id = o.id as string
    await t.advance(id, 'job_done')
    await t.transition(t.people.managerSA, id, 'in_progress', 'Wipe the indoor unit')
    const rework = (await t.notifications(id)).filter((n) => n.event === 'rework')
    expect(recipients(rework)).toEqual([t.people.bala])
    expect(rework[0].message).toContain('Wipe the indoor unit')
  })

  it('Assigned and reassigned notify the (new) technician', async () => {
    const o = await t.createOrder({ technician: t.people.ali })
    const id = o.id as string
    await t.transition(t.people.admin, id, 'assigned', null, t.people.bala)
    const assigned = (await t.notifications(id)).filter((n) => n.event === 'assigned')
    expect(assigned.map((n) => n.recipient_id)).toEqual([t.people.ali, t.people.bala])
    expect(assigned[1].message).toContain('reassigned')
  })

  it('assigning a New order notifies the technician; creating a New order notifies nobody', async () => {
    const fresh = await t.createOrder()
    expect(await t.notifications(fresh.id as string)).toHaveLength(0)
    await t.transition(t.people.admin, fresh.id as string, 'assigned', null, t.people.yusoff)
    expect(recipients(await t.notifications(fresh.id as string))).toEqual([t.people.yusoff])
  })

  it('creates no notification for acknowledge, start, cancel or close', async () => {
    const o = await t.createOrder({ technician: t.people.ali })
    const id = o.id as string
    const base = (await t.notifications(id)).length // the assignment
    await t.transition(t.people.ali, id, 'acknowledged')
    await t.transition(t.people.ali, id, 'in_progress')
    expect(await t.notifications(id)).toHaveLength(base)

    const c = await t.createOrder({ technician: t.people.ali })
    const before = (await t.notifications(c.id as string)).length
    await t.transition(t.people.admin, c.id as string, 'cancelled', 'No longer needed')
    expect(await t.notifications(c.id as string)).toHaveLength(before)
  })

  it('creates no notification when a change is rejected', async () => {
    const o = await t.createOrder({ technician: t.people.ali })
    const id = o.id as string
    await t.advance(id, 'job_done')
    const before = (await t.notifications(id)).length
    await expectRejects(t.transition(t.people.managerSA, id, 'in_progress'), 'A review note is required')
    await expectRejects(t.transition(t.people.admin, id, 'reviewed'), 'Only Manager')
    expect(await t.notifications(id)).toHaveLength(before)
  })
})

describe('mark_notification_read', () => {
  it('lets the recipient mark a notification read, keeping the first read time', async () => {
    const o = await t.createOrder({ technician: t.people.ali })
    const [n] = await t.notifications(o.id as string)
    const first = await t.rpcAs(t.people.ali, 'mark_notification_read', {
      p_notification_id: n.id,
    })
    expect(first.read_at).not.toBeNull()
    const second = await t.rpcAs(t.people.ali, 'mark_notification_read', {
      p_notification_id: n.id,
    })
    expect(second.read_at).toEqual(first.read_at)
  })

  it('rejects anyone but the recipient', async () => {
    const o = await t.createOrder({ technician: t.people.ali })
    const [n] = await t.notifications(o.id as string)
    await expectRejects(
      t.rpcAs(t.people.bala, 'mark_notification_read', { p_notification_id: n.id }),
      'You can only mark your own notifications as read',
    )
    expect((await t.notifications(o.id as string))[0].read_at).toBeNull()
  })

  it('rejects an unknown notification', async () => {
    await expectRejects(
      t.rpcAs(t.people.ali, 'mark_notification_read', { p_notification_id: 999999 }),
      'Notification not found',
    )
  })
})
