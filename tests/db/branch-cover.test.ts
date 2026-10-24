import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SIGNED_OUT, createTestDb, expectRejects, type TestDb } from './helpers'

// 0004 branch cover: a Manager covers their home branch and their additional
// branches, and every branch needs a Manager before it has other staff or
// orders (supabase/migrations/20261023000002_review_and_close.sql).

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

const setCover = (staffId: string, branchIds: string[]) =>
  t.q('update staff set additional_branch_ids = $2::uuid[] where id = $1', [staffId, branchIds])

/** A new branch with no staff yet. */
async function newBranch(name: string): Promise<string> {
  const [b] = await t.q<{ id: string }>('insert into branches (name) values ($1) returning id', [name])
  return b.id
}

const addStaff = (name: string, role: string, branchId: string) =>
  t.q<{ id: string }>(
    `insert into staff (name, email, phone, role, branch_id)
     values ($1, lower(replace($1, ' ', '')) || '@sejuk.example.com', '60120000099', $2::staff_role, $3)
     returning id`,
    [name, role, branchId],
  )

describe('Additional branches on the staff record', () => {
  it('lists extra branches for a Manager', async () => {
    const penang = await t.branchId('Penang')
    const jb = await t.branchId('Johor Bahru')
    await setCover(t.people.managerSA, [penang, jb])
    const [row] = await t.q<{ a: string[] }>('select additional_branch_ids as a from staff where id = $1', [
      t.people.managerSA,
    ])
    expect(row.a.sort()).toEqual([penang, jb].sort())
    await setCover(t.people.managerSA, [])
  })

  it('rejects them for non-Managers, unknown branches, the home branch, and duplicates', async () => {
    const penang = await t.branchId('Penang')
    await expectRejects(setCover(t.people.ali, [penang]), 'Only Managers can cover additional branches')
    await expectRejects(setCover(t.people.finance, [penang]), 'Only Managers can cover additional branches')
    await expectRejects(
      setCover(t.people.managerSA, ['00000000-0000-4000-8000-000000000000']),
      'Choose existing branches as additional branches',
    )
    await expectRejects(
      t.q(`update staff set additional_branch_ids = array[null]::uuid[] where id = $1`, [t.people.managerSA]),
      'Choose existing branches as additional branches',
    )
    await expectRejects(
      setCover(t.people.managerSA, [await t.branchId('Shah Alam')]),
      'The home branch cannot also be an additional branch',
    )
    await expectRejects(setCover(t.people.managerSA, [penang, penang]), 'An additional branch is listed twice')
  })

  it('cannot be changed through the API (no write grants)', async () => {
    await expectRejects(
      t.qAs(t.people.managerSA, `update staff set additional_branch_ids = '{}' where id = $1`, [t.people.managerSA]),
      /permission denied/i,
    )
  })

  it('covered_branches lists the signed-in Manager’s home branch first, then the others by name', async () => {
    const penang = await t.branchId('Penang')
    const jb = await t.branchId('Johor Bahru')
    await setCover(t.people.managerSA, [penang, jb])
    try {
      const rows = await t.qAs<{ name: string; home: boolean }>(t.people.managerSA, 'select name, home from covered_branches()')
      expect(rows).toEqual([
        { name: 'Shah Alam', home: true },
        { name: 'Johor Bahru', home: false },
        { name: 'Penang', home: false },
      ])
      await expectRejects(t.qAs(t.people.finance, 'select * from covered_branches()'), 'Only Managers cover branches')
      await expectRejects(t.qAs(SIGNED_OUT, 'select * from covered_branches()'), /permission denied/i)
    } finally {
      await setCover(t.people.managerSA, [])
    }
  })
})

describe('A Manager acts only on branches they cover', () => {
  it('reads, is told about, and reviews a covered branch; not others', async () => {
    const penangOrder = (await t.createOrder({ technician: t.people.ali, branch: 'Penang' })).id as string
    await t.advance(penangOrder, 'job_done')
    // Nurul (Shah Alam) cannot see or review Penang yet.
    expect(await t.qAs(t.people.managerSA, 'select id from orders where id = $1', [penangOrder])).toEqual([])
    await t.tellCustomer(penangOrder)
    await expectRejects(t.transition(t.people.managerSA, penangOrder, 'reviewed'), 'Only a Manager of Penang can')
    await expectRejects(
      t.transition(t.people.managerSA, penangOrder, 'in_progress', 'Redo'),
      'Only a Manager of Penang can',
    )

    // Penang's Manager leaves; Nurul covers Penang.
    await setCover(t.people.managerSA, [await t.branchId('Penang')])
    try {
      expect(await t.qAs(t.people.managerSA, 'select id from orders where id = $1', [penangOrder])).toHaveLength(1)
      expect((await t.transition(t.people.managerSA, penangOrder, 'reviewed')).status).toBe('reviewed')

      // Job Done notices go to every Manager covering the branch.
      const next = (await t.createOrder({ technician: t.people.ali, branch: 'Penang' })).id as string
      await t.advance(next, 'job_done')
      const told = (await t.notifications(next)).filter((n) => n.event === 'job_done').map((n) => n.recipient_id)
      expect(told.sort()).toEqual([t.people.managerSA, t.people.managerPG].sort())
    } finally {
      await setCover(t.people.managerSA, [])
    }
    expect(await t.qAs(t.people.managerSA, 'select id from orders where id = $1', [penangOrder])).toEqual([])
  })
})

describe('Every branch needs a Manager first', () => {
  it('rejects a technician, Admin or Finance user in a branch with no Manager', async () => {
    const ipoh = await newBranch('Ipoh')
    for (const role of ['technician', 'admin', 'finance']) {
      await expectRejects(addStaff(`Ipoh ${role}`, role, ipoh), 'Ipoh has no Manager. Add a Manager to this branch first.')
    }
    expect(await t.q('select 1 from staff where branch_id = $1', [ipoh])).toEqual([])
  })

  it('accepts the Manager and the staff in one transaction, in either order', async () => {
    const kuantan = await newBranch('Kuantan')
    await t.db.exec(`
      begin;
      insert into staff (name, email, phone, role, branch_id)
        values ('Ravi', 'ravi@sejuk.example.com', '60120000091', 'technician', '${kuantan}');
      insert into staff (name, email, phone, role, branch_id)
        values ('Aminah Kuantan', 'aminah.k@sejuk.example.com', '60120000092', 'manager', '${kuantan}');
      commit;
    `)
    expect(await t.q('select 1 from staff where branch_id = $1', [kuantan])).toHaveLength(2)
  })

  it('accepts staff in a branch covered only as an additional branch', async () => {
    const melaka = await newBranch('Melaka')
    await setCover(t.people.managerKL, [melaka])
    try {
      const [tech] = await addStaff('Melaka Tech', 'technician', melaka)
      expect(tech.id).toBeTruthy()
      // The cover cannot be removed while Melaka has staff and no other Manager.
      await expectRejects(setCover(t.people.managerKL, []), 'Melaka has no Manager')
      await t.q('update staff set active = false where id = $1', [tech.id])
    } finally {
      await setCover(t.people.managerKL, [])
    }
  })

  it('keeps the last Manager: no deactivating, moving or demoting while other staff remain', async () => {
    const nurul = t.people.managerSA
    await expectRejects(t.q('update staff set active = false where id = $1', [nurul]), 'Shah Alam has no Manager')
    await expectRejects(
      t.q('update staff set branch_id = $2 where id = $1', [nurul, await t.branchId('Penang')]),
      'Shah Alam has no Manager',
    )
    await expectRejects(t.q(`update staff set role = 'admin' where id = $1`, [nurul]), 'Shah Alam has no Manager')
    // Moving a technician into a branch without a Manager is rejected too.
    const empty = await newBranch('Seremban')
    await expectRejects(t.q('update staff set branch_id = $2 where id = $1', [t.people.bala, empty]), 'Seremban has no Manager')
    const [row] = await t.q<{ active: boolean; role: string }>('select active, role from staff where id = $1', [nurul])
    expect(row).toEqual({ active: true, role: 'manager' })
  })

  it('lets a Manager go once another Manager covers the branch', async () => {
    const penang = await t.branchId('Penang')
    const [extra] = await addStaff('Penang Tech', 'technician', penang)
    await setCover(t.people.managerSA, [penang])
    try {
      await t.q('update staff set active = false where id = $1', [t.people.managerPG])
      expect((await t.q<{ active: boolean }>('select active from staff where id = $1', [t.people.managerPG]))[0].active).toBe(
        false,
      )
    } finally {
      await t.q('update staff set active = true where id = $1', [t.people.managerPG])
      await t.q('update staff set active = false where id = $1', [extra.id])
      await setCover(t.people.managerSA, [])
    }
  })

  it('lets a branch with no other staff lose its Manager', async () => {
    const putrajaya = await newBranch('Putrajaya')
    const [m] = await addStaff('Putrajaya Manager', 'manager', putrajaya)
    await t.q('update staff set active = false where id = $1', [m.id])
    expect((await t.q<{ active: boolean }>('select active from staff where id = $1', [m.id]))[0].active).toBe(false)
  })

  it('rejects an order for a branch with no Manager, and moving an order there', async () => {
    const kuching = await newBranch('Kuching')
    await expectRejects(
      t.rpcAs(t.people.admin, 'create_order', {
        p_branch_id: kuching,
        p_customer_name: 'Encik Tan',
        p_customer_phone: '60123456789',
        p_customer_address: '1 Jalan Padungan, Kuching',
        p_problem_description: 'Aircond leaking',
        p_service_type_id: await t.serviceTypeId('Repair'),
        p_quoted_price: 150,
        p_scheduled_at: null,
        p_admin_notes: null,
        p_technician_id: null,
      }),
      'Kuching has no Manager. Add a Manager to this branch first.',
    )
    const order = await t.createOrder()
    await expectRejects(
      t.q('update orders set branch_id = $2 where id = $1', [order.id, kuching]),
      'Kuching has no Manager',
    )
    // Editing an order without changing its branch is unaffected.
    await t.q(`update orders set admin_notes = 'Call first' where id = $1`, [order.id])
  })
})
