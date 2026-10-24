import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { addDays } from '../../src/domain'
import { createTestDb, expectRejects, type Row, type TestDb } from './helpers'
import { addTechnician, approvedJob, myt, openJob, prepareKpiDb, rate, reschedule, week } from './kpiHelpers'

// 0009 Operational Insight: insight_facts finds busy / quiet technicians, the
// review backlog, rising reschedules and rating drops from the 0007 numbers.

let t: TestDb
let jb: string
let managerJB: string
const w = week(10)
const before = week(9)
const tech: Record<string, string> = {}

const facts = (actor: string, start = w.start, end = w.end, branch: string | null = jb) =>
  t.qAs<Row>(actor, 'select * from insight_facts($1, $2, $3)', [start, end, branch])
const num = (v: unknown) => (v === null ? null : Number(v))

beforeAll(async () => {
  t = await createTestDb()
  await prepareKpiDb(t)
  jb = await t.branchId('Johor Bahru')
  managerJB = (await t.q<{ id: string }>(`select id from staff where role = 'manager' and branch_id = $1`, [jb]))[0].id
  for (const name of ['Busy Bee', 'Mid One', 'Mid Two', 'Mid Three', 'Quiet Quinn']) {
    tech[name] = await addTechnician(t, name, 'Johor Bahru')
  }
  const jobs = async (name: string, n: number, period = w, rating?: number) => {
    for (let i = 0; i < n; i++) {
      const id = await approvedJob(t, { tech: tech[name], branch: 'Johor Bahru', at: myt(addDays(period.start, i % 7), '10:00:00') })
      if (rating !== undefined) await rate(t, id, rating)
    }
  }
  // This week: 12, 6, 6, 6, 0 -> team average 6.0.
  await jobs('Busy Bee', 12)
  await jobs('Mid One', 3, w, 2)
  await jobs('Mid One', 3)
  await jobs('Mid Two', 6)
  await jobs('Mid Three', 6)
  // The week before: Mid One rated 5 three times.
  await jobs('Mid One', 3, before, 5)
  // Reschedules in Johor Bahru: 1 the week before, 4 this week.
  const open = await openJob(t, { tech: tech['Mid Two'], branch: 'Johor Bahru', target: 'assigned' })
  await reschedule(t, open, { at: myt(before.start) })
  for (let i = 0; i < 4; i++) await reschedule(t, open, { at: myt(addDays(w.start, i)) })
  // Review backlog: one job waiting 3 days.
  const waiting = await openJob(t, { tech: tech['Mid Three'], branch: 'Johor Bahru' })
  await t.q(`update order_completions set completed_at = now() - interval '3 days 1 hour' where order_id = $1`, [waiting])
})
afterAll(() => t.close())

describe('insight_facts', () => {
  it('finds each kind with the numbers behind it', async () => {
    const rows = await facts(managerJB)
    expect(
      rows.map((r) => [r.kind, r.technician_name ?? r.branch_name, num(r.value), num(r.previous), num(r.team_average), r.days]),
    ).toEqual([
      ['busy', 'Busy Bee', 12, null, 6, null],
      ['quiet', 'Quiet Quinn', 0, null, 6, null],
      ['review_backlog', 'Johor Bahru', 1, null, null, 3],
      ['reschedules_up', 'Johor Bahru', 4, 1, null, null],
      ['rating_drop', 'Mid One', 2, 5, null, null],
    ])
  })

  it('uses exactly the KPI dashboard numbers', async () => {
    const rows = await facts(t.people.admin)
    const kpi = await t.qAs<Row>(t.people.admin, 'select * from kpi_technicians($1, $2, $3)', [w.start, w.end, jb])
    const busy = rows.find((r) => r.kind === 'busy')!
    expect(num(busy.value)).toBe(kpi.find((k) => k.id === busy.technician_id)!.jobs_completed)
    const average = kpi.reduce((s, k) => s + Number(k.jobs_completed), 0) / kpi.length
    expect(num(busy.team_average)).toBe(Math.round(average * 10) / 10)
    const branches = await t.qAs<Row>(t.people.admin, 'select * from kpi_branches($1, $2)', [w.start, w.end])
    const up = rows.find((r) => r.kind === 'reschedules_up')!
    expect(num(up.value)).toBe(branches.find((b) => b.branch_id === jb)!.reschedules)
  })

  it('is for Managers (their branches) and Admins only', async () => {
    await expectRejects(facts(t.people.finance), 'Insights are for Managers and Admins')
    await expectRejects(facts(tech['Busy Bee']), 'Insights are for Managers and Admins')
    await expectRejects(facts(t.people.managerSA), 'You can only see the branches you cover')
    // Nurul without a branch: only Shah Alam, so nothing from Johor Bahru.
    const own = await facts(t.people.managerSA, w.start, w.end, null)
    expect(own.filter((r) => r.branch_name === 'Johor Bahru')).toEqual([])
    await expectRejects(facts(t.people.admin, w.end, w.start), 'The period must end after it starts')
  })

  it('finds only the review backlog (which is about now) in a quiet period', async () => {
    const empty = week(30)
    expect((await facts(t.people.admin, empty.start, empty.end)).map((r) => r.kind)).toEqual(['review_backlog'])
  })
})

describe('Insight wordings (service_role only)', () => {
  it('stores and reuses a wording for 7 days', async () => {
    const svc = { role: 'service_role', sub: null } as const
    await t.rpcAs(svc, 'insight_wording_put', {
      p_hash: 'a'.repeat(64),
      p_sentences: JSON.stringify([{ fact: 0, text: 'Busy Bee completed 12 jobs.' }]),
      p_tip: ' Share the load. ',
    })
    const got = await t.rpcAs<Row>(svc, 'insight_wording_get', { p_hash: 'a'.repeat(64) })
    expect(got).toMatchObject({ tip: 'Share the load.', sentences: [{ fact: 0, text: 'Busy Bee completed 12 jobs.' }] })
    await t.q(`update insight_wordings set created_at = now() - interval '8 days'`)
    expect((await t.rpcAs<Row>(svc, 'insight_wording_get', { p_hash: 'a'.repeat(64) })).hash).toBeNull()
    await t.rpcAs(svc, 'ask_purge_old')
    expect(await t.q('select * from insight_wordings')).toEqual([])
    await expectRejects(t.rpcAs(t.people.admin, 'insight_wording_get', { p_hash: 'a'.repeat(64) }), /permission denied/i)
  })
})
