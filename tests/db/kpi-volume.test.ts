import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './helpers'
import { branchesKpi, events, num, prepareKpiDb, summary, technicians, trend } from './kpiHelpers'

/**
 * AC17 (database side): a year of data for 45 technician teams across the 5
 * branches (about 25,000 orders with approvals, returns, reschedules,
 * payments and ratings) is generated directly in PGlite, and every dashboard
 * read must stay inside a budget. PGlite is a single-threaded WebAssembly
 * Postgres without a shared buffer cache, so its times are an upper bound for
 * the hosted project's; the PRD's 2 second target is used as the budget for
 * the week and month views.
 */
const TECHNICIANS = 45
const ORDERS = 25_000
const YEAR_START = '2025-10-24' // the generated year runs from here to 2026-10-24 (Malaysia days)
const YEAR_END = '2026-10-24'

// Budgets in milliseconds. The full-year range alone takes under 1 s, but
// the whole suite runs in parallel, so its budget leaves room for that load.
const VIEW_BUDGET_MS = 2_000
const WIDE_BUDGET_MS = 8_000

let t: TestDb
const timings: Record<string, number> = {}

async function timed<T>(name: string, run: () => Promise<T>, budgetMs: number): Promise<T> {
  const started = performance.now()
  const result = await run()
  const took = performance.now() - started
  timings[name] = Math.round(took)
  expect(took, `${name} took ${Math.round(took)} ms (budget ${budgetMs} ms)`).toBeLessThan(budgetMs)
  return result
}

beforeAll(async () => {
  t = await createTestDb()
  await prepareKpiDb(t)
  const { people } = t

  // 45 technicians, 9 per branch, with their staff history.
  await t.q(
    `insert into staff (name, email, phone, role, branch_id)
     select 'Team ' || lpad(n::text, 2, '0'),
            'team' || lpad(n::text, 2, '0') || '@sejuk.example.com',
            '6012888' || lpad(n::text, 4, '0'),
            'technician',
            (select id from branches order by name offset ((n - 1) % 5) limit 1)
       from generate_series(1, ${TECHNICIANS}) n`,
  )
  await t.q(`update staff_history set created_at = timestamptz '2025-06-01 00:00:00+08'`)

  // Orders: skip the row triggers for the bulk load (the data is consistent by construction).
  await t.q(`set session_replication_role = replica`)
  await t.q(
    `create temp table gen as
     select n,
            (select id from branches order by name offset ((n - 1) % 5) limit 1) as branch_id,
            (select s.id from staff s where s.name like 'Team %' and s.branch_id =
               (select id from branches order by name offset ((n - 1) % 5) limit 1)
              order by s.name offset ((n / 5) % 9) limit 1) as tech_id,
            timestamptz '${YEAR_START} 08:00:00+08'
              + (n::numeric * 364 / ${ORDERS}) * interval '1 day' as created_at,
            case when n % 20 < 17 then 'closed' when n % 20 = 17 then 'reviewed'
                 when n % 20 = 18 then 'job_done' else 'in_progress' end::order_status as status
       from generate_series(1, ${ORDERS}) n`,
  )
  await t.q(
    `insert into orders (id, order_no, branch_id, customer_name, customer_phone, customer_address,
                         problem_description, service_type_id, quoted_price, assigned_technician_id,
                         status, scheduled_at, created_by, created_at, updated_at)
     select gen_random_uuid(), 'GEN' || g.n, g.branch_id, 'Customer ' || g.n, '60123456789', 'Address',
            'Problem', (select id from service_types order by name offset (g.n % 5) limit 1),
            (100 + (g.n % 9) * 50)::numeric, g.tech_id, g.status, g.created_at, $1, g.created_at, g.created_at
       from gen g`,
    [people.admin],
  )
  await t.q(
    `insert into order_completions (order_id, work_done, extra_charges, technician_id, completed_at)
     select o.id, 'Done', (substr(o.order_no, 4)::int % 3) * 10, o.assigned_technician_id, o.created_at + interval '4 hours'
       from orders o where o.order_no like 'GEN%' and o.status in ('job_done', 'reviewed', 'closed')`,
  )
  await t.q(
    `insert into audit_log (order_id, actor_id, actor_role, action, from_status, to_status, created_at)
     select o.id, $1, 'manager', 'reviewed', 'job_done', 'reviewed', o.created_at + interval '1 day'
       from orders o where o.order_no like 'GEN%' and o.status in ('reviewed', 'closed')`,
    [people.managerSA],
  )
  await t.q(
    `insert into audit_log (order_id, actor_id, actor_role, action, from_status, to_status, note, created_at)
     select o.id, $1, 'manager', 'returned_for_rework', 'job_done', 'in_progress', 'Redo',
            o.created_at + interval '6 hours'
       from orders o where o.order_no like 'GEN%' and substr(o.order_no, 4)::int % 10 = 0`,
    [people.managerSA],
  )
  await t.q(
    `insert into order_reschedules (order_id, old_scheduled_at, new_scheduled_at, reason, requested_by,
                                    performed_by, technician_id, created_at)
     select o.id, o.created_at, case when n % 4 = 0 then null else o.created_at + interval '2 days' end,
            (array['customer_not_home', 'parts_unavailable', 'weather', 'technician_unavailable', 'other'])[1 + n % 5]::reschedule_reason,
            (array['customer', 'technician', 'admin'])[1 + n % 3]::reschedule_party,
            $1, o.assigned_technician_id, o.created_at + interval '3 hours'
       from (select o.*, substr(o.order_no, 4)::int as n from orders o where o.order_no like 'GEN%') o
      where o.n % 6 = 0`,
    [people.admin],
  )
  await t.q(
    `insert into payments (order_id, amount, method, recorded_by, recorded_at)
     select o.id, o.quoted_price, 'cash', $1, o.created_at + interval '2 days'
       from orders o where o.order_no like 'GEN%' and o.status = 'closed'`,
    [people.finance],
  )
  await t.q(
    `insert into customer_messages (order_id, channel, phone, prepared_body, body, status, confirmed_by, confirmed_at, created_at)
     select o.id, 'whatsapp', '60123456789', 'Done', 'Done', 'sent', $1, o.created_at + interval '5 hours',
            o.created_at + interval '4 hours'
       from orders o where o.order_no like 'GEN%' and o.status in ('reviewed', 'closed')`,
    [people.ali],
  )
  await t.q(
    `insert into customer_feedback (message_id, order_id, technician_id, branch_id, rating, working_well, source, created_at)
     select m.id, o.id, o.assigned_technician_id, o.branch_id, 1 + substr(o.order_no, 4)::int % 5,
            substr(o.order_no, 4)::int % 7 <> 0, 'link', m.created_at + interval '1 day'
       from orders o join customer_messages m on m.order_id = o.id
      where o.order_no like 'GEN%' and substr(o.order_no, 4)::int % 5 < 3`,
  )
  await t.q(`set session_replication_role = origin`)
  await t.q('analyze')
}, 240_000)

afterAll(async () => {
  console.info('KPI read timings (ms, PGlite):', JSON.stringify(timings))
  await t.close()
})

describe('AC17 every dashboard read stays inside its time budget with a year of data for 45 teams', () => {
  const admin = () => t.people.admin
  const week = { start: '2026-10-12', end: '2026-10-19' }
  const month = { start: '2026-09-01', end: '2026-10-01' }
  const year = { start: YEAR_START, end: YEAR_END }

  it('generated the data it claims to', async () => {
    const [counts] = await t.q<{ orders: number; techs: number }>(
      `select (select count(*) from orders where order_no like 'GEN%')::int as orders,
              (select count(*) from staff where name like 'Team %')::int as techs`,
    )
    expect(counts).toEqual({ orders: ORDERS, techs: TECHNICIANS })
  })

  it('the week view: cards, leaderboard and an 8-week trend', async () => {
    const cards = await timed('summary week', () => summary(t, admin(), week.start, week.end), VIEW_BUDGET_MS)
    expect(num(cards.jobs_completed)).toBeGreaterThan(100)
    const rows = await timed('technicians week', () => technicians(t, admin(), week.start, week.end), VIEW_BUDGET_MS)
    expect(rows.length).toBeGreaterThanOrEqual(TECHNICIANS)
    const points = await timed('trend 8 weeks', () => trend(t, admin(), 'week', week.end, 8), VIEW_BUDGET_MS)
    expect(points).toHaveLength(8)
    // The cards and the leaderboard still add up at this size.
    expect(rows.reduce((n, r) => n + r.jobs_completed, 0)).toBe(num(cards.jobs_completed))
  })

  it('the month view: cards, leaderboard, branch comparison and a 6-month trend', async () => {
    await timed('summary month', () => summary(t, admin(), month.start, month.end), VIEW_BUDGET_MS)
    await timed('technicians month', () => technicians(t, admin(), month.start, month.end), VIEW_BUDGET_MS)
    const branches = await timed('branches month', () => branchesKpi(t, admin(), month.start, month.end), VIEW_BUDGET_MS)
    expect(branches).toHaveLength(5)
    await timed('trend 6 months', () => trend(t, admin(), 'month', month.end, 6), VIEW_BUDGET_MS)
  })

  it('a Manager’s view and a technician’s drill-down', async () => {
    await timed('summary week manager', () => summary(t, t.people.managerSA, week.start, week.end), VIEW_BUDGET_MS)
    const [team] = await t.q<{ id: string }>(`select id from staff where name = 'Team 01'`)
    const list = await timed('events month', () => events(t, admin(), team.id, month.start, month.end), VIEW_BUDGET_MS)
    expect(list.length).toBeGreaterThan(0)
    await timed('trend technician', () => trend(t, admin(), 'week', week.end, 8, null, team.id), VIEW_BUDGET_MS)
  })

  it('the widest ranges the database serves: a full year and a 26-week trend', async () => {
    await timed('summary year', () => summary(t, admin(), year.start, year.end), WIDE_BUDGET_MS)
    const rows = await timed('technicians year', () => technicians(t, admin(), year.start, year.end), WIDE_BUDGET_MS)
    expect(rows.length).toBeGreaterThanOrEqual(TECHNICIANS)
    await timed('branches year', () => branchesKpi(t, admin(), year.start, year.end), WIDE_BUDGET_MS)
    await timed('trend 26 weeks', () => trend(t, admin(), 'week', year.end, 26), WIDE_BUDGET_MS)
  })
})
