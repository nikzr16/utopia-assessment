import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { addDays } from '../../src/domain'
import { SIGNED_OUT, createTestDb, expectRejects, type Identity, type TestDb } from './helpers'
import {
  approvedJob,
  branchesKpi,
  byName,
  events,
  myt,
  num,
  prepareKpiDb,
  reschedule,
  summary,
  technicians,
  trend,
  week,
} from './kpiHelpers'

let t: TestDb
const w = week(50)
const when = (n: number) => myt(addDays(w.start, n))
let sa: string
let kl: string
let aliJob: string
let balaJob: string
let johnJob: string

beforeAll(async () => {
  t = await createTestDb()
  await prepareKpiDb(t)
  sa = await t.branchId('Shah Alam')
  kl = await t.branchId('Kuala Lumpur')
  aliJob = await approvedJob(t, { tech: t.people.ali, price: 100, at: when(1) })
  balaJob = await approvedJob(t, { tech: t.people.bala, price: 200, at: when(2) })
  johnJob = await approvedJob(t, { tech: t.people.john, branch: 'Kuala Lumpur', price: 400, at: when(2) })
  const open = (await t.createOrder({ technician: t.people.ali })).id as string
  await reschedule(t, open, { at: when(3) })
})
afterAll(() => t.close())

const ALL_FIVE = (actor: string) => ({
  summary: () => summary(t, actor, w.start, w.end),
  technicians: () => technicians(t, actor, w.start, w.end),
  branches: () => branchesKpi(t, actor, w.start, w.end),
  trend: () => trend(t, actor, 'week', w.end, 2),
  events: () => events(t, actor, t.people.ali, w.start, w.end),
})

// ---------------------------------------------------------------------------
// AC1: who sees what, enforced by the database
// ---------------------------------------------------------------------------
describe('AC1 Admins and Finance see every branch', () => {
  for (const [who, id] of [['Admin', () => t.people.admin], ['Finance', () => t.people.finance]] as const) {
    it(`${who} reads every branch's numbers`, async () => {
      const cards = await summary(t, id(), w.start, w.end)
      expect(num(cards.jobs_completed)).toBe(3)
      expect(num(cards.total_amount)).toBe(700)
      const rows = await technicians(t, id(), w.start, w.end)
      expect(rows.map((r) => r.name)).toEqual(expect.arrayContaining(['Ali', 'Bala', 'John', 'Yusoff']))
      expect((await branchesKpi(t, id(), w.start, w.end)).map((r) => r.branch_name)).toHaveLength(5)
      expect((await events(t, id(), t.people.john, w.start, w.end)).map((r) => r.order_id)).toEqual([johnJob])
    })
  }

  it('an Admin asking for a branch that does not exist is told so', async () => {
    await expectRejects(
      technicians(t, t.people.admin, w.start, w.end, '00000000-0000-0000-0000-000000000000'),
      'Branch not found',
    )
  })
})

describe('AC1 a Manager sees only the branches they cover', () => {
  it('Shah Alam’s Manager gets Shah Alam numbers, technicians and branch rows only', async () => {
    const cards = await summary(t, t.people.managerSA, w.start, w.end)
    expect(num(cards.jobs_completed)).toBe(2)
    expect(num(cards.total_amount)).toBe(300)
    const rows = await technicians(t, t.people.managerSA, w.start, w.end)
    expect(rows.map((r) => r.name).sort()).toEqual(['Ali', 'Bala', 'Yusoff'])
    expect(rows.every((r) => r.branch_id === sa)).toBe(true)
    expect((await branchesKpi(t, t.people.managerSA, w.start, w.end)).map((r) => r.branch_name)).toEqual(['Shah Alam'])
    // The same numbers as an Admin narrowed to the branch.
    const adminSa = await summary(t, t.people.admin, w.start, w.end, sa)
    expect(num(adminSa.jobs_completed)).toBe(num(cards.jobs_completed))
    expect(num(adminSa.total_amount)).toBe(num(cards.total_amount))
    // Her own branch as an explicit filter works too.
    expect((await technicians(t, t.people.managerSA, w.start, w.end, sa)).length).toBe(3)
  })

  it('refuses another branch, and leaves another branch’s technicians out of the drill-down and the trend', async () => {
    await expectRejects(summary(t, t.people.managerSA, w.start, w.end, kl), 'You can only see the branches you cover')
    await expectRejects(technicians(t, t.people.managerSA, w.start, w.end, kl), 'You can only see the branches you cover')
    await expectRejects(
      events(t, t.people.managerSA, t.people.ali, w.start, w.end, kl),
      'You can only see the branches you cover',
    )
    await expectRejects(
      trend(t, t.people.managerSA, 'week', w.end, 2, kl),
      'You can only see the branches you cover',
    )
    // A branch that does not exist reads the same as one she does not cover.
    await expectRejects(
      summary(t, t.people.managerSA, w.start, w.end, '00000000-0000-0000-0000-000000000000'),
      'You can only see the branches you cover',
    )
    // John works in Kuala Lumpur: nothing of his is visible to her.
    expect(await events(t, t.people.managerSA, t.people.john, w.start, w.end)).toEqual([])
    const johnTrend = await trend(t, t.people.managerSA, 'week', w.end, 1, null, t.people.john)
    expect(johnTrend.map((r) => r.jobs_completed)).toEqual([0])
  })

  it('a Manager with extra cover sees the extra branch, and loses it when the cover is removed', async () => {
    await t.q('update staff set additional_branch_ids = $2::uuid[] where id = $1', [t.people.managerSA, [kl]])
    try {
      const cards = await summary(t, t.people.managerSA, w.start, w.end)
      expect(num(cards.jobs_completed)).toBe(3)
      expect((await branchesKpi(t, t.people.managerSA, w.start, w.end)).map((r) => r.branch_name)).toEqual([
        'Kuala Lumpur', 'Shah Alam',
      ])
      expect(num((await summary(t, t.people.managerSA, w.start, w.end, kl)).jobs_completed)).toBe(1)
    } finally {
      await t.q(`update staff set additional_branch_ids = '{}' where id = $1`, [t.people.managerSA])
    }
    await expectRejects(summary(t, t.people.managerSA, w.start, w.end, kl), 'You can only see the branches you cover')
  })
})

describe('AC1 a technician sees only their own numbers', () => {
  it('gets their own cards, one leaderboard row without a rank, and their own trend and events', async () => {
    const cards = await summary(t, t.people.ali, w.start, w.end)
    expect(num(cards.jobs_completed)).toBe(1)
    expect(num(cards.total_amount)).toBe(100)
    expect(num(cards.rescheduled)).toBe(1)
    expect(num(cards.active_technicians)).toBe(1)

    const rows = await technicians(t, t.people.ali, w.start, w.end)
    expect(rows.map((r) => r.name)).toEqual(['Ali'])
    expect(rows[0].rank).toBeNull()
    expect(rows[0].jobs_completed).toBe(1)

    expect((await trend(t, t.people.ali, 'week', w.end, 1)).map((r) => r.jobs_completed)).toEqual([1])
    expect((await trend(t, t.people.ali, 'week', w.end, 1, null, t.people.ali)).map((r) => r.jobs_completed)).toEqual([1])
    expect((await events(t, t.people.ali, t.people.ali, w.start, w.end)).map((r) => r.kind).sort()).toEqual([
      'completed', 'rescheduled',
    ])
    expect(aliJob).toBeTruthy()
  })

  it('is refused other technicians, the branch comparison, and gets nothing of other branches', async () => {
    await expectRejects(events(t, t.people.ali, t.people.bala, w.start, w.end), 'You can only see your own numbers')
    await expectRejects(
      trend(t, t.people.ali, 'week', w.end, 1, null, t.people.bala),
      'You can only see your own numbers',
    )
    await expectRejects(branchesKpi(t, t.people.ali, w.start, w.end), 'not available to technicians')
    // John (Kuala Lumpur) has his own row only, with only his numbers.
    const john = await technicians(t, t.people.john, w.start, w.end)
    expect(john.map((r) => r.name)).toEqual(['John'])
    expect(john[0].jobs_completed).toBe(1)
    expect(num(john[0].total_amount)).toBe(400)
    expect(balaJob).toBeTruthy()
  })
})

describe('AC1 inactive staff and signed-out visitors see nothing', () => {
  it('refuses an inactive staff member, then serves them again once reactivated', async () => {
    await t.setActiveIgnoringOpenJobs(t.people.yusoff, false)
    try {
      for (const call of Object.values(ALL_FIVE(t.people.yusoff))) {
        await expectRejects(call(), 'no active staff profile')
      }
    } finally {
      await t.setActiveIgnoringOpenJobs(t.people.yusoff, true)
    }
    expect(num((await summary(t, t.people.yusoff, w.start, w.end)).jobs_completed)).toBe(0)
  })

  it('refuses signed-out visitors (no execute right), and accounts without a staff profile', async () => {
    const calls = [
      `select * from kpi_summary('${w.start}', '${w.end}', null)`,
      `select * from kpi_technicians('${w.start}', '${w.end}', null)`,
      `select * from kpi_branches('${w.start}', '${w.end}')`,
      `select * from kpi_trend('week', '${w.end}', 2, null, null)`,
      `select * from kpi_technician_events('${t.people.ali}', '${w.start}', '${w.end}', null)`,
    ]
    const stranger: Identity = { role: 'authenticated', sub: await t.createAuthUser('kpi.outsider@example.com') }
    const noUser: Identity = { role: 'authenticated', sub: null }
    for (const sql of calls) {
      await expectRejects(t.qAs(SIGNED_OUT, sql), /permission denied/i)
      await expectRejects(t.qAs(stranger, sql), 'no active staff profile')
      await expectRejects(t.qAs(noUser, sql), 'You must be signed in')
    }
  })
})

// ---------------------------------------------------------------------------
// AC15: named, documented, read-only functions
// ---------------------------------------------------------------------------
describe('AC15 the five read functions are named, documented, read-only and signed-in only', () => {
  const NAMES = ['kpi_summary', 'kpi_technicians', 'kpi_branches', 'kpi_trend', 'kpi_technician_events']

  it('are security definer, stable (cannot write) and carry a comment naming their inputs and outputs', async () => {
    const rows = await t.q<{ proname: string; secdef: boolean; volatility: string; doc: string | null; args: string }>(
      `select p.proname, p.prosecdef as secdef, p.provolatile as volatility,
              obj_description(p.oid, 'pg_proc') as doc, pg_get_function_arguments(p.oid) as args
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = any($1::text[])`,
      [NAMES],
    )
    expect(rows.map((r) => r.proname).sort()).toEqual([...NAMES].sort())
    for (const r of rows) {
      expect(r.secdef, r.proname).toBe(true)
      expect(r.volatility, r.proname).toBe('s')
      expect(r.doc, r.proname).toMatch(/Inputs?:/)
      expect(r.doc, r.proname).toMatch(/Output/)
      expect(r.doc, r.proname).toContain('Malaysia')
      // The actor is never a parameter.
      expect(r.args, r.proname).not.toMatch(/actor|staff_id|user/)
    }
  })

  it('are executable by signed-in staff only', async () => {
    const rows = await t.q<{ proname: string; role: string; ok: boolean }>(
      `select p.proname, r.role, has_function_privilege(r.role, p.oid, 'execute') as ok
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
              unnest(array['anon', 'authenticated', 'service_role']) as r(role)
        where n.nspname = 'public' and p.proname = any($1::text[])`,
      [NAMES],
    )
    expect(rows.filter((r) => r.ok).map((r) => r.role)).toEqual(Array(NAMES.length).fill('authenticated'))
  })
})

// ---------------------------------------------------------------------------
// Bad periods and inputs
// ---------------------------------------------------------------------------
describe('periods and inputs are checked', () => {
  const admin = () => t.people.admin

  it('refuses an empty, backwards, missing or longer-than-400-day period; accepts exactly 400 days', async () => {
    await expectRejects(summary(t, admin(), w.start, w.start), 'The period must end after it starts')
    await expectRejects(summary(t, admin(), w.end, w.start), 'The period must end after it starts')
    await expectRejects(technicians(t, admin(), w.start, addDays(w.start, 401)), 'Choose a period of up to a year')
    await expectRejects(
      t.qAs(admin(), `select * from kpi_branches(null, '${w.end}')`),
      'Choose a start and an end date',
    )
    await expectRejects(
      t.qAs(admin(), `select * from kpi_summary('${w.start}', 'infinity', null)`),
      'Choose a start and an end date',
    )
    await expectRejects(branchesKpi(t, admin(), w.start, addDays(w.start, 500)), 'Choose a period of up to a year')
    await expectRejects(events(t, admin(), t.people.ali, w.start, addDays(w.start, 401)), 'Choose a period of up to a year')
    expect(await technicians(t, admin(), w.start, addDays(w.start, 400))).toBeTruthy()
    expect((await summary(t, admin(), w.start, addDays(w.start, 1))).jobs_completed).toBe(0)
  })

  it('refuses a bad trend request and an unknown technician', async () => {
    await expectRejects(trend(t, admin(), 'day', w.end, 4), 'Choose week or month')
    await expectRejects(trend(t, admin(), 'week', w.end, 0), 'Choose between 1 and 26 periods')
    await expectRejects(trend(t, admin(), 'week', w.end, 27), 'Choose between 1 and 26 periods')
    await expectRejects(
      t.qAs(admin(), `select * from kpi_trend('week', null, 4, null, null)`),
      'Choose an end date',
    )
    expect(await trend(t, admin(), 'week', w.end, 26)).toHaveLength(26)
    const nobody = '00000000-0000-0000-0000-000000000000'
    await expectRejects(trend(t, admin(), 'week', w.end, 4, null, nobody), 'Technician not found')
    await expectRejects(events(t, admin(), nobody, w.start, w.end), 'Technician not found')
  })

  it('answers every function with the same technician rows regardless of who asks (Admin vs Finance)', async () => {
    const a = await technicians(t, t.people.admin, w.start, w.end)
    const f = await technicians(t, t.people.finance, w.start, w.end)
    expect(f).toEqual(a)
    expect(byName(a, 'Bala').rank).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// P2: the technician of a reschedule
// ---------------------------------------------------------------------------
describe('P2 order_reschedules.technician_id', () => {
  it('is filled from the order for new reschedules and backfilled for existing ones', async () => {
    const old = await createTestDb({ holdBackMigrations: ['20261023000005'] })
    try {
      const { people } = old
      const log = (orderId: string) =>
        old.rpcAs(people.admin, 'reschedule_order', {
          p_order_id: orderId, p_new_scheduled_at: '2027-02-01T02:00:00Z', p_reason: 'weather', p_requested_by: 'customer',
        })

      const moved = (await old.createOrder({ technician: people.ali })).id as string
      const first = await log(moved) // while Ali's
      await old.transition(people.admin, moved, 'assigned', null, people.bala)
      const second = await log(moved) // after the reassign: Bala's
      const unassigned = (await old.createOrder()).id as string
      const third = await log(unassigned) // no technician yet
      // A row with no assignment trail at all (older than the audit log): the order's technician.
      const bare = (await old.q<{ id: string }>(
        `insert into orders (branch_id, customer_name, customer_phone, customer_address, problem_description,
                             service_type_id, quoted_price, assigned_technician_id, status, created_by)
         select b.id, 'X', '60123456789', 'Addr', 'Problem', s.id, 10, $1, 'assigned', $2
           from branches b, service_types s where b.name = 'Shah Alam' and s.name = 'Repair' returning id`,
        [people.yusoff, people.admin],
      ))[0].id
      const fourth = (await old.q<{ id: string }>(
        `insert into order_reschedules (order_id, reason, requested_by, performed_by)
         values ($1, 'other', 'admin', $2) returning id`,
        [bare, people.admin],
      ))[0].id

      await old.applyMigration('20261023000005')
      const technicianOf = async (id: unknown) =>
        (await old.q<{ technician_id: string | null }>('select technician_id from order_reschedules where id = $1', [id]))[0]
          .technician_id
      expect(await technicianOf(first.id)).toBe(people.ali)
      expect(await technicianOf(second.id)).toBe(people.bala)
      expect(await technicianOf(third.id)).toBeNull()
      expect(await technicianOf(fourth)).toBe(people.yusoff)

      // From now on the trigger fills it in.
      const fifth = await log(moved)
      expect(await technicianOf(fifth.id)).toBe(people.bala)
      const sixth = await log(unassigned)
      expect(await technicianOf(sixth.id)).toBeNull()
    } finally {
      await old.close()
    }
  })
})
