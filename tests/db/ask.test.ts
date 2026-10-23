import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SERVICE_ROLE, SIGNED_OUT, createTestDb, expectRejects, type Actor, type Row, type TestDb } from './helpers'
import { addTechnician, approvedJob, events, myt, openJob, payAt, prepareKpiDb, week } from './kpiHelpers'

/**
 * 0008 AI operations query: the read functions the `ask` Edge Function may
 * call (ask_jobs, ask_payments, ask_find_people), and the saved chats and
 * Question log it writes. Every lookup runs as the person asking.
 */
let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
  await prepareKpiDb(t)
})
afterAll(() => t.close())

/** Call a set-returning function with named arguments as the actor; all rows. */
async function call<T = Row>(actor: Actor, fn: string, args: Record<string, unknown> = {}): Promise<T[]> {
  const entries = Object.entries(args).filter(([, v]) => v !== undefined)
  const named = entries
    .map(([k, v], i) => `${k} => $${i + 1}${Array.isArray(v) ? '::text[]' : ''}`)
    .join(', ')
  return t.qAs<T>(actor, `select * from ${fn}(${named})`, entries.map(([, v]) => v))
}

const branchId = async (name: string) =>
  (await t.q<{ id: string }>('select id from branches where name = $1', [name]))[0].id

const orderNos = (rows: Row[]) => rows.map((r) => r.order_no as string).sort()

async function orderNo(id: string): Promise<string> {
  return (await t.q<{ order_no: string }>('select order_no from orders where id = $1', [id]))[0].order_no
}

async function namedOrder(customer: string, o: { tech?: string; branch?: string; price?: number } = {}) {
  const order = await t.createOrder({
    technician: o.tech ?? t.people.ali,
    branch: o.branch,
    quotedPrice: o.price ?? 100,
    customerName: customer,
  })
  return order.id as string
}

// ---------------------------------------------------------------------------
// ask_jobs
// ---------------------------------------------------------------------------
describe('ask_jobs: jobs the person may see', () => {
  const w = week(10)
  let saJob: string
  let klJob: string
  let baleJob: string

  beforeAll(async () => {
    saJob = await approvedJob(t, { tech: t.people.ali, at: myt(w.start, '10:00:00') })
    baleJob = await approvedJob(t, { tech: t.people.bala, at: myt(w.sunday, '23:59:00') })
    klJob = await approvedJob(t, { tech: t.people.john, branch: 'Kuala Lumpur', at: myt(w.start, '11:00:00') })
  })

  const approvedIn = (actor: Actor, extra: Record<string, unknown> = {}) =>
    call(actor, 'ask_jobs', { p_date_kind: 'approved', p_start: w.start, p_end: w.end, ...extra })

  it('gives Admins and Finance every branch', async () => {
    for (const who of [t.people.admin, t.people.finance]) {
      const rows = await approvedIn(who)
      expect(orderNos(rows)).toEqual(
        [await orderNo(saJob), await orderNo(baleJob), await orderNo(klJob)].sort(),
      )
    }
  })

  it('gives a Manager only the branches they cover, and refuses another branch', async () => {
    const rows = await approvedIn(t.people.managerSA)
    expect(orderNos(rows)).toEqual([await orderNo(saJob), await orderNo(baleJob)].sort())
    await expectRejects(
      approvedIn(t.people.managerSA, { p_branch_id: await branchId('Kuala Lumpur') }),
      'You can only see the branches you cover',
    )
  })

  it('gives a technician only their own jobs, and refuses asking about someone else', async () => {
    const rows = await approvedIn(t.people.ali)
    expect(orderNos(rows)).toEqual([await orderNo(saJob)])
    await expectRejects(approvedIn(t.people.ali, { p_technician_id: t.people.bala }), 'You can only see your own jobs')
  })

  it('refuses signed-out visitors and inactive staff', async () => {
    await expectRejects(approvedIn(SIGNED_OUT), /permission denied/i)
    const idle = await addTechnician(t, 'Idle Ask Tech')
    await t.setActiveIgnoringOpenJobs(idle, false)
    await expectRejects(approvedIn(idle), 'Your account has no active staff profile')
  })

  it('counts an approval on its Malaysia day, like the KPI functions', async () => {
    // Sunday 23:59 belongs to this week; the next Monday 00:00 does not.
    const late = await approvedJob(t, { tech: t.people.yusoff, at: myt(w.end, '00:00:00') })
    const rows = await approvedIn(t.people.admin, { p_technician_id: t.people.bala })
    expect(orderNos(rows)).toEqual([await orderNo(baleJob)])
    const yusoff = await approvedIn(t.people.admin, { p_technician_id: t.people.yusoff })
    expect(orderNos(yusoff)).not.toContain(await orderNo(late))

    const kpi = await events(t, t.people.admin, t.people.bala, w.start, w.end)
    const completed = kpi.filter((e) => e.kind === 'completed').map((e) => e.order_no as string)
    expect(orderNos(rows)).toEqual(completed.sort())
  })

  it('returns the columns the answer table needs, with a total count', async () => {
    const [row] = await approvedIn(t.people.admin, { p_technician_id: t.people.ali })
    expect(row).toMatchObject({
      order_no: await orderNo(saJob),
      status: 'reviewed',
      service_type: expect.any(String),
      branch_name: 'Shah Alam',
      technician_name: 'Ali',
      technician_active: true,
      customer_phone: expect.any(String),
      payment_status: 'unpaid',
      total_count: 1,
    })
    expect(row.approved_at).not.toBeNull()
  })

  it('filters by status, customer name (wildcards are plain text), and payment status', async () => {
    const tan = await namedOrder('Tan Ah Kow (50%_off)')
    const tan2 = await namedOrder('Mrs Tan Mei')
    await namedOrder('Lee Chong')
    await t.advance(tan, 'job_done')

    const byName = await call(t.people.admin, 'ask_jobs', { p_customer_name: 'tan' })
    expect(orderNos(byName)).toEqual(expect.arrayContaining([await orderNo(tan), await orderNo(tan2)]))
    expect(byName.every((r) => /tan/i.test(r.customer_name as string))).toBe(true)

    const literal = await call(t.people.admin, 'ask_jobs', { p_customer_name: '50%_off' })
    expect(orderNos(literal)).toEqual([await orderNo(tan)])
    // '%' is a character to find, not "anything".
    expect(orderNos(await call(t.people.admin, 'ask_jobs', { p_customer_name: '%' }))).toEqual([await orderNo(tan)])

    const waiting = await call(t.people.admin, 'ask_jobs', { p_statuses: ['job_done'], p_customer_name: 'tan' })
    expect(orderNos(waiting)).toEqual([await orderNo(tan)])

    const unpaid = await call(t.people.admin, 'ask_jobs', {
      p_customer_name: 'Tan Ah Kow',
      p_payment_status: 'unpaid',
    })
    expect(unpaid).toHaveLength(1)
  })

  it('lists scheduled jobs soonest first', async () => {
    const day = week(11).start
    const later = await t.createOrder({ technician: t.people.ali, scheduledAt: myt(day, '15:00:00') })
    const sooner = await t.createOrder({ technician: t.people.ali, scheduledAt: myt(day, '09:00:00') })
    const rows = await call(t.people.managerSA, 'ask_jobs', {
      p_date_kind: 'scheduled',
      p_start: day,
      p_end: week(11).end,
    })
    expect(rows.map((r) => r.order_no)).toEqual([sooner.order_no, later.order_no])
  })

  it('limits the rows but reports the full count', async () => {
    const rows = await call(t.people.admin, 'ask_jobs', { p_limit: 2 })
    expect(rows).toHaveLength(2)
    expect(Number(rows[0].total_count)).toBeGreaterThan(2)
  })

  it('refuses bad inputs with plain messages', async () => {
    await expectRejects(call(t.people.admin, 'ask_jobs', { p_date_kind: 'paid' }), 'Unknown date kind: paid')
    await expectRejects(
      call(t.people.admin, 'ask_jobs', { p_date_kind: 'approved' }),
      'Choose a date kind together with a period',
    )
    await expectRejects(
      call(t.people.admin, 'ask_jobs', { p_start: w.start, p_end: w.end }),
      'Choose a date kind together with a period',
    )
    await expectRejects(call(t.people.admin, 'ask_jobs', { p_statuses: ['done'] }), 'Unknown status')
    await expectRejects(call(t.people.admin, 'ask_jobs', { p_limit: 500 }), 'Choose between 1 and 200 rows')
    await expectRejects(
      call(t.people.admin, 'ask_jobs', { p_date_kind: 'created', p_start: '2026-01-01', p_end: '2027-06-01' }),
      'Choose a period of up to a year',
    )
  })
})

// ---------------------------------------------------------------------------
// ask_payments
// ---------------------------------------------------------------------------
describe('ask_payments: money questions', () => {
  const w = week(14)
  let paidCash: string
  let paidTransfer: string
  let partly: string
  let unpaid: string
  let kl: string

  beforeAll(async () => {
    paidCash = await openJob(t, { price: 200 })
    await payAt(t, paidCash, 200, myt(w.start))
    paidTransfer = await openJob(t, { price: 300 })
    const transfer = await t.pay(t.people.finance, paidTransfer, 300, 'bank_transfer')
    await t.q('update payments set recorded_at = $2 where id = $1', [transfer.id, myt(w.sunday)])
    partly = await openJob(t, { price: 500 })
    await payAt(t, partly, 100, myt(week(20).start))
    unpaid = await openJob(t, { price: 150 })
    kl = await openJob(t, { tech: t.people.john, branch: 'Kuala Lumpur', price: 80 })
  })

  it('lists payments recorded in a period, with the job they belong to', async () => {
    const rows = await call(t.people.finance, 'ask_payments', { p_kind: 'recorded', p_start: w.start, p_end: w.end })
    expect(orderNos(rows)).toEqual([await orderNo(paidCash), await orderNo(paidTransfer)].sort())
    const cash = rows.find((r) => r.method === 'cash')!
    expect(cash).toMatchObject({ kind: 'recorded', method: 'cash', payment_status: 'paid' })
  })

  it('lists non-cash receipts that are not verified yet', async () => {
    const rows = await call(t.people.finance, 'ask_payments', { p_kind: 'unverified' })
    expect(orderNos(rows)).toContain(await orderNo(paidTransfer))
    expect(orderNos(rows)).not.toContain(await orderNo(paidCash))
  })

  it('lists unpaid and partly paid finished jobs', async () => {
    const none = await call(t.people.finance, 'ask_payments', { p_kind: 'unpaid' })
    expect(orderNos(none)).toEqual(expect.arrayContaining([await orderNo(unpaid), await orderNo(kl)]))
    expect(orderNos(none)).not.toContain(await orderNo(partly))
    const some = await call(t.people.finance, 'ask_payments', { p_kind: 'partly_paid' })
    const row = some.find((r) => r.order_id === partly)!
    expect(row).toMatchObject({ payment_status: 'partial' })
    expect(Number(row.balance)).toBe(400)
  })

  it('keeps a Manager to their branches and a technician to their own jobs', async () => {
    const sa = await call(t.people.managerSA, 'ask_payments', { p_kind: 'unpaid' })
    expect(orderNos(sa)).not.toContain(await orderNo(kl))
    const john = await call(t.people.john, 'ask_payments', { p_kind: 'unpaid' })
    expect(orderNos(john)).toContain(await orderNo(kl))
    expect(john.every((r) => r.technician_id === t.people.john)).toBe(true)
  })

  it('refuses an unknown question or a recorded list without a period', async () => {
    await expectRejects(call(t.people.finance, 'ask_payments', { p_kind: 'refunds' }), 'Unknown payment question: refunds')
    await expectRejects(call(t.people.finance, 'ask_payments', { p_kind: 'recorded' }), 'Choose a start and an end date')
  })
})

// ---------------------------------------------------------------------------
// ask_find_people
// ---------------------------------------------------------------------------
describe('ask_find_people: forgiving name search', () => {
  const find = (actor: Actor, name: string, role?: string) =>
    call<{ name: string; is_pick: boolean; active: boolean; branch_name: string; score: string }>(
      actor,
      'ask_find_people',
      { p_name: name, p_role: role },
    )
  const pick = (rows: { name: string; is_pick: boolean }[]) => rows.find((r) => r.is_pick)?.name ?? null

  it('finds one clear match despite case, spelling slips and titles', async () => {
    expect(pick(await find(t.people.admin, 'jon'))).toBe('John')
    expect(pick(await find(t.people.admin, 'YUSOF'))).toBe('Yusoff')
    expect(pick(await find(t.people.admin, 'Encik Bala'))).toBe('Bala')
  })

  it('offers both when two people share a name, and picks none', async () => {
    await addTechnician(t, 'Ali Rahman', 'Kuala Lumpur')
    const rows = await find(t.people.admin, 'Ali')
    expect(rows.slice(0, 2).map((r) => r.name).sort()).toEqual(['Ali', 'Ali Rahman'])
    expect(pick(rows)).toBeNull()
    // A Shah Alam Manager does not see the Kuala Lumpur Ali.
    expect(pick(await find(t.people.managerSA, 'Ali'))).toBe('Ali')
  })

  it('finds inactive people, marked inactive', async () => {
    const gone = await addTechnician(t, 'Zainal Gone')
    await t.setActiveIgnoringOpenJobs(gone, false)
    const rows = await find(t.people.admin, 'zainal')
    expect(rows[0]).toMatchObject({ name: 'Zainal Gone', active: false, is_pick: true })
  })

  it('returns nothing for an unknown name, and only themselves to a technician', async () => {
    expect(await find(t.people.admin, 'Xavier')).toEqual([])
    expect(await find(t.people.ali, 'Bala')).toEqual([])
    expect(pick(await find(t.people.ali, 'ali'))).toBe('Ali')
  })

  it('searches other roles when asked', async () => {
    expect(pick(await find(t.people.admin, 'nurul', 'manager'))).toBe('Nurul Huda')
    expect(await find(t.people.admin, 'nurul')).toEqual([])
    await expectRejects(find(t.people.admin, 'nurul', 'boss'), 'Unknown role: boss')
    await expectRejects(find(t.people.admin, '  '), 'Type a name to search for')
  })
})

// ---------------------------------------------------------------------------
// Saved chats and the Question log
// ---------------------------------------------------------------------------
describe('Saved chats and the Question log', () => {
  const record = (staffId: string, chatId: string | null, question: string, save = true) =>
    t.rpcAs<{ chat_id: string | null; message_id: string | null }>(SERVICE_ROLE, 'ask_record', {
      p_staff_id: staffId,
      p_chat_id: chatId,
      p_question: question,
      p_answer: save ? `Answer to ${question}` : null,
      p_result: save ? JSON.stringify({ rows: [] }) : null,
      p_save: save,
      p_lookups: JSON.stringify([{ name: 'kpi_summary', input: { period: 'today' } }]),
      p_row_count: 0,
      p_outcome: save ? 'answered' : 'ai_unavailable',
      p_duration_ms: 1200,
      p_input_tokens: 900,
      p_output_tokens: 80,
    })

  it('lets only the Edge Function (secret key) record a question', async () => {
    const sql = `select * from ask_record($1, null, 'Fake', 'Fake answer', null, true, null, 0, 'answered', 0, 0, 0)`
    for (const who of [t.people.managerSA, t.people.admin]) {
      await expectRejects(t.qAs(who, sql, [who]), /permission denied/i)
    }
    await expectRejects(t.qAs(SIGNED_OUT, sql, [t.people.admin]), /permission denied/i)
    expect(await t.q(`select * from ask_log where question = 'Fake'`)).toEqual([])
  })

  it('creates a chat titled from the first question and keeps follow-ups in it', async () => {
    const first = await record(t.people.managerSA, null, 'What jobs did Ali complete last week?')
    expect(first.chat_id).toBeTruthy()
    await record(t.people.managerSA, first.chat_id, 'and Bala?')

    const chats = await t.qAs(t.people.managerSA, 'select * from ask_chats where id = $1', [first.chat_id])
    expect(chats[0].title).toBe('What jobs did Ali complete last week?')
    const messages = await t.qAs(
      t.people.managerSA,
      'select role, body from ask_messages where chat_id = $1 order by id',
      [first.chat_id],
    )
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
    expect(messages[2].body).toBe('and Bala?')
  })

  it('shows a person only their own chats', async () => {
    const mine = await record(t.people.managerKL, null, 'Weiming question')
    expect(await t.qAs(t.people.managerSA, 'select * from ask_chats where id = $1', [mine.chat_id])).toEqual([])
    expect(await t.qAs(t.people.admin, 'select * from ask_messages where chat_id = $1', [mine.chat_id])).toEqual([])
    await expectRejects(record(t.people.managerSA, mine.chat_id!, 'sneaky'), 'Chat not found')
  })

  it('logs questions without saving a chat when the answer failed', async () => {
    const r = await record(t.people.finance, null, 'AI down question', false)
    expect(r.chat_id).toBeNull()
    const log = await t.qAs(t.people.admin, `select * from ask_log_entries where question = 'AI down question'`)
    expect(log[0]).toMatchObject({ staff_name: 'Siti Aminah', outcome: 'ai_unavailable', chat_id: null })
  })

  it('shows the Question log to Admins only', async () => {
    await record(t.people.ali, null, 'My jobs today?')
    const admin = await t.qAs(t.people.admin, `select * from ask_log_entries where question = 'My jobs today?'`)
    expect(admin[0]).toMatchObject({ staff_name: 'Ali', staff_role: 'technician', duration_ms: 1200 })
    for (const who of [t.people.managerSA, t.people.finance, t.people.ali]) {
      expect(await t.qAs(who, 'select * from ask_log')).toEqual([])
    }
  })

  it('lets a person rename and delete their own chats only; the log entry stays', async () => {
    const r = await record(t.people.bala, null, 'Bala chat')
    const renamed = await t.rpcAs(t.people.bala, 'ask_rename_chat', { p_chat_id: r.chat_id, p_title: ' My week ' })
    expect(renamed.title).toBe('My week')
    await expectRejects(t.rpcAs(t.people.ali, 'ask_rename_chat', { p_chat_id: r.chat_id, p_title: 'x' }), 'Chat not found')
    await expectRejects(t.rpcAs(t.people.ali, 'ask_delete_chat', { p_chat_id: r.chat_id }), 'Chat not found')
    await expectRejects(t.rpcAs(t.people.bala, 'ask_rename_chat', { p_chat_id: r.chat_id, p_title: '' }), 'Type a name for the chat')

    await t.rpcAs(t.people.bala, 'ask_delete_chat', { p_chat_id: r.chat_id })
    expect(await t.q('select * from ask_chats where id = $1', [r.chat_id])).toEqual([])
    expect(await t.q('select * from ask_messages where chat_id = $1', [r.chat_id])).toEqual([])
    const log = await t.q(`select chat_id from ask_log where question = 'Bala chat'`)
    expect(log).toEqual([{ chat_id: null }])
  })

  it('hides anything older than 7 days, and the nightly purge deletes it', async () => {
    const r = await record(t.people.yusoff, null, 'Old question')
    const ago = `now() - interval '8 days'`
    await t.q(`update ask_chats set created_at = ${ago}, updated_at = ${ago} where id = $1`, [r.chat_id])
    await t.q(`update ask_messages set created_at = ${ago} where chat_id = $1`, [r.chat_id])
    await t.q(`update ask_log set created_at = ${ago} where question = 'Old question'`)

    expect(await t.qAs(t.people.yusoff, 'select * from ask_chats where id = $1', [r.chat_id])).toEqual([])
    expect(await t.qAs(t.people.admin, `select * from ask_log where question = 'Old question'`)).toEqual([])
    await expectRejects(record(t.people.yusoff, r.chat_id, 'more'), 'Chat not found')

    await expectRejects(t.qAs(t.people.admin, 'select ask_purge_old()'), /permission denied/i)
    await t.qAs(SERVICE_ROLE, 'select ask_purge_old()')
    expect(await t.q('select * from ask_chats where id = $1', [r.chat_id])).toEqual([])
    expect(await t.q(`select * from ask_log where question = 'Old question'`)).toEqual([])
    // Newer chats stay.
    expect((await t.q<{ n: number }>('select count(*)::int as n from ask_chats'))[0].n).toBeGreaterThan(0)
  })
})
