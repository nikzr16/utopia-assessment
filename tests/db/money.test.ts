import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { finalAmount, paymentStatus } from '../../src/domain'
import { createTestDb, expectRejects, type TestDb } from './helpers'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

const num = (v: unknown) => Number(v)

describe('AC9 final amount always equals quoted price plus extra charges', () => {
  it('equals the quoted price before any completion record exists', async () => {
    const o = await t.createOrder({ quotedPrice: 250 })
    const s = await t.summary(o.id as string)
    expect(num(s.extra_charges)).toBe(0)
    expect(num(s.final_amount)).toBe(250)
  })

  it('adds the extra charges once the technician submits the completion', async () => {
    const o = await t.createOrder({ technician: t.people.ali, quotedPrice: 250 })
    await t.advance(o.id as string, 'job_done', { extraCharges: 80.5 })
    const s = await t.summary(o.id as string)
    expect(num(s.extra_charges)).toBe(80.5)
    expect(num(s.final_amount)).toBe(330.5)
    expect(num(s.final_amount)).toBe(finalAmount(250, 80.5))
  })

  it('recalculates after rework when the extra charges change', async () => {
    const { people } = t
    const o = await t.createOrder({ technician: people.ali, quotedPrice: 200 })
    const id = o.id as string
    await t.advance(id, 'job_done', { extraCharges: 50 })
    expect(num((await t.summary(id)).final_amount)).toBe(250)

    await t.transition(people.managerSA, id, 'in_progress', 'Extra charge not justified')
    await t.rpcAs(people.ali, 'submit_completion', {
      p_order_id: id,
      p_work_done: 'Redone',
      p_extra_charges: 20,
    })
    const s = await t.summary(id)
    expect(num(s.extra_charges)).toBe(20)
    expect(num(s.final_amount)).toBe(220)
    // The completion is replaced, not duplicated.
    expect(await t.q('select 1 from order_completions where order_id = $1', [id])).toHaveLength(1)
  })

  it('has no stored total column that could drift', async () => {
    const cols = await t.q<{ column_name: string; table_name: string }>(
      `select table_name, column_name from information_schema.columns
        where table_schema = 'public'
          and table_name in ('orders', 'order_completions', 'payments')
          and column_name in ('final_amount', 'amount_paid', 'payment_status', 'balance')`,
    )
    expect(cols).toEqual([])
  })

  it('keeps final amount consistent for several quoted/extra combinations', async () => {
    const cases: Array<[number, number]> = [
      [0, 0],
      [99.99, 0.01],
      [1000, 250.75],
      [0, 45],
    ]
    for (const [quoted, extra] of cases) {
      const o = await t.createOrder({ technician: t.people.ali, quotedPrice: quoted })
      await t.advance(o.id as string, 'job_done', { extraCharges: extra })
      const s = await t.summary(o.id as string)
      expect(num(s.final_amount)).toBe(finalAmount(quoted, extra))
    }
  })

  it('rejects a negative quoted price at the database level', async () => {
    await expectRejects(t.createOrder({ quotedPrice: -1 }), 'Quoted price must be zero or more')
  })
})

describe('AC10 payment status follows the sum of payments versus final amount', () => {
  it('is unpaid with no payments', async () => {
    const o = await t.createOrder({ technician: t.people.ali, quotedPrice: 300 })
    const s = await t.summary(o.id as string)
    expect(s.payment_status).toBe('unpaid')
    expect(num(s.amount_paid)).toBe(0)
    expect(num(s.balance)).toBe(300)
  })

  it('is partial after a deposit, then paid when the sum reaches the final amount', async () => {
    const { people } = t
    const o = await t.createOrder({ technician: people.ali, quotedPrice: 300 })
    const id = o.id as string
    await t.advance(id, 'in_progress')

    await t.pay(people.ali, id, 100) // deposit
    let s = await t.summary(id)
    expect(s.payment_status).toBe('partial')
    expect(num(s.amount_paid)).toBe(100)
    expect(num(s.balance)).toBe(200)

    await t.pay(people.ali, id, 150, 'bank_transfer')
    s = await t.summary(id)
    expect(s.payment_status).toBe('partial')
    expect(num(s.balance)).toBe(50)

    await t.pay(people.ali, id, 50)
    s = await t.summary(id)
    expect(s.payment_status).toBe('paid')
    expect(num(s.amount_paid)).toBe(300)
    expect(num(s.balance)).toBe(0)
  })

  it('moves a paid order back to partial when extra charges raise the final amount', async () => {
    const { people } = t
    const o = await t.createOrder({ technician: people.ali, quotedPrice: 300 })
    const id = o.id as string
    await t.advance(id, 'in_progress')
    await t.pay(people.ali, id, 300)
    expect((await t.summary(id)).payment_status).toBe('paid')
    await t.rpcAs(people.ali, 'submit_completion', {
      p_order_id: id,
      p_work_done: 'Done, plus extra part',
      p_extra_charges: 60,
    })
    const s = await t.summary(id)
    expect(s.payment_status).toBe('partial')
    expect(num(s.balance)).toBe(60)
  })

  it('counts an overpayment as paid and shows the overpaid amount', async () => {
    const o = await t.createOrder({ technician: t.people.ali, quotedPrice: 100 })
    const id = o.id as string
    await t.advance(id, 'in_progress')
    await t.pay(t.people.ali, id, 130)
    const s = await t.summary(id)
    expect(s.payment_status).toBe('paid')
    expect(num(s.balance)).toBe(0)
    expect(num(s.overpaid_amount)).toBe(30)
  })

  it('matches the TypeScript paymentStatus helper', async () => {
    const o = await t.createOrder({ technician: t.people.ali, quotedPrice: 120 })
    const id = o.id as string
    await t.advance(id, 'in_progress')
    for (const amount of [0, 40, 80, 20]) {
      if (amount > 0) await t.pay(t.people.ali, id, amount)
      const s = await t.summary(id)
      expect(s.payment_status).toBe(paymentStatus(num(s.final_amount), num(s.amount_paid)))
    }
  })

  it('treats a zero-amount order as paid, consistent with the TypeScript helper', async () => {
    const o = await t.createOrder({ quotedPrice: 0 })
    const s = await t.summary(o.id as string)
    expect(s.payment_status).toBe('paid')
    expect(s.payment_status).toBe(paymentStatus(0, 0))
  })
})

describe('record_payment rules', () => {
  it('lets only the assigned technician or Finance record a payment', async () => {
    const { people } = t
    const o = await t.createOrder({ technician: people.ali })
    const id = o.id as string
    await t.advance(id, 'in_progress')
    for (const actor of [people.bala, people.admin, people.managerSA]) {
      await expectRejects(t.pay(actor, id, 10), 'Only the assigned technician or Finance can record a payment')
    }
    await t.pay(people.ali, id, 10)
    await t.pay(people.finance, id, 10)
    expect(await t.q('select 1 from payments where order_id = $1', [id])).toHaveLength(2)
  })

  it('only accepts payments while In Progress, Job Done or Reviewed', async () => {
    const { people } = t
    const fresh = await t.createOrder({ technician: people.ali })
    await expectRejects(t.pay(people.finance, fresh.id as string, 10), 'Payments can only be recorded while')

    const closed = await t.createOrder({ technician: people.ali })
    await t.closeOrder(closed.id as string)
    await expectRejects(t.pay(people.finance, closed.id as string, 10), 'Payments can only be recorded while')

    for (const status of ['job_done', 'reviewed'] as const) {
      const o = await t.createOrder({ technician: people.ali })
      await t.advance(o.id as string, status)
      await t.pay(people.finance, o.id as string, 10)
    }
  })

  it('rejects zero and negative amounts', async () => {
    const o = await t.createOrder({ technician: t.people.ali })
    await t.advance(o.id as string, 'in_progress')
    for (const amount of [0, -5]) {
      await expectRejects(t.pay(t.people.ali, o.id as string, amount), 'Payment amount must be greater than zero')
    }
  })

  it('writes an audit entry without changing the order status', async () => {
    const o = await t.createOrder({ technician: t.people.ali })
    const id = o.id as string
    await t.advance(id, 'in_progress')
    await t.pay(t.people.ali, id, 75)
    const entry = (await t.audit(id)).at(-1)!
    expect(entry.action).toBe('payment_recorded')
    expect(entry.from_status).toBeNull()
    expect(entry.to_status).toBeNull()
    expect(entry.details).toMatchObject({ amount: 75, method: 'cash', payment_status_after: 'partial' })
    expect((await t.summary(id)).status).toBe('in_progress')
  })
})
