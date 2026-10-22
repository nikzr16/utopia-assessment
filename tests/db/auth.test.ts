import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SERVICE_ROLE, SIGNED_OUT, createTestDb, expectRejects, type Identity, type TestDb } from './helpers'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

const SIGNED_IN_NO_SUB: Identity = { role: 'authenticated', sub: null }
const ZERO = '00000000-0000-0000-0000-000000000000'

/** Every RPC with arguments that would be valid for an Admin; only the actor can make them fail. */
async function everyRpc(orderId: string, notificationId: number) {
  return [
    ['create_order', {
      p_branch_id: await t.branchId('Shah Alam'),
      p_customer_name: 'X',
      p_customer_phone: '1',
      p_customer_address: 'Y',
      p_problem_description: 'Z',
      p_service_type_id: await t.serviceTypeId('Repair'),
      p_quoted_price: 10,
    }],
    ['transition_order', { p_order_id: orderId, p_to_status: 'acknowledged' }],
    ['submit_completion', { p_order_id: orderId, p_work_done: 'Done' }],
    ['record_payment', { p_order_id: orderId, p_amount: 10, p_method: 'cash' }],
    ['reschedule_order', {
      p_order_id: orderId,
      p_new_scheduled_at: '2026-11-02T02:00:00Z',
      p_reason: 'weather',
      p_requested_by: 'customer',
    }],
    ['mark_notification_read', { p_notification_id: notificationId }],
    ['technician_jobs', {}],
  ] as Array<[string, Record<string, unknown>]>
}

describe('AC2 the signed-in staff member is the actor and nobody can act as someone else', () => {
  it('no function the API can call accepts an actor argument', async () => {
    const rows = await t.q<{ proname: string; args: string | null }>(
      `select p.proname, pg_get_function_arguments(p.oid) as args
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prokind = 'f'
          and has_function_privilege('authenticated', p.oid, 'execute')`,
    )
    for (const r of rows) expect(r.args ?? '', r.proname).not.toMatch(/actor/i)
    expect(rows.map((r) => r.proname)).toEqual(expect.arrayContaining(['create_order', 'transition_order']))
  })

  it('rejects a call that tries to supply an actor id', async () => {
    const o = await t.createOrder({ technician: t.people.ali })
    await expectRejects(
      t.rpcAs(t.people.bala, 'transition_order', {
        p_actor_id: t.people.ali,
        p_order_id: o.id,
        p_to_status: 'acknowledged',
      }),
      /transition_order/,
    )
    expect((await t.summary(o.id as string)).status).toBe('assigned')
  })

  it('uses the signed-in user: the same call succeeds or fails depending only on who is signed in', async () => {
    const o = await t.createOrder({ technician: t.people.ali })
    const id = o.id as string
    await t.actAs(t.people.bala)
    await expectRejects(
      t.rpc('transition_order', { p_order_id: id, p_to_status: 'acknowledged' }),
      'Only the assigned technician can acknowledge a job',
    )
    await t.actAs(t.people.ali)
    const r = await t.rpc('transition_order', { p_order_id: id, p_to_status: 'acknowledged' })
    expect(r.status).toBe('acknowledged')
    expect((await t.audit(id)).at(-1)).toMatchObject({
      action: 'acknowledged',
      actor_id: t.people.ali,
      actor_role: 'technician',
    })
  })

  it('records the signed-in admin as creator and as the audit actor', async () => {
    await t.actAs(t.people.admin2)
    const o = await t.rpc('create_order', {
      p_branch_id: await t.branchId('Penang'),
      p_customer_name: 'Puan Ros',
      p_customer_phone: '60125550000',
      p_customer_address: '1 Lebuh Chulia, Penang',
      p_problem_description: 'No cooling',
      p_service_type_id: await t.serviceTypeId('Repair'),
      p_quoted_price: 120,
    })
    expect(o.created_by).toBe(t.people.admin2)
    const [entry] = await t.audit(o.id as string)
    expect(entry).toMatchObject({ action: 'created', actor_id: t.people.admin2, actor_role: 'admin' })
  })

  it('signing out ends access: reads return nothing and actions are rejected', async () => {
    const o = await t.createOrder({ technician: t.people.ali })
    await t.actAs(t.people.ali)
    expect((await t.rpc('technician_jobs')).id).toBeDefined()
    expect((await t.qAs(t.people.ali, 'select id from orders')).length).toBeGreaterThan(0)

    t.actSignedOut()
    expect(t.currentIdentity()).toEqual(SIGNED_OUT)
    await expectRejects(
      t.rpc('transition_order', { p_order_id: o.id, p_to_status: 'acknowledged' }),
      /permission denied/i,
    )
    await expectRejects(t.qAs(SIGNED_OUT, 'select id from orders'), /permission denied/i)
    expect((await t.summary(o.id as string)).status).toBe('assigned')
  })
})

describe('AC16 signed-out requests can read nothing and every action is rejected', () => {
  let orderId: string
  let notificationId: number
  beforeAll(async () => {
    const o = await t.createOrder({ technician: t.people.ali })
    orderId = o.id as string
    notificationId = Number((await t.notifications(orderId))[0].id)
  })

  it('the anon role (no sign-in) cannot call any RPC', async () => {
    for (const [fn, args] of await everyRpc(orderId, notificationId)) {
      await expectRejects(t.rpcAs(SIGNED_OUT, fn, args), /permission denied/i)
    }
    await expectRejects(t.rpcAs(SIGNED_OUT, 'current_staff'), /permission denied/i)
  })

  it('a request with no JWT subject is rejected by the database itself: "You must be signed in"', async () => {
    // Even if a role could reach the function, auth.uid() is null.
    for (const [fn, args] of await everyRpc(orderId, notificationId)) {
      await expectRejects(t.rpcAs(SIGNED_IN_NO_SUB, fn, args), 'You must be signed in')
      // The service role has no business calling the RPCs at all.
      await expectRejects(t.rpcAs(SERVICE_ROLE, fn, args), /permission denied/i)
    }
    // The database owner with no claims at all (for example a stray SQL session).
    await expectRejects(t.q(`select * from transition_order(p_order_id => $1, p_to_status => 'acknowledged')`, [orderId]), 'You must be signed in')
  })

  it('nothing is written by a rejected signed-out call', async () => {
    const before = (await t.audit(orderId)).length
    await t.rpcAs(SIGNED_IN_NO_SUB, 'transition_order', { p_order_id: orderId, p_to_status: 'acknowledged' }).catch(() => {})
    expect((await t.audit(orderId)).length).toBe(before)
    expect((await t.summary(orderId)).status).toBe('assigned')
  })
})

describe('AC17 a signed-in account with no active staff profile cannot read or act', () => {
  let orderId: string
  let notificationId: number
  beforeAll(async () => {
    const o = await t.createOrder({ technician: t.people.ali })
    orderId = o.id as string
    notificationId = Number((await t.notifications(orderId))[0].id)
  })

  const STAFF_TABLES = [
    'branches', 'staff', 'service_types', 'orders', 'order_completions', 'attachments', 'payments',
    'order_reschedules', 'audit_log', 'notifications', 'order_status_transitions', 'order_summary',
  ]

  async function expectNoAccess(who: Identity) {
    for (const table of STAFF_TABLES) {
      expect(await t.qAs(who, `select * from ${table}`), `${table} should be empty`).toEqual([])
    }
    for (const [fn, args] of await everyRpc(orderId, notificationId)) {
      await expectRejects(t.rpcAs(who, fn, args), 'Your account has no active staff profile')
    }
    expect(await t.rpcAs(who, 'current_staff')).toBeUndefined()
  }

  it('an account with no staff row (a stranger who signed up) gets nothing', async () => {
    const id = await t.createAuthUser('stranger2@example.com')
    await expectNoAccess({ role: 'authenticated', sub: id })
  })

  it('an account whose email matches no staff row stays unlinked and gets nothing', async () => {
    const id = await t.createAuthUser('almost.ali@sejuk.example.com')
    expect(await t.q('select 1 from staff where auth_user_id = $1', [id])).toHaveLength(0)
    await expectNoAccess({ role: 'authenticated', sub: id })
  })

  it('a staff member who has been deactivated gets nothing, and gets access back when reactivated', async () => {
    const ali = await t.identityOf(t.people.ali)
    expect((await t.qAs(ali, 'select id from orders')).length).toBeGreaterThan(0)

    await t.q('update staff set active = false where id = $1', [t.people.ali])
    try {
      await expectNoAccess(ali)
    } finally {
      await t.q('update staff set active = true where id = $1', [t.people.ali])
    }
    expect((await t.qAs(ali, 'select id from orders')).length).toBeGreaterThan(0)
    expect((await t.rpcAs(ali, 'current_staff')).name).toBe('Ali')
  })

  it('an account that is deleted loses its staff link and can no longer act', async () => {
    const id = await t.createAuthUser('temp.person@sejuk.example.com')
    await t.q(
      `insert into staff (name, email, phone, role, branch_id)
       select 'Temp Person', 'temp.person@sejuk.example.com', '60120000099', 'technician', id
         from branches where name = 'Penang'`,
    )
    await t.q('select link_staff_accounts()')
    const who: Identity = { role: 'authenticated', sub: id }
    expect((await t.rpcAs(who, 'current_staff')).name).toBe('Temp Person')
    await t.q('delete from auth.users where id = $1', [id])
    expect((await t.q('select auth_user_id from staff where email = $1', ['temp.person@sejuk.example.com']))[0].auth_user_id).toBeNull()
    await expectNoAccess(who)
  })
})

describe('Linking sign-in accounts to staff', () => {
  it('links every seeded staff member to the account with their email', async () => {
    const rows = await t.q<{ email: string; auth_user_id: string | null; account_email: string | null }>(
      `select s.email, s.auth_user_id, u.email as account_email
         from staff s left join auth.users u on u.id = s.auth_user_id
        where s.email like '%@sejuk.example.com' and s.name in
          ('Aisyah Rahman','Farid Hakim','Ali','John','Bala','Yusoff','Nurul Huda','Tan Wei Ming','Siti Aminah')`,
    )
    expect(rows).toHaveLength(9)
    for (const r of rows) {
      expect(r.auth_user_id, r.email).not.toBeNull()
      expect(r.account_email).toBe(r.email)
    }
  })

  it('the trigger links a new account to the staff row with the same email, ignoring letter case', async () => {
    await t.q(
      `insert into staff (name, email, phone, role, branch_id)
       select 'Lina Ho', 'lina@sejuk.example.com', '60120000041', 'technician', id
         from branches where name = 'Johor Bahru'`,
    )
    const accountId = await t.createAuthUser('LiNa@Sejuk.Example.COM')
    const [row] = await t.q<{ id: string; auth_user_id: string }>(
      `select id, auth_user_id from staff where email = 'lina@sejuk.example.com'`,
    )
    expect(row.auth_user_id).toBe(accountId)
    // ...and the new account can act as that staff member straight away.
    const profile = await t.rpcAs({ role: 'authenticated', sub: accountId }, 'current_staff')
    expect(profile).toMatchObject({ id: row.id, name: 'Lina Ho', role: 'technician', branch_name: 'Johor Bahru' })
  })

  it('does not link an unrelated email, an empty email, or touch other staff', async () => {
    const before = await t.q('select id, auth_user_id from staff order by id')
    await t.createAuthUser('nobody@example.org')
    await t.db.exec(`insert into auth.users (email) values (null)`)
    expect(await t.q('select id, auth_user_id from staff order by id')).toEqual(before)
  })

  it('never links an account whose email is not confirmed (no taking over a staff profile)', async () => {
    await t.q(
      `insert into staff (name, email, phone, role, branch_id)
       select 'Unconfirmed Una', 'una@sejuk.example.com', '60120000043', 'admin', id
         from branches where name = 'Penang'`,
    )
    const [{ id }] = await t.q<{ id: string }>(
      `insert into auth.users (email) values ('una@sejuk.example.com') returning id`,
    )
    await t.q('select link_staff_accounts()')
    const [row] = await t.q<{ auth_user_id: string | null }>(
      `select auth_user_id from staff where email = 'una@sejuk.example.com'`,
    )
    expect(row.auth_user_id).toBeNull()
    expect(await t.rpcAs({ role: 'authenticated', sub: id }, 'current_staff')).toBeUndefined()

    // Once the email is confirmed the account links to its staff row.
    await t.q('update auth.users set email_confirmed_at = now() where id = $1', [id])
    const [after] = await t.q<{ auth_user_id: string | null }>(
      `select auth_user_id from staff where email = 'una@sejuk.example.com'`,
    )
    expect(after.auth_user_id).toBe(id)
  })

  it('never re-links a staff member who is already linked', async () => {
    const [ali] = await t.q<{ auth_user_id: string }>(`select auth_user_id from staff where email = 'ali@sejuk.example.com'`)
    await t.createAuthUser('ALI@sejuk.example.com') // a second account for the same email
    const [after] = await t.q<{ auth_user_id: string }>(`select auth_user_id from staff where email = 'ali@sejuk.example.com'`)
    expect(after.auth_user_id).toBe(ali.auth_user_id)
  })

  it('link_staff_accounts links existing accounts and is repeatable', async () => {
    // The account exists first (as on a project that already had sign-ins)...
    const accountId = await t.createAuthUser('Early.Bird@Sejuk.Example.com')
    await t.q(
      `insert into staff (name, email, phone, role, branch_id)
       select 'Early Bird', 'early.bird@sejuk.example.com', '60120000042', 'finance', id
         from branches where name = 'Kota Kinabalu'`,
    )
    const unlinked = async () =>
      (await t.q(`select 1 from staff where email = 'early.bird@sejuk.example.com' and auth_user_id is null`)).length
    expect(await unlinked()).toBe(1)

    // ...and only the service role may backfill.
    const first = await t.rpcAs(SERVICE_ROLE, 'link_staff_accounts')
    expect(Number(first.link_staff_accounts)).toBe(1)
    expect(await unlinked()).toBe(0)
    expect(
      (await t.q<{ auth_user_id: string }>(`select auth_user_id from staff where email = 'early.bird@sejuk.example.com'`))[0].auth_user_id,
    ).toBe(accountId)

    const second = await t.rpcAs(SERVICE_ROLE, 'link_staff_accounts')
    expect(Number(second.link_staff_accounts)).toBe(0)
  })

  it('only the service role can run link_staff_accounts', async () => {
    for (const who of [SIGNED_OUT, SIGNED_IN_NO_SUB, await t.identityOf(t.people.admin)]) {
      await expectRejects(t.rpcAs(who, 'link_staff_accounts'), /permission denied/i)
    }
  })

  it('keeps one account per staff member and one staff member per account', async () => {
    const [ali] = await t.q<{ auth_user_id: string }>(`select auth_user_id from staff where email = 'ali@sejuk.example.com'`)
    await expect(
      t.q('update staff set auth_user_id = $1 where email = $2', [ali.auth_user_id, 'bala@sejuk.example.com']),
    ).rejects.toThrow(/unique|duplicate/i)
  })

  it('treats staff emails as unique regardless of letter case, and requires one', async () => {
    const insert = (email: string | null) =>
      t.q(
        `insert into staff (name, email, phone, role, branch_id)
         select 'Dup', $1, '60120000050', 'admin', id from branches where name = 'Penang'`,
        [email],
      )
    await expect(insert('ALI@Sejuk.Example.com')).rejects.toThrow(/unique|duplicate/i)
    await expect(insert(null)).rejects.toThrow(/null/i)
    await expect(insert('  ')).rejects.toThrow(/check|violates/i)
  })
})

describe('current_staff()', () => {
  it('returns the signed-in staff member with their branch name', async () => {
    const cases: Array<[string, string, string, string]> = [
      [t.people.admin, 'Aisyah Rahman', 'admin', 'Kuala Lumpur'],
      [t.people.ali, 'Ali', 'technician', 'Shah Alam'],
      [t.people.managerKL, 'Tan Wei Ming', 'manager', 'Kuala Lumpur'],
      [t.people.finance, 'Siti Aminah', 'finance', 'Kuala Lumpur'],
    ]
    for (const [staffId, name, role, branch] of cases) {
      const rows = await t.qAs(staffId, 'select * from current_staff()')
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        id: staffId,
        name,
        role,
        branch_name: branch,
        active: true,
      })
      expect(rows[0].email).toMatch(/@sejuk\.example\.com$/)
    }
  })

  it('returns nothing when the account has no active staff profile (and is not an error)', async () => {
    const stranger = await t.createAuthUser('current.staff.stranger@example.com')
    expect(await t.qAs({ role: 'authenticated', sub: stranger }, 'select * from current_staff()')).toEqual([])
    expect(await t.qAs(SIGNED_IN_NO_SUB, 'select * from current_staff()')).toEqual([])
  })

  it('cannot be used to look at somebody else', async () => {
    const rows = await t.qAs(t.people.ali, 'select name from current_staff()')
    expect(rows).toEqual([{ name: 'Ali' }])
  })

  it('is refused to signed-out visitors', async () => {
    await expectRejects(t.qAs(SIGNED_OUT, 'select * from current_staff()'), /permission denied/i)
  })
})

describe('JWT claims are read like Supabase does', () => {
  it('accepts the subject from request.jwt.claims (JSON) or the legacy request.jwt.claim.sub', async () => {
    const [ali] = await t.q<{ auth_user_id: string }>(`select auth_user_id from staff where email = 'ali@sejuk.example.com'`)
    const viaJson = await t.db.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: ali.auth_user_id })])
      return (await tx.query<{ uid: string }>('select auth.uid() as uid')).rows[0].uid
    })
    const viaLegacy = await t.db.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [ali.auth_user_id])
      return (await tx.query<{ uid: string }>('select auth.uid() as uid')).rows[0].uid
    })
    const none = (await t.q<{ uid: string | null }>('select auth.uid() as uid'))[0].uid
    expect(viaJson).toBe(ali.auth_user_id)
    expect(viaLegacy).toBe(ali.auth_user_id)
    expect(none).toBeNull()
  })

  it('does not let one call leak its identity into the next', async () => {
    await t.actAs(t.people.ali)
    await t.rpc('technician_jobs')
    t.actSignedOut()
    await expectRejects(t.rpc('technician_jobs'), /permission denied/i)
    expect((await t.q<{ uid: string | null }>('select auth.uid() as uid'))[0].uid).toBeNull()
    expect((await t.q<{ r: string }>('select current_user as r'))[0].r).not.toMatch(/anon|authenticated/)
    // An unknown staff id cannot even be turned into an identity.
    await expect(t.identityOf(ZERO)).rejects.toThrow(/No staff member/)
  })
})
