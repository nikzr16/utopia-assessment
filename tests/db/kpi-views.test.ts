import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { addDays } from '../../src/domain'
import { createTestDb, type TestDb } from './helpers'
import {
  addTechnician,
  approvedJob,
  branchesKpi,
  byName,
  events,
  myt,
  num,
  openJob,
  payAt,
  prepareKpiDb,
  rate,
  reschedule,
  returnForRework,
  setHistory,
  summary,
  technicians,
  trend,
  week,
} from './kpiHelpers'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
  await prepareKpiDb(t)
})
afterAll(() => t.close())

const admin = () => t.people.admin
/** A `date` column as `YYYY-MM-DD`, whether the driver gives a string or a Date. */
const dateOf = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v))
const day = (start: string, n: number, time = '10:00:00') => myt(addDays(start, n), time)

// ---------------------------------------------------------------------------
// AC10: who is listed, from the staff history
// ---------------------------------------------------------------------------
describe('AC10 every technician active in the branch during the period is listed', () => {
  it('lists technicians who joined or left mid-week, shows zeros, tags inactive ones, and counts active ones at the end', async () => {
    const w = week(0)
    const penang = await t.branchId('Penang')
    await addTechnician(t, 'Penang Whole', 'Penang')
    const left = await addTechnician(t, 'Penang Left', 'Penang')
    const joined = await addTechnician(t, 'Penang Joined', 'Penang')
    const later = await addTechnician(t, 'Penang Later', 'Penang')
    const before = await addTechnician(t, 'Penang Before', 'Penang')

    const early = myt('2025-12-01', '00:00:00')
    await setHistory(t, left, [
      { at: early, branchId: penang, active: true },
      { at: day(w.start, 2, '12:00:00'), branchId: penang, active: false },
    ])
    await setHistory(t, joined, [{ at: day(w.start, 2, '09:00:00'), branchId: penang, active: true }])
    await setHistory(t, later, [{ at: myt(w.end, '09:00:00'), branchId: penang, active: true }])
    await setHistory(t, before, [
      { at: early, branchId: penang, active: true },
      { at: myt(addDays(w.start, -3), '12:00:00'), branchId: penang, active: false },
    ])
    for (const id of [left, before]) await t.setActiveIgnoringOpenJobs(id, false)

    const rows = await technicians(t, admin(), w.start, w.end, penang)
    expect(rows.map((r) => r.name).sort()).toEqual(['Penang Joined', 'Penang Left', 'Penang Whole'])
    // Quiet teams show zeros; the one who left is tagged inactive.
    expect(byName(rows, 'Penang Whole')).toMatchObject({ jobs_completed: 0, rescheduled: 0, returned: 0, rated: 0, average_rating: null, active: true })
    expect(num(byName(rows, 'Penang Whole').total_amount)).toBe(0)
    expect(byName(rows, 'Penang Left').active).toBe(false)
    // Managers and Admins are never on the technician list.
    expect(rows.every((r) => !['Lim Mei Ling', 'Aisyah Rahman'].includes(r.name))).toBe(true)

    // Active technicians at the end of the week: Whole and Joined (Left left, Later joins next week).
    expect(num((await summary(t, admin(), w.start, w.end, penang)).active_technicians)).toBe(2)
    const comparison = await branchesKpi(t, admin(), w.start, w.end)
    expect(num(comparison.find((r) => r.branch_name === 'Penang')!.active_technicians)).toBe(2)

    // The week before Left joined: nobody of them was there yet; Before left before this week.
    const prev = week(0)
    const earlier = await technicians(t, admin(), addDays(prev.start, -7), prev.start, penang)
    expect(earlier.map((r) => r.name).sort()).toEqual(['Penang Before', 'Penang Left', 'Penang Whole'])
  })

  it('lists a person with a counted job even when the staff history no longer shows them active', async () => {
    const w = week(1)
    const jb = await t.branchId('Johor Bahru')
    const ghost = await addTechnician(t, 'Ghost Technician', 'Johor Bahru')
    await approvedJob(t, { tech: ghost, branch: 'Johor Bahru', at: day(w.start, 1) })
    await t.setActiveIgnoringOpenJobs(ghost, false)
    await setHistory(t, ghost, [
      { at: myt('2025-12-01', '00:00:00'), branchId: jb, active: true },
      { at: myt('2025-12-15', '00:00:00'), branchId: jb, active: false },
    ])
    const rows = await technicians(t, admin(), w.start, w.end, jb)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ name: 'Ghost Technician', jobs_completed: 1, active: false })
    // Not active at the end of the period, so not in the active count.
    expect(num((await summary(t, admin(), w.start, w.end, jb)).active_technicians)).toBe(0)
  })

  it('returns zero rows for a branch with no technicians, and zero cards with an empty reason table', async () => {
    const w = week(2)
    const kk = await t.branchId('Kota Kinabalu')
    expect(await technicians(t, admin(), w.start, w.end, kk)).toEqual([])
    const cards = await summary(t, admin(), w.start, w.end, kk)
    expect(cards).toMatchObject({
      jobs_completed: 0, rescheduled: 0, postponed: 0, returned: 0, rated: 0, average_rating: null,
      poor_ratings: 0, active_technicians: 0,
    })
    expect(num(cards.total_amount)).toBe(0)
    expect(num(cards.collected)).toBe(0)
    expect(Object.keys(cards.reason_by_requester as object).sort()).toEqual([
      'customer_not_home', 'other', 'parts_unavailable', 'technician_unavailable', 'weather',
    ])
  })
})

// ---------------------------------------------------------------------------
// AC11: order and ties
// ---------------------------------------------------------------------------
describe('AC11 the leaderboard is ordered by jobs, then amount, then name; ties share a rank', () => {
  it('ranks 1, 2, 2, 4, 5, 5 and orders equal rows by name', async () => {
    const w = week(3)
    const jb = await t.branchId('Johor Bahru')
    const mk = (name: string) => addTechnician(t, name, 'Johor Bahru')
    const [a, b, c, d] = await Promise.all([mk('Tie B'), mk('Tie A'), mk('Tie C'), mk('Tie D')])
    await mk('Tie F')
    await mk('Tie E')
    const job = (tech: string, price: number, n: number) =>
      approvedJob(t, { tech, branch: 'Johor Bahru', price, at: day(w.start, n) })
    await job(a, 100, 0); await job(a, 100, 1) // 2 jobs, RM 200
    await job(b, 150, 0); await job(b, 50, 2) // 2 jobs, RM 200: tied with the one above
    await job(c, 200, 0); await job(c, 100, 3) // 2 jobs, RM 300: ahead on amount
    await job(d, 999, 1) // 1 job, however big

    const rows = await technicians(t, admin(), w.start, w.end, jb)
    expect(rows.map((r) => [r.name, r.rank])).toEqual([
      ['Tie C', 1], ['Tie A', 2], ['Tie B', 2], ['Tie D', 4], ['Tie E', 5], ['Tie F', 5],
    ])
  })
})

// ---------------------------------------------------------------------------
// AC9: branch comparison
// ---------------------------------------------------------------------------
describe('AC9 branch comparison', () => {
  it('shows every branch with its own figures, and counts everything in the order’s branch', async () => {
    const w = week(4)
    const kl = await t.branchId('Kuala Lumpur')
    const klJob = await approvedJob(t, { tech: t.people.john, branch: 'Kuala Lumpur', price: 400, at: day(w.start, 1) })
    await rate(t, klJob, 5)
    await payAt(t, klJob, 150, day(w.start, 2))
    const klOpen = (await t.createOrder({ technician: t.people.john, branch: 'Kuala Lumpur' })).id as string
    await reschedule(t, klOpen, { at: day(w.start, 3), newAt: null })
    const klReturn = await openJob(t, { tech: t.people.john, branch: 'Kuala Lumpur' })
    await returnForRework(t, klReturn, day(w.start, 4))
    await approvedJob(t, { tech: t.people.ali, branch: 'Shah Alam', price: 90, at: day(w.start, 1) })
    // Ali reads and approves in Shah Alam: nothing of it leaks into Kuala Lumpur.

    const rows = await branchesKpi(t, admin(), w.start, w.end)
    expect(rows.map((r) => r.branch_name)).toEqual(['Johor Bahru', 'Kota Kinabalu', 'Kuala Lumpur', 'Penang', 'Shah Alam'])
    const byBranch = (name: string) => rows.find((r) => r.branch_name === name)!
    expect(byBranch('Kuala Lumpur')).toMatchObject({
      branch_id: kl, jobs_completed: 1, rescheduled: 0, postponed: 1, reschedules: 1, returned: 1, rated: 1, poor_ratings: 0,
    })
    expect(num(byBranch('Kuala Lumpur').total_amount)).toBe(400)
    expect(num(byBranch('Kuala Lumpur').collected)).toBe(150)
    expect(num(byBranch('Kuala Lumpur').average_rating)).toBe(5)
    expect(byBranch('Shah Alam')).toMatchObject({ jobs_completed: 1, rated: 0, average_rating: null })
    expect(byBranch('Johor Bahru')).toMatchObject({ jobs_completed: 0, returned: 0 })

    // Active technicians per branch, at the end of the period (staff table agrees: nobody here changed).
    const staffCounts = await t.q<{ name: string; n: number }>(
      `select b.name, count(s.id)::int as n from branches b
         left join staff s on s.branch_id = b.id and s.role = 'technician' and s.active
        group by b.name`,
    )
    for (const { name, n } of staffCounts) expect(num(byBranch(name).active_technicians), name).toBe(n)
  })
})

// ---------------------------------------------------------------------------
// AC8: trend
// ---------------------------------------------------------------------------
describe('AC8 trend over weeks and months', () => {
  let tech: string
  const w0 = week(30)

  beforeAll(async () => {
    tech = await addTechnician(t, 'Trender')
    await approvedJob(t, { tech, price: 100, at: day(w0.start, 1) }) // week 30
    // week 31: nothing
    const w32 = week(32)
    await approvedJob(t, { tech, price: 100, at: day(w32.start, 0) }) // week 32
    const r = await approvedJob(t, { tech, price: 50, at: day(w32.start, 5) })
    await rate(t, r, 4)
    const open = (await t.createOrder({ technician: tech })).id as string
    await reschedule(t, open, { at: day(w32.start, 2) })
    const w33 = week(33)
    const rated = await approvedJob(t, { tech, price: 70, at: day(w33.start, 6, '23:59:59') })
    await rate(t, rated, 5)
  })

  it('returns one row per week, oldest first, with empty weeks as zeros', async () => {
    const rows = await trend(t, admin(), 'week', week(34).start, 4, null, tech)
    expect(rows.map((r) => dateOf(r.period_start))).toEqual([week(30).start, week(31).start, week(32).start, week(33).start])
    expect(rows.map((r) => dateOf(r.period_end))).toEqual([week(31).start, week(32).start, week(33).start, week(34).start])
    expect(rows.map((r) => r.jobs_completed)).toEqual([1, 0, 2, 1])
    expect(rows.map((r) => num(r.total_amount))).toEqual([100, 0, 150, 70])
    expect(rows.map((r) => r.reschedules)).toEqual([0, 0, 1, 0])
    expect(rows.map((r) => (r.average_rating === null ? null : num(r.average_rating)))).toEqual([null, null, 4, 5])
  })

  it('makes the last row the week holding the day before p_end', async () => {
    // p_end in the middle of a week: the week of the day before.
    const mid = day(week(33).start, 2).slice(0, 10)
    const rows = await trend(t, admin(), 'week', mid, 2, null, tech)
    expect(rows.map((r) => dateOf(r.period_start))).toEqual([week(32).start, week(33).start])
    // p_end on a Monday: the week that just ended.
    const monday = await trend(t, admin(), 'week', week(33).start, 1, null, tech)
    expect(monday.map((r) => dateOf(r.period_start))).toEqual([week(32).start])
  })

  it('groups by calendar month', async () => {
    const rows = await trend(t, admin(), 'month', '2026-09-01', 3, null, tech)
    expect(rows.map((r) => dateOf(r.period_start))).toEqual(['2026-06-01', '2026-07-01', '2026-08-01'])
    expect(rows.map((r) => dateOf(r.period_end))).toEqual(['2026-07-01', '2026-08-01', '2026-09-01'])
    // The four jobs of weeks 30 and 32-33 fall in August (weeks start 3 Aug).
    expect(rows.map((r) => r.jobs_completed)).toEqual([0, 0, 4])
  })

  it('narrows by branch', async () => {
    const kl = await t.branchId('Kuala Lumpur')
    const rows = await trend(t, admin(), 'week', week(34).start, 4, kl, tech)
    expect(rows.map((r) => r.jobs_completed)).toEqual([0, 0, 0, 0])
  })
})

// ---------------------------------------------------------------------------
// AC16: the jobs, reschedules and returns behind the numbers
// ---------------------------------------------------------------------------
describe('AC16 a technician’s events are the rows behind their numbers', () => {
  it('lists completed, rescheduled, postponed and returned rows, latest first, adding up to the leaderboard', async () => {
    const w = week(40)
    const tech = await addTechnician(t, 'Driller')
    const done = await approvedJob(t, { tech, price: 250, extra: 20, at: day(w.start, 1) })
    await rate(t, done, 2, false)
    const open = (await t.createOrder({ technician: tech })).id as string
    await reschedule(t, open, { at: day(w.start, 2), requestedBy: 'customer', reason: 'customer_not_home' })
    await reschedule(t, open, { at: day(w.start, 3), requestedBy: 'technician', reason: 'other', newAt: null })
    const back = await openJob(t, { tech })
    await returnForRework(t, back, day(w.start, 4))
    // Someone else's events are not in the list.
    await approvedJob(t, { tech: t.people.bala, at: day(w.start, 1) })

    const rows = await events(t, admin(), tech, w.start, w.end)
    expect(rows.map((r) => r.kind)).toEqual(['returned', 'postponed', 'rescheduled', 'completed'])
    const completed = rows.find((r) => r.kind === 'completed')!
    expect(completed).toMatchObject({
      order_id: done, service_type: 'Repair', branch_name: 'Shah Alam', rating: 2, working_well: false,
    })
    expect(num(completed.amount)).toBe(270)
    expect(rows.find((r) => r.kind === 'rescheduled')).toMatchObject({
      order_id: open, reason: 'customer_not_home', requested_by: 'customer', amount: null, rating: null,
    })
    expect(rows.find((r) => r.kind === 'postponed')).toMatchObject({ reason: 'other', requested_by: 'technician', note: 'Another reason' })
    expect(rows.find((r) => r.kind === 'returned')).toMatchObject({ order_id: back, note: 'Please redo the gas refill' })

    const lead = byName(await technicians(t, admin(), w.start, w.end), 'Driller')
    expect(lead).toMatchObject({ jobs_completed: 1, rescheduled: 1, postponed: 1, returned: 1 })

    // A branch filter on another branch leaves nothing.
    const kl = await t.branchId('Kuala Lumpur')
    expect(await events(t, admin(), tech, w.start, w.end, kl)).toEqual([])
  })

  it('has cards that add up to the leaderboard rows', async () => {
    const w = week(40)
    const rows = await technicians(t, admin(), w.start, w.end)
    const cards = await summary(t, admin(), w.start, w.end)
    const sum = (pick: (r: (typeof rows)[number]) => number) => rows.reduce((n, r) => n + pick(r), 0)
    expect(num(cards.jobs_completed)).toBe(sum((r) => r.jobs_completed))
    expect(num(cards.total_amount)).toBe(sum((r) => num(r.total_amount)))
    expect(num(cards.collected)).toBe(sum((r) => num(r.collected)))
    expect(num(cards.returned)).toBe(sum((r) => r.returned))
    expect(num(cards.rated)).toBe(sum((r) => r.rated))
    expect(num(cards.poor_ratings)).toBe(sum((r) => r.poor_ratings))
    expect(num(cards.rescheduled) + num(cards.postponed)).toBe(sum((r) => r.reschedules))
  })
})
