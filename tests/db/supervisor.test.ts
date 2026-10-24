import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SERVICE_ROLE, SIGNED_OUT, createTestDb, expectRejects, type Row, type TestDb } from './helpers'

// 0009 Workflow Supervisor: rule warnings at Job Done and after, the AI check
// runs, Managers checking warnings, and the approve guard.

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

const warningsOf = (orderId: string) =>
  t.q<Row>('select * from order_warnings where order_id = $1 order by seq', [orderId])
const live = async (orderId: string) =>
  (await warningsOf(orderId)).filter((w) => w.status !== 'resolved')
const rules = async (orderId: string) => (await live(orderId)).map((w) => w.rule).sort()
const runsOf = (orderId: string) =>
  t.q<Row>('select * from supervisor_runs where order_id = $1 order by created_at, id', [orderId])

/** An order at Job Done with Ali; optional photo (uploaded while In Progress) and extra charges. */
async function jobDone(opts: { price?: number; extra?: number; photo?: boolean; branch?: string } = {}) {
  const order = await t.createOrder({ technician: t.people.ali, quotedPrice: opts.price ?? 250, branch: opts.branch })
  const id = order.id as string
  await t.advance(id, 'in_progress')
  if (opts.photo ?? true) await addPhoto(id)
  await t.submit(t.people.ali, id, { extraCharges: opts.extra ?? 0 })
  return id
}

async function addPhoto(orderId: string) {
  const path = await t.upload(t.people.ali, t.filePath(orderId))
  await t.rpcAs(t.people.ali, 'add_attachment', { p_order_id: orderId, p_storage_path: path })
}

const approve = (orderId: string, actor = t.people.managerSA) =>
  t.rpcAs(actor, 'transition_order', { p_order_id: orderId, p_to_status: 'reviewed' })

const check = (warningId: string, note = 'Called the customer, all fine', actor = t.people.managerSA) =>
  t.rpcAs<Row>(actor, 'check_order_warning', { p_warning_id: warningId, p_note: note })

const returnForRework = (orderId: string) => t.transition(t.people.managerSA, orderId, 'in_progress', 'Redo it')

describe('Rule warnings at Job Done', () => {
  it('flags an amount much higher than the quote and a job with no photo, with plain messages', async () => {
    const id = await jobDone({ price: 350, extra: 630, photo: false })
    const ws = await live(id)
    expect(ws.map((w) => [w.rule, w.source, w.status, w.message]).sort()).toEqual([
      ['no_photo', 'rule', 'open', 'Job Done but no photos uploaded.'],
      ['over_quote', 'rule', 'open', 'Final amount RM 980.00 is 180% above the quoted RM 350.00.'],
    ])
    expect(ws.find((w) => w.rule === 'over_quote')!.facts).toEqual({ quoted: 350, final: 980 })
  })

  it('needs both 50% and RM 100 over the quote', async () => {
    expect(await rules(await jobDone({ price: 200, extra: 99.99 }))).toEqual([])
    expect(await rules(await jobDone({ price: 200, extra: 100 }))).toEqual(['over_quote'])
    // 50% but only RM 50 more; RM 150 more but only 30%.
    expect(await rules(await jobDone({ price: 100, extra: 50 }))).toEqual([])
    expect(await rules(await jobDone({ price: 500, extra: 150 }))).toEqual([])
    const free = await jobDone({ price: 0, extra: 100 })
    expect((await live(free))[0].message).toBe('Final amount RM 100.00 with a quoted price of RM 0.00.')
  })

  it('counts photos only (not videos or PDFs) for the photo rule', async () => {
    const order = await t.createOrder({ technician: t.people.ali })
    const id = order.id as string
    await t.advance(id, 'in_progress')
    const pdf = await t.upload(t.people.ali, t.filePath(id, { ext: 'pdf' }), { mime: 'application/pdf' })
    await t.rpcAs(t.people.ali, 'add_attachment', { p_order_id: id, p_storage_path: pdf })
    await t.submit(t.people.ali, id)
    expect(await rules(id)).toEqual(['no_photo'])
  })

  it('flags 3 or more reschedules', async () => {
    const order = await t.createOrder({ technician: t.people.ali })
    const id = order.id as string
    for (let i = 0; i < 3; i++) {
      await t.rpcAs(t.people.admin, 'reschedule_order', {
        p_order_id: id,
        p_new_scheduled_at: `2026-11-0${i + 2}T02:00:00Z`,
        p_reason: 'customer_not_home',
        p_requested_by: 'customer',
        p_note: null,
      })
    }
    await t.advance(id, 'in_progress')
    await addPhoto(id)
    await t.submit(t.people.ali, id)
    const [w] = await live(id)
    expect([w.rule, w.message]).toEqual(['many_reschedules', 'Rescheduled or postponed 3 times.'])
  })

  it('starts an AI check run at Job Done (pending until the Edge Function picks it up)', async () => {
    const id = await jobDone()
    const runs = await runsOf(id)
    expect(runs.map((r) => [r.trigger, r.status, r.requested_by, r.attempts])).toEqual([['job_done', 'pending', null, 1]])
  })
})

describe('Approve guard and checking warnings', () => {
  it('refuses Approve while a warning is open, allows Return for rework, and approves once all are checked', async () => {
    const id = await jobDone({ price: 350, extra: 630, photo: false })
    await t.tellCustomer(id)
    await expectRejects(approve(id), 'Check every warning before approving (2 open)')

    const [a, b] = await live(id)
    await check(a.id as string)
    await expectRejects(approve(id), 'Check every warning before approving (1 open)')
    const checked = await check(b.id as string, '  Customer   agreed to the new part ')
    expect(checked).toMatchObject({ status: 'checked', checked_by: t.people.managerSA, check_note: 'Customer agreed to the new part' })
    await approve(id)
    expect((await t.summary(id)).status).toBe('reviewed')
    // Checked warnings stay with the order.
    expect((await warningsOf(id)).map((w) => w.status)).toEqual(['checked', 'checked'])
  })

  it('lets only a covering Manager check, only while waiting for review, with a 3-300 character note', async () => {
    const id = await jobDone({ photo: false })
    const [w] = await live(id)
    const wid = w.id as string
    await expectRejects(check(wid, 'ok fine', t.people.ali), 'Only a Manager of Shah Alam can check warnings')
    await expectRejects(check(wid, 'ok fine', t.people.admin), 'Only a Manager of Shah Alam can check warnings')
    await expectRejects(check(wid, 'ok fine', t.people.managerKL), 'Only a Manager of Shah Alam can check warnings')
    await expectRejects(check(wid, ' o '), 'Write a short note (at least 3 characters)')
    await expectRejects(check(wid, 'x'.repeat(301)), 'Keep the note to 300 characters')
    await expectRejects(t.rpcAs(SIGNED_OUT, 'check_order_warning', { p_warning_id: wid, p_note: 'fine' }), /permission denied/i)
    await check(wid)
    await expectRejects(check(wid), 'This warning is no longer open')
    await expectRejects(check('00000000-0000-0000-0000-000000000000'), 'Warning not found')

    const other = await jobDone({ photo: false })
    await returnForRework(other)
    const [ow] = await live(other)
    await expectRejects(check(ow.id as string), 'Warnings can only be checked while the job is waiting for review')
  })

  it('does not let an AI check that failed or never ran block Approve', async () => {
    const id = await jobDone()
    await t.tellCustomer(id)
    expect((await runsOf(id))[0].status).toBe('pending')
    await approve(id)
    expect((await t.summary(id)).status).toBe('reviewed')
  })
})

describe('Rework, ratings and changed facts', () => {
  it('runs again on resubmission: a fixed cause resolves, a 2nd return opens a warning, checked ones with the same facts stay', async () => {
    const id = await jobDone({ price: 350, extra: 630, photo: false })
    const over = (await live(id)).find((w) => w.rule === 'over_quote')!
    await check(over.id as string)

    await returnForRework(id)
    await addPhoto(id)
    await t.submit(t.people.ali, id, { extraCharges: 630 })
    expect((await live(id)).map((w) => [w.rule, w.status])).toEqual([['over_quote', 'checked']])
    expect((await warningsOf(id)).find((w) => w.rule === 'no_photo')).toMatchObject({ status: 'resolved' })

    await returnForRework(id)
    await t.submit(t.people.ali, id, { extraCharges: 630 })
    const ws = await live(id)
    expect(ws.map((w) => [w.rule, w.status, w.message])).toEqual([
      ['over_quote', 'checked', 'Final amount RM 980.00 is 180% above the quoted RM 350.00.'],
      ['many_returns', 'open', 'Returned for rework 2 times.'],
    ])
    expect((await runsOf(id)).map((r) => r.trigger)).toEqual(['job_done', 'resubmitted', 'resubmitted'])
  })

  it('reopens a checked warning when its numbers change', async () => {
    const id = await jobDone({ price: 350, extra: 630 })
    const [over] = await live(id)
    await check(over.id as string)
    await returnForRework(id)
    await t.submit(t.people.ali, id, { extraCharges: 900 })
    const all = await warningsOf(id)
    expect(all.map((w) => [w.status, w.message])).toEqual([
      ['resolved', 'Final amount RM 980.00 is 180% above the quoted RM 350.00.'],
      ['open', 'Final amount RM 1,250.00 is 257% above the quoted RM 350.00.'],
    ])
  })

  it('adds a low-rating warning when the customer rates 1-2 stars or says it is not working, even after approval', async () => {
    const rate = async (rating: number, working: boolean) => {
      const id = await jobDone()
      await t.tellCustomer(id)
      await approve(id)
      const [m] = await t.q<{ feedback_token: string }>(
        'select feedback_token from customer_messages where order_id = $1 order by created_at desc limit 1',
        [id],
      )
      await t.rpcAs(SIGNED_OUT, 'submit_feedback', {
        p_token: m.feedback_token,
        p_rating: rating,
        p_working_well: working,
        p_comment: null,
      })
      return live(id)
    }
    expect((await rate(1, true)).map((w) => [w.rule, w.status, w.message])).toEqual([
      ['low_rating', 'open', 'Customer rated 1 star.'],
    ])
    expect((await rate(4, false)).map((w) => w.message)).toEqual([
      'Customer said the aircond is not working (rated 4 stars).',
    ])
    expect(await rate(3, true)).toEqual([])
  })
})

describe('Who sees warnings', () => {
  it('shows warnings and runs to Admins, Finance and covering Managers, never to technicians', async () => {
    const id = await jobDone({ photo: false })
    const read = async (actor: string) => ({
      warnings: (await t.qAs(actor, 'select id from order_warnings where order_id = $1', [id])).length,
      runs: (await t.qAs(actor, 'select id from supervisor_runs where order_id = $1', [id])).length,
    })
    expect(await read(t.people.admin)).toEqual({ warnings: 1, runs: 1 })
    expect(await read(t.people.finance)).toEqual({ warnings: 1, runs: 1 })
    expect(await read(t.people.managerSA)).toEqual({ warnings: 1, runs: 1 })
    expect(await read(t.people.managerKL)).toEqual({ warnings: 0, runs: 0 })
    expect(await read(t.people.ali)).toEqual({ warnings: 0, runs: 0 })
    await expectRejects(t.qAs(SIGNED_OUT, 'select * from order_warnings'), /permission denied/i)
    await expectRejects(
      t.qAs(t.people.managerSA, `update order_warnings set status = 'checked' where order_id = $1`, [id]),
      /permission denied/i,
    )
  })

  it('never deletes warnings while the order exists, and removes them with the order', async () => {
    const id = await jobDone({ photo: false })
    await expectRejects(t.q('delete from order_warnings where order_id = $1', [id]), 'Warnings cannot be deleted')
    await expectRejects(
      t.q(`update order_warnings set message = 'Nothing' where order_id = $1`, [id]),
      'A warning cannot be changed',
    )
    // As the test clean-up script does: the append-only guards of 0000 / 0003
    // are switched off; the warnings need nothing (they follow their order).
    const guards = [['audit_log', 'audit_log_no_update_trg'], ['customer_messages', 'customer_messages_guard_trg']]
    for (const [table, trigger] of guards) await t.q(`alter table ${table} disable trigger ${trigger}`)
    await t.q('delete from orders where id = $1', [id])
    for (const [table, trigger] of guards) await t.q(`alter table ${table} enable trigger ${trigger}`)
    expect(await warningsOf(id)).toEqual([])
  })
})

describe('The AI check (Edge Function side, service_role)', () => {
  it('gives the AI only the written job text and money, plus checked AI warnings, and marks the run running', async () => {
    const id = await jobDone({ price: 150, extra: 0 })
    const [run] = await runsOf(id)
    const input = (await t.rpcAs<Row>(SERVICE_ROLE, 'supervisor_ai_input', { p_run_id: run.id })).supervisor_ai_input as Row
    expect(input.job).toEqual({
      service_type: 'Repair',
      quoted_price: 150,
      extra_charges: 0,
      final_amount: 150,
      problem_description: 'Aircond not cold',
      work_done: 'Done',
      remarks: null,
    })
    expect(input.already_checked).toEqual([])
    expect(input.log_staff_id).toBe(t.people.ali)
    const text = JSON.stringify(input)
    expect(text).not.toContain('Encik Hafiz')
    expect(text).not.toContain('60123456789')
    expect(text).not.toContain('Jalan Mawar')
    expect((await runsOf(id))[0].status).toBe('running')
  })

  it('replaces open AI warnings, keeps checked ones, saves at most 3, and closes the run', async () => {
    const id = await jobDone()
    const [first] = await runsOf(id)
    await t.rpcAs(SERVICE_ROLE, 'supervisor_ai_input', { p_run_id: first.id })
    await t.rpcAs(SERVICE_ROLE, 'supervisor_save_ai', {
      p_run_id: first.id,
      p_status: 'done',
      p_issues: ['Work done describes a compressor replacement, but the service is Repair with no extra charge.', '  Second   issue ', ' ', 'Third', 'Fourth'],
      p_error: null,
    })
    let ws = await live(id)
    expect(ws.map((w) => [w.rule, w.source, w.message])).toEqual([
      ['ai_text', 'ai', 'Work done describes a compressor replacement, but the service is Repair with no extra charge.'],
      ['ai_text', 'ai', 'Second issue'],
      ['ai_text', 'ai', 'Third'],
    ])
    expect((await runsOf(id))[0]).toMatchObject({ status: 'done' })
    await expectRejects(
      t.rpcAs(SERVICE_ROLE, 'supervisor_save_ai', { p_run_id: first.id, p_status: 'done', p_issues: [], p_error: null }),
      'This check already finished',
    )

    await check(ws[0].id as string, 'Compressor was under warranty')
    const recheck = await t.rpcAs<Row>(t.people.managerSA, 'request_supervisor_recheck', { p_order_id: id })
    expect(recheck).toMatchObject({ trigger: 'recheck', requested_by: t.people.managerSA, status: 'pending' })
    // Asked twice within 2 minutes: the same run.
    expect((await t.rpcAs<Row>(t.people.managerSA, 'request_supervisor_recheck', { p_order_id: id })).id).toBe(recheck.id)

    const input = (await t.rpcAs<Row>(SERVICE_ROLE, 'supervisor_ai_input', { p_run_id: recheck.id })).supervisor_ai_input as Row
    expect(input.already_checked).toEqual([
      { warning: 'Work done describes a compressor replacement, but the service is Repair with no extra charge.', manager_note: 'Compressor was under warranty' },
    ])
    expect(input.log_staff_id).toBe(t.people.managerSA)
    await expectRejects(
      t.rpcAs(SERVICE_ROLE, 'supervisor_ai_input', { p_run_id: recheck.id, p_requested_by: t.people.managerKL }),
      'Check not found',
    )
    await t.rpcAs(SERVICE_ROLE, 'supervisor_save_ai', { p_run_id: recheck.id, p_status: 'done', p_issues: [], p_error: null })
    ws = await live(id)
    expect(ws.map((w) => [w.message, w.status])).toEqual([
      ['Work done describes a compressor replacement, but the service is Repair with no extra charge.', 'checked'],
    ])
  })

  it('lets only a covering Manager ask for a re-check of a job waiting for review', async () => {
    const id = await jobDone()
    const recheck = (actor: string) => t.rpcAs(actor, 'request_supervisor_recheck', { p_order_id: id })
    await expectRejects(recheck(t.people.admin), 'Only a Manager of Shah Alam can re-check a job')
    await expectRejects(recheck(t.people.managerKL), 'Only a Manager of Shah Alam can re-check a job')
    await t.tellCustomer(id)
    await approve(id)
    await expectRejects(recheck(t.people.managerSA), 'Only a job waiting for review can be re-checked')
  })

  it('records a failed run without warnings', async () => {
    const id = await jobDone()
    const [run] = await runsOf(id)
    await t.rpcAs(SERVICE_ROLE, 'supervisor_save_ai', {
      p_run_id: run.id,
      p_status: 'failed',
      p_issues: ['ignored'],
      p_error: 'The assistant cannot be reached',
    })
    expect(await live(id)).toEqual([])
    expect((await runsOf(id))[0]).toMatchObject({ status: 'failed', error: 'The assistant cannot be reached' })
  })

  it('retries pending runs twice, then fails them; stuck running runs fail after 5 minutes', async () => {
    const a = await jobDone()
    const b = await jobDone()
    const c = await jobDone()
    const [ra] = await runsOf(a)
    const [rb] = await runsOf(b)
    const [rc] = await runsOf(c)
    await t.q(`update supervisor_runs set created_at = now() - interval '3 minutes' where id = any ($1::uuid[])`, [[ra.id, rb.id]])
    await t.q(`update supervisor_runs set attempts = 2 where id = $1`, [rb.id])
    await t.q(`update supervisor_runs set status = 'running', created_at = now() - interval '6 minutes' where id = $1`, [rc.id])
    await t.rpcAs(SERVICE_ROLE, 'supervisor_retry_pending')
    expect((await runsOf(a))[0]).toMatchObject({ status: 'pending', attempts: 2 })
    expect((await runsOf(b))[0]).toMatchObject({ status: 'failed', error: 'The AI check did not start' })
    expect((await runsOf(c))[0]).toMatchObject({ status: 'failed', error: 'The AI check stopped before it finished' })
  })

  it('keeps every step away from browsers', async () => {
    const id = await jobDone()
    const [run] = await runsOf(id)
    for (const [fn, args] of [
      ['supervisor_ai_input', { p_run_id: run.id }],
      ['supervisor_save_ai', { p_run_id: run.id, p_status: 'done', p_issues: [], p_error: null }],
      ['supervisor_retry_pending', {}],
    ] as const) {
      await expectRejects(t.rpcAs(t.people.managerSA, fn, args), /permission denied/i)
    }
  })
})

describe('AI log', () => {
  it('records non-Ask AI calls with their feature and order (service_role only)', async () => {
    const id = await jobDone()
    const args = {
      p_staff_id: t.people.ali,
      p_feature: 'supervisor',
      p_summary: 'Job check',
      p_order_id: id,
      p_outcome: 'no_warnings',
      p_duration_ms: 1200,
      p_input_tokens: 300,
      p_output_tokens: 20,
    }
    await t.rpcAs(SERVICE_ROLE, 'ai_log_record', args)
    const [row] = await t.qAs<Row>(t.people.admin, 'select * from ask_log_entries where order_id = $1', [id])
    expect(row).toMatchObject({ feature: 'supervisor', question: 'Job check', outcome: 'no_warnings', staff_name: 'Ali' })
    expect(row.order_no).toBe((await t.summary(id)).order_no)
    await expectRejects(t.rpcAs(SERVICE_ROLE, 'ai_log_record', { ...args, p_feature: 'ask' }), 'Unknown AI feature ask')
    await expectRejects(t.rpcAs(t.people.admin, 'ai_log_record', args), /permission denied/i)
  })
})
