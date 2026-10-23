import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './helpers'
import {
  addTechnician,
  approvedJob,
  byName,
  events,
  managerOf,
  myt,
  num,
  openJob,
  payAt,
  prepareKpiDb,
  rate,
  reschedule,
  resubmitAndApprove,
  returnForRework,
  setApprovedAt,
  setHistory,
  summary,
  technicians,
  week,
} from './kpiHelpers'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
  await prepareKpiDb(t)
})
afterAll(() => t.close())

const admin = () => t.people.admin

// ---------------------------------------------------------------------------
// AC2: what counts as a completed job, and when
// ---------------------------------------------------------------------------
describe('AC2 a job counts once, when a Manager approves it', () => {
  it('counts approved jobs with their final amount, and not Job Done, rework, in-progress or cancelled ones', async () => {
    const w = week(0)
    const tech = await addTechnician(t, 'Definer')
    const j1 = await approvedJob(t, { tech, price: 200, extra: 30, at: myt(w.start, '10:00:00') })
    await approvedJob(t, { tech, price: 100, at: myt(addDaysTo(w.start, 2), '15:00:00') })

    // Approved this week, closed later: still counted, in the week of the approval.
    const closed = (await t.createOrder({ technician: tech, quotedPrice: 75 })).id as string
    await t.closeOrder(closed)
    await setApprovedAt(t, closed, myt(addDaysTo(w.start, 3), '09:00:00'))

    // Not counted: waiting for review, being worked on, returned for rework, cancelled.
    await openJob(t, { tech, target: 'job_done' })
    await openJob(t, { tech, target: 'in_progress' })
    const reworked = await openJob(t, { tech, target: 'job_done' })
    await returnForRework(t, reworked, myt(addDaysTo(w.start, 1)))
    const cancelled = (await t.createOrder({ technician: tech })).id as string
    await t.transition(admin(), cancelled, 'cancelled', 'Customer cancelled')

    const row = byName(await technicians(t, admin(), w.start, w.end), 'Definer')
    expect(row.jobs_completed).toBe(3)
    expect(num(row.total_amount)).toBe(230 + 100 + 75)
    expect(row.returned).toBe(1)

    // The numbers match the order pages: same approval time and final amount.
    const [page] = await t.q<{ reviewed_at: string; final_amount: string }>(
      'select reviewed_at, final_amount from order_review_summary where id = $1',
      [j1],
    )
    const listed = await events(t, admin(), tech, w.start, w.end)
    const completed = listed.find((e) => e.order_id === j1)!
    expect(new Date(completed.happened_at as string).getTime()).toBe(new Date(page.reviewed_at).getTime())
    expect(num(completed.amount)).toBe(num(page.final_amount))
    expect(completed.kind).toBe('completed')

    const cards = await summary(t, admin(), w.start, w.end)
    expect(num(cards.jobs_completed)).toBeGreaterThanOrEqual(3)
  })

  it('splits weeks and months at Malaysia midnight (Sunday 23:59:59 vs Monday 00:00:00)', async () => {
    const w1 = week(1)
    const w2 = week(2)
    const tech = await addTechnician(t, 'Midnight')
    await approvedJob(t, { tech, at: myt(w1.sunday, '23:59:59') })
    await approvedJob(t, { tech, at: myt(w2.start, '00:00:00') })
    // 00:00 Monday in Malaysia is still Sunday 16:00 in UTC: UTC days would get this wrong.
    await approvedJob(t, { tech, at: myt(w2.start, '00:00:01') })

    expect(byName(await technicians(t, admin(), w1.start, w1.end), 'Midnight').jobs_completed).toBe(1)
    expect(byName(await technicians(t, admin(), w2.start, w2.end), 'Midnight').jobs_completed).toBe(2)

    // A calendar month: 31 Jan 23:59:59 is January, 1 Feb 00:00:00 is February.
    const monthTech = await addTechnician(t, 'Month Tester')
    await approvedJob(t, { tech: monthTech, at: myt('2026-01-31', '23:59:59') })
    await approvedJob(t, { tech: monthTech, at: myt('2026-02-01', '00:00:00') })
    expect(byName(await technicians(t, admin(), '2026-01-01', '2026-02-01'), 'Month Tester').jobs_completed).toBe(1)
    expect(byName(await technicians(t, admin(), '2026-02-01', '2026-03-01'), 'Month Tester').jobs_completed).toBe(1)
  })

  it('counts a reworked job once, in the week of its final approval; the return counts where it was logged', async () => {
    const w1 = week(3)
    const w2 = week(4)
    const tech = await addTechnician(t, 'Reworker')
    const id = await openJob(t, { tech, target: 'job_done' })
    await returnForRework(t, id, myt(addDaysTo(w1.start, 2)))
    await resubmitAndApprove(t, id, tech, myt(addDaysTo(w2.start, 1)))

    const first = byName(await technicians(t, admin(), w1.start, w1.end), 'Reworker')
    expect([first.jobs_completed, first.returned]).toEqual([0, 1])
    const second = byName(await technicians(t, admin(), w2.start, w2.end), 'Reworker')
    expect([second.jobs_completed, second.returned]).toEqual([1, 0])
  })
})

// ---------------------------------------------------------------------------
// AC3: who gets the credit
// ---------------------------------------------------------------------------
describe('AC3 credit goes to the technician of that moment', () => {
  it('credits the technician who submitted the approved work after a reassign', async () => {
    const w = week(5)
    const first = await addTechnician(t, 'First Assigned')
    const second = await addTechnician(t, 'Second Assigned')
    const id = (await t.createOrder({ technician: first })).id as string
    await t.transition(admin(), id, 'assigned', null, second) // reassign before work starts
    await t.advance(id, 'reviewed')
    await setApprovedAt(t, id, myt(addDaysTo(w.start, 1)))

    const rows = await technicians(t, admin(), w.start, w.end)
    expect(byName(rows, 'First Assigned').jobs_completed).toBe(0)
    expect(byName(rows, 'Second Assigned').jobs_completed).toBe(1)
  })

  it('keeps a job in the order’s branch and with the same technician after the technician moves or leaves', async () => {
    const w = week(6)
    const sa = await t.branchId('Shah Alam')
    const kl = await t.branchId('Kuala Lumpur')
    const mover = await addTechnician(t, 'Mover', 'Shah Alam')
    const leaver = await addTechnician(t, 'Leaver', 'Shah Alam')
    await approvedJob(t, { tech: mover, branch: 'Shah Alam', price: 120, at: myt(addDaysTo(w.start, 1)) })
    await approvedJob(t, { tech: leaver, branch: 'Shah Alam', price: 80, at: myt(addDaysTo(w.start, 1)) })

    // Mover joins Kuala Lumpur on Thursday; Leaver is deactivated on Wednesday.
    await t.q('update staff set branch_id = $2 where id = $1', [mover, kl])
    await setHistory(t, mover, [
      { at: myt('2025-12-01', '00:00:00'), branchId: sa, active: true },
      { at: myt(addDaysTo(w.start, 3), '00:00:00'), branchId: kl, active: true },
    ])
    await t.setActiveIgnoringOpenJobs(leaver, false)
    await setHistory(t, leaver, [
      { at: myt('2025-12-01', '00:00:00'), branchId: sa, active: true },
      { at: myt(addDaysTo(w.start, 2), '00:00:00'), branchId: sa, active: false },
    ])

    const all = await technicians(t, admin(), w.start, w.end)
    expect(byName(all, 'Mover').jobs_completed).toBe(1)
    expect(byName(all, 'Leaver')).toMatchObject({ jobs_completed: 1, active: false })
    expect(num(byName(all, 'Leaver').total_amount)).toBe(80)

    // The Shah Alam job stays with Shah Alam; Mover is also listed (with 0) in Kuala Lumpur.
    const inKl = await technicians(t, admin(), w.start, w.end, kl)
    expect(byName(inKl, 'Mover')).toMatchObject({ jobs_completed: 0, total_amount: expect.anything() })
    expect(num(byName(inKl, 'Mover').total_amount)).toBe(0)
    expect(inKl.some((r) => r.name === 'Leaver')).toBe(false)
    const inSa = await technicians(t, admin(), w.start, w.end, sa)
    expect(byName(inSa, 'Mover').jobs_completed).toBe(1)
    expect(byName(inSa, 'Leaver').jobs_completed).toBe(1)

    // Leaver is not listed the following week: gone before it, nothing counted in it.
    const next = week(7)
    expect((await technicians(t, admin(), next.start, next.end)).some((r) => r.name === 'Leaver')).toBe(false)
  })

  it('credits a reschedule to the technician assigned when it was logged; none before an order has one', async () => {
    const w = week(8)
    const one = await addTechnician(t, 'Resch One')
    const two = await addTechnician(t, 'Resch Two')
    const id = (await t.createOrder({ technician: one })).id as string
    await reschedule(t, id, { at: myt(addDaysTo(w.start, 1)), requestedBy: 'customer', reason: 'other' })
    await t.transition(admin(), id, 'assigned', null, two) // reassigned afterwards
    await reschedule(t, id, { at: myt(addDaysTo(w.start, 2)), requestedBy: 'technician', reason: 'weather' })
    const unassigned = (await t.createOrder()).id as string
    await reschedule(t, unassigned, { at: myt(addDaysTo(w.start, 2)), requestedBy: 'customer', reason: 'customer_not_home' })

    const rows = await technicians(t, admin(), w.start, w.end)
    expect(byName(rows, 'Resch One').reschedules).toBe(1)
    expect(byName(rows, 'Resch Two').reschedules).toBe(1)
    // The unassigned order's reschedule is in the cards but belongs to nobody on the leaderboard.
    const cards = await summary(t, admin(), w.start, w.end)
    expect(num(cards.rescheduled) + num(cards.postponed)).toBe(3)
    expect(rows.reduce((n, r) => n + r.reschedules, 0)).toBe(2)
  })

  it('credits a rating to the technician stored on the visit', async () => {
    const w = week(9)
    const owner = await addTechnician(t, 'Visit Owner')
    const other = await addTechnician(t, 'Visit Other')
    const id = await approvedJob(t, { tech: owner, at: myt(addDaysTo(w.start, 1)) })
    await rate(t, id, 4, true, other)
    const rows = await technicians(t, admin(), w.start, w.end)
    expect(byName(rows, 'Visit Owner')).toMatchObject({ jobs_completed: 1, rated: 0 })
    expect(byName(rows, 'Visit Other')).toMatchObject({ jobs_completed: 0, rated: 1 })
  })
})

// ---------------------------------------------------------------------------
// AC4: total amount and collected
// ---------------------------------------------------------------------------
describe('AC4 total amount is approved work; collected is payments recorded in the period', () => {
  it('counts payments by the day they were recorded, whatever the job’s own week', async () => {
    const w = week(10)
    const tech = await addTechnician(t, 'Payer')
    // Approved in week 0 (earlier) but paid in this week: collected, not completed.
    const earlier = await approvedJob(t, { tech, price: 200, at: myt(week(0).start, '09:00:00') })
    await payAt(t, earlier, 100, myt(addDaysTo(w.start, 1)))
    // Approved this week, paid in two weeks' time and on the last second of this week.
    const now = await approvedJob(t, { tech, price: 300, at: myt(addDaysTo(w.start, 2)) })
    await payAt(t, now, 50, myt(w.sunday, '23:59:59'))
    await payAt(t, now, 25, myt(week(11).start, '00:00:00'))

    const row = byName(await technicians(t, admin(), w.start, w.end), 'Payer')
    expect(row.jobs_completed).toBe(1)
    expect(num(row.total_amount)).toBe(300)
    expect(num(row.collected)).toBe(150)
    const cards = await summary(t, admin(), w.start, w.end)
    expect(num(cards.collected)).toBeGreaterThanOrEqual(150)
  })
})

// ---------------------------------------------------------------------------
// AC5: reschedules
// ---------------------------------------------------------------------------
describe('AC5 reschedules and postponements are counted when logged, by requester and reason', () => {
  it('splits rescheduled and postponed, by who asked and why, in the week they were logged', async () => {
    const w = week(12)
    const tech = await addTechnician(t, 'Rescheduler')
    const mk = async () => (await t.createOrder({ technician: tech })).id as string
    const day = (n: number, time = '10:00:00') => myt(addDaysTo(w.start, n), time)
    await reschedule(t, await mk(), { at: day(1), requestedBy: 'customer', reason: 'customer_not_home' })
    await reschedule(t, await mk(), { at: day(2), requestedBy: 'technician', reason: 'parts_unavailable', newAt: null })
    await reschedule(t, await mk(), { at: day(3), requestedBy: 'admin', reason: 'weather' })
    await reschedule(t, await mk(), { at: day(4), requestedBy: 'customer', reason: 'other', newAt: null })
    // Not in this week: the second before Monday, and Monday of the next week.
    await reschedule(t, await mk(), { at: myt(addDaysTo(w.start, -1), '23:59:59') })
    await reschedule(t, await mk(), { at: myt(addDaysTo(w.start, 7), '00:00:00') })

    const row = byName(await technicians(t, admin(), w.start, w.end), 'Rescheduler')
    expect(row).toMatchObject({
      rescheduled: 2,
      postponed: 2,
      reschedules: 4,
      requested_by_customer: 2,
      requested_by_technician: 1,
      requested_by_admin: 1,
      reason_customer_not_home: 1,
      reason_parts_unavailable: 1,
      reason_weather: 1,
      reason_technician_unavailable: 0,
      reason_other: 1,
    })

    const cards = await summary(t, admin(), w.start, w.end)
    expect(cards).toMatchObject({ rescheduled: 2, postponed: 2, requested_by_customer: 2, reason_other: 1 })
    expect(cards.reason_by_requester).toEqual({
      customer_not_home: { customer: 1, technician: 0, admin: 0 },
      parts_unavailable: { customer: 0, technician: 1, admin: 0 },
      weather: { customer: 0, technician: 0, admin: 1 },
      technician_unavailable: { customer: 0, technician: 0, admin: 0 },
      other: { customer: 1, technician: 0, admin: 0 },
    })
  })
})

// ---------------------------------------------------------------------------
// AC6: ratings
// ---------------------------------------------------------------------------
describe('AC6 ratings follow the job: latest per order, average, rated out of completed, poor', () => {
  it('uses the latest rating per order and fills a late rating into its job’s week', async () => {
    const w = week(13)
    const tech = await addTechnician(t, 'Rater')
    const at = (n: number) => myt(addDaysTo(w.start, n))
    const five = await approvedJob(t, { tech, at: at(0) })
    const two = await approvedJob(t, { tech, at: at(0) })
    const notWorking = await approvedJob(t, { tech, at: at(1) })
    const late = await approvedJob(t, { tech, at: at(1) })
    await rate(t, five, 5)
    await rate(t, two, 2)
    await rate(t, notWorking, 4, false)

    // Rated twice over two visits: the latest visit counts (a poor first rating is replaced by 5).
    const redone = await openJob(t, { tech, target: 'job_done' })
    await rate(t, redone, 1, false)
    await returnForRework(t, redone, at(2))
    await t.submit(tech, redone)
    await rate(t, redone, 5)
    await t.tellCustomer(redone)
    await t.transition(await managerOf(t, redone), redone, 'reviewed')
    await setApprovedAt(t, redone, at(2))

    const before = byName(await technicians(t, admin(), w.start, w.end), 'Rater')
    expect(before).toMatchObject({ jobs_completed: 5, rated: 4, poor_ratings: 2, returned: 1 })
    expect(num(before.average_rating)).toBe(4) // (5 + 2 + 4 + 5) / 4

    // The customer answers after the week is over: it fills into the week of the job.
    await rate(t, late, 3)
    const after = byName(await technicians(t, admin(), w.start, w.end), 'Rater')
    expect(after).toMatchObject({ jobs_completed: 5, rated: 5, poor_ratings: 2 })
    expect(num(after.average_rating)).toBe(3.8) // 19 / 5, one decimal

    const cards = await summary(t, admin(), w.start, w.end)
    expect(num(cards.rated)).toBeGreaterThanOrEqual(5)
  })

  it('shows no average when nothing is rated, and ignores ratings of jobs not yet approved', async () => {
    const w = week(14)
    const tech = await addTechnician(t, 'Unrated')
    await approvedJob(t, { tech, at: myt(addDaysTo(w.start, 1)) })
    const waiting = await openJob(t, { tech, target: 'job_done' })
    await rate(t, waiting, 5)
    const row = byName(await technicians(t, admin(), w.start, w.end), 'Unrated')
    expect(row).toMatchObject({ jobs_completed: 1, rated: 0, average_rating: null, poor_ratings: 0 })
  })
})

// ---------------------------------------------------------------------------
// AC7: returns and Needs attention
// ---------------------------------------------------------------------------
describe('AC7 returns for rework are counted per technician; 3 or more is Needs attention', () => {
  it('counts every return logged in the period, flags 3 or more', async () => {
    const w = week(15)
    const busy = await addTechnician(t, 'Returned Often')
    const some = await addTechnician(t, 'Returned Twice')
    const day = (n: number, time = '09:00:00') => myt(addDaysTo(w.start, n), time)

    // One order returned three times: three log rows.
    const id = await openJob(t, { tech: busy, target: 'job_done' })
    for (const n of [0, 1, 2]) {
      await returnForRework(t, id, day(n))
      if (n < 2) await t.submit(busy, id)
    }
    const a = await openJob(t, { tech: some, target: 'job_done' })
    const b = await openJob(t, { tech: some, target: 'job_done' })
    await returnForRework(t, a, day(3))
    await returnForRework(t, b, day(4))
    // A return outside the week does not count.
    const outside = await openJob(t, { tech: some, target: 'job_done' })
    await returnForRework(t, outside, myt(addDaysTo(w.start, 7), '00:00:00'))

    const rows = await technicians(t, admin(), w.start, w.end)
    expect(byName(rows, 'Returned Often')).toMatchObject({ returned: 3, needs_attention: true, jobs_completed: 0 })
    expect(byName(rows, 'Returned Twice')).toMatchObject({ returned: 2, needs_attention: false })
    const cards = await summary(t, admin(), w.start, w.end)
    expect(cards.returned).toBe(5)
  })
})

// ---------------------------------------------------------------------------
// Helper: a day `n` days after a Malaysia day
// ---------------------------------------------------------------------------
function addDaysTo(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
