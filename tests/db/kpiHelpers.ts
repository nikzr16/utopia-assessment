import { addDays } from '../../src/domain'
import type { Row, TestDb } from './helpers'

/**
 * Fixtures for the KPI dashboard database tests (0007). Orders go through the
 * real RPCs; only the times are then moved (direct updates, tests only) so a
 * test can place an approval, a reschedule or a return on a chosen Malaysia
 * day. Each test uses its own Monday-Sunday week, far in the past, so tests
 * sharing one database never count each other's rows.
 */

/** Week `i` (0, 1, 2 …) counted from Monday 5 January 2026. */
export function week(i: number) {
  const start = addDays('2026-01-05', 7 * i)
  return { start, end: addDays(start, 7), sunday: addDays(start, 6) }
}

/** A Malaysia wall-clock time as an ISO instant string (`+08:00`). */
export const myt = (day: string, time = '12:00:00') => `${day}T${time}+08:00`

/** Remove the append-only guards so tests can backdate rows, and start every staff history before the test weeks. */
export async function prepareKpiDb(t: TestDb): Promise<void> {
  for (const [table, trigger] of [
    ['audit_log', 'audit_log_no_update_trg'],
    ['customer_feedback', 'customer_feedback_guard_trg'],
    ['customer_messages', 'customer_messages_guard_trg'],
    ['staff_history', 'staff_history_no_update_trg'],
  ]) {
    await t.q(`alter table ${table} disable trigger ${trigger}`)
  }
  await t.q(`update staff_history set created_at = timestamptz '2025-12-01 00:00:00+08'`)
}

export interface JobOptions {
  tech?: string
  branch?: string
  price?: number
  extra?: number
  /** When the Manager approved it (ISO instant). */
  at: string
}

/** An order approved (Reviewed) at `at`, through the real flow. */
export async function approvedJob(t: TestDb, o: JobOptions): Promise<string> {
  const order = await t.createOrder({
    technician: o.tech ?? t.people.ali,
    branch: o.branch,
    quotedPrice: o.price ?? 100,
  })
  const id = order.id as string
  await t.advance(id, 'reviewed', { extraCharges: o.extra })
  await setApprovedAt(t, id, o.at)
  return id
}

export async function setApprovedAt(t: TestDb, orderId: string, at: string): Promise<void> {
  await t.q(`update audit_log set created_at = $2 where order_id = $1 and action = 'reviewed'`, [orderId, at])
}

/** An assigned order moved on to `target` (default Job Done: waiting for review). */
export async function openJob(
  t: TestDb,
  o: { tech?: string; branch?: string; price?: number; target?: 'assigned' | 'in_progress' | 'job_done' } = {},
): Promise<string> {
  const order = await t.createOrder({
    technician: o.tech ?? t.people.ali,
    branch: o.branch,
    quotedPrice: o.price ?? 100,
  })
  const id = order.id as string
  await t.advance(id, o.target ?? 'job_done')
  return id
}

/** The Manager whose home branch is the order's. */
export async function managerOf(t: TestDb, orderId: string): Promise<string> {
  const rows = await t.q<{ id: string }>(
    `select s.id from staff s join orders o on o.id = $1
      where s.role = 'manager' and s.active and s.branch_id = o.branch_id order by s.name limit 1`,
    [orderId],
  )
  return rows[0].id
}

/** Return a Job Done order for rework, logged at `at`. */
export async function returnForRework(t: TestDb, orderId: string, at: string): Promise<void> {
  await t.transition(await managerOf(t, orderId), orderId, 'in_progress', 'Please redo the gas refill')
  await t.q(
    `update audit_log set created_at = $2
      where id = (select max(id) from audit_log where order_id = $1 and action = 'returned_for_rework')`,
    [orderId, at],
  )
}

/** Submit the completion again after a return, tell the customer, and approve at `at`. */
export async function resubmitAndApprove(t: TestDb, orderId: string, tech: string, at: string): Promise<void> {
  await t.submit(tech, orderId, { workDone: 'Redone properly' })
  await t.tellCustomer(orderId)
  await t.transition(await managerOf(t, orderId), orderId, 'reviewed')
  await setApprovedAt(t, orderId, at)
}

export interface RescheduleOptions {
  at: string
  requestedBy?: 'customer' | 'technician' | 'admin'
  reason?: 'customer_not_home' | 'parts_unavailable' | 'weather' | 'technician_unavailable' | 'other'
  /** null = postponed with no new date. */
  newAt?: string | null
}

/** Log a reschedule through the RPC, then place it at `at`. */
export async function reschedule(t: TestDb, orderId: string, o: RescheduleOptions): Promise<Row> {
  const reason = o.reason ?? 'weather'
  const entry = await t.rpcAs(t.people.admin, 'reschedule_order', {
    p_order_id: orderId,
    p_new_scheduled_at: o.newAt === undefined ? '2027-02-01T02:00:00Z' : o.newAt,
    p_reason: reason,
    p_requested_by: o.requestedBy ?? 'customer',
    p_note: reason === 'other' ? 'Another reason' : null,
  })
  await t.q(`update order_reschedules set created_at = $2 where id = $1`, [entry.id, o.at])
  return entry
}

/** A customer rating for the order's latest visit (message). Optionally for another technician. */
export async function rate(
  t: TestDb,
  orderId: string,
  rating: number,
  workingWell = true,
  technician: string | null = null,
): Promise<void> {
  await t.q(
    `insert into customer_feedback (message_id, order_id, technician_id, branch_id, rating, working_well, source)
     select m.id, o.id, coalesce($4::uuid, c.technician_id, o.assigned_technician_id), o.branch_id, $2, $3, 'link'
       from orders o
       left join order_completions c on c.order_id = o.id
       join lateral (select id from customer_messages where order_id = o.id
                      order by created_at desc, id desc limit 1) m on true
      where o.id = $1`,
    [orderId, rating, workingWell, technician],
  )
}

/** A payment recorded at `at`. */
export async function payAt(t: TestDb, orderId: string, amount: number, at: string): Promise<void> {
  const payment = await t.pay(t.people.finance, orderId, amount)
  await t.q(`update payments set recorded_at = $2 where id = $1`, [payment.id, at])
}

export interface HistoryState {
  at: string
  role?: 'technician' | 'manager' | 'admin' | 'finance'
  branchId: string
  active: boolean
}

/** Replace a person's staff history with these states (tests only: the table is append-only in the app). */
export async function setHistory(t: TestDb, staffId: string, states: HistoryState[]): Promise<void> {
  await t.q('delete from staff_history where staff_id = $1', [staffId])
  for (const s of states) {
    await t.q(
      `insert into staff_history (staff_id, action, role, branch_id, active, created_at)
       values ($1, 'created', $2, $3, $4, $5)`,
      [staffId, s.role ?? 'technician', s.branchId, s.active, s.at],
    )
  }
}

let phoneCounter = 0
/** A new active technician (mobile phone unique per call); history starts before the test weeks. */
export async function addTechnician(t: TestDb, name: string, branch = 'Shah Alam'): Promise<string> {
  phoneCounter += 1
  const rows = await t.q<{ id: string }>(
    `insert into staff (name, email, phone, role, branch_id)
     select $1, lower(replace($1, ' ', '.')) || '@sejuk.example.com', $2, 'technician', id
       from branches where name = $3 returning id`,
    [name, `6012999${String(1000 + phoneCounter)}`, branch],
  )
  const id = rows[0].id
  // A sign-in account with the same email links itself to the new staff row.
  await t.createAuthUser(`${name.toLowerCase().replace(/ /g, '.')}@sejuk.example.com`)
  await t.q(`update staff_history set created_at = timestamptz '2025-12-01 00:00:00+08' where staff_id = $1`, [id])
  return id
}

export interface TechRow {
  id: string
  name: string
  active: boolean
  branch_id: string
  branch_name: string
  jobs_completed: number
  total_amount: string | number
  collected: string | number
  rescheduled: number
  postponed: number
  reschedules: number
  requested_by_customer: number
  requested_by_technician: number
  requested_by_admin: number
  reason_customer_not_home: number
  reason_parts_unavailable: number
  reason_weather: number
  reason_technician_unavailable: number
  reason_other: number
  returned: number
  rated: number
  average_rating: string | number | null
  poor_ratings: number
  rank: number | null
  needs_attention: boolean
}

export const technicians = (t: TestDb, actor: string, start: string, end: string, branch: string | null = null) =>
  t.qAs<TechRow>(actor, 'select * from kpi_technicians($1::date, $2::date, $3::uuid)', [start, end, branch])

export const summary = async (t: TestDb, actor: string, start: string, end: string, branch: string | null = null) =>
  (await t.qAs<Row>(actor, 'select * from kpi_summary($1::date, $2::date, $3::uuid)', [start, end, branch]))[0]

export const branchesKpi = (t: TestDb, actor: string, start: string, end: string) =>
  t.qAs<Row>(actor, 'select * from kpi_branches($1::date, $2::date)', [start, end])

export const trend = (
  t: TestDb,
  actor: string,
  unit: string,
  end: string,
  count: number,
  branch: string | null = null,
  technician: string | null = null,
) =>
  t.qAs<Row>(actor, 'select * from kpi_trend($1, $2::date, $3, $4::uuid, $5::uuid)', [unit, end, count, branch, technician])

export const events = (
  t: TestDb,
  actor: string,
  technician: string,
  start: string,
  end: string,
  branch: string | null = null,
) =>
  t.qAs<Row>(actor, 'select * from kpi_technician_events($1::uuid, $2::date, $3::date, $4::uuid)', [
    technician,
    start,
    end,
    branch,
  ])

/** The row of one technician, by name. */
export const byName = (rows: TechRow[], name: string): TechRow => {
  const row = rows.find((r) => r.name === name)
  if (!row) throw new Error(`No leaderboard row for ${name}: ${rows.map((r) => r.name).join(', ')}`)
  return row
}

export const num = (v: unknown): number => Number(v)
