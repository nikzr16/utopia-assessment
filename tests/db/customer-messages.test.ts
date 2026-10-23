import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { formatMalaysiaDateTime } from '../../src/domain'
import { SIGNED_OUT, createTestDb, expectRejects, type Actor, type Row, type TestDb } from './helpers'

// 0003 database functions: the customer message prepared when an order reaches
// Job Done, editing it, confirming it was sent (or the customer was told by
// phone), the latest-message view, and who can read it.

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

const LANDLINE = '60312345678'
const MOBILE = '60123456789'

type MessageStatus = 'job_done' | 'reviewed' | 'closed'

/** An order moved to Job Done (or further) by `technician`. */
async function doneOrder(
  opts: { technician?: string; phone?: string; name?: string; status?: MessageStatus } = {},
): Promise<string> {
  const technician = opts.technician ?? t.people.ali
  const order = await t.createOrder({
    technician,
    customerPhone: opts.phone,
    customerName: opts.name,
  })
  const id = order.id as string
  if (opts.status === 'closed') await t.closeOrder(id)
  else await t.advance(id, opts.status === 'reviewed' ? 'reviewed' : 'job_done')
  return id
}

/**
 * A not_sent message for an order already Reviewed or Closed. Since 0004 the
 * customer is told before approval, so only a backfilled message (0003
 * migration) can be in this state; this inserts one the same way.
 */
async function unsentMessageOn(orderId: string): Promise<Row> {
  const [m] = await t.q<Row>(
    `insert into customer_messages (order_id, channel, phone, prepared_body, body)
     select id, 'whatsapp', customer_phone, 'Backfilled', 'Backfilled' from orders where id = $1
     returning *`,
    [orderId],
  )
  return m
}

/** Manager returns the job; the technician submits it again (a new Job Done). */
async function rework(orderId: string, technician = t.people.ali) {
  await t.transition(t.people.managerSA, orderId, 'in_progress', 'Please redo the gas check')
  await t.submit(technician, orderId, { workDone: 'Gas checked again' })
}

const messagesOf = (orderId: string) =>
  t.q<Row>('select * from customer_messages where order_id = $1 order by created_at, id', [orderId])

const latestOf = async (orderId: string): Promise<Row> =>
  (await t.q<Row>('select * from latest_customer_messages where order_id = $1', [orderId]))[0]

const edit = (actor: Actor, messageId: unknown, body: unknown) =>
  t.rpcAs(actor, 'edit_customer_message', { p_message_id: messageId, p_body: body })

const confirm = (actor: Actor, messageId: unknown) =>
  t.rpcAs(actor, 'confirm_customer_message', { p_message_id: messageId })

const auditOf = async (orderId: string, ...actions: string[]) =>
  (await t.audit(orderId)).filter((a) => actions.includes(a.action))

const iso = (value: unknown) => new Date(value as string | Date).toISOString()
const when = (value: unknown) => formatMalaysiaDateTime(iso(value))

// ---------------------------------------------------------------------------
// The text
// ---------------------------------------------------------------------------
describe('Customer message wording and Malaysia time', () => {
  const message = (at: string) =>
    t
      .q<{ v: string }>(`select _customer_job_done_message('Encik Hafiz', 'ORDER1007', 'Ali', $1::timestamptz) as v`, [at])
      .then((r) => r[0].v)

  it('follows the brief: customer, order number, technician, time, a request for feedback', async () => {
    expect(await message('2026-10-22T07:15:00Z')).toBe(
      'Hi Encik Hafiz, Job ORDER1007 has been completed by Technician Ali at Thu 22 Oct 2026, 3:15 PM. Please check and leave feedback. Thank you!',
    )
  })

  it('shows the completion time in Malaysia time, not UTC', async () => {
    // 20:30 UTC on the 22nd is 04:30 on the 23rd in Malaysia.
    expect(await message('2026-10-22T20:30:00Z')).toContain('at Fri 23 Oct 2026, 4:30 AM.')
    // Midnight and noon read 12 AM / 12 PM.
    expect(await message('2026-10-21T16:00:00Z')).toContain('at Thu 22 Oct 2026, 12:00 AM.')
    expect(await message('2026-10-22T04:00:00Z')).toContain('at Thu 22 Oct 2026, 12:00 PM.')
  })
})

// ---------------------------------------------------------------------------
// The trigger
// ---------------------------------------------------------------------------
describe('Job Done prepares a customer message', () => {
  it('writes one not_sent WhatsApp message with the filled-in text when the technician submits', async () => {
    const order = await t.createOrder({ technician: t.people.ali })
    const id = order.id as string
    await t.advance(id, 'in_progress')
    expect(await messagesOf(id)).toEqual([])

    await t.submit(t.people.ali, id, { workDone: 'Cleaned indoor unit' })

    const [row, ...rest] = await messagesOf(id)
    expect(rest).toEqual([])
    const [completion] = await t.q<Row>('select * from order_completions where order_id = $1', [id])
    expect(row).toMatchObject({
      order_id: id,
      channel: 'whatsapp',
      phone: MOBILE,
      status: 'not_sent',
      edited_by: null,
      edited_at: null,
      confirmed_by: null,
      confirmed_at: null,
    })
    // The text is built from the order, the completion record and the technician.
    const expected = `Hi Encik Hafiz, Job ${order.order_no} has been completed by Technician Ali at ${when(completion.completed_at)}. Please check and leave feedback. Thank you!`
    expect(row.prepared_body).toBe(expected)
    expect(row.body).toBe(expected)
    expect(completion.technician_id).toBe(t.people.ali)
  })

  it('uses the name of the technician who submitted', async () => {
    const id = await doneOrder({ technician: t.people.bala })
    expect((await messagesOf(id))[0].body).toContain('completed by Technician Bala at')
  })

  it('records a landline customer as a phone message', async () => {
    const id = await doneOrder({ phone: LANDLINE, name: 'Puan Aminah' })
    const [row] = await messagesOf(id)
    expect(row).toMatchObject({ channel: 'phone', phone: LANDLINE, status: 'not_sent' })
    expect(row.body).toMatch(/^Hi Puan Aminah, Job ORDER\d+ has been completed by Technician Ali at /)
  })

  it('writes nothing when the submission fails', async () => {
    const order = await t.createOrder({ technician: t.people.ali })
    const id = order.id as string
    await t.advance(id, 'in_progress')
    await expectRejects(
      t.rpcAs(t.people.ali, 'submit_completion', { p_order_id: id, p_work_done: '  ' }),
      'Describe the work done',
    )
    expect(await messagesOf(id)).toEqual([])
    // Another person's attempt fails too.
    await expectRejects(
      t.rpcAs(t.people.bala, 'submit_completion', { p_order_id: id, p_work_done: 'Done' }),
      'Only the assigned technician',
    )
    expect(await messagesOf(id)).toEqual([])
  })

  it('writes a new message on every Job Done, so a rework resubmission has its own', async () => {
    const id = await doneOrder()
    const [first] = await messagesOf(id)
    await rework(id)

    const rows = await messagesOf(id)
    expect(rows).toHaveLength(2)
    expect(rows[0].id).toBe(first.id)
    expect(rows[0].status).toBe('not_sent') // the earlier one stays in the history
    expect(rows[1]).toMatchObject({ status: 'not_sent', channel: 'whatsapp' })
    expect(rows[1].id).not.toBe(first.id)

    const [completion] = await t.q<Row>('select * from order_completions where order_id = $1', [id])
    expect(rows[1].body).toContain(`at ${when(completion.completed_at)}.`)
    expect((await latestOf(id)).id).toBe(rows[1].id)
  })

  it('does not write a message for other status changes', async () => {
    const id = await doneOrder()
    expect(await messagesOf(id)).toHaveLength(1)
    await t.tellCustomer(id)
    await t.transition(t.people.managerSA, id, 'reviewed')
    expect(await messagesOf(id)).toHaveLength(1)
    await t.pay(t.people.finance, id, 250)
    await t.transition(t.people.finance, id, 'closed')
    expect(await messagesOf(id)).toHaveLength(1)

    const open = await t.createOrder({ technician: t.people.ali })
    await t.advance(open.id as string, 'in_progress')
    expect(await messagesOf(open.id as string)).toEqual([])
  })

  it('keeps the table consistent: WhatsApp only for a mobile, each status on its own channel, who and when together', async () => {
    const id = await doneOrder()
    const insert = (channel: string, phone: string, status = 'not_sent', confirmed = false) =>
      t.q(
        `insert into customer_messages (order_id, channel, phone, prepared_body, body, status, confirmed_by, confirmed_at)
         values ($1, $2, $3, 'x', 'x', $4, $5, $6)`,
        [id, channel, phone, status, confirmed ? t.people.ali : null, confirmed ? new Date().toISOString() : null],
      )
    await expectRejects(insert('whatsapp', LANDLINE), 'customer_messages_channel_phone_check')
    await expectRejects(insert('phone', MOBILE), 'customer_messages_channel_phone_check')
    await expectRejects(insert('sms', MOBILE), 'customer_messages_channel_check')
    await expectRejects(insert('whatsapp', MOBILE, 'delivered', true), /customer_messages_status(_channel)?_check/)
    await expectRejects(insert('whatsapp', MOBILE, 'told_by_phone', true), 'customer_messages_status_channel_check')
    await expectRejects(insert('phone', LANDLINE, 'sent', true), 'customer_messages_status_channel_check')
    await expectRejects(insert('whatsapp', MOBILE, 'sent', false), 'customer_messages_confirmed_check')
    await expectRejects(insert('whatsapp', MOBILE, 'not_sent', true), 'customer_messages_confirmed_check')
    await expectRejects(
      t.q(`update customer_messages set edited_by = $2 where order_id = $1`, [id, t.people.ali]),
      'customer_messages_edited_check',
    )
    expect(await messagesOf(id)).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Orders that were already done before this feature
// ---------------------------------------------------------------------------
describe('Existing orders get a message when the migration runs (backfill)', () => {
  it('prepares a not_sent message for every Job Done, Reviewed and Closed order with a completion record', async () => {
    // 0004 builds on the 0003 tables, so it is held back too and runs after.
    const L = await createTestDb({ holdBackMigrations: ['20261023000001', '20261023000002'] })
    try {
      const order = (opts: Parameters<TestDb['createOrder']>[0]) => L.createOrder(opts).then((o) => o.id as string)
      const done = await order({ technician: L.people.ali })
      await L.advance(done, 'job_done')
      const reviewed = await order({ technician: L.people.bala })
      await L.advance(reviewed, 'reviewed')
      const closed = await order({ technician: L.people.john, branch: 'Kuala Lumpur', customerName: 'Cik Mei Ling' })
      await L.closeOrder(closed)
      const landline = await order({ technician: L.people.yusoff, customerPhone: LANDLINE, customerName: 'Puan Aminah' })
      await L.advance(landline, 'job_done')
      // Not past Job Done yet, or cancelled: no message.
      const inProgress = await order({ technician: L.people.ali })
      await L.advance(inProgress, 'in_progress')
      const assigned = await order({ technician: L.people.ali })
      const fresh = await order({})
      const cancelled = await order({})
      await L.transition(L.people.admin, cancelled, 'cancelled', 'Customer cancelled')
      // Reworked: Job Done again, so one record (the latest completion).
      const reworked = await order({ technician: L.people.ali })
      await L.advance(reworked, 'job_done')
      await L.transition(L.people.managerSA, reworked, 'in_progress', 'Redo')
      await L.submit(L.people.ali, reworked, { workDone: 'Redone' })

      expect((await L.q(`select to_regclass('customer_messages') as t`))[0].t).toBeNull()
      await L.applyMigration('20261023000001')
      await L.applyMigration('20261023000002')

      const rows = await L.q<Row>('select * from customer_messages order by order_id')
      expect(rows.map((r) => r.order_id).sort()).toEqual([done, reviewed, closed, landline, reworked].sort())
      expect(rows.every((r) => r.status === 'not_sent' && r.confirmed_by === null && r.edited_by === null)).toBe(true)
      for (const id of [inProgress, assigned, fresh, cancelled]) {
        expect(rows.find((r) => r.order_id === id)).toBeUndefined()
      }

      // Each message uses that order's completion time and technician.
      for (const [id, tech, customer, channel, phone] of [
        [done, 'Ali', 'Encik Hafiz', 'whatsapp', MOBILE],
        [reviewed, 'Bala', 'Encik Hafiz', 'whatsapp', MOBILE],
        [closed, 'John', 'Cik Mei Ling', 'whatsapp', MOBILE],
        [landline, 'Yusoff', 'Puan Aminah', 'phone', LANDLINE],
        [reworked, 'Ali', 'Encik Hafiz', 'whatsapp', MOBILE],
      ]) {
        const row = rows.find((r) => r.order_id === id)!
        const [o] = await L.q<Row>('select order_no from orders where id = $1', [id])
        const [c] = await L.q<Row>('select completed_at from order_completions where order_id = $1', [id])
        const text = `Hi ${customer}, Job ${o.order_no} has been completed by Technician ${tech} at ${when(c.completed_at)}. Please check and leave feedback. Thank you!`
        expect(row, id).toMatchObject({ channel, phone, prepared_body: text, body: text })
      }

      // The latest-message view and the new button state work for them straight away.
      const latest = await L.q<Row>('select order_id, status from latest_customer_messages')
      expect(latest).toHaveLength(5)
      // New Job Done submissions after the migration still get their message.
      const later = await order({ technician: L.people.ali })
      await L.advance(later, 'job_done')
      expect(await L.q('select 1 from customer_messages where order_id = $1', [later])).toHaveLength(1)
      // The backfilled message can be confirmed like any other.
      const [mine] = rows.filter((r) => r.order_id === done)
      const sent = await L.rpcAs(L.people.admin, 'confirm_customer_message', { p_message_id: mine.id })
      expect(sent).toMatchObject({ status: 'sent', confirmed_by: L.people.admin })
    } finally {
      await L.close()
    }
  })
})

// ---------------------------------------------------------------------------
// edit_customer_message
// ---------------------------------------------------------------------------
describe('edit_customer_message', () => {
  it('lets the assigned technician change the text; the prepared text is kept', async () => {
    const id = await doneOrder()
    const [msg] = await messagesOf(id)
    const row = await edit(t.people.ali, msg.id, '  Hi Encik Hafiz, your aircond job is done. Please give us feedback!  ')
    expect(row).toMatchObject({
      id: msg.id,
      body: 'Hi Encik Hafiz, your aircond job is done. Please give us feedback!',
      prepared_body: msg.prepared_body,
      edited_by: t.people.ali,
      status: 'not_sent',
      confirmed_by: null,
    })
    expect(row.edited_at).not.toBeNull()
    const view = await latestOf(id)
    expect(view).toMatchObject({ edited_by: t.people.ali, edited_by_name: 'Ali', body: row.body })
  })

  it('lets an Admin edit it, and the latest editor is shown', async () => {
    const id = await doneOrder()
    const [msg] = await messagesOf(id)
    await edit(t.people.ali, msg.id, 'First version')
    await edit(t.people.admin2, msg.id, 'Second version')
    expect(await latestOf(id)).toMatchObject({
      body: 'Second version',
      edited_by: t.people.admin2,
      edited_by_name: 'Farid Hakim',
      prepared_body: msg.prepared_body,
    })
  })

  it('keeps line breaks and accepts exactly 1,000 characters', async () => {
    const id = await doneOrder()
    const [msg] = await messagesOf(id)
    expect((await edit(t.people.ali, msg.id, 'Line one\n\nLine two')).body).toBe('Line one\n\nLine two')
    expect((await edit(t.people.ali, msg.id, 'a'.repeat(1000))).body).toHaveLength(1000)
    expect((await edit(t.people.ali, msg.id, `\n ${'😀'.repeat(1000)} \n`)).body).toBe('😀'.repeat(1000))
  })

  it('rejects an empty or too long text and changes nothing', async () => {
    const id = await doneOrder()
    const [msg] = await messagesOf(id)
    for (const body of ['', '   ', '\n\t ', null]) {
      await expectRejects(edit(t.people.ali, msg.id, body), 'Enter the message to send')
    }
    await expectRejects(edit(t.people.ali, msg.id, 'a'.repeat(1001)), 'The message can be at most 1,000 characters')
    await expectRejects(edit(t.people.ali, msg.id, '😀'.repeat(1001)), 'The message can be at most 1,000 characters')
    expect((await messagesOf(id))[0]).toMatchObject({ body: msg.body, edited_by: null, edited_at: null })
    expect(await auditOf(id, 'customer_message_edited')).toEqual([])
  })

  it('writes an audit entry with the previous and new text', async () => {
    const id = await doneOrder()
    const [msg] = await messagesOf(id)
    await edit(t.people.ali, msg.id, 'Version A')
    await edit(t.people.admin, msg.id, 'Version B')
    const entries = await auditOf(id, 'customer_message_edited')
    expect(entries.map((e) => [e.actor_id, e.actor_role, e.from_status, e.to_status])).toEqual([
      [t.people.ali, 'technician', null, null],
      [t.people.admin, 'admin', null, null],
    ])
    expect(entries[0].details).toMatchObject({
      message_id: msg.id,
      previous_body: msg.body,
      new_body: 'Version A',
      status: 'job_done',
    })
    expect(entries[1].details).toMatchObject({ previous_body: 'Version A', new_body: 'Version B' })
  })

  it('is rejected for another technician, a Manager, Finance and signed-out callers', async () => {
    const id = await doneOrder()
    const [msg] = await messagesOf(id)
    for (const who of [t.people.bala, t.people.john, t.people.managerKL, t.people.finance]) {
      await expectRejects(
        edit(who, msg.id, 'Not mine'),
        'Only the assigned technician, an Admin or a Manager of the branch can send the customer message of an order',
      )
    }
    // 0004: the branch's Manager may send it, but not edit it.
    await expectRejects(
      edit(t.people.managerSA, msg.id, 'Not mine'),
      'Managers send the prepared message as it is; only the assigned technician or an Admin can edit it',
    )
    await expectRejects(edit(SIGNED_OUT, msg.id, 'Not mine'), /permission denied/i)
    await expectRejects(edit({ role: 'authenticated', sub: null }, msg.id, 'Not mine'), 'You must be signed in')
    expect((await messagesOf(id))[0]).toMatchObject({ body: msg.body, edited_by: null })
    expect(await auditOf(id, 'customer_message_edited')).toEqual([])
  })

  it('is rejected for an unknown message', async () => {
    await expectRejects(edit(t.people.admin, '00000000-0000-4000-8000-000000000000', 'Hi'), 'Message not found')
  })

  it('works while the order is Job Done, Reviewed or Closed', async () => {
    for (const status of ['job_done', 'reviewed', 'closed'] as const) {
      const id = await doneOrder({ status })
      const msg = status === 'job_done' ? (await messagesOf(id))[0] : await unsentMessageOn(id)
      expect((await edit(t.people.ali, msg.id, `Edited in ${status}`)).body).toBe(`Edited in ${status}`)
    }
  })

  it('is rejected while the order is back In Progress for rework', async () => {
    const id = await doneOrder()
    const [msg] = await messagesOf(id)
    await t.transition(t.people.managerSA, id, 'in_progress', 'Please redo')
    await expectRejects(
      edit(t.people.ali, msg.id, 'Too late'),
      'A customer message can only be edited while the order is Job Done, Reviewed or Closed (it is currently In Progress)',
    )
    expect((await messagesOf(id))[0].body).toBe(msg.body)
  })

  it('is rejected for an older message once a newer one exists', async () => {
    const id = await doneOrder()
    const [first] = await messagesOf(id)
    await rework(id)
    await expectRejects(
      edit(t.people.ali, first.id, 'Old text'),
      'A newer message has been prepared for this order. Reload the page to see it.',
    )
    const [, second] = await messagesOf(id)
    expect((await edit(t.people.ali, second.id, 'New text')).body).toBe('New text')
    expect((await messagesOf(id))[0].body).toBe(first.body)
  })

  it('is rejected for a landline customer, who is called instead', async () => {
    const id = await doneOrder({ phone: LANDLINE })
    const [msg] = await messagesOf(id)
    await expectRejects(edit(t.people.ali, msg.id, 'Text'), 'Only a WhatsApp message can be edited')
    expect((await messagesOf(id))[0].body).toBe(msg.body)
  })

  it('is rejected once the message is confirmed, and the text never changes again', async () => {
    const id = await doneOrder()
    const [msg] = await messagesOf(id)
    const sent = await confirm(t.people.ali, msg.id)
    await expectRejects(edit(t.people.admin, msg.id, 'Changed after sending'), `Already sent by Ali at ${when(sent.confirmed_at)}`)
    await expectRejects(edit(t.people.ali, msg.id, 'Changed after sending'), 'Already sent by Ali at')
    expect((await messagesOf(id))[0]).toMatchObject({ body: msg.body, edited_by: null })
  })
})

// ---------------------------------------------------------------------------
// confirm_customer_message
// ---------------------------------------------------------------------------
describe('confirm_customer_message', () => {
  it('marks a WhatsApp message sent by the assigned technician, with who and when', async () => {
    const id = await doneOrder()
    const [msg] = await messagesOf(id)
    const row = await confirm(t.people.ali, msg.id)
    expect(row).toMatchObject({ id: msg.id, status: 'sent', confirmed_by: t.people.ali, body: msg.body })
    expect(row.confirmed_at).not.toBeNull()
    expect(await latestOf(id)).toMatchObject({
      status: 'sent',
      confirmed_by: t.people.ali,
      confirmed_by_name: 'Ali',
    })
  })

  it('lets an Admin confirm it from the order page', async () => {
    const id = await doneOrder()
    const [msg] = await messagesOf(id)
    expect(await confirm(t.people.admin, msg.id)).toMatchObject({ status: 'sent', confirmed_by: t.people.admin })
    expect(await latestOf(id)).toMatchObject({ confirmed_by_name: 'Aisyah Rahman' })
  })

  it('marks a landline customer told by phone', async () => {
    const id = await doneOrder({ phone: LANDLINE })
    const [msg] = await messagesOf(id)
    expect(await confirm(t.people.ali, msg.id)).toMatchObject({ status: 'told_by_phone', confirmed_by: t.people.ali })
  })

  it('writes an audit entry the order history can show', async () => {
    const wa = await doneOrder()
    const [waMsg] = await messagesOf(wa)
    await edit(t.people.ali, waMsg.id, 'Edited text')
    await confirm(t.people.admin, waMsg.id)
    const [sent] = await auditOf(wa, 'customer_messaged')
    expect(sent).toMatchObject({ actor_id: t.people.admin, actor_role: 'admin', from_status: null, to_status: null })
    expect(sent.details).toMatchObject({
      message_id: waMsg.id,
      channel: 'whatsapp',
      phone: MOBILE,
      body: 'Edited text',
      edited: true,
      status: 'job_done',
    })
    expect(await auditOf(wa, 'customer_called')).toEqual([])

    const ph = await doneOrder({ phone: LANDLINE })
    const [phMsg] = await messagesOf(ph)
    await confirm(t.people.ali, phMsg.id)
    const [called] = await auditOf(ph, 'customer_called')
    expect(called).toMatchObject({ actor_id: t.people.ali, actor_role: 'technician' })
    expect(called.details).toMatchObject({ message_id: phMsg.id, channel: 'phone', phone: LANDLINE, edited: false })
    expect(await auditOf(ph, 'customer_messaged')).toEqual([])
  })

  it('accepts only the first confirmation: the second gets "Already sent by X at T"', async () => {
    const id = await doneOrder()
    const [msg] = await messagesOf(id)
    const first = await confirm(t.people.ali, msg.id)
    const at = when(first.confirmed_at)
    await expectRejects(confirm(t.people.admin, msg.id), `Already sent by Ali at ${at}`)
    await expectRejects(confirm(t.people.ali, msg.id), `Already sent by Ali at ${at}`)
    expect((await messagesOf(id))[0]).toMatchObject({ confirmed_by: t.people.ali, status: 'sent' })
    expect(iso((await messagesOf(id))[0].confirmed_at)).toBe(iso(first.confirmed_at))
    expect(await auditOf(id, 'customer_messaged')).toHaveLength(1)
  })

  it('says "Already told by phone by X at T" for a landline message', async () => {
    const id = await doneOrder({ phone: LANDLINE })
    const [msg] = await messagesOf(id)
    const first = await confirm(t.people.admin, msg.id)
    await expectRejects(
      confirm(t.people.ali, msg.id),
      `Already told by phone by Aisyah Rahman at ${when(first.confirmed_at)}`,
    )
    expect(await auditOf(id, 'customer_called')).toHaveLength(1)
  })

  it('lets exactly one of two simultaneous confirmations through', async () => {
    const id = await doneOrder()
    const [msg] = await messagesOf(id)
    const results = await Promise.allSettled([confirm(t.people.ali, msg.id), confirm(t.people.admin, msg.id)])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect((failed.reason as Error).message).toMatch(/^Already sent by (Ali|Aisyah Rahman) at /)
    expect(await auditOf(id, 'customer_messaged')).toHaveLength(1)
  })

  it('is rejected for another technician, a Manager, Finance and signed-out callers', async () => {
    const id = await doneOrder()
    const [msg] = await messagesOf(id)
    for (const who of [t.people.bala, t.people.john, t.people.managerKL, t.people.finance]) {
      await expectRejects(
        confirm(who, msg.id),
        'Only the assigned technician, an Admin or a Manager of the branch can send the customer message of an order',
      )
    }
    await expectRejects(confirm(SIGNED_OUT, msg.id), /permission denied/i)
    await expectRejects(confirm({ role: 'authenticated', sub: null }, msg.id), 'You must be signed in')
    expect((await messagesOf(id))[0]).toMatchObject({ status: 'not_sent', confirmed_by: null, confirmed_at: null })
    expect(await auditOf(id, 'customer_messaged', 'customer_called')).toEqual([])
  })

  it('is rejected for an unknown message', async () => {
    await expectRejects(confirm(t.people.admin, '00000000-0000-4000-8000-000000000000'), 'Message not found')
  })

  it('works while the order is Reviewed or Closed', async () => {
    for (const status of ['reviewed', 'closed'] as const) {
      const id = await doneOrder({ status })
      const msg = await unsentMessageOn(id)
      expect((await confirm(t.people.ali, msg.id)).status).toBe('sent')
    }
  })

  it('is rejected while the order is back In Progress for rework', async () => {
    const id = await doneOrder()
    const [msg] = await messagesOf(id)
    await t.transition(t.people.managerSA, id, 'in_progress', 'Please redo')
    await expectRejects(
      confirm(t.people.ali, msg.id),
      'A customer message can only be confirmed while the order is Job Done, Reviewed or Closed (it is currently In Progress)',
    )
    expect((await messagesOf(id))[0].status).toBe('not_sent')
    // After the resubmission the new message is the one to confirm.
    await t.submit(t.people.ali, id, { workDone: 'Redone' })
    const [, second] = await messagesOf(id)
    expect((await confirm(t.people.ali, second.id)).status).toBe('sent')
  })

  it('is rejected for an older message once a newer one exists', async () => {
    const id = await doneOrder()
    const [first] = await messagesOf(id)
    await rework(id)
    await expectRejects(
      confirm(t.people.ali, first.id),
      'A newer message has been prepared for this order. Reload the page to see it.',
    )
    expect((await messagesOf(id))[0].status).toBe('not_sent')
    expect(await auditOf(id, 'customer_messaged')).toEqual([])
  })

  it('offers the button again after a rework even when the first message was sent', async () => {
    const id = await doneOrder()
    const [first] = await messagesOf(id)
    await confirm(t.people.ali, first.id)
    await rework(id)
    const rows = await messagesOf(id)
    expect(rows.map((r) => r.status)).toEqual(['sent', 'not_sent'])
    expect(await latestOf(id)).toMatchObject({ id: rows[1].id, status: 'not_sent' })
    expect((await confirm(t.people.admin, rows[1].id)).status).toBe('sent')
    expect((await messagesOf(id)).map((r) => r.status)).toEqual(['sent', 'sent'])
  })

  it('has no undo: a confirmed message cannot be changed or deleted, even by the database owner', async () => {
    const id = await doneOrder()
    const [msg] = await messagesOf(id)
    await confirm(t.people.ali, msg.id)
    for (const sql of [
      `update customer_messages set status = 'not_sent', confirmed_by = null, confirmed_at = null where id = $1`,
      `update customer_messages set body = 'Changed' where id = $1`,
    ]) {
      await expectRejects(t.q(sql, [msg.id]), 'A confirmed customer message cannot be changed')
    }
    await expectRejects(t.q('delete from customer_messages where id = $1', [msg.id]), 'Customer messages cannot be deleted')
    expect((await messagesOf(id))[0]).toMatchObject({ status: 'sent', confirmed_by: t.people.ali, body: msg.body })

    // An unsent message cannot have its prepared text, number or channel rewritten either.
    const open = await doneOrder()
    const [fresh] = await messagesOf(open)
    await expectRejects(
      t.q(`update customer_messages set prepared_body = 'Other' where id = $1`, [fresh.id]),
      'Only the text and the confirmation of a customer message can change',
    )
    await expectRejects(t.q('delete from customer_messages where id = $1', [fresh.id]), 'Customer messages cannot be deleted')
  })
})

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------
describe('Who can read customer messages (row-level security)', () => {
  let aliOrder: string
  let balaOrder: string
  let reworked: string
  beforeAll(async () => {
    aliOrder = await doneOrder({ technician: t.people.ali })
    balaOrder = await doneOrder({ technician: t.people.bala })
    reworked = await doneOrder({ technician: t.people.ali })
    await rework(reworked)
  })

  const idsFor = async (actor: string, table: string) =>
    (await t.qAs<{ order_id: string }>(actor, `select order_id from ${table}`)).map((r) => r.order_id)

  it('lets the assigned technician read their own messages and nobody else’s', async () => {
    const own = await idsFor(t.people.ali, 'customer_messages')
    expect(own).toEqual(expect.arrayContaining([aliOrder, reworked]))
    expect(own).not.toContain(balaOrder)
    expect(own.filter((id) => id === reworked)).toHaveLength(2) // the history stays readable
    expect(await t.qAs(t.people.ali, 'select 1 from customer_messages where order_id = $1', [balaOrder])).toEqual([])
    expect(await idsFor(t.people.yusoff, 'customer_messages')).toEqual([])
    const bala = await idsFor(t.people.bala, 'customer_messages')
    expect(bala).toContain(balaOrder)
    expect(bala).not.toContain(aliOrder)
  })

  it('lets every Admin read all messages', async () => {
    const total = (await t.q<{ n: number }>('select count(*)::int as n from customer_messages'))[0].n
    for (const admin of [t.people.admin, t.people.admin2]) {
      expect(await idsFor(admin, 'customer_messages')).toHaveLength(total)
    }
  })

  it('lets Finance read all messages and a Manager those of the branches they cover (0004)', async () => {
    const total = (await t.q<{ n: number }>('select count(*)::int as n from customer_messages'))[0].n
    expect(await idsFor(t.people.finance, 'customer_messages')).toHaveLength(total)
    // The fixture orders are all in Shah Alam.
    expect(await idsFor(t.people.managerSA, 'customer_messages')).toEqual(
      expect.arrayContaining([aliOrder, balaOrder, reworked]),
    )
    expect(await idsFor(t.people.managerSA, 'latest_customer_messages')).toEqual(
      expect.arrayContaining([aliOrder, balaOrder, reworked]),
    )
    for (const who of [t.people.managerKL, t.people.managerPG]) {
      const seen = await idsFor(who, 'customer_messages')
      for (const id of [aliOrder, balaOrder, reworked]) expect(seen).not.toContain(id)
    }
  })

  it('gives signed-out visitors nothing, and an unlinked sign-in nothing', async () => {
    await expectRejects(t.qAs(SIGNED_OUT, 'select * from customer_messages'), /permission denied/i)
    await expectRejects(t.qAs(SIGNED_OUT, 'select * from latest_customer_messages'), /permission denied/i)
    expect(await t.qAs({ role: 'authenticated', sub: null }, 'select * from customer_messages')).toEqual([])
    const stranger = { role: 'authenticated' as const, sub: await t.createAuthUser('whatsapp-outsider@example.com') }
    expect(await t.qAs(stranger, 'select * from customer_messages')).toEqual([])
    expect(await t.qAs(stranger, 'select * from latest_customer_messages')).toEqual([])
  })

  it('latest_customer_messages returns the newest message of each order, with names', async () => {
    const rows = await t.qAs<Row>(t.people.admin, 'select * from latest_customer_messages where order_id = any($1::uuid[])', [
      [aliOrder, balaOrder, reworked],
    ])
    expect(rows).toHaveLength(3)
    const newest = (await messagesOf(reworked))[1]
    expect(rows.find((r) => r.order_id === reworked)!.id).toBe(newest.id)

    // Names come with the row: the editor's and the confirmer's.
    const [msg] = await messagesOf(aliOrder)
    await edit(t.people.ali, msg.id, 'Hello again')
    await confirm(t.people.admin, msg.id)
    const [row] = await t.qAs<Row>(t.people.ali, 'select * from latest_customer_messages where order_id = $1', [aliOrder])
    expect(row).toMatchObject({
      id: msg.id,
      status: 'sent',
      edited_by_name: 'Ali',
      confirmed_by_name: 'Aisyah Rahman',
      body: 'Hello again',
      prepared_body: msg.prepared_body,
      channel: 'whatsapp',
      phone: MOBILE,
    })
    // The technician sees only their own orders through the view as well.
    expect(await idsFor(t.people.ali, 'latest_customer_messages')).not.toContain(balaOrder)
    expect(await idsFor(t.people.ali, 'latest_customer_messages')).toContain(aliOrder)
  })

  it('cannot be changed directly by any role', async () => {
    const [msg] = await messagesOf(balaOrder)
    for (const who of [t.people.admin, t.people.bala, t.people.finance]) {
      await expectRejects(t.qAs(who, `update customer_messages set status = 'sent' where id = $1`, [msg.id]), /permission denied/i)
      await expectRejects(t.qAs(who, 'delete from customer_messages where id = $1', [msg.id]), /permission denied/i)
    }
    expect((await messagesOf(balaOrder))[0].status).toBe('not_sent')
  })
})
