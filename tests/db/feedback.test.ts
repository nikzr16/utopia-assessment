import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SIGNED_OUT, createTestDb, expectRejects, type Actor, type Row, type TestDb } from './helpers'

// 0005 database functions: the feedback token on each WhatsApp Job Done
// message, the fixed link line, the customer page (signed out), ratings taken
// by phone, the poor-rating notice, and who can read feedback.

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

const LANDLINE = '60312345678'
const TOKEN = /^[A-Za-z0-9_-]{22}$/

/** An order moved to Job Done (or further) by `technician`. */
async function doneOrder(
  opts: { technician?: string; phone?: string; branch?: string; status?: 'job_done' | 'reviewed' | 'closed' } = {},
): Promise<string> {
  const order = await t.createOrder({
    technician: opts.technician ?? t.people.ali,
    customerPhone: opts.phone,
    branch: opts.branch,
  })
  const id = order.id as string
  if (opts.status === 'closed') await t.closeOrder(id)
  else await t.advance(id, opts.status ?? 'job_done')
  return id
}

const messagesOf = (orderId: string) =>
  t.q<Row>('select * from customer_messages where order_id = $1 order by created_at, id', [orderId])

const latestOf = async (orderId: string): Promise<Row> =>
  (await t.q<Row>('select * from latest_customer_messages where order_id = $1', [orderId]))[0]

const tokenOf = async (orderId: string): Promise<string> => (await latestOf(orderId)).feedback_url!.toString().split('/f/')[1]

const form = (token: string, actor: Actor = SIGNED_OUT) => t.rpcAs<Row>(actor, 'feedback_form', { p_token: token })

const submit = (
  token: string,
  answers: { rating?: unknown; working?: unknown; comment?: unknown } = {},
  actor: Actor = SIGNED_OUT,
) =>
  t
    .rpcAs<Row>(actor, 'submit_feedback', {
      p_token: token,
      p_rating: answers.rating === undefined ? 5 : answers.rating,
      p_working_well: answers.working === undefined ? true : answers.working,
      p_comment: answers.comment ?? null,
    })
    .then((r) => r.submit_feedback)

const recordByPhone = (
  actor: Actor,
  messageId: unknown,
  answers: { rating?: number; working?: boolean; comment?: string | null } = {},
) =>
  t.rpcAs<Row>(actor, 'record_phone_feedback', {
    p_message_id: messageId,
    p_rating: answers.rating ?? 4,
    p_working_well: answers.working ?? true,
    p_comment: answers.comment ?? null,
  })

const feedbackOf = (orderId: string) =>
  t.q<Row>('select * from customer_feedback where order_id = $1 order by created_at', [orderId])

/** Move a message's Job Done time into the past (the guard is paused, as the cleanup script does). */
async function age(messageId: unknown, days: number) {
  await t.q('alter table customer_messages disable trigger customer_messages_guard_trg')
  try {
    await t.q(`update customer_messages set created_at = now() - $2::numeric * interval '1 day' where id = $1`, [
      messageId,
      days,
    ])
  } finally {
    await t.q('alter table customer_messages enable trigger customer_messages_guard_trg')
  }
}

async function rework(orderId: string) {
  await t.transition(t.people.managerSA, orderId, 'in_progress', 'Still leaking')
  await t.submit(t.people.ali, orderId, { workDone: 'Fixed the leak' })
}

// ---------------------------------------------------------------------------
// The link in the message
// ---------------------------------------------------------------------------
describe('Feedback link in the Job Done message (PRD AC1, AC13)', () => {
  it('gives every WhatsApp Job Done message its own random 22-character token; a landline gets none', async () => {
    const a = await doneOrder()
    const b = await doneOrder()
    const [ma] = await messagesOf(a)
    const [mb] = await messagesOf(b)
    expect(ma.feedback_token).toMatch(TOKEN)
    expect(mb.feedback_token).toMatch(TOKEN)
    expect(ma.feedback_token).not.toBe(mb.feedback_token)

    const landline = await doneOrder({ phone: LANDLINE })
    const [ml] = await messagesOf(landline)
    expect(ml.channel).toBe('phone')
    expect(ml.feedback_token).toBeNull()
    expect(await latestOf(landline)).toMatchObject({ feedback_url: null, full_body: ml.body })
  })

  it('the text sent is the message, a blank line, and "Leave feedback: <address>/f/<token>"', async () => {
    const id = await doneOrder()
    const [m] = await messagesOf(id)
    const latest = await latestOf(id)
    expect(latest.feedback_url).toBe(`http://localhost:5173/f/${m.feedback_token as string}`)
    expect(latest.full_body).toBe(`${m.body as string}\n\nLeave feedback: http://localhost:5173/f/${m.feedback_token as string}`)
  })

  it('editing the message changes only the text above the link line', async () => {
    const id = await doneOrder()
    const [m] = await messagesOf(id)
    await t.rpcAs(t.people.ali, 'edit_customer_message', { p_message_id: m.id, p_body: 'Hi, all done!' })
    const latest = await latestOf(id)
    expect(latest.body).toBe('Hi, all done!')
    expect(latest.full_body).toBe(`Hi, all done!\n\nLeave feedback: ${latest.feedback_url as string}`)
  })

  it('the token never changes', async () => {
    const id = await doneOrder()
    const [m] = await messagesOf(id)
    await expectRejects(
      t.q(`update customer_messages set feedback_token = 'AAAAAAAAAAAAAAAAAAAAAA' where id = $1`, [m.id]),
      'Only the text and the confirmation of a customer message can change',
    )
  })

  it('uses the address setting, and a placeholder when it is missing', async () => {
    const id = await doneOrder()
    const token = await tokenOf(id)
    await t.q(`update app_settings set value = 'https://sejuk.example.com/' where key = 'feedback_link_base'`)
    expect((await latestOf(id)).feedback_url).toBe(`https://sejuk.example.com/f/${token}`)
    await t.q(`delete from app_settings where key = 'feedback_link_base'`)
    try {
      expect((await latestOf(id)).feedback_url).toBe(`https://feedback-address-not-set.invalid/f/${token}`)
    } finally {
      await t.q(`insert into app_settings (key, value) values ('feedback_link_base', 'http://localhost:5173')`)
    }
  })

  it('a rework resubmission prepares a new message with a new token (PRD AC6)', async () => {
    const id = await doneOrder()
    const first = await tokenOf(id)
    await t.tellCustomer(id)
    await rework(id)
    const second = await tokenOf(id)
    expect(second).toMatch(TOKEN)
    expect(second).not.toBe(first)
  })
})

// ---------------------------------------------------------------------------
// The customer page
// ---------------------------------------------------------------------------
describe('feedback_form: what a signed-out visitor sees (PRD AC2, AC5)', () => {
  it('an open link shows only the order number, service type, technician and Job Done time', async () => {
    const id = await doneOrder()
    const [m] = await messagesOf(id)
    const [o] = await t.q<Row>('select order_no from orders where id = $1', [id])
    const row = await form(m.feedback_token as string)
    expect(Object.keys(row).sort()).toEqual(['job_done_at', 'order_no', 'service_type', 'state', 'technician_name'])
    expect(row).toMatchObject({ state: 'open', order_no: o.order_no, service_type: 'Repair', technician_name: 'Ali' })
    expect(new Date(row.job_done_at as string).toISOString()).toBe(new Date(m.created_at as string).toISOString())
  })

  it('unknown or malformed links are not_found and reveal nothing', async () => {
    for (const token of ['AAAAAAAAAAAAAAAAAAAAAA', 'short', '', "x' or 1=1 --", 'A'.repeat(23)]) {
      expect(await form(token), token).toEqual({
        state: 'not_found',
        order_no: null,
        service_type: null,
        technician_name: null,
        job_done_at: null,
      })
    }
  })

  it('a link stops working 7 days after Job Done', async () => {
    const id = await doneOrder()
    const [m] = await messagesOf(id)
    await age(m.id, 6.9)
    expect((await form(m.feedback_token as string)).state).toBe('open')
    await age(m.id, 7)
    expect(await form(m.feedback_token as string)).toMatchObject({ state: 'expired', order_no: null })
    await expectRejects(submit(m.feedback_token as string), 'This feedback link has expired')
    expect(await feedbackOf(id)).toEqual([])
  })

  it('a link is replaced while the job is reworked and once a newer visit exists', async () => {
    const id = await doneOrder()
    const old = await tokenOf(id)
    await t.tellCustomer(id)
    await t.transition(t.people.managerSA, id, 'in_progress', 'Still leaking')
    expect((await form(old)).state).toBe('replaced')
    await t.submit(t.people.ali, id, { workDone: 'Fixed' })
    expect((await form(old)).state).toBe('replaced')
    await expectRejects(submit(old), 'This feedback link is no longer active')
    expect((await form(await tokenOf(id))).state).toBe('open')
  })

  it('works the same for a signed-in staff member', async () => {
    const id = await doneOrder()
    expect((await form(await tokenOf(id), t.people.john)).state).toBe('open')
  })
})

describe('submit_feedback: one submission per visit (PRD AC3, AC4, AC11)', () => {
  it('stores the answers with the technician and branch, then the link reads as submitted', async () => {
    const id = await doneOrder()
    const [m] = await messagesOf(id)
    const token = m.feedback_token as string
    expect(await submit(token, { rating: 4, working: true, comment: '  Very tidy, thank you \n' })).toBe('submitted')
    const [o] = await t.q<Row>('select branch_id from orders where id = $1', [id])
    const [f] = await feedbackOf(id)
    expect(f).toMatchObject({
      message_id: m.id,
      order_id: id,
      technician_id: t.people.ali,
      branch_id: o.branch_id,
      rating: 4,
      working_well: true,
      comment: 'Very tidy, thank you',
      source: 'link',
      recorded_by: null,
    })
    expect((await form(token)).state).toBe('submitted')
    expect((await form(token)).order_no).not.toBeNull()
  })

  it('a second submission is rejected with "already received" and stores nothing', async () => {
    const id = await doneOrder()
    const token = await tokenOf(id)
    await submit(token, { rating: 5 })
    await expectRejects(submit(token, { rating: 1 }), 'we have already received your feedback')
    expect(await feedbackOf(id)).toHaveLength(1)
    // The table itself allows one row per visit.
    const [f] = await feedbackOf(id)
    await expectRejects(
      t.q(
        `insert into customer_feedback (message_id, order_id, branch_id, rating, working_well, source)
         values ($1, $2, $3, 1, false, 'link')`,
        [f.message_id, id, f.branch_id],
      ),
      /customer_feedback_message_key/,
    )
  })

  it('checks the answers: 1-5 stars, Yes / No required, comment at most 1,000 characters', async () => {
    const id = await doneOrder()
    const token = await tokenOf(id)
    for (const rating of [0, 6, -1, null]) {
      await expectRejects(submit(token, { rating }), 'Choose a rating from 1 to 5 stars')
    }
    await expectRejects(submit(token, { working: null }), 'Tell us whether your aircon is working well now')
    await expectRejects(submit(token, { comment: 'x'.repeat(1001) }), 'The comment can be at most 1,000 characters')
    expect(await feedbackOf(id)).toEqual([])
    await submit(token, { comment: '😀'.repeat(1000) })
    expect((await feedbackOf(id))[0].comment).toHaveLength(2000) // 1,000 characters, 2,000 UTF-16 units
  })

  it('an empty comment is stored as none', async () => {
    const id = await doneOrder()
    await submit(await tokenOf(id), { comment: '   \n ' })
    expect((await feedbackOf(id))[0].comment).toBeNull()
  })

  it('an unknown link is rejected', async () => {
    await expectRejects(submit('AAAAAAAAAAAAAAAAAAAAAA'), 'This feedback link is not valid')
    await expectRejects(submit('nope'), 'This feedback link is not valid')
  })

  it('feedback never blocks Approve or Close, and is still accepted after Close (PRD AC12)', async () => {
    const id = await doneOrder({ status: 'closed' })
    expect((await t.summary(id)).status).toBe('closed')
    expect(await submit(await tokenOf(id), { rating: 3 })).toBe('submitted')
  })

  it('a rework keeps every visit\'s feedback', async () => {
    const id = await doneOrder()
    await submit(await tokenOf(id), { rating: 2, working: false, comment: 'Still leaking' })
    await t.tellCustomer(id)
    await rework(id)
    await submit(await tokenOf(id), { rating: 5 })
    expect((await feedbackOf(id)).map((f) => f.rating)).toEqual([2, 5])
  })

  it('feedback rows never change and are never deleted', async () => {
    const id = await doneOrder()
    await submit(await tokenOf(id))
    const [f] = await feedbackOf(id)
    await expectRejects(t.q('update customer_feedback set rating = 1 where id = $1', [f.id]), 'Customer feedback cannot be changed')
    await expectRejects(t.q('delete from customer_feedback where id = $1', [f.id]), 'Customer feedback cannot be deleted')
  })
})

// ---------------------------------------------------------------------------
// Poor rating notice
// ---------------------------------------------------------------------------
describe('A poor rating notifies the covering Managers (PRD AC10)', () => {
  const lowNotices = async (orderId: string) =>
    (await t.notifications(orderId)).filter((n) => n.event === 'low_feedback')

  it('1-2 stars or "not working well" notifies every Manager covering the branch, and only them', async () => {
    const sa = await t.branchId('Shah Alam')
    await t.q('update staff set additional_branch_ids = $2::uuid[] where id = $1', [t.people.managerKL, [sa]])
    try {
      const id = await doneOrder()
      const [o] = await t.q<Row>('select order_no from orders where id = $1', [id])
      await submit(await tokenOf(id), { rating: 2, working: true })
      const notices = await lowNotices(id)
      expect(notices.map((n) => n.recipient_id).sort()).toEqual([t.people.managerKL, t.people.managerSA].sort())
      expect(notices[0].message).toBe(`${o.order_no as string}: the customer rated 2/5`)
    } finally {
      await t.q(`update staff set additional_branch_ids = '{}' where id = $1`, [t.people.managerKL])
    }
  })

  it('5 stars but not working well also notifies; 3 stars and working does not', async () => {
    const bad = await doneOrder()
    const [o] = await t.q<Row>('select order_no from orders where id = $1', [bad])
    await submit(await tokenOf(bad), { rating: 5, working: false })
    const [n] = await lowNotices(bad)
    expect(n).toMatchObject({
      recipient_id: t.people.managerSA,
      message: `${o.order_no as string}: the customer rated 5/5 and says the aircon is not working well`,
    })

    const fine = await doneOrder()
    await submit(await tokenOf(fine), { rating: 3, working: true })
    expect(await lowNotices(fine)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Rating taken by phone
// ---------------------------------------------------------------------------
describe('record_phone_feedback: landline customers (PRD AC7)', () => {
  async function toldByPhone(): Promise<{ id: string; messageId: string }> {
    const id = await doneOrder({ phone: LANDLINE })
    const [m] = await messagesOf(id)
    await t.tellCustomer(id)
    return { id, messageId: m.id as string }
  }

  it('an Admin records it; it is marked as taken by phone by them and audited', async () => {
    const { id, messageId } = await toldByPhone()
    const f = await recordByPhone(t.people.admin, messageId, { rating: 3, working: true, comment: ' Okay ' })
    expect(f).toMatchObject({ source: 'phone', recorded_by: t.people.admin, rating: 3, comment: 'Okay', technician_id: t.people.ali })
    const [entry] = (await t.audit(id)).filter((a) => a.action === 'feedback_recorded')
    expect(entry).toMatchObject({ actor_id: t.people.admin, actor_role: 'admin' })
    expect(entry.details).toMatchObject({ rating: 3, working_well: true, comment: 'Okay', message_id: messageId })
  })

  it('a covering Manager records it; a poor one notifies the other covering Managers, not the recorder', async () => {
    const sa = await t.branchId('Shah Alam')
    await t.q('update staff set additional_branch_ids = $2::uuid[] where id = $1', [t.people.managerKL, [sa]])
    try {
      const { id, messageId } = await toldByPhone()
      await recordByPhone(t.people.managerSA, messageId, { rating: 1, working: false })
      const notices = (await t.notifications(id)).filter((n) => n.event === 'low_feedback')
      expect(notices.map((n) => n.recipient_id)).toEqual([t.people.managerKL])
    } finally {
      await t.q(`update staff set additional_branch_ids = '{}' where id = $1`, [t.people.managerKL])
    }
  })

  it('the technician, Finance and a Manager of another branch cannot record it', async () => {
    const { id, messageId } = await toldByPhone()
    for (const actor of [t.people.ali, t.people.finance, t.people.managerKL]) {
      await expectRejects(
        recordByPhone(actor, messageId),
        'Only an Admin or a Manager of Shah Alam can record a rating taken by phone',
      )
    }
    expect(await feedbackOf(id)).toEqual([])
  })

  it('only for a landline customer already told by phone, once per visit', async () => {
    const wa = await doneOrder()
    const [waMsg] = await messagesOf(wa)
    await expectRejects(recordByPhone(t.people.admin, waMsg.id), 'rates the job with their feedback link')

    const notTold = await doneOrder({ phone: LANDLINE })
    const [ntMsg] = await messagesOf(notTold)
    await expectRejects(recordByPhone(t.people.admin, ntMsg.id), 'mark them "Told by phone"')

    const { messageId } = await toldByPhone()
    await recordByPhone(t.people.admin, messageId, { rating: 4 })
    await expectRejects(recordByPhone(t.people.managerSA, messageId), /Already rated 4\/5, taken by phone by Aisyah Rahman at /)
  })

  it('has no 7-day limit, but stops at the next visit', async () => {
    const { id, messageId } = await toldByPhone()
    await age(messageId, 30)
    const late = await toldByPhone()
    await age(late.messageId, 30)
    await recordByPhone(t.people.admin, late.messageId)
    expect(await feedbackOf(late.id)).toHaveLength(1)

    await rework(id)
    await expectRejects(recordByPhone(t.people.admin, messageId), 'A newer visit has been prepared for this order')
  })

  it('needs a sign-in', async () => {
    const { messageId } = await toldByPhone()
    await expectRejects(recordByPhone(SIGNED_OUT, messageId), /permission denied/i)
  })
})

// ---------------------------------------------------------------------------
// Who reads feedback
// ---------------------------------------------------------------------------
describe('Staff read feedback with the order (PRD AC8, AC9)', () => {
  let id: string
  beforeAll(async () => {
    id = await doneOrder()
    await submit(await tokenOf(id), { rating: 2, working: false, comment: 'Water dripping' })
  })

  it('Admins, Finance, the covering Manager and the assigned technician see it in order_feedback', async () => {
    for (const actor of [t.people.admin, t.people.finance, t.people.managerSA, t.people.ali]) {
      const rows = await t.qAs<Row>(actor, 'select * from order_feedback where order_id = $1', [id])
      expect(rows, actor).toHaveLength(1)
      expect(rows[0]).toMatchObject({ rating: 2, working_well: false, comment: 'Water dripping', technician_name: 'Ali', source: 'link', recorded_by_name: null })
      expect(rows[0].job_done_at).not.toBeNull()
    }
  })

  it('another technician and a Manager of another branch see nothing', async () => {
    for (const actor of [t.people.john, t.people.managerKL]) {
      expect(await t.qAs(actor, 'select * from order_feedback where order_id = $1', [id])).toEqual([])
      expect(await t.qAs(actor, 'select * from customer_feedback where order_id = $1', [id])).toEqual([])
    }
  })

  it('signed-out visitors cannot read feedback or settings', async () => {
    for (const rel of ['customer_feedback', 'order_feedback', 'app_settings']) {
      await expectRejects(t.qAs(SIGNED_OUT, `select * from ${rel}`), /permission denied/i)
    }
    await expectRejects(t.qAs(t.people.admin, 'select * from app_settings'), /permission denied/i)
  })

  it('the Manager queue shows the latest visit\'s rating', async () => {
    const reviewed = await doneOrder()
    await submit(await tokenOf(reviewed), { rating: 5, working: true })
    await t.tellCustomer(reviewed)
    await t.transition(t.people.managerSA, reviewed, 'reviewed')
    const rows = await t.qAs<Row>(t.people.managerSA, `select * from manager_orders('reviewed')`)
    expect(rows.find((r) => r.id === reviewed)).toMatchObject({ latest_rating: 5, latest_working_well: true })
    const [summary] = await t.q<Row>('select latest_rating, latest_working_well from order_review_summary where id = $1', [id])
    expect(summary).toEqual({ latest_rating: 2, latest_working_well: false })
  })
})
