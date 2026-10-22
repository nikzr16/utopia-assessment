import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, expectRejects, type TestDb } from './helpers'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

describe('AC14 order numbers are automatic, unique, and cannot be edited', () => {
  // Keep first: it relies on a fresh database / sequence.
  it('starts at ORDER1001 and counts up', async () => {
    const a = await t.createOrder()
    const b = await t.createOrder()
    const c = await t.createOrder({ technician: t.people.ali })
    expect([a.order_no, b.order_no, c.order_no]).toEqual(['ORDER1001', 'ORDER1002', 'ORDER1003'])
  })

  it('generates a unique number for every order', async () => {
    const orders = await Promise.all([1, 2, 3, 4, 5].map(() => t.createOrder()))
    const numbers = orders.map((o) => o.order_no as string)
    expect(new Set(numbers).size).toBe(numbers.length)
    for (const n of numbers) expect(n).toMatch(/^ORDER\d{4,}$/)
  })

  it('rejects editing the order number', async () => {
    const o = await t.createOrder()
    await expectRejects(
      t.q('update orders set order_no = $1 where id = $2', ['ORDER9999', o.id]),
      'Order number cannot be changed',
    )
    expect((await t.summary(o.id as string)).order_no).toBe(o.order_no)
  })

  it('rejects editing the order number even when other columns change in the same update', async () => {
    const o = await t.createOrder()
    await expectRejects(
      t.q('update orders set order_no = $1, customer_name = $2 where id = $3', ['ORDER1', 'Someone', o.id]),
      'Order number cannot be changed',
    )
    expect((await t.summary(o.id as string)).customer_name).toBe('Encik Hafiz')
  })

  it('still allows other columns to be updated (order_no unchanged)', async () => {
    const o = await t.createOrder()
    await t.q('update orders set admin_notes = $1 where id = $2', ['Gate code 1234', o.id])
    const s = await t.summary(o.id as string)
    expect(s.admin_notes).toBe('Gate code 1234')
    expect(s.order_no).toBe(o.order_no)
  })

  it('enforces uniqueness at the database level', async () => {
    const a = await t.createOrder()
    await expect(
      t.q(
        `insert into orders (order_no, branch_id, customer_name, customer_phone, customer_address,
                             problem_description, service_type_id, quoted_price, created_by)
         select $1, branch_id, customer_name, customer_phone, customer_address,
                problem_description, service_type_id, quoted_price, created_by
           from orders where id = $2`,
        [a.order_no, a.id],
      ),
    ).rejects.toThrow(/unique/i)
  })

  it('keeps order numbers when an order is cancelled or closed', async () => {
    const o = await t.createOrder()
    await t.transition(t.people.admin, o.id as string, 'cancelled', 'Test')
    expect((await t.summary(o.id as string)).order_no).toBe(o.order_no)
  })
})

describe('create_order rules', () => {
  const base = async () => ({
    p_branch_id: await t.branchId('Shah Alam'),
    p_customer_name: 'Puan Aminah',
    p_customer_phone: '60121112222',
    p_customer_address: '5 Jalan Kenanga, Shah Alam',
    p_problem_description: 'Water leaking',
    p_service_type_id: await t.serviceTypeId('Repair'),
    p_quoted_price: 180,
  })

  it('only Admin can create orders', async () => {
    for (const actor of [t.people.ali, t.people.managerSA, t.people.finance]) {
      await expectRejects(
        t.rpcAs(actor, 'create_order', await base()),
        'Only Admin can create an order',
      )
    }
  })

  it('requires the customer and problem details', async () => {
    await expectRejects(t.rpcAs(t.people.admin, 'create_order', { ...(await base()), p_customer_name: ' ' }), 'Customer name is required')
    await expectRejects(t.rpcAs(t.people.admin, 'create_order', { ...(await base()), p_customer_phone: '' }), 'Customer phone is required')
    await expectRejects(t.rpcAs(t.people.admin, 'create_order', { ...(await base()), p_customer_address: '' }), 'Customer address is required')
    await expectRejects(
      t.rpcAs(t.people.admin, 'create_order', { ...(await base()), p_problem_description: '' }),
      'Problem description is required',
    )
  })

  it('rejects a bad branch, service type, price or technician', async () => {
    const zero = '00000000-0000-0000-0000-000000000000'
    await expectRejects(t.rpcAs(t.people.admin, 'create_order', { ...(await base()), p_branch_id: zero }), 'Select a valid branch')
    await expectRejects(
      t.rpcAs(t.people.admin, 'create_order', { ...(await base()), p_service_type_id: zero }),
      'Select a valid service type',
    )
    await expectRejects(
      t.rpcAs(t.people.admin, 'create_order', { ...(await base()), p_quoted_price: -10 }),
      'Quoted price must be zero or more',
    )
    await expectRejects(
      t.rpcAs(t.people.admin, 'create_order', { ...(await base()), p_technician_id: t.people.finance }),
      'not an active technician',
    )
  })

  it('saves as New with no technician, or Assigned with one (any branch)', async () => {
    const withoutTech = await t.rpcAs(t.people.admin, 'create_order', await base())
    expect(withoutTech.status).toBe('new')
    const withTech = await t.rpcAs(t.people.admin, 'create_order', { ...(await base()), p_technician_id: t.people.john })
    expect(withTech.status).toBe('assigned')
    expect(withTech.assigned_technician_id).toBe(t.people.john)
  })
})

describe('attachments limit', () => {
  const add = (orderId: string, paymentId: string | null = null) =>
    t.q(
      `insert into attachments (order_id, payment_id, kind, storage_path, mime_type, uploaded_by)
       values ($1, $2, 'photo', 'completion/' || gen_random_uuid() || '.jpg', 'image/jpeg', $3)`,
      [orderId, paymentId, t.people.ali],
    )

  it('allows up to 6 completion attachments and rejects the 7th', async () => {
    const o = await t.createOrder({ technician: t.people.ali })
    const id = o.id as string
    for (let i = 0; i < 6; i++) await add(id)
    await expectRejects(add(id), 'at most 6 completion attachments')
    expect(await t.q('select 1 from attachments where order_id = $1', [id])).toHaveLength(6)
  })

  it('does not count payment receipt photos towards the limit', async () => {
    const o = await t.createOrder({ technician: t.people.ali })
    const id = o.id as string
    await t.advance(id, 'in_progress')
    const payment = await t.pay(t.people.ali, id, 50)
    for (let i = 0; i < 6; i++) await add(id)
    await add(id, payment.id as string)
    await add(id, payment.id as string)
    expect(await t.q('select 1 from attachments where order_id = $1', [id])).toHaveLength(8)
  })

  it('applies the limit per order', async () => {
    const a = await t.createOrder({ technician: t.people.ali })
    const b = await t.createOrder({ technician: t.people.ali })
    for (let i = 0; i < 6; i++) await add(a.id as string)
    await add(b.id as string)
  })

  it('cannot get around the limit by re-pointing a receipt attachment', async () => {
    const o = await t.createOrder({ technician: t.people.ali })
    const id = o.id as string
    await t.advance(id, 'in_progress')
    const payment = await t.pay(t.people.ali, id, 50)
    for (let i = 0; i < 6; i++) await add(id)
    await add(id, payment.id as string)
    await expectRejects(
      t.q('update attachments set payment_id = null where order_id = $1 and payment_id is not null', [id]),
      'at most 6 completion attachments',
    )
  })
})

describe('AC15 a technician job list contains only orders assigned to them', () => {
  let aliOrders: string[]
  let balaOrders: string[]
  let reassignedId: string
  beforeAll(async () => {
    const { people } = t
    aliOrders = [
      (await t.createOrder({ technician: people.ali })).id as string,
      (await t.createOrder({ technician: people.ali })).id as string,
    ]
    await t.advance(aliOrders[1], 'job_done') // later statuses still belong to Ali
    balaOrders = [(await t.createOrder({ technician: people.bala })).id as string]
    await t.createOrder() // unassigned (New)
    const reassigned = await t.createOrder({ technician: people.ali })
    reassignedId = reassigned.id as string
    await t.transition(people.admin, reassignedId, 'assigned', null, people.john)
  })

  const jobsFor = (actor: string) =>
    t.qAs<{ id: string; assigned_technician_id: string }>(actor, 'select * from technician_jobs()')

  it("lists the technician's own orders in any status", async () => {
    const jobs = await jobsFor(t.people.ali)
    const ids = jobs.map((j) => j.id)
    expect(ids).toEqual(expect.arrayContaining(aliOrders))
    expect(jobs.every((j) => j.assigned_technician_id === t.people.ali)).toBe(true)
  })

  it("never lists another technician's or unassigned orders", async () => {
    const aliJobs = (await jobsFor(t.people.ali)).map((j) => j.id)
    for (const id of balaOrders) expect(aliJobs).not.toContain(id)
    const balaJobs = await jobsFor(t.people.bala)
    expect(balaJobs.map((j) => j.id)).toEqual(balaOrders)
    const unassigned = await t.q<{ id: string }>(`select id from orders where status = 'new'`)
    const all = [...aliJobs, ...balaJobs.map((j) => j.id)]
    for (const u of unassigned) expect(all).not.toContain(u.id)
  })

  it('drops an order from the previous technician after reassignment', async () => {
    const johnJobs = (await jobsFor(t.people.john)).map((j) => j.id)
    expect(johnJobs).toContain(reassignedId)
    const aliJobs = (await jobsFor(t.people.ali)).map((j) => j.id)
    expect(aliJobs).not.toContain(reassignedId)
  })

  it('returns an empty list for a technician with no jobs', async () => {
    expect(await jobsFor(t.people.yusoff)).toEqual([])
  })

  it('is only for technicians', async () => {
    await expectRejects(t.rpcAs(t.people.admin, 'technician_jobs'), 'Only technicians have a job list')
  })
})
