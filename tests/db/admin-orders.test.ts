import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, expectRejects, SIGNED_OUT, type Row, type TestDb } from './helpers'

// 0001 Admin order portal: phone / price rules in create_order, update_order,
// list_orders and technician_options.

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

async function createArgs(overrides: Record<string, unknown> = {}) {
  return {
    p_branch_id: await t.branchId('Shah Alam'),
    p_customer_name: 'Puan Lim',
    p_customer_phone: '012-345 6789',
    p_customer_address: '8 Jalan Kenanga, Shah Alam',
    p_problem_description: 'Water dripping from indoor unit',
    p_service_type_id: await t.serviceTypeId('Repair'),
    p_quoted_price: 180,
    p_scheduled_at: null,
    p_admin_notes: null,
    p_technician_id: null,
    ...overrides,
  }
}

/** update_order arguments that keep every field of the order as it is. */
function editArgs(order: Row, overrides: Record<string, unknown> = {}) {
  return {
    p_order_id: order.id,
    p_expected_updated_at: order.updated_at,
    p_branch_id: order.branch_id,
    p_customer_name: order.customer_name,
    p_customer_phone: order.customer_phone,
    p_customer_address: order.customer_address,
    p_problem_description: order.problem_description,
    p_service_type_id: order.service_type_id,
    p_quoted_price: order.quoted_price,
    p_scheduled_at: order.scheduled_at,
    p_admin_notes: order.admin_notes,
    ...overrides,
  }
}

const edit = (order: Row, overrides: Record<string, unknown> = {}, actor = t.people.admin) =>
  t.rpcAs(actor, 'update_order', editArgs(order, overrides))

describe('create_order: Malaysian phone and quoted price rules (AC4, AC5)', () => {
  it('stores the customer phone as digits with the country code', async () => {
    for (const [typed, stored] of [
      ['012-345 6789', '60123456789'],
      ['+60 11-2345 6789', '601123456789'],
      ['(03) 1234 5678', '60312345678'],
      ['082-123 456', '6082123456'],
    ]) {
      const o = await t.rpcAs(t.people.admin, 'create_order', await createArgs({ p_customer_phone: typed }))
      expect(o.customer_phone).toBe(stored)
    }
  })

  it('rejects a phone number that is not Malaysian', async () => {
    for (const phone of ['012-345 678', '+65 9123 4567', 'call me']) {
      await expectRejects(
        t.rpcAs(t.people.admin, 'create_order', await createArgs({ p_customer_phone: phone })),
        'Enter a valid Malaysian phone number',
      )
    }
  })

  it('accepts RM 0 and RM 100,000; rejects more, or more than 2 decimals', async () => {
    for (const price of [0, 100000, 250.5]) {
      const o = await t.rpcAs(t.people.admin, 'create_order', await createArgs({ p_quoted_price: price }))
      expect(Number(o.quoted_price)).toBe(price)
    }
    await expectRejects(
      t.rpcAs(t.people.admin, 'create_order', await createArgs({ p_quoted_price: 100000.01 })),
      'Quoted price cannot be more than RM 100,000.00',
    )
    await expectRejects(
      t.rpcAs(t.people.admin, 'create_order', await createArgs({ p_quoted_price: 12.345 })),
      'Quoted price can have at most 2 decimal places',
    )
    await expectRejects(
      t.rpcAs(t.people.admin, 'create_order', await createArgs({ p_quoted_price: null })),
      'Quoted price is required',
    )
  })

  it('writes nothing when a rule fails', async () => {
    const before = await t.q<{ n: number }>('select count(*)::int as n from orders')
    await expectRejects(
      t.rpcAs(t.people.admin, 'create_order', await createArgs({ p_customer_phone: '123' })),
      'Enter a valid Malaysian phone number',
    )
    expect(await t.q('select count(*)::int as n from orders')).toEqual(before)
  })
})

describe('update_order: Admin edits an order (AC10, AC11)', () => {
  it('saves the changes, keeps status and technician, and audits old and new values', async () => {
    const created = await t.createOrder({ technician: t.people.ali })
    const order = await t.summary(created.id as string)
    const updated = await edit(order, {
      p_branch_id: await t.branchId('Kuala Lumpur'),
      p_customer_name: '  Encik Hafiz Bin Omar ',
      p_customer_phone: '+60 13-987 6543',
      p_service_type_id: await t.serviceTypeId('Aircond cleaning'),
      p_quoted_price: 300,
      p_admin_notes: 'Call before arriving',
    })
    expect(updated).toMatchObject({
      customer_name: 'Encik Hafiz Bin Omar',
      customer_phone: '60139876543',
      admin_notes: 'Call before arriving',
      status: 'assigned',
      assigned_technician_id: t.people.ali,
      order_no: order.order_no,
    })
    expect(Number(updated.quoted_price)).toBe(300)

    const entry = (await t.audit(order.id as string)).at(-1)!
    expect(entry).toMatchObject({
      action: 'updated',
      actor_id: t.people.admin,
      actor_role: 'admin',
      from_status: null,
      to_status: null,
    })
    expect(entry.details).toEqual({
      status: 'assigned',
      changes: {
        branch: { from: 'Shah Alam', to: 'Kuala Lumpur' },
        customer_name: { from: 'Encik Hafiz', to: 'Encik Hafiz Bin Omar' },
        customer_phone: { from: '60123456789', to: '60139876543' },
        service_type: { from: 'Repair', to: 'Aircond cleaning' },
        quoted_price: { from: 250, to: 300 },
        admin_notes: { from: null, to: 'Call before arriving' },
      },
    })
  })

  it('notifies the assigned technician (Q7) and names what changed', async () => {
    const order = await t.summary((await t.createOrder({ technician: t.people.bala })).id as string)
    await edit(order, { p_customer_address: '9 Jalan Melati, Shah Alam', p_quoted_price: 260 })
    const last = (await t.notifications(order.id as string)).at(-1)!
    expect(last).toMatchObject({ recipient_id: t.people.bala, event: 'order_updated' })
    expect(last.message).toBe(`${order.order_no} was updated: address, quoted price`)
  })

  it('does not notify anyone when the order has no technician', async () => {
    const order = await t.summary((await t.createOrder()).id as string)
    await edit(order, { p_customer_name: 'Someone Else' })
    expect(await t.notifications(order.id as string)).toEqual([])
  })

  it('writes nothing when nothing changed (spaces and phone format do not count)', async () => {
    const order = await t.summary((await t.createOrder({ technician: t.people.ali })).id as string)
    const auditBefore = (await t.audit(order.id as string)).length
    const notesBefore = (await t.notifications(order.id as string)).length
    const result = await edit(order, {
      p_customer_name: ` ${order.customer_name as string} `,
      p_customer_phone: '012-345 6789',
    })
    expect(result.updated_at).toEqual(order.updated_at)
    expect((await t.audit(order.id as string)).length).toBe(auditBefore)
    expect((await t.notifications(order.id as string)).length).toBe(notesBefore)
  })

  it('works for New, Assigned and Acknowledged, not once work has started', async () => {
    const order = await t.summary((await t.advance((await t.createOrder()).id as string, 'in_progress')).id as string)
    await expectRejects(
      edit(order, { p_customer_name: 'Too late' }),
      'An order can only be edited while it is New, Assigned or Acknowledged (it is currently In Progress)',
    )
  })

  it('is Admin only', async () => {
    const order = await t.summary((await t.createOrder({ technician: t.people.ali })).id as string)
    for (const actor of [t.people.ali, t.people.managerSA, t.people.finance]) {
      await expectRejects(edit(order, { p_customer_name: 'Not allowed' }, actor), 'Only Admin can edit an order')
    }
    await expectRejects(
      t.rpcAs(SIGNED_OUT, 'update_order', editArgs(order, { p_customer_name: 'Nope' })),
      /permission denied/i,
    )
    expect((await t.summary(order.id as string)).customer_name).toBe('Encik Hafiz')
  })

  it('rejects a save based on an out-of-date copy of the order (P7)', async () => {
    const order = await t.summary((await t.createOrder()).id as string)
    await edit(order, { p_customer_name: 'First Admin' })
    await expectRejects(
      edit(order, { p_customer_name: 'Second Admin' }),
      'This order was changed by someone else. Reload to see the latest version.',
    )
    await expectRejects(
      edit(order, { p_expected_updated_at: null, p_customer_name: 'No version' }),
      'This order was changed by someone else',
    )
    expect((await t.summary(order.id as string)).customer_name).toBe('First Admin')
  })

  it('applies the same field rules as create_order', async () => {
    const order = await t.summary((await t.createOrder()).id as string)
    await expectRejects(edit(order, { p_customer_phone: '0123' }), 'Enter a valid Malaysian phone number')
    await expectRejects(edit(order, { p_customer_phone: ' ' }), 'Customer phone is required')
    await expectRejects(edit(order, { p_quoted_price: 100001 }), 'Quoted price cannot be more than RM 100,000.00')
    await expectRejects(edit(order, { p_customer_address: '' }), 'Customer address is required')
    expect((await t.audit(order.id as string)).map((a) => a.action)).toEqual(['created'])
  })

  it('keeps a service type that was deactivated later, but cannot switch to one', async () => {
    const order = await t.summary((await t.createOrder()).id as string)
    const repair = await t.serviceTypeId('Repair')
    const cleaning = await t.serviceTypeId('Aircond cleaning')
    await t.q('update service_types set active = false where id = $1', [repair])
    try {
      const kept = await edit(order, { p_customer_name: 'Kept Repair' })
      expect(kept.service_type_id).toBe(repair)
      const moved = await edit(await t.summary(order.id as string), { p_service_type_id: cleaning })
      await t.q('update service_types set active = false where id = $1', [cleaning])
      await expectRejects(
        edit(await t.summary(moved.id as string), { p_service_type_id: repair }),
        'Select a valid service type',
      )
    } finally {
      await t.q('update service_types set active = true where id = any($1::uuid[])', [[repair, cleaning]])
    }
  })
})

describe('update_order and the scheduled date (P6)', () => {
  it('sets a date when the order has none', async () => {
    const order = await t.summary((await t.createOrder({ scheduledAt: null })).id as string)
    const updated = await edit(order, { p_scheduled_at: '2026-11-03T02:00:00Z' })
    expect(new Date(updated.scheduled_at as string).toISOString()).toBe('2026-11-03T02:00:00.000Z')
    const entry = (await t.audit(order.id as string)).at(-1)!
    expect(Object.keys((entry.details as { changes: object }).changes)).toEqual(['scheduled_at'])
    expect(await t.q('select * from order_reschedules where order_id = $1', [order.id])).toEqual([])
  })

  it('refuses to move or clear a date that is already set: use Reschedule', async () => {
    const order = await t.summary((await t.createOrder({ scheduledAt: '2026-10-26T02:00:00Z' })).id as string)
    await expectRejects(edit(order, { p_scheduled_at: '2026-10-27T02:00:00Z' }), 'Use Reschedule to change a scheduled date')
    await expectRejects(edit(order, { p_scheduled_at: null }), 'Use Reschedule to change a scheduled date')
    // Same date, other changes: fine.
    await edit(order, { p_customer_name: 'Date unchanged' })
  })
})

describe('technician_options (Q3)', () => {
  it('lists active technicians with branch and open-job count', async () => {
    const fresh = await createTestDb()
    try {
      await fresh.createOrder({ technician: fresh.people.ali })
      await fresh.advance((await fresh.createOrder()).id as string, 'in_progress', { technician: fresh.people.ali })
      await fresh.advance((await fresh.createOrder()).id as string, 'job_done', { technician: fresh.people.ali })
      await fresh.createOrder({ technician: fresh.people.john })
      await fresh.q("update staff set active = false where name = 'Yusoff'")

      const rows = await fresh.qAs(fresh.people.admin, 'select * from technician_options()')
      expect(rows.map((r) => [r.name, r.branch_name, Number(r.open_jobs)])).toEqual([
        ['John', 'Kuala Lumpur', 1],
        ['Ali', 'Shah Alam', 2],
        ['Bala', 'Shah Alam', 0],
      ])
      expect(rows[0].phone).toBe('60120000012')
      await expectRejects(fresh.qAs(SIGNED_OUT, 'select * from technician_options()'), /permission denied/i)
    } finally {
      await fresh.close()
    }
  })
})

describe('list_orders (Q11, AC8)', () => {
  let L: TestDb
  const ids: Record<string, string> = {}

  beforeAll(async () => {
    L = await createTestDb()
    const make = async (key: string, args: Record<string, unknown>) => {
      const o = await L.rpcAs(L.people.admin, 'create_order', {
        p_branch_id: await L.branchId((args.branch as string) ?? 'Shah Alam'),
        p_customer_name: args.name,
        p_customer_phone: args.phone,
        p_customer_address: 'Somewhere',
        p_problem_description: 'Not cold',
        p_service_type_id: await L.serviceTypeId('Repair'),
        p_quoted_price: 100,
        p_scheduled_at: args.scheduledAt ?? null,
        p_admin_notes: null,
        p_technician_id: args.technician ?? null,
      })
      ids[key] = o.id as string
      // Distinct creation times, oldest first.
      await L.q(`update orders set created_at = now() - make_interval(mins => $1) where id = $2`, [
        100 - Object.keys(ids).length,
        o.id,
      ])
    }
    await make('lim', { name: 'Puan Lim', phone: '012-345 6789', technician: L.people.ali, scheduledAt: '2026-10-27T02:00:00Z' })
    await make('tan', { name: 'Mr Tan', phone: '03-1234 5678', branch: 'Kuala Lumpur', technician: L.people.john })
    await make('hafiz', { name: 'Encik Hafiz', phone: '019-876 5432', scheduledAt: '2026-11-05T02:00:00Z' })
    await make('pct', { name: '100% Cool Sdn Bhd', phone: '011-2345 6789', technician: L.people.bala })
    await L.transition(L.people.admin, ids.hafiz, 'cancelled', 'Customer cancelled')
  })
  afterAll(() => L.close())

  const list = (args: Record<string, unknown> = {}, actor?: string) =>
    L.qAs(
      actor ?? L.people.admin,
      `select * from list_orders(
         p_search => $1, p_statuses => $2::order_status[], p_branch_id => $3, p_technician_id => $4,
         p_scheduled_from => $5, p_scheduled_to => $6, p_limit => $7, p_offset => $8)`,
      [
        args.search ?? null,
        args.statuses ? `{${(args.statuses as string[]).join(',')}}` : null,
        args.branch ?? null,
        args.technician ?? null,
        args.from ?? null,
        args.to ?? null,
        args.limit ?? 25,
        args.offset ?? 0,
      ],
    )

  const keysOf = (rows: Row[]) => rows.map((r) => Object.keys(ids).find((k) => ids[k] === r.id))

  it('returns all orders newest first with the total count and display columns', async () => {
    const rows = await list()
    expect(keysOf(rows)).toEqual(['pct', 'hafiz', 'tan', 'lim'])
    expect(rows.every((r) => Number(r.total_count) === 4)).toBe(true)
    expect(rows[3]).toMatchObject({
      customer_name: 'Puan Lim',
      customer_phone: '60123456789',
      branch_name: 'Shah Alam',
      service_type_name: 'Repair',
      technician_name: 'Ali',
      status: 'assigned',
    })
  })

  it('pages with limit and offset; the total stays the full count', async () => {
    const page2 = await list({ limit: 2, offset: 2 })
    expect(keysOf(page2)).toEqual(['tan', 'lim'])
    expect(Number(page2[0].total_count)).toBe(4)
    expect((await list({ limit: 1000 })).length).toBe(4) // clamped to 100
  })

  it('searches order number, customer name (any case) and phone in any format', async () => {
    const lim = await L.summary(ids.lim)
    expect(keysOf(await list({ search: lim.order_no }))).toEqual(['lim'])
    expect(keysOf(await list({ search: (lim.order_no as string).toLowerCase() }))).toEqual(['lim'])
    expect(keysOf(await list({ search: 'puan LIM' }))).toEqual(['lim'])
    for (const phone of ['012-345 6789', '+60 12 345', '0123456']) {
      expect(keysOf(await list({ search: phone }))).toEqual(['lim'])
    }
    expect(keysOf(await list({ search: '03-1234' }))).toEqual(['tan'])
    // Without a 0 / 60 prefix the digits may appear anywhere.
    expect(keysOf(await list({ search: '345 6789' }))).toEqual(['pct', 'lim'])
  })

  it('treats % and _ in the search as plain characters', async () => {
    expect(keysOf(await list({ search: '100%' }))).toEqual(['pct'])
    expect(keysOf(await list({ search: '%' }))).toEqual(['pct'])
    expect(await list({ search: '_' })).toEqual([])
  })

  it('filters by status, branch, technician and scheduled date range', async () => {
    expect(keysOf(await list({ statuses: ['cancelled'] }))).toEqual(['hafiz'])
    expect(keysOf(await list({ statuses: ['assigned', 'cancelled'] }))).toEqual(['pct', 'hafiz', 'tan', 'lim'])
    expect(keysOf(await list({ statuses: [] }))).toHaveLength(4)
    expect(keysOf(await list({ branch: await L.branchId('Kuala Lumpur') }))).toEqual(['tan'])
    expect(keysOf(await list({ technician: L.people.bala }))).toEqual(['pct'])
    expect(
      keysOf(await list({ from: '2026-10-26T16:00:00Z', to: '2026-10-27T16:00:00Z' })), // 27 Oct, Malaysia time
    ).toEqual(['lim'])
    expect(keysOf(await list({ from: '2026-11-01T00:00:00Z' }))).toEqual(['hafiz'])
  })

  it('runs under row-level security: a technician sees only their own orders', async () => {
    expect(keysOf(await list({}, L.people.ali))).toEqual(['lim'])
    await expectRejects(L.qAs(SIGNED_OUT, 'select * from list_orders()'), /permission denied/i)
  })
})
