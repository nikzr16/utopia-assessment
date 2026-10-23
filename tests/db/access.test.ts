import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SERVICE_ROLE, SIGNED_OUT, createTestDb, expectRejects, type Identity, type TestDb } from './helpers'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

const TABLES = [
  'branches', 'staff', 'service_types', 'orders', 'order_completions', 'attachments',
  'payments', 'order_reschedules', 'audit_log', 'notifications', 'order_status_transitions',
  'customer_messages', 'customer_feedback',
]
const VIEWS = ['order_summary', 'latest_customer_messages', 'order_review_summary', 'order_feedback']
// 0005: settings only the definer functions read; RLS on, no policy, no grants.
const PRIVATE_TABLES = ['app_settings']
// 0005: the only functions signed-out visitors may call (the customer feedback page).
const ANON_FUNCTIONS = ['feedback_form', 'submit_feedback']
const ORDER_CHILDREN = ['order_completions', 'attachments', 'payments', 'order_reschedules', 'audit_log']

// ---------------------------------------------------------------------------
// Database shape: RLS everywhere, grants minimal
// ---------------------------------------------------------------------------
describe('Access migration: row-level security and grants', () => {
  it('enables row-level security on every table, with only authenticated read policies', async () => {
    const rls = await t.q<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity`,
    )
    expect(rls.map((r) => r.relname).sort()).toEqual([...TABLES, ...PRIVATE_TABLES].sort())

    const allTables = await t.q<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'`,
    )
    expect(allTables.map((r) => r.relname).sort()).toEqual([...TABLES, ...PRIVATE_TABLES].sort())

    const policies = await t.q<{ tablename: string; cmd: string; roles: string }>(
      `select tablename, cmd, roles::text as roles from pg_policies where schemaname = 'public'`,
    )
    expect(policies.map((p) => p.tablename).sort()).toEqual([...TABLES].sort())
    for (const p of policies) {
      expect(p.cmd).toBe('SELECT')
      expect(p.roles).toBe('{authenticated}')
    }
  })

  it('keeps the views security_invoker so the policies apply through them', async () => {
    for (const view of VIEWS) {
      const [v] = await t.q<{ reloptions: string[] | null }>(
        `select reloptions from pg_class where relname = $1`,
        [view],
      )
      expect(v.reloptions, view).toContain('security_invoker=true')
    }
  })

  it('grants authenticated read-only access: SELECT yes; INSERT/UPDATE/DELETE/TRUNCATE no', async () => {
    const privileges = await t.q<{ rel: string; priv: string; ok: boolean }>(
      `select r.rel, p.priv, has_table_privilege('authenticated', 'public.' || r.rel, p.priv) as ok
         from unnest($1::text[]) as r(rel),
              unnest(array['select','insert','update','delete','truncate','references','trigger']) as p(priv)`,
      [[...TABLES, ...VIEWS]],
    )
    for (const p of privileges) {
      expect(p.ok, `${p.rel} ${p.priv}`).toBe(p.priv === 'select')
    }
  })

  it('keeps app_settings away from every API role', async () => {
    const privileges = await t.q<{ role: string; priv: string }>(
      `select r.role, p.priv
         from unnest(array['anon','authenticated','service_role']) as r(role),
              unnest(array['select','insert','update','delete','truncate','references','trigger']) as p(priv)
        where has_table_privilege(r.role, 'public.app_settings', p.priv)`,
    )
    expect(privileges).toEqual([])
  })

  it('grants anon no table, view or sequence, and only the two feedback page functions', async () => {
    const tables = await t.q<{ rel: string; priv: string; ok: boolean }>(
      `select r.rel, p.priv, has_table_privilege('anon', 'public.' || r.rel, p.priv) as ok
         from unnest($1::text[]) as r(rel),
              unnest(array['select','insert','update','delete','truncate','references','trigger']) as p(priv)`,
      [[...TABLES, ...VIEWS, ...PRIVATE_TABLES]],
    )
    expect(tables.filter((r) => r.ok)).toEqual([])

    const seq = await t.q<{ ok: boolean }>(
      `select has_sequence_privilege('anon', 'public.order_no_seq', 'usage') as ok`,
    )
    expect(seq[0].ok).toBe(false)

    const fns = await t.q<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prokind = 'f'
          and has_function_privilege('anon', p.oid, 'execute')`,
    )
    expect(fns.map((f) => f.proname).sort()).toEqual([...ANON_FUNCTIONS].sort())
  })

  it('lets authenticated execute only the RPCs, the profile lookup, and the policy helpers', async () => {
    const fns = await t.q<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prokind = 'f'
          and has_function_privilege('authenticated', p.oid, 'execute')`,
    )
    expect(fns.map((f) => f.proname).sort()).toEqual(
      [
        'create_order', 'transition_order', 'submit_completion', 'record_payment', 'reschedule_order',
        'mark_notification_read', 'technician_jobs', 'current_staff', '_current_staff_id', '_current_staff_role',
        'update_order', 'list_orders', 'technician_options',
        'add_attachment', 'remove_attachment', 'mark_all_notifications_read', 'my_jobs',
        '_can_access_job_file',
        'edit_customer_message', 'confirm_customer_message',
        '_current_staff_covers', 'verify_payment', 'unverify_payment',
        'manager_orders', 'finance_orders', 'covered_branches',
        'feedback_form', 'submit_feedback', 'record_phone_feedback', '_feedback_link', '_customer_message_full_text',
      ].sort(),
    )
  })

  it('gives service_role only: read staff, and run link_staff_accounts', async () => {
    const tables = await t.q<{ rel: string; priv: string }>(
      `select r.rel, p.priv
         from unnest($1::text[]) as r(rel),
              unnest(array['select','insert','update','delete','truncate','references','trigger']) as p(priv)
        where has_table_privilege('service_role', 'public.' || r.rel, p.priv)`,
      [[...TABLES, ...VIEWS]],
    )
    expect(tables).toEqual([{ rel: 'staff', priv: 'select' }])

    const fns = await t.q<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prokind = 'f'
          and has_function_privilege('service_role', p.oid, 'execute')`,
    )
    expect(fns).toEqual([{ proname: 'link_staff_accounts' }])

    expect((await t.qAs(SERVICE_ROLE, 'select count(*)::int as n from staff'))[0].n).toBe(12)
    await expectRejects(t.qAs(SERVICE_ROLE, 'select * from orders'), /permission denied/i)
  })

  it('keeps the internal helpers out of reach of the API roles', async () => {
    const internal = [
      '_require_actor', '_lock_order', '_require_technician', '_audit', '_notify',
      '_payment_status', '_authorize_transition', '_status_label', '_transition_phrase',
      '_link_staff_on_signup', '_normalize_my_phone', '_check_quoted_price', '_check_order_details',
      '_check_extra_charges', '_job_file_order', '_job_file_is_receipt', '_job_file_write_error',
      '_job_file_kind', '_job_file_object', '_payment_method_label',
      '_is_my_mobile', '_malaysia_date_time', '_customer_job_done_message', '_check_customer_message_body',
      '_customer_message_confirmed_error', '_customer_message_error',
      'customer_messages_guard', 'orders_customer_message',
      'staff_additional_branches_check', '_covers_branch', '_branch_has_manager', '_branch_no_manager_error',
      'staff_branch_manager_check', 'orders_branch_manager_check', '_payment_verify_error',
      '_set_payment_verified', '_customer_on_behalf_message',
      '_new_feedback_token', '_feedback_link_placeholder', 'customer_feedback_guard', '_is_low_feedback',
      '_check_feedback', '_feedback_link_state', '_feedback_state_error', '_notify_low_feedback',
      '_phone_feedback_error',
    ]
    const rows = await t.q<{ proname: string; role: string; ok: boolean }>(
      `select p.proname, r.role, has_function_privilege(r.role, p.oid, 'execute') as ok
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
              unnest(array['anon','authenticated','service_role']) as r(role)
        where n.nspname = 'public' and p.proname = any($1::text[])`,
      [internal],
    )
    expect(new Set(rows.map((r) => r.proname))).toEqual(new Set(internal))
    expect(rows.filter((r) => r.ok)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Fixture: orders for several technicians with a row in every child table
// ---------------------------------------------------------------------------
interface Fixture {
  ali: string[] // two orders: one Job Done with a payment, one Assigned
  bala: string
  john: string
  fresh: string // New, unassigned
}
let fx: Fixture

async function addAttachments(orderId: string, uploader: string) {
  await t.q(
    `insert into attachments (order_id, kind, storage_path, mime_type, uploaded_by)
     values ($1, 'photo', 'completion/' || gen_random_uuid() || '.jpg', 'image/jpeg', $2),
            ($1, 'pdf',   'completion/' || gen_random_uuid() || '.pdf', 'application/pdf', $2)`,
    [orderId, uploader],
  )
}

beforeAll(async () => {
  const { people } = t
  const reschedule = (orderId: string) =>
    t.rpcAs(people.admin, 'reschedule_order', {
      p_order_id: orderId,
      p_new_scheduled_at: '2026-11-03T02:00:00Z',
      p_reason: 'weather',
      p_requested_by: 'customer',
    })

  const a1 = (await t.createOrder({ technician: people.ali })).id as string
  await t.advance(a1, 'in_progress')
  await t.pay(people.ali, a1, 100)
  await t.submit(people.ali, a1, { extraCharges: 10 })
  await addAttachments(a1, people.ali)

  const a2 = (await t.createOrder({ technician: people.ali })).id as string
  await reschedule(a2)

  const b1 = (await t.createOrder({ technician: people.bala })).id as string
  await t.advance(b1, 'in_progress')
  await t.pay(people.bala, b1, 40)
  await t.submit(people.bala, b1)
  await addAttachments(b1, people.bala)
  await reschedule((await t.createOrder({ technician: people.bala })).id as string)

  const j1 = (await t.createOrder({ technician: people.john, branch: 'Kuala Lumpur' })).id as string
  await t.advance(j1, 'in_progress')
  await t.pay(people.john, j1, 60)
  await addAttachments(j1, people.john)

  const fresh = (await t.createOrder()).id as string
  fx = { ali: [a1, a2], bala: b1, john: j1, fresh }
})

const ids = (rows: Array<{ id?: unknown; order_id?: unknown }>, key: 'id' | 'order_id' = 'id') =>
  rows.map((r) => r[key] as string).sort()

// ---------------------------------------------------------------------------
// AC15
// ---------------------------------------------------------------------------
describe('AC15 a technician can read only orders assigned to them, enforced by the database', () => {
  it('orders: a technician sees only their own, in every status', async () => {
    const ali = await t.qAs<{ id: string; assigned_technician_id: string }>(
      t.people.ali,
      'select id, assigned_technician_id from orders',
    )
    expect(ids(ali)).toEqual([...fx.ali].sort())
    expect(ali.every((o) => o.assigned_technician_id === t.people.ali)).toBe(true)

    expect(ids(await t.qAs(t.people.bala, 'select id from orders'))).toEqual(
      (await t.q<{ id: string }>(`select id from orders where assigned_technician_id = $1`, [t.people.bala])).map((r) => r.id).sort(),
    )
    expect(ids(await t.qAs(t.people.john, 'select id from orders'))).toEqual([fx.john])
    expect(await t.qAs(t.people.yusoff, 'select id from orders')).toEqual([])
  })

  it('order_summary and technician_jobs() show the same, with the money figures', async () => {
    const summary = await t.qAs<{ id: string; final_amount: string; amount_paid: string }>(
      t.people.ali,
      'select id, final_amount, amount_paid from order_summary',
    )
    expect(ids(summary)).toEqual([...fx.ali].sort())
    const done = summary.find((s) => s.id === fx.ali[0])!
    expect(Number(done.final_amount)).toBe(260)
    expect(Number(done.amount_paid)).toBe(100)

    const jobs = await t.qAs(t.people.ali, 'select id from technician_jobs()')
    expect(ids(jobs)).toEqual([...fx.ali].sort())
    expect(await t.qAs(t.people.yusoff, 'select id from technician_jobs()')).toEqual([])
  })

  it('cannot fetch another technician’s or an unassigned order by id', async () => {
    for (const id of [fx.bala, fx.john, fx.fresh]) {
      expect(await t.qAs(t.people.ali, 'select * from orders where id = $1', [id])).toEqual([])
      expect(await t.qAs(t.people.ali, 'select * from order_summary where id = $1', [id])).toEqual([])
    }
  })

  for (const table of ORDER_CHILDREN) {
    it(`${table}: only rows of the technician's own orders`, async () => {
      const own = await t.q<{ order_id: string }>(
        `select order_id from ${table} where order_id = any($1::uuid[]) order by order_id`,
        [fx.ali],
      )
      expect(own.length, `fixture should have ${table} rows for Ali`).toBeGreaterThan(0)
      const seen = await t.qAs<{ order_id: string }>(t.people.ali, `select order_id from ${table} order by order_id`)
      expect(seen.map((r) => r.order_id)).toEqual(own.map((r) => r.order_id))

      const total = (await t.q<{ n: number }>(`select count(*)::int as n from ${table}`))[0].n
      expect(total).toBeGreaterThan(seen.length) // other people's rows exist but are hidden
      expect(await t.qAs(t.people.yusoff, `select order_id from ${table}`)).toEqual([])
    })
  }

  it('a reassigned order moves, with its history, from the old to the new technician', async () => {
    const o = (await t.createOrder({ technician: t.people.yusoff })).id as string
    expect(ids(await t.qAs(t.people.yusoff, 'select id from orders'))).toContain(o)
    expect((await t.qAs(t.people.yusoff, 'select id from audit_log where order_id = $1', [o])).length).toBeGreaterThan(0)

    await t.transition(t.people.admin, o, 'assigned', null, t.people.john)

    expect(await t.qAs(t.people.yusoff, 'select id from orders where id = $1', [o])).toEqual([])
    expect(await t.qAs(t.people.yusoff, 'select id from audit_log where order_id = $1', [o])).toEqual([])
    expect(await t.qAs(t.people.john, 'select id from orders where id = $1', [o])).toHaveLength(1)
    expect((await t.qAs(t.people.john, 'select id from audit_log where order_id = $1', [o])).length).toBeGreaterThan(1)
  })

  it('Admin and Finance see every order and every related row', async () => {
    const totals = Object.fromEntries(
      await Promise.all(
        ['orders', ...ORDER_CHILDREN].map(async (tbl) => [
          tbl,
          (await t.q<{ n: number }>(`select count(*)::int as n from ${tbl}`))[0].n,
        ]),
      ),
    )
    for (const who of [t.people.admin, t.people.admin2, t.people.finance]) {
      for (const [tbl, total] of Object.entries(totals)) {
        const n = (await t.qAs<{ n: number }>(who, `select count(*)::int as n from ${tbl}`))[0].n
        expect(n, `${tbl} as ${who}`).toBe(total)
      }
      const summaryCount = (await t.qAs<{ n: number }>(who, 'select count(*)::int as n from order_summary'))[0].n
      expect(summaryCount).toBe(totals.orders)
    }
  })

  it('a Manager sees the orders and related rows of the branches they cover only (0004)', async () => {
    const covered = `(o.branch_id = s.branch_id or o.branch_id = any (s.additional_branch_ids))`
    for (const who of [t.people.managerSA, t.people.managerKL]) {
      const expected = async (tbl: string) =>
        (
          await t.q<{ n: number }>(
            tbl === 'orders'
              ? `select count(*)::int as n from orders o join staff s on s.id = $1 where ${covered}`
              : `select count(*)::int as n from ${tbl} x join orders o on o.id = x.order_id
                   join staff s on s.id = $1 where ${covered}`,
            [who],
          )
        )[0].n
      const all = (await t.q<{ n: number }>('select count(*)::int as n from orders'))[0].n
      const mine = await expected('orders')
      expect(mine, 'fixture should have orders in and outside the branch').toBeGreaterThan(0)
      expect(mine).toBeLessThan(all)
      for (const tbl of ['orders', ...ORDER_CHILDREN]) {
        const n = (await t.qAs<{ n: number }>(who, `select count(*)::int as n from ${tbl}`))[0].n
        expect(n, `${tbl} as ${who}`).toBe(await expected(tbl))
      }
      const summaryCount = (await t.qAs<{ n: number }>(who, 'select count(*)::int as n from order_summary'))[0].n
      expect(summaryCount).toBe(mine)
    }
  })

  it('every active staff member can read the reference data, including technicians', async () => {
    const expected: Record<string, number> = {
      branches: 5,
      service_types: 5,
      order_status_transitions: 13,
    }
    for (const who of [t.people.ali, t.people.admin, t.people.finance]) {
      for (const [tbl, n] of Object.entries(expected)) {
        expect((await t.qAs<{ n: number }>(who, `select count(*)::int as n from ${tbl}`))[0].n, tbl).toBe(n)
      }
      expect((await t.qAs<{ n: number }>(who, 'select count(*)::int as n from staff'))[0].n).toBeGreaterThanOrEqual(9)
    }
  })

  it('notifications: everyone sees only their own', async () => {
    const all = await t.q<{ id: number; recipient_id: string }>('select id, recipient_id from notifications')
    expect(all.length).toBeGreaterThan(0)
    let seenTotal = 0
    for (const [name, staffId] of Object.entries(t.people)) {
      const mine = await t.qAs<{ recipient_id: string }>(staffId, 'select recipient_id from notifications')
      expect(mine.every((n) => n.recipient_id === staffId), name).toBe(true)
      expect(mine.length, name).toBe(all.filter((n) => n.recipient_id === staffId).length)
      seenTotal += mine.length
    }
    expect(seenTotal).toBe(all.length)
    // Ali was assigned two orders, so he has notifications; Admin has none.
    expect((await t.qAs(t.people.ali, 'select 1 from notifications')).length).toBeGreaterThanOrEqual(2)
    expect(await t.qAs(t.people.admin, 'select 1 from notifications')).toEqual([])
    // The Shah Alam manager was told about the Job Done orders.
    expect((await t.qAs(t.people.managerSA, `select 1 from notifications where event = 'job_done'`)).length).toBeGreaterThanOrEqual(2)
    // Asking for someone else's notification by id returns nothing.
    const others = all.find((n) => n.recipient_id !== t.people.ali)!
    expect(await t.qAs(t.people.ali, 'select 1 from notifications where id = $1', [others.id])).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// AC16 (database side)
// ---------------------------------------------------------------------------
describe('AC16 signed-out requests can read no data', () => {
  it('the anon role cannot read any table or view', async () => {
    for (const table of [...TABLES, ...VIEWS]) {
      await expectRejects(t.qAs(SIGNED_OUT, `select * from ${table}`), /permission denied/i)
    }
  })

  it('the anon role cannot execute any RPC (permission denied, not just rejected by a rule)', async () => {
    await expectRejects(t.qAs(SIGNED_OUT, 'select * from technician_jobs()'), /permission denied/i)
    await expectRejects(t.qAs(SIGNED_OUT, 'select * from current_staff()'), /permission denied/i)
    await expectRejects(t.qAs(SIGNED_OUT, 'select _current_staff_id()'), /permission denied/i)
    await expectRejects(t.qAs(SIGNED_OUT, `select _feedback_link('x')`), /permission denied/i)
    await expectRejects(
      t.qAs(SIGNED_OUT, `select * from record_phone_feedback('00000000-0000-0000-0000-000000000000', 5, true)`),
      /permission denied/i,
    )
  })

  it('even a request that reaches the tables as authenticated without a user gets zero rows (RLS)', async () => {
    const noUser: Identity = { role: 'authenticated', sub: null }
    for (const table of [...TABLES, ...VIEWS]) {
      expect(await t.qAs(noUser, `select * from ${table}`), table).toEqual([])
    }
  })

  it('no policy grants anon anything, so a future grant would still return no rows', async () => {
    const policies = await t.q<{ roles: string }>(`select roles::text as roles from pg_policies where schemaname = 'public'`)
    expect(policies.filter((p) => /anon|public/.test(p.roles))).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// AC17 (database side)
// ---------------------------------------------------------------------------
describe('AC17 an account with no active staff profile can read nothing', () => {
  it('a stranger, an unlinked staff row and a deactivated staff member all see zero rows everywhere', async () => {
    const stranger: Identity = { role: 'authenticated', sub: await t.createAuthUser('outsider@example.com') }
    await t.q(
      `insert into staff (name, email, phone, role, branch_id)
       select 'Unlinked Una', 'una@sejuk.example.com', '60120000060', 'manager', id
         from branches where name = 'Penang'`,
    )
    const deactivated = await t.identityOf(t.people.bala)
    await t.q('update staff set active = false where id = $1', [t.people.bala])
    try {
      for (const who of [stranger, deactivated]) {
        for (const table of [...TABLES, ...VIEWS]) {
          expect(await t.qAs(who, `select * from ${table}`), table).toEqual([])
        }
        expect(await t.qAs(who, 'select * from technician_jobs()').catch((e: Error) => e.message)).toMatch(
          /no active staff profile/,
        )
      }
    } finally {
      await t.q('update staff set active = true where id = $1', [t.people.bala])
    }
    // Reactivated: reads work again.
    expect((await t.qAs(deactivated, 'select id from orders')).length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// No direct writes
// ---------------------------------------------------------------------------
describe('Nobody can write tables directly; all writes go through the RPCs', () => {
  it('authenticated users cannot insert, update or delete in any table', async () => {
    const who = t.people.admin
    const o = fx.ali[0]
    const attempts: string[] = [
      `update orders set admin_notes = 'hacked' where id = '${o}'`,
      `update orders set status = 'closed' where id = '${o}'`,
      `delete from orders where id = '${o}'`,
      `insert into payments (order_id, amount, method, recorded_by) values ('${o}', 1, 'cash', '${who}')`,
      `update payments set amount = 1`,
      `delete from audit_log`,
      `update audit_log set note = 'x'`,
      `insert into audit_log (order_id, actor_id, actor_role, action) values ('${o}', '${who}', 'admin', 'forged')`,
      `update staff set role = 'admin'`,
      `insert into staff (name, email, phone, role, branch_id) select 'X', 'x@x.com', '1', 'admin', id from branches limit 1`,
      `update notifications set read_at = now()`,
      `delete from notifications`,
      `update order_status_transitions set paid_required = false`,
      `insert into branches (name) values ('Hacked')`,
      `update order_completions set extra_charges = 0`,
      `insert into attachments (order_id, kind, storage_path, uploaded_by) values ('${o}', 'photo', 'x', '${who}')`,
      `update order_reschedules set reason = 'other'`,
      `insert into service_types (name) values ('Hacked')`,
      `update customer_messages set body = 'hacked'`,
      `update customer_messages set status = 'sent'`,
      `delete from customer_messages`,
      `insert into customer_messages (order_id, channel, phone, prepared_body, body) values ('${o}', 'whatsapp', '60123456789', 'x', 'x')`,
    ]
    for (const sql of attempts) {
      await expectRejects(t.qAs(who, sql), /permission denied/i)
    }
    // Technicians and Finance as well: no role is special.
    for (const staffId of [t.people.ali, t.people.finance, t.people.managerSA]) {
      await expectRejects(t.qAs(staffId, `update orders set quoted_price = 0`), /permission denied/i)
      await expectRejects(t.qAs(staffId, `update staff set role = 'admin' where id = '${staffId}'`), /permission denied/i)
    }
    expect((await t.summary(o)).status).toBe('job_done')
  })

  it('authenticated users cannot touch the order number sequence or call internal helpers', async () => {
    await expectRejects(t.qAs(t.people.admin, `select nextval('order_no_seq')`), /permission denied/i)
    await expectRejects(t.qAs(t.people.admin, 'select _require_actor()'), /permission denied/i)
    await expectRejects(t.qAs(t.people.admin, `select _notify('${t.people.ali}', '${fx.ali[0]}', 'assigned', 'x')`), /permission denied/i)
  })

  it('the policy helpers only ever reveal the caller’s own staff id and role', async () => {
    const mine = await t.qAs<{ id: string; role: string }>(
      t.people.ali,
      'select _current_staff_id() as id, _current_staff_role() as role',
    )
    expect(mine).toEqual([{ id: t.people.ali, role: 'technician' }])
    const nobody = await t.qAs(
      { role: 'authenticated', sub: null },
      'select _current_staff_id() as id, _current_staff_role() as role',
    )
    expect(nobody).toEqual([{ id: null, role: null }])
  })
})
