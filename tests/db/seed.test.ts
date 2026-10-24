import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './helpers'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

describe('AC1 seed data', () => {
  it('loads the 5 branches', async () => {
    const rows = await t.q<{ name: string }>('select name from branches order by name')
    expect(rows.map((r) => r.name).sort()).toEqual(
      ['Johor Bahru', 'Kota Kinabalu', 'Kuala Lumpur', 'Penang', 'Shah Alam'].sort(),
    )
  })

  it('loads at least one user for every role', async () => {
    const rows = await t.q<{ role: string; n: string }>(
      'select role, count(*)::text as n from staff group by role',
    )
    const counts = Object.fromEntries(rows.map((r) => [r.role, Number(r.n)]))
    expect(counts.admin).toBe(2)
    expect(counts.manager).toBe(5)
    expect(counts.finance).toBeGreaterThanOrEqual(1)
    expect(counts.technician).toBeGreaterThanOrEqual(4)
  })

  it('loads the four brief technicians with the right branches', async () => {
    const rows = await t.q<{ name: string; branch: string }>(
      `select s.name, b.name as branch
         from staff s join branches b on b.id = s.branch_id
        where s.role = 'technician' and s.name in ('Ali', 'John', 'Bala', 'Yusoff')
        order by s.name`,
    )
    expect(rows).toEqual([
      { name: 'Ali', branch: 'Shah Alam' },
      { name: 'Bala', branch: 'Shah Alam' },
      { name: 'John', branch: 'Kuala Lumpur' },
      { name: 'Yusoff', branch: 'Shah Alam' },
    ])
  })

  it('places a Manager in every branch (0004: a branch needs a Manager first)', async () => {
    const rows = await t.q<{ branch: string }>(
      `select b.name as branch from staff s join branches b on b.id = s.branch_id
        where s.role = 'manager' order by b.name`,
    )
    expect(rows.map((r) => r.branch)).toEqual(['Johor Bahru', 'Kota Kinabalu', 'Kuala Lumpur', 'Penang', 'Shah Alam'])
  })

  it('loads the service types', async () => {
    const rows = await t.q<{ name: string }>('select name from service_types')
    expect(rows.map((r) => r.name).sort()).toEqual(
      ['Aircond cleaning', 'Gas refill', 'General servicing', 'Installation', 'Repair'].sort(),
    )
  })

  it('gives every staff member a fake Malaysian phone number', async () => {
    const rows = await t.q<{ phone: string }>('select phone from staff')
    for (const r of rows) expect(r.phone).toMatch(/^601\d{8,9}$/)
  })

  it('gives every staff member a unique lower-case sign-in email', async () => {
    const rows = await t.q<{ name: string; email: string }>('select name, email from staff order by name')
    expect(Object.fromEntries(rows.map((r) => [r.name, r.email]))).toEqual({
      'Aisyah Rahman': 'aisyah.admin.kl@sejuk.example.com',
      'Farid Hakim': 'farid.admin.sa@sejuk.example.com',
      Ali: 'ali.tech.sa@sejuk.example.com',
      John: 'john.tech.kl@sejuk.example.com',
      Bala: 'bala.tech.sa@sejuk.example.com',
      Yusoff: 'yusoff.tech.sa@sejuk.example.com',
      'Nurul Huda': 'nurul.manager.sa@sejuk.example.com',
      'Tan Wei Ming': 'weiming.manager.kl@sejuk.example.com',
      'Lim Mei Ling': 'meiling.manager.pg@sejuk.example.com',
      'Hafiz Osman': 'hafiz.manager.jb@sejuk.example.com',
      'Grace Lojuni': 'grace.manager.kk@sejuk.example.com',
      'Siti Aminah': 'siti.finance.kl@sejuk.example.com',
    })
    for (const r of rows) expect(r.email).toBe(r.email.toLowerCase())
  })

  it('shapes every email as <name>.<role>.<branch>@sejuk.example.com, matching the role and branch (0010)', async () => {
    const rows = await t.q<{ email: string; role: string; branch: string }>(
      'select s.email, s.role::text as role, b.name as branch from staff s join branches b on b.id = s.branch_id',
    )
    const role: Record<string, string> = { admin: 'admin', manager: 'manager', technician: 'tech', finance: 'finance' }
    const branch: Record<string, string> = {
      'Kuala Lumpur': 'kl',
      'Shah Alam': 'sa',
      Penang: 'pg',
      'Johor Bahru': 'jb',
      'Kota Kinabalu': 'kk',
    }
    for (const r of rows) expect(r.email).toMatch(new RegExp(`^[a-z]+\\.${role[r.role]}\\.${branch[r.branch]}@sejuk\\.example\\.com$`))
  })

  it('creates no sign-in accounts itself (the login script does that)', async () => {
    const bare = await createTestDb({ provisionLogins: false })
    try {
      expect(await bare.q('select 1 from auth.users')).toHaveLength(0)
      expect(await bare.q('select 1 from staff where auth_user_id is not null')).toHaveLength(0)
    } finally {
      await bare.close()
    }
  })

  it('loads no sample orders', async () => {
    const rows = await t.q<{ n: string }>('select count(*)::text as n from orders')
    expect(rows[0].n).toBe('0')
  })
})
