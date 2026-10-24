import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SERVICE_ROLE, SIGNED_OUT, createTestDb, expectRejects, type Row, type TestDb } from './helpers'

// 0006 staff management (supabase/migrations/20261023000004_staff_management.sql):
// who may change whom, the staff rules, history, joined / left dates, the
// sign-in steps the server function runs, and the staff screen reads.

interface Target {
  staff_id: string
  name: string
  email: string
  previous_email: string | null
  auth_user_id: string | null
  active: boolean
  sign_in_state: string
}

interface HistoryRow {
  staff_id: string
  actor_id: string | null
  action: string
  changes: Record<string, { from?: unknown; to?: unknown }>
  role: string
  branch_id: string
  active: boolean
}

const STAFF_FIELDS = {
  p_name: 'Ravi Kumar',
  p_email: 'Ravi@Example.com ',
  p_phone: '012-777 1234',
  p_role: 'technician',
}

function staffDb() {
  let t!: TestDb
  beforeAll(async () => {
    t = await createTestDb()
  })
  afterAll(() => t.close())
  return () => t
}

const history = (t: TestDb, staffId: string) =>
  t.q<HistoryRow>('select * from staff_history where staff_id = $1 order by id', [staffId])

async function create(t: TestDb, actor: string, fields: Record<string, unknown> = {}): Promise<Target> {
  return t.rpcAs<Target>(actor, 'create_staff', {
    ...STAFF_FIELDS,
    p_branch_id: await t.branchId('Shah Alam'),
    ...fields,
  })
}

async function editArgs(t: TestDb, staffId: string, changes: Record<string, unknown> = {}) {
  const [s] = await t.q<Row>('select * from staff where id = $1', [staffId])
  return {
    p_staff_id: staffId,
    p_name: s.name,
    p_email: s.email,
    p_phone: s.phone,
    p_role: s.role,
    p_branch_id: s.branch_id,
    ...changes,
  }
}

// ---------------------------------------------------------------------------
describe('Migration on a project that already has staff', () => {
  it('backfills joined / left dates and one history entry per person', async () => {
    const L = await createTestDb({ holdBackMigrations: ['20261023000004', '20261023000005'] })
    try {
      await L.q('update staff set active = false where id = $1', [L.people.yusoff])
      await L.applyMigration('20261023000004')
      const rows = await L.q<{ joined: string; left_at: string | null; active: boolean; name: string }>(
        `select to_char(joined_at at time zone 'Asia/Kuala_Lumpur', 'YYYY-MM-DD HH24:MI') as joined,
                left_at, active, name from staff`,
      )
      expect(new Set(rows.map((r) => r.joined))).toEqual(new Set(['2026-10-22 00:00']))
      for (const r of rows) expect(r.left_at === null).toBe(r.active)

      const h = await L.q<HistoryRow>('select * from staff_history order by id')
      expect(h.filter((r) => r.action === 'created')).toHaveLength(rows.length)
      expect(h.every((r) => r.actor_id === null)).toBe(true)
      expect(h.filter((r) => r.action === 'deactivated').map((r) => r.staff_id)).toEqual([L.people.yusoff])
      const ali = h.find((r) => r.staff_id === L.people.ali && r.action === 'created')!
      expect(ali.changes).toMatchObject({ name: { to: 'Ali' }, role: { to: 'technician' }, branch: { to: 'Shah Alam' } })
      expect(ali.role).toBe('technician')
    } finally {
      await L.close()
    }
  })
})

// ---------------------------------------------------------------------------
describe('create_staff', () => {
  const db = staffDb()

  it('lets an Admin add anyone; stores trimmed, normalised details; records who and when', async () => {
    const t = db()
    const ravi = await create(t, t.people.admin)
    expect(ravi).toMatchObject({ name: 'Ravi Kumar', email: 'ravi@example.com', active: true, sign_in_state: 'none' })
    const [row] = await t.q<Row>('select phone, joined_at, left_at, auth_user_id from staff where id = $1', [ravi.staff_id])
    expect(row.phone).toBe('60127771234')
    expect(row.left_at).toBeNull()
    expect(row.auth_user_id).toBeNull()
    expect(Date.now() - new Date(row.joined_at as string).getTime()).toBeLessThan(60_000)

    const [h] = await history(t, ravi.staff_id)
    expect(h).toMatchObject({ action: 'created', actor_id: t.people.admin, role: 'technician', active: true })
    expect(h.changes).toMatchObject({ email: { to: 'ravi@example.com' }, phone: { to: '60127771234' }, branch: { to: 'Shah Alam' } })

    const fin = await create(t, t.people.admin, {
      p_name: 'Nora', p_email: 'nora@example.com', p_phone: '03-5512 3456', p_role: 'finance',
    })
    expect(fin.name).toBe('Nora') // landline is fine for non-technicians
  })

  it('lets a Manager add technicians to the branches they cover only', async () => {
    const t = db()
    const tech = await create(t, t.people.managerSA, { p_name: 'Sam', p_email: 'sam@example.com', p_phone: '0127771235' })
    expect((await history(t, tech.staff_id))[0].actor_id).toBe(t.people.managerSA)

    await expectRejects(
      create(t, t.people.managerSA, { p_email: 'x1@example.com', p_phone: '0127771236', p_branch_id: await t.branchId('Penang') }),
      'You do not cover Penang. Choose one of your branches.',
    )
    await expectRejects(
      create(t, t.people.managerSA, { p_email: 'x2@example.com', p_phone: '0127771237', p_role: 'manager' }),
      'Managers can only add technicians',
    )
    await expectRejects(
      create(t, t.people.managerSA, {
        p_email: 'x3@example.com', p_phone: '0127771238', p_additional_branch_ids: [await t.branchId('Penang')],
      }),
      'Only an Admin can change branch cover',
    )
  })

  it('is refused for Technicians, Finance, and signed-out visitors', async () => {
    const t = db()
    await expectRejects(create(t, t.people.ali, { p_email: 'y1@example.com' }), 'Only Admins and Managers can manage staff')
    await expectRejects(create(t, t.people.finance, { p_email: 'y2@example.com' }), 'Only Admins and Managers can manage staff')
    await expectRejects(
      t.rpcAs(SIGNED_OUT, 'create_staff', { ...STAFF_FIELDS, p_branch_id: await t.branchId('Shah Alam') }),
      /permission denied/i,
    )
  })

  it('checks the details: name, email, phone, role, branch', async () => {
    const t = db()
    const a = t.people.admin
    await expectRejects(create(t, a, { p_name: '  ' }), 'Name is required')
    await expectRejects(create(t, a, { p_name: 'x'.repeat(101) }), 'The name can be at most 100 characters')
    await expectRejects(create(t, a, { p_email: 'not-an-email' }), 'Enter a valid email address')
    await expectRejects(create(t, a, { p_phone: '123' }), 'Enter a valid Malaysian phone number')
    await expectRejects(create(t, a, { p_role: null }), 'Choose a role')
    await expectRejects(create(t, a, { p_branch_id: '00000000-0000-4000-8000-000000000000' }), 'Select a valid branch')
  })

  it('needs a mobile for technicians, a free phone and a free email', async () => {
    const t = db()
    const a = t.people.admin
    await expectRejects(
      create(t, a, { p_email: 'land@example.com', p_phone: '03-5512 3457' }),
      'A technician needs a Malaysian mobile number for WhatsApp',
    )
    await expectRejects(
      create(t, a, { p_email: 'dup@example.com', p_phone: '+60 12-000 0011' }),
      'This phone number is already used by Ali',
    )
    await expectRejects(create(t, a, { p_email: 'ALI@sejuk.example.com', p_phone: '0127779999' }), 'This email is already used by Ali')
  })

  it('applies "Manager first": a branch needs a Manager before other staff', async () => {
    const t = db()
    const [b] = await t.q<{ id: string }>(`insert into branches (name) values ('Seremban') returning id`)
    await expectRejects(
      create(t, t.people.admin, { p_email: 'tech.s@example.com', p_phone: '0127772001', p_branch_id: b.id }),
      'Seremban has no Manager. Add a Manager to this branch first.',
    )
    await create(t, t.people.admin, {
      p_name: 'Mona', p_email: 'mona@example.com', p_phone: '0127772002', p_role: 'manager', p_branch_id: b.id,
    })
    const tech = await create(t, t.people.admin, { p_email: 'tech.s@example.com', p_phone: '0127772001', p_branch_id: b.id })
    expect(tech.active).toBe(true)
  })
})

// ---------------------------------------------------------------------------
describe('update_staff', () => {
  const db = staffDb()

  it('moves a technician with open jobs; the jobs stay with them', async () => {
    const t = db()
    const order = await t.createOrder({ technician: t.people.ali })
    const kl = await t.branchId('Kuala Lumpur')
    const res = await t.rpcAs<Target>(t.people.admin, 'update_staff', await editArgs(t, t.people.ali, { p_branch_id: kl }))
    expect(res.previous_email).toBe('ali@sejuk.example.com')
    expect((await t.summary(order.id as string)).assigned_technician_id).toBe(t.people.ali)
    const last = (await history(t, t.people.ali)).at(-1)!
    expect(last).toMatchObject({ action: 'updated', actor_id: t.people.admin, branch_id: kl })
    expect(last.changes).toEqual({ branch: { from: 'Shah Alam', to: 'Kuala Lumpur' } })
  })

  it('blocks a role change while the technician has open jobs', async () => {
    const t = db()
    await expectRejects(
      t.rpcAs(t.people.admin, 'update_staff', await editArgs(t, t.people.ali, { p_role: 'finance' })),
      /^Ali has \d+ open jobs?\. Reassign (it|them) first\.$/,
    )
  })

  it('changes email and records from -> to; returns the previous email', async () => {
    const t = db()
    const res = await t.rpcAs<Target>(
      t.people.admin, 'update_staff', await editArgs(t, t.people.bala, { p_email: 'Bala.New@Example.com' }),
    )
    expect(res).toMatchObject({ email: 'bala.new@example.com', previous_email: 'bala@sejuk.example.com' })
    expect((await history(t, t.people.bala)).at(-1)!.changes).toEqual({
      email: { from: 'bala@sejuk.example.com', to: 'bala.new@example.com' },
    })
  })

  it('records nothing when nothing changed', async () => {
    const t = db()
    const before = (await history(t, t.people.john)).length
    await t.rpcAs(t.people.admin, 'update_staff', await editArgs(t, t.people.john))
    expect(await history(t, t.people.john)).toHaveLength(before)
  })

  it('lets an Admin set a Manager\'s cover (cover_changed), kept when not passed, cleared when no longer a Manager', async () => {
    const t = db()
    const penang = await t.branchId('Penang')
    await t.rpcAs(t.people.admin, 'update_staff', await editArgs(t, t.people.managerKL, { p_additional_branch_ids: [penang] }))
    const h = (await history(t, t.people.managerKL)).at(-1)!
    expect(h.action).toBe('cover_changed')
    expect(h.changes).toEqual({ cover: { from: [], to: ['Penang'] } })

    await t.rpcAs(t.people.admin, 'update_staff', await editArgs(t, t.people.managerKL, { p_name: 'Tan Wei Ming' }))
    expect((await t.q('select additional_branch_ids as a from staff where id = $1', [t.people.managerKL]))[0].a).toEqual([penang])

    // A second KL Manager first, so KL keeps one.
    const kl = await t.branchId('Kuala Lumpur')
    await create(t, t.people.admin, {
      p_name: 'Kiran', p_email: 'kiran@example.com', p_phone: '0127773001', p_role: 'manager', p_branch_id: kl,
    })
    await t.rpcAs(t.people.admin, 'update_staff', await editArgs(t, t.people.managerKL, { p_role: 'finance' }))
    const [row] = await t.q<Row>('select role, additional_branch_ids as a from staff where id = $1', [t.people.managerKL])
    expect(row).toEqual({ role: 'finance', a: [] })
  })

  it('keeps self, Manager scope and cover rules', async () => {
    const t = db()
    await expectRejects(
      t.rpcAs(t.people.admin, 'update_staff', await editArgs(t, t.people.admin, { p_role: 'manager' })),
      'You cannot change your own role',
    )
    // Managers: technicians of covered branches only, never roles or cover.
    await expectRejects(
      t.rpcAs(t.people.managerSA, 'update_staff', await editArgs(t, t.people.managerPG, { p_name: 'X' })),
      'Managers can only manage technicians',
    )
    await expectRejects(
      t.rpcAs(t.people.managerSA, 'update_staff', await editArgs(t, t.people.john, { p_name: 'X' })),
      'Only a Manager of Kuala Lumpur can manage John',
    )
    await expectRejects(
      t.rpcAs(t.people.managerSA, 'update_staff', await editArgs(t, t.people.yusoff, { p_role: 'finance' })),
      'Only an Admin can change a role',
    )
    await expectRejects(
      t.rpcAs(t.people.managerSA, 'update_staff', await editArgs(t, t.people.yusoff, { p_branch_id: await t.branchId('Penang') })),
      'You do not cover Penang. Choose one of your branches.',
    )
    await expectRejects(
      t.rpcAs(t.people.managerSA, 'update_staff', await editArgs(t, t.people.yusoff, { p_email: 'yusoff.new@example.com' })),
      'Only an Admin can change an email',
    )
    // Same address in other letter case is no change.
    await t.rpcAs(t.people.managerSA, 'update_staff', await editArgs(t, t.people.yusoff, { p_email: 'YUSOFF@sejuk.example.com' }))
    const ok = await t.rpcAs<Target>(t.people.managerSA, 'update_staff', await editArgs(t, t.people.yusoff, { p_phone: '0127773002' }))
    expect(ok.name).toBe('Yusoff')
  })

  it('names the fix when the last covering Manager would move away', async () => {
    const t = db()
    await expectRejects(
      t.rpcAs(t.people.admin, 'update_staff', await editArgs(t, t.people.managerSA, { p_branch_id: await t.branchId('Penang') })),
      'Nurul Huda is the only Manager covering Shah Alam. Give another Manager cover of Shah Alam first.',
    )
  })
})

// ---------------------------------------------------------------------------
describe('set_staff_active', () => {
  const db = staffDb()

  it('deactivates and reactivates, with left_at and history; repeating changes nothing', async () => {
    const t = db()
    const p = await create(t, t.people.admin)
    const off = await t.rpcAs<Target>(t.people.admin, 'set_staff_active', { p_staff_id: p.staff_id, p_active: false })
    expect(off.active).toBe(false)
    expect((await t.q('select left_at from staff where id = $1', [p.staff_id]))[0].left_at).not.toBeNull()
    await t.rpcAs(t.people.admin, 'set_staff_active', { p_staff_id: p.staff_id, p_active: false })
    expect((await history(t, p.staff_id)).map((h) => h.action)).toEqual(['created', 'deactivated'])

    await t.rpcAs(t.people.admin, 'set_staff_active', { p_staff_id: p.staff_id, p_active: true })
    expect((await t.q('select left_at from staff where id = $1', [p.staff_id]))[0].left_at).toBeNull()
    const h = await history(t, p.staff_id)
    expect(h.map((r) => r.action)).toEqual(['created', 'deactivated', 'reactivated'])
    expect(h[1]).toMatchObject({ actor_id: t.people.admin, active: false })
  })

  it('blocks a technician with open jobs, naming the count', async () => {
    const t = db()
    await t.createOrder({ technician: t.people.bala })
    await t.createOrder({ technician: t.people.bala })
    await expectRejects(
      t.rpcAs(t.people.admin, 'set_staff_active', { p_staff_id: t.people.bala, p_active: false }),
      'Bala has 2 open jobs. Reassign them first.',
    )
  })

  it('guards self, the last Finance user and the last Admin', async () => {
    const t = db()
    await expectRejects(
      t.rpcAs(t.people.admin, 'set_staff_active', { p_staff_id: t.people.admin, p_active: false }),
      'You cannot deactivate yourself',
    )
    await expectRejects(
      t.rpcAs(t.people.admin, 'set_staff_active', { p_staff_id: t.people.finance, p_active: false }),
      'Siti Aminah is the last active Finance user. Add another Finance user first.',
    )
    await t.rpcAs(t.people.admin, 'set_staff_active', { p_staff_id: t.people.admin2, p_active: false })
    try {
      // By SQL too (checked at commit).
      await expectRejects(
        t.q('update staff set active = false where id = $1', [t.people.admin]),
        'Aisyah Rahman is the last active Admin. Add another Admin first.',
      )
    } finally {
      await t.rpcAs(t.people.admin, 'set_staff_active', { p_staff_id: t.people.admin2, p_active: true })
    }
  })

  it('lets a covering Manager deactivate their technician, not others', async () => {
    const t = db()
    const p = await create(t, t.people.managerSA, { p_name: 'Temp', p_email: 'temp@example.com', p_phone: '0127774001' })
    await t.rpcAs(t.people.managerSA, 'set_staff_active', { p_staff_id: p.staff_id, p_active: false })
    await expectRejects(
      t.rpcAs(t.people.managerKL, 'set_staff_active', { p_staff_id: p.staff_id, p_active: true }),
      'Only a Manager of Shah Alam can manage Temp',
    )
  })

  it('applies the phone and "Manager first" rules on reactivation', async () => {
    const t = db()
    const p = await create(t, t.people.admin, { p_name: 'Old', p_email: 'old@example.com', p_phone: '0127775001' })
    await t.rpcAs(t.people.admin, 'set_staff_active', { p_staff_id: p.staff_id, p_active: false })
    await create(t, t.people.admin, { p_name: 'New', p_email: 'new@example.com', p_phone: '0127775001' })
    await expectRejects(
      t.rpcAs(t.people.admin, 'set_staff_active', { p_staff_id: p.staff_id, p_active: true }),
      'This phone number is already used by New',
    )

    const [b] = await t.q<{ id: string }>(`insert into branches (name) values ('Ipoh') returning id`)
    const m = await create(t, t.people.admin, {
      p_name: 'Ipoh Manager', p_email: 'im@example.com', p_phone: '0127775002', p_role: 'manager', p_branch_id: b.id,
    })
    const tech = await create(t, t.people.admin, { p_name: 'Ipoh Tech', p_email: 'it@example.com', p_phone: '0127775003', p_branch_id: b.id })
    await expectRejects(
      t.rpcAs(t.people.admin, 'set_staff_active', { p_staff_id: m.staff_id, p_active: false }),
      'Ipoh Manager is the only Manager covering Ipoh. Give another Manager cover of Ipoh first.',
    )
    await t.rpcAs(t.people.admin, 'set_staff_active', { p_staff_id: tech.staff_id, p_active: false })
    await t.rpcAs(t.people.admin, 'set_staff_active', { p_staff_id: m.staff_id, p_active: false })
    await expectRejects(
      t.rpcAs(t.people.admin, 'set_staff_active', { p_staff_id: tech.staff_id, p_active: true }),
      'Ipoh has no Manager. Add a Manager to this branch first.',
    )
  })
})

// ---------------------------------------------------------------------------
describe('Staff rules hold for plain SQL too', () => {
  const db = staffDb()
  const insert = (t: TestDb, name: string, phone: string, role = 'technician') =>
    t.q(
      `insert into staff (name, email, phone, role, branch_id)
       select $1, lower($1) || '@example.com', $2, $3::staff_role, id from branches where name = 'Shah Alam'`,
      [name, phone, role],
    )

  it('rejects a phone not in stored form, a technician landline, and a phone in use', async () => {
    const t = db()
    await expectRejects(insert(t, 'A', '012-777 6001'), 'Store the phone number as digits with the country code')
    await expectRejects(insert(t, 'B', '60355123456'), 'A technician needs a Malaysian mobile number')
    await expectRejects(insert(t, 'C', '60120000011'), 'This phone number is already used by Ali')
    await insert(t, 'D', '60355123456', 'finance')
  })

  it('rejects deactivating a technician with open jobs; records history with no actor', async () => {
    const t = db()
    await t.createOrder({ technician: t.people.john, branch: 'Kuala Lumpur' })
    await expectRejects(t.q('update staff set active = false where id = $1', [t.people.john]), 'John has 1 open job. Reassign it first.')
    await t.q(`update staff set name = 'Johnny' where id = $1`, [t.people.john])
    expect((await history(t, t.people.john)).at(-1)).toMatchObject({ action: 'updated', actor_id: null })
  })

  it('keeps history append-only (rows go only with a deleted staff row, for test cleanup)', async () => {
    const t = db()
    await expectRejects(t.q(`update staff_history set action = 'updated'`), 'Staff history cannot be changed')
    await expectRejects(t.q('delete from staff_history'), 'Staff history cannot be changed')
    await insert(t, 'Gone', '60127776002')
    const [g] = await t.q<{ id: string }>(`select id from staff where name = 'Gone'`)
    await t.q('delete from staff where id = $1', [g.id])
    expect(await history(t, g.id)).toEqual([])
  })

  it('lets test cleanup delete someone who changed other people (their history entries keep no actor)', async () => {
    const t = db()
    await t.q(`insert into staff (name, email, phone, role, branch_id)
               select 'Temp Admin', 'tempadmin@example.com', '60127776010', 'admin', id from branches where name = 'Shah Alam'`)
    const [a] = await t.q<{ id: string }>(`select id from staff where name = 'Temp Admin'`)
    await t.createAuthUser('tempadmin@example.com')
    await t.rpcAs(a.id, 'update_staff', await editArgs(t, t.people.yusoff, { p_name: 'Yusoff B' }))
    await t.q('delete from staff where id = $1', [a.id])
    const last = (await history(t, t.people.yusoff)).at(-1)!
    expect(last).toMatchObject({ action: 'updated', actor_id: null })
    // Changing anything else is still refused.
    await expectRejects(t.q('update staff_history set actor_id = null where staff_id = $1', [t.people.ali]), 'Staff history cannot be changed')
  })

  it('does not record linking a sign-in', async () => {
    const t = db()
    await insert(t, 'Linky', '60127776003')
    const [s] = await t.q<{ id: string }>(`select id from staff where name = 'Linky'`)
    await t.createAuthUser('linky@example.com')
    expect((await history(t, s.id)).map((h) => h.action)).toEqual(['created'])
  })
})

// ---------------------------------------------------------------------------
describe('Sign-in steps (staff-access server function)', () => {
  const db = staffDb()

  async function invitedStaff(t: TestDb, email: string, phone: string) {
    const p = await create(t, t.people.admin, { p_name: email.split('@')[0], p_email: email, p_phone: phone })
    const [u] = await t.q<{ id: string }>('insert into auth.users (email) values ($1) returning id', [email])
    await t.rpcAs(SERVICE_ROLE, 'link_invited_staff', { p_staff_id: p.staff_id, p_auth_user_id: u.id })
    return { ...p, authId: u.id }
  }

  it('links the invited sign-in (secret key only) and tracks the sign-in state', async () => {
    const t = db()
    const p = await create(t, t.people.admin, { p_email: 'inv@example.com', p_phone: '0127778001' })
    const [u] = await t.q<{ id: string }>(`insert into auth.users (email) values ('inv@example.com') returning id`)
    await expectRejects(
      t.rpcAs(t.people.admin, 'link_invited_staff', { p_staff_id: p.staff_id, p_auth_user_id: u.id }),
      /permission denied/i,
    )
    await t.rpcAs(SERVICE_ROLE, 'link_invited_staff', { p_staff_id: p.staff_id, p_auth_user_id: u.id })
    const check = () => t.rpcAs<Target>(t.people.admin, 'staff_access_check', { p_staff_id: p.staff_id, p_action: 'email_sync' })
    expect((await check()).sign_in_state).toBe('invite_pending')
    await t.q('update auth.users set email_confirmed_at = now() where id = $1', [u.id])
    expect((await check()).sign_in_state).toBe('ready')

    const [other] = await t.q<{ id: string }>(`insert into auth.users (email) values ('other@example.com') returning id`)
    await expectRejects(
      t.rpcAs(SERVICE_ROLE, 'link_invited_staff', { p_staff_id: p.staff_id, p_auth_user_id: other.id }),
      'This staff member is already linked to another sign-in',
    )
  })

  it('allows an invite until a password is set, a reset only after', async () => {
    const t = db()
    const p = await invitedStaff(t, 'pend@example.com', '0127778002')
    const check = (action: string, actor = t.people.admin) =>
      t.rpcAs<Target>(actor, 'staff_access_check', { p_staff_id: p.staff_id, p_action: action })
    expect((await check('invite')).email).toBe('pend@example.com')
    await expectRejects(check('password_reset'), 'pend has not set a password yet. Send the invite again instead.')
    await t.q('update auth.users set email_confirmed_at = now() where id = $1', [p.authId])
    await expectRejects(check('invite'), 'pend has already set a password. Send a password reset instead.')
    expect((await check('password_reset')).sign_in_state).toBe('ready')
    expect((await check('unblock')).active).toBe(true)
    await expectRejects(check('block'), 'pend is active')
    await expectRejects(check('teleport'), 'Unknown sign-in action: teleport')
    await expectRejects(check('invite', t.people.ali), 'Only Admins and Managers can manage staff')
    await expectRejects(check('invite', t.people.managerKL), 'Only a Manager of Shah Alam can manage pend')

    await t.rpcAs(t.people.admin, 'set_staff_active', { p_staff_id: p.staff_id, p_active: false })
    await expectRejects(check('password_reset'), 'pend is inactive. Reactivate them first.')
    expect((await check('block')).active).toBe(false)
  })

  it('records invites and resets in the history', async () => {
    const t = db()
    const p = await invitedStaff(t, 'ev@example.com', '0127778003')
    await t.rpcAs(t.people.admin, 'staff_access_event', { p_staff_id: p.staff_id, p_action: 'invite_sent' })
    await t.rpcAs(t.people.admin, 'staff_access_event', { p_staff_id: p.staff_id, p_action: 'password_reset' })
    const h = await history(t, p.staff_id)
    expect(h.map((r) => r.action)).toEqual(['created', 'invite_sent', 'password_reset'])
    expect(h[1]).toMatchObject({ actor_id: t.people.admin, changes: { email: { to: 'ev@example.com' } } })
    await expectRejects(
      t.rpcAs(t.people.admin, 'staff_access_event', { p_staff_id: p.staff_id, p_action: 'created' }),
      'Unknown sign-in event: created',
    )
  })
})

// ---------------------------------------------------------------------------
describe('Staff screen reads', () => {
  const db = staffDb()
  const list = (t: TestDb, actor: string, args: Record<string, unknown> = {}) =>
    t.qAs<Row>(
      actor,
      `select * from staff_list(p_search => $1, p_role => $2::staff_role, p_branch_id => $3, p_status => $4,
                                p_limit => $5, p_offset => $6)`,
      [args.search ?? null, args.role ?? null, args.branch ?? null, args.status ?? 'active', args.limit ?? 25, args.offset ?? 0],
    )
  const names = (rows: Row[]) => rows.map((r) => r.name)

  it('lists everyone for an Admin, by name, with the total', async () => {
    const t = db()
    const rows = await list(t, t.people.admin)
    expect(rows).toHaveLength(12)
    expect(names(rows)).toEqual([...names(rows)].sort((a, b) => String(a).toLowerCase().localeCompare(String(b).toLowerCase())))
    expect(rows.every((r) => Number(r.total_count) === 12 && r.can_manage === true)).toBe(true)
    const page2 = await list(t, t.people.admin, { limit: 5, offset: 10 })
    expect(page2).toHaveLength(2)
    expect(Number(page2[0].total_count)).toBe(12)
  })

  it('searches name, email and phone; filters role, branch (incl. cover) and status', async () => {
    const t = db()
    const a = t.people.admin
    expect(names(await list(t, a, { search: 'ali' }))).toEqual(['Ali'])
    expect(names(await list(t, a, { search: 'weiming@' }))).toEqual(['Tan Wei Ming'])
    expect(names(await list(t, a, { search: '012-000 0013' }))).toEqual(['Bala'])
    expect(names(await list(t, a, { search: '20000031' }))).toEqual(['Siti Aminah'])
    expect(names(await list(t, a, { role: 'technician' }))).toEqual(['Ali', 'Bala', 'John', 'Yusoff'])

    const penang = await t.branchId('Penang')
    expect(names(await list(t, a, { branch: penang }))).toEqual(['Lim Mei Ling'])
    await t.q('update staff set additional_branch_ids = array[$2::uuid] where id = $1', [t.people.managerKL, penang])
    expect(names(await list(t, a, { branch: penang }))).toEqual(['Lim Mei Ling', 'Tan Wei Ming'])
    await t.q(`update staff set additional_branch_ids = '{}' where id = $1`, [t.people.managerKL])

    await t.q('update staff set active = false where id = $1', [t.people.yusoff])
    expect(names(await list(t, a, { status: 'inactive' }))).toEqual(['Yusoff'])
    expect(await list(t, a, { status: 'all' })).toHaveLength(12)
    expect(await list(t, a)).toHaveLength(11)
    await t.q('update staff set active = true where id = $1', [t.people.yusoff])
    await expectRejects(list(t, a, { status: 'gone' }), 'Unknown staff status filter: gone')
  })

  it('shows a Manager the staff of covered branches; manageable = their technicians', async () => {
    const t = db()
    const rows = await list(t, t.people.managerSA)
    expect(names(rows)).toEqual(['Ali', 'Bala', 'Farid Hakim', 'Nurul Huda', 'Yusoff'])
    expect(rows.filter((r) => r.can_manage).map((r) => r.name)).toEqual(['Ali', 'Bala', 'Yusoff'])
    await expectRejects(list(t, t.people.ali), 'Only Admins and Managers can see staff')
    await expectRejects(list(t, t.people.finance), 'Only Admins and Managers can see staff')
  })

  it('staff_detail: profile, permissions, open jobs, history; hidden outside a Manager\'s branches', async () => {
    const t = db()
    const order = await t.createOrder({ technician: t.people.ali })
    const d = (await t.rpcAs<{ staff_detail: Record<string, any> }>(t.people.admin, 'staff_detail', { p_staff_id: t.people.ali })).staff_detail
    expect(d.staff).toMatchObject({ name: 'Ali', role: 'technician', branch_name: 'Shah Alam', active: true, sign_in_state: 'ready' })
    expect(d.permissions).toMatchObject({
      can_edit: true, can_change_role: true, can_change_cover: true, can_deactivate: true,
      can_reactivate: false, can_send_invite: false, can_reset_password: true,
      deactivate_blocker: 'Ali has 1 open job. Reassign it first.',
    })
    expect(d.open_jobs).toEqual([
      { order_id: order.id, order_no: order.order_no, status: 'assigned', branch_name: 'Shah Alam' },
    ])
    expect(d.history[0]).toMatchObject({ action: 'created', actor_name: null })

    const self = (await t.rpcAs<{ staff_detail: Record<string, any> }>(t.people.admin, 'staff_detail', { p_staff_id: t.people.admin })).staff_detail
    expect(self.permissions).toMatchObject({ can_edit: true, can_deactivate: false, can_change_role: false })

    const asManager = (await t.rpcAs<{ staff_detail: Record<string, any> }>(t.people.managerSA, 'staff_detail', { p_staff_id: t.people.admin2 })).staff_detail
    expect(asManager.permissions).toMatchObject({
      can_edit: false, can_change_cover: false, can_change_email: false, can_reset_password: false,
    })
    expect(d.permissions.can_change_email).toBe(true)
    await expectRejects(t.rpcAs(t.people.managerSA, 'staff_detail', { p_staff_id: t.people.john }), 'Staff member not found')
  })

  it('branch_cover_overview: each branch, its Managers, active staff, and whether it has one', async () => {
    const t = db()
    const sa = await t.branchId('Shah Alam')
    await t.q('update staff set additional_branch_ids = array[$2::uuid] where id = $1', [t.people.managerPG, sa])
    try {
      const rows = await t.qAs<Row>(t.people.managerKL, 'select * from branch_cover_overview()')
      expect(rows.map((r) => r.branch_name)).toEqual(['Johor Bahru', 'Kota Kinabalu', 'Kuala Lumpur', 'Penang', 'Shah Alam'])
      const shahAlam = rows.find((r) => r.branch_name === 'Shah Alam')!
      expect(shahAlam).toMatchObject({ active_staff: 5, has_manager: true })
      expect(shahAlam.managers).toEqual([
        { id: t.people.managerSA, name: 'Nurul Huda', home: true },
        { id: t.people.managerPG, name: 'Lim Mei Ling', home: false },
      ])
    } finally {
      await t.q(`update staff set additional_branch_ids = '{}' where id = $1`, [t.people.managerPG])
    }
    await expectRejects(t.qAs(t.people.ali, 'select * from branch_cover_overview()'), 'Only Admins and Managers can see staff')
  })

  it('staff_form_check lists every problem before saving, and none for a good form', async () => {
    const t = db()
    const check = (args: Record<string, unknown>) =>
      t.qAs<{ field: string; message: string }>(
        t.people.admin,
        `select * from staff_form_check(p_staff_id => $1, p_name => $2, p_email => $3, p_phone => $4,
                                        p_role => $5::staff_role, p_branch_id => $6, p_additional_branch_ids => $7,
                                        p_active => $8)`,
        [args.id ?? null, args.name ?? 'Ravi', args.email ?? 'ravi@example.com', args.phone ?? '0127779001',
         'role' in args ? args.role : 'technician', args.branch ?? null, args.cover ?? null, args.active ?? true],
      )
    const sa = await t.branchId('Shah Alam')
    expect(await check({ branch: sa })).toEqual([])
    expect(await check({ branch: sa, name: '', email: 'bad', phone: '03-5512 3456' })).toEqual([
      { field: 'name', message: 'Name is required' },
      { field: 'email', message: 'Enter a valid email address, for example ravi@example.com' },
      { field: 'phone', message: 'A technician needs a Malaysian mobile number for WhatsApp, for example 012-345 6789' },
    ])
    expect(await check({ branch: sa, phone: '123' })).toEqual([
      { field: 'phone', message: 'Enter a valid Malaysian phone number, for example 012-345 6789 or 03-1234 5678' },
    ])
    expect(await check({ branch: sa, phone: '012-000 0011', email: 'ali@sejuk.example.com' })).toEqual([
      { field: 'phone', message: 'This phone number is already used by Ali' },
      { field: 'email', message: 'This email is already used by Ali' },
    ])
    // Editing Nurul: moving her leaves Shah Alam without a Manager.
    expect(
      await check({ id: t.people.managerSA, name: 'Nurul Huda', email: 'nurul@sejuk.example.com', phone: '60120000021',
                    role: 'manager', branch: await t.branchId('Penang') }),
    ).toEqual([
      { field: 'branch', message: 'Nurul Huda is the only Manager covering Shah Alam. Give another Manager cover of Shah Alam first.' },
    ])
    // Deactivation preview (the confirm dialog).
    expect(
      await check({ id: t.people.finance, name: 'Siti Aminah', email: 'siti@sejuk.example.com', phone: '60120000031',
                    role: 'finance', branch: await t.branchId('Kuala Lumpur'), active: false }),
    ).toEqual([{ field: 'active', message: 'Siti Aminah is the last active Finance user. Add another Finance user first.' }])
    expect(await check({ role: null, branch: sa })).toEqual([{ field: 'role', message: 'Choose a role' }])
  })
})

// ---------------------------------------------------------------------------
describe('order_review_summary carries the ids behind its staff names', () => {
  const db = staffDb()

  it('completion technician, reviewer and closer', async () => {
    const t = db()
    const o = await t.createOrder({ technician: t.people.ali })
    await t.closeOrder(o.id as string)
    const [r] = await t.q<Row>(
      `select completion_technician_id, reviewed_by_id, closed_by_id from order_review_summary where id = $1`,
      [o.id],
    )
    expect(r).toEqual({ completion_technician_id: t.people.ali, reviewed_by_id: t.people.managerSA, closed_by_id: t.people.finance })
  })
})
