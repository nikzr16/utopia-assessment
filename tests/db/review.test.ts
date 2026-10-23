import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { formatMalaysiaDateTime } from '../../src/domain'
import { SIGNED_OUT, createTestDb, expectRejects, type Row, type TestDb } from './helpers'

// 0004 Manager review: approve only once the customer was told, the Manager
// sending the customer message on behalf of the technician, notices to the
// technician, the review facts in order_review_summary, and manager_orders.

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

const LANDLINE = '60312345678'

async function doneOrder(opts: { phone?: string; branch?: string; technician?: string } = {}): Promise<string> {
  const id = (
    await t.createOrder({ technician: opts.technician ?? t.people.ali, customerPhone: opts.phone, branch: opts.branch })
  ).id as string
  await t.advance(id, 'job_done')
  return id
}

const latestMessage = async (orderId: string) =>
  (await t.q<Row>('select * from latest_customer_messages where order_id = $1', [orderId]))[0]

const review = async (orderId: string) =>
  (await t.q<Row>('select * from order_review_summary where id = $1', [orderId]))[0]

describe('Approve waits until the customer was told', () => {
  it('is rejected while the latest message is not sent, then works', async () => {
    const id = await doneOrder()
    await expectRejects(
      t.transition(t.people.managerSA, id, 'reviewed'),
      'Tell the customer the job is done before approving',
    )
    expect((await t.summary(id)).status).toBe('job_done')
    await t.tellCustomer(id)
    expect((await t.transition(t.people.managerSA, id, 'reviewed', 'Neat work')).status).toBe('reviewed')
  })

  it('accepts a landline customer told by phone', async () => {
    const id = await doneOrder({ phone: LANDLINE })
    await t.tellCustomer(id)
    expect((await latestMessage(id)).status).toBe('told_by_phone')
    expect((await t.transition(t.people.managerSA, id, 'reviewed')).status).toBe('reviewed')
  })

  it('does not block returning a job for rework', async () => {
    const id = await doneOrder()
    expect((await t.transition(t.people.managerSA, id, 'in_progress', 'Leak not fixed')).status).toBe('in_progress')
  })
})

describe('A Manager sends the customer message on behalf of the technician', () => {
  it('saves the on-behalf text as sent, keeps the prepared text, and records it', async () => {
    const id = await doneOrder()
    const before = await latestMessage(id)
    const sent = await t.rpcAs<Row>(t.people.managerSA, 'confirm_customer_message', { p_message_id: before.id })
    const [o] = await t.q<Row>('select order_no from orders where id = $1', [id])
    const [c] = await t.q<Row>('select completed_at from order_completions where order_id = $1', [id])
    expect(sent).toMatchObject({
      status: 'sent',
      confirmed_by: t.people.managerSA,
      prepared_body: before.prepared_body,
      body: `Hi Encik Hafiz, this is Nurul Huda, Manager at Sejuk Sejuk Service Shah Alam, on behalf of Technician Ali. Job ${o.order_no} was completed at ${formatMalaysiaDateTime(c.completed_at as string)}. Please check and leave feedback. Thank you!`,
    })
    const [entry] = (await t.audit(id)).filter((e) => e.action === 'customer_messaged')
    expect(entry).toMatchObject({ actor_id: t.people.managerSA, actor_role: 'manager' })
    expect(entry.details).toMatchObject({ on_behalf: true, body: sent.body })
    // Now the Manager can approve.
    expect((await t.transition(t.people.managerSA, id, 'reviewed')).status).toBe('reviewed')
  })

  it('tells a landline customer by phone without changing the text', async () => {
    const id = await doneOrder({ phone: LANDLINE })
    const before = await latestMessage(id)
    const told = await t.rpcAs<Row>(t.people.managerSA, 'confirm_customer_message', { p_message_id: before.id })
    expect(told).toMatchObject({ status: 'told_by_phone', body: before.body })
  })

  it('uses the order’s branch for a Manager covering it as an additional branch', async () => {
    const id = await doneOrder({ branch: 'Penang' })
    await t.q('update staff set additional_branch_ids = array[$2::uuid] where id = $1', [
      t.people.managerSA,
      await t.branchId('Penang'),
    ])
    try {
      const sent = await t.rpcAs<Row>(t.people.managerSA, 'confirm_customer_message', {
        p_message_id: (await latestMessage(id)).id,
      })
      expect(sent.body).toContain('this is Nurul Huda, Manager at Sejuk Sejuk Service Penang, on behalf of Technician Ali')
    } finally {
      await t.q(`update staff set additional_branch_ids = '{}' where id = $1`, [t.people.managerSA])
    }
  })

  it('is rejected for a Manager of another branch', async () => {
    const id = await doneOrder()
    await expectRejects(
      t.rpcAs(t.people.managerKL, 'confirm_customer_message', { p_message_id: (await latestMessage(id)).id }),
      'Only the assigned technician, an Admin or a Manager of the branch can send the customer message of an order',
    )
  })
})

describe('Notices on approve and close', () => {
  it('tells Finance and the technician on approve, and the technician on close', async () => {
    const id = await doneOrder()
    await t.tellCustomer(id)
    await t.transition(t.people.managerSA, id, 'reviewed')
    const afterApprove = await t.notifications(id)
    expect(afterApprove.filter((n) => n.event === 'reviewed').map((n) => n.recipient_id)).toEqual([t.people.finance])
    const approved = afterApprove.filter((n) => n.event === 'job_approved')
    expect(approved).toHaveLength(1)
    expect(approved[0]).toMatchObject({ recipient_id: t.people.ali })
    expect(approved[0].message).toMatch(/^ORDER\d+ was approved by Nurul Huda$/)

    await t.pay(t.people.finance, id, 250)
    await t.transition(t.people.finance, id, 'closed')
    const closed = (await t.notifications(id)).filter((n) => n.event === 'job_closed')
    expect(closed).toHaveLength(1)
    expect(closed[0]).toMatchObject({ recipient_id: t.people.ali })
    expect(closed[0].message).toMatch(/^ORDER\d+ was closed by Siti Aminah$/)
  })
})

describe('order_review_summary', () => {
  it('shows who approved (with the note) and closed, and the return count and last note', async () => {
    const id = await doneOrder()
    expect(await review(id)).toMatchObject({
      return_count: 0,
      latest_message_status: 'not_sent',
      latest_message_channel: 'whatsapp',
      completion_technician_name: 'Ali',
      reviewed_at: null,
      closed_at: null,
    })
    await t.transition(t.people.managerSA, id, 'in_progress', 'Gas pressure low')
    await t.submit(t.people.ali, id)
    await t.transition(t.people.managerSA, id, 'in_progress', 'Still leaking')
    await t.submit(t.people.ali, id)
    expect(await review(id)).toMatchObject({ return_count: 2, last_return_note: 'Still leaking' })

    await t.tellCustomer(id)
    await t.transition(t.people.managerSA, id, 'reviewed', 'Customer wants the receipt by email')
    await t.pay(t.people.finance, id, 250, 'bank_transfer')
    expect(await review(id)).toMatchObject({
      reviewed_by_name: 'Nurul Huda',
      review_note: 'Customer wants the receipt by email',
      payment_count: 1,
      unverified_count: 1,
    })
    const [p] = await t.q<Row>('select id from payments where order_id = $1', [id])
    await t.rpcAs(t.people.finance, 'verify_payment', { p_payment_id: p.id })
    await t.transition(t.people.finance, id, 'closed')
    const r = await review(id)
    expect(r).toMatchObject({ closed_by_name: 'Siti Aminah', unverified_count: 0 })
    expect(r.closed_at).not.toBeNull()
  })

  it('follows the order’s visibility', async () => {
    const id = await doneOrder()
    expect(await t.qAs(t.people.ali, 'select id from order_review_summary where id = $1', [id])).toHaveLength(1)
    expect(await t.qAs(t.people.bala, 'select id from order_review_summary where id = $1', [id])).toEqual([])
    expect(await t.qAs(t.people.managerKL, 'select id from order_review_summary where id = $1', [id])).toEqual([])
    expect(await t.qAs(t.people.finance, 'select id from order_review_summary where id = $1', [id])).toHaveLength(1)
    await expectRejects(t.qAs(SIGNED_OUT, 'select * from order_review_summary'), /permission denied/i)
  })
})

describe('manager_orders', () => {
  it('lists Job Done orders of covered branches, oldest first, with a branch filter', async () => {
    const first = await doneOrder()
    const second = await doneOrder({ technician: t.people.bala })
    const kl = await doneOrder({ branch: 'Kuala Lumpur', technician: t.people.john })
    const nurul = (await t.qAs<{ id: string }>(t.people.managerSA, `select id from manager_orders('to_review')`)).map(
      (r) => r.id,
    )
    expect(nurul.indexOf(first)).toBeLessThan(nurul.indexOf(second))
    expect(nurul).not.toContain(kl)
    const weiMing = (await t.qAs<{ id: string }>(t.people.managerKL, `select id from manager_orders('to_review')`)).map(
      (r) => r.id,
    )
    expect(weiMing).toContain(kl)
    expect(weiMing).not.toContain(first)
    const filtered = await t.qAs<{ id: string }>(t.people.managerSA, 'select id from manager_orders($1, $2)', [
      'to_review',
      await t.branchId('Penang'),
    ])
    expect(filtered.map((r) => r.id)).not.toContain(first)
  })

  it('is for Managers only and knows its tabs', async () => {
    for (const who of [t.people.admin, t.people.finance, t.people.ali]) {
      await expectRejects(t.qAs(who, `select * from manager_orders('to_review')`), 'Only Managers have a review queue')
    }
    await expectRejects(t.qAs(t.people.managerSA, `select * from manager_orders('later')`), 'Unknown review queue view: later')
    await expectRejects(t.qAs(SIGNED_OUT, `select * from manager_orders('to_review')`), /permission denied/i)
  })
})
