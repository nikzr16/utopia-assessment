import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SIGNED_OUT, createTestDb, expectRejects, type Row, type TestDb } from './helpers'

// 0004 Finance: verifying payments (verify_payment / unverify_payment), the
// close guard, and the finance_orders queue.

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

const payment = async (id: string) => (await t.q<Row>('select * from payments where id = $1', [id]))[0]
const verify = (actor: string | typeof SIGNED_OUT, id: unknown) => t.rpcAs<Row>(actor, 'verify_payment', { p_payment_id: id })
const unverify = (actor: string | typeof SIGNED_OUT, id: unknown) =>
  t.rpcAs<Row>(actor, 'unverify_payment', { p_payment_id: id })

/** A Reviewed order (RM 250) with one payment by the technician before review. */
async function reviewedWithPayment(method = 'bank_transfer', amount = 250) {
  const id = (await t.createOrder({ technician: t.people.ali })).id as string
  await t.advance(id, 'job_done')
  const p = await t.pay(t.people.ali, id, amount, method)
  await t.tellCustomer(id)
  await t.transition(t.people.managerSA, id, 'reviewed')
  return { id, paymentId: p.id as string }
}

describe('verify_payment / unverify_payment', () => {
  it('lets Finance tick a non-cash payment (who, when), undo it, and records both', async () => {
    const { id, paymentId } = await reviewedWithPayment()
    const ticked = await verify(t.people.finance, paymentId)
    expect(ticked).toMatchObject({ verified_by: t.people.finance })
    expect(ticked.verified_at).not.toBeNull()
    await expectRejects(verify(t.people.finance, paymentId), /^Already verified by Siti Aminah at /)

    const unticked = await unverify(t.people.finance, paymentId)
    expect(unticked).toMatchObject({ verified_by: null, verified_at: null })
    await expectRejects(unverify(t.people.finance, paymentId), 'This payment is not verified')

    const log = (await t.audit(id)).filter((e) => e.action.startsWith('payment_') && e.action !== 'payment_recorded')
    expect(log.map((e) => [e.action, e.actor_id, e.from_status, e.to_status])).toEqual([
      ['payment_verified', t.people.finance, null, null],
      ['payment_unverified', t.people.finance, null, null],
    ])
    expect(log[0].details).toMatchObject({ payment_id: paymentId, method: 'bank_transfer', status: 'reviewed' })
  })

  it('works before review too (Not yet reviewed tab)', async () => {
    const id = (await t.createOrder({ technician: t.people.ali })).id as string
    await t.advance(id, 'in_progress')
    const p = await t.pay(t.people.ali, id, 50, 'ewallet')
    expect((await verify(t.people.finance, p.id)).verified_by).toBe(t.people.finance)
  })

  it('is for Finance only', async () => {
    const { paymentId } = await reviewedWithPayment()
    for (const who of [t.people.admin, t.people.managerSA, t.people.ali]) {
      await expectRejects(verify(who, paymentId), 'Only Finance can verify payments')
    }
    await expectRejects(verify(SIGNED_OUT, paymentId), /permission denied/i)
    expect((await payment(paymentId)).verified_by).toBeNull()
  })

  it('rejects cash, unknown payments, and Closed orders', async () => {
    const cash = await reviewedWithPayment('cash')
    await expectRejects(verify(t.people.finance, cash.paymentId), 'Cash payments do not need verifying')
    await expectRejects(verify(t.people.finance, '00000000-0000-4000-8000-000000000000'), 'Payment not found')

    const { id, paymentId } = await reviewedWithPayment('card')
    await verify(t.people.finance, paymentId)
    await t.transition(t.people.finance, id, 'closed')
    await expectRejects(unverify(t.people.finance, paymentId), 'is Closed and its payments can no longer be changed')
    expect((await payment(paymentId)).verified_by).toBe(t.people.finance)
  })

  it('keeps the columns consistent: who and when together, never on cash', async () => {
    const cash = await reviewedWithPayment('cash')
    await expectRejects(
      t.q('update payments set verified_by = $2, verified_at = now() where id = $1', [cash.paymentId, t.people.finance]),
      'payments_verified_check',
    )
    const card = await reviewedWithPayment('card')
    await expectRejects(
      t.q('update payments set verified_by = $2 where id = $1', [card.paymentId, t.people.finance]),
      'payments_verified_check',
    )
  })
})

describe('Close needs every non-cash payment verified', () => {
  it('is rejected until each receipt is ticked; cash needs no tick', async () => {
    const { id, paymentId } = await reviewedWithPayment('bank_transfer', 200)
    await t.pay(t.people.finance, id, 50, 'cash')
    await expectRejects(
      t.transition(t.people.finance, id, 'closed'),
      'Verify every receipt before closing (1 not verified yet)',
    )
    expect((await t.summary(id)).status).toBe('reviewed')
    await verify(t.people.finance, paymentId)
    expect((await t.transition(t.people.finance, id, 'closed')).status).toBe('closed')
  })

  it('checks payment first: an unpaid order says so even with unverified receipts', async () => {
    const { id } = await reviewedWithPayment('card', 100)
    await expectRejects(
      t.transition(t.people.finance, id, 'closed'),
      'Order must be fully paid before closing (outstanding balance RM 150.00)',
    )
  })
})

describe('Finance records payments with a receipt', () => {
  it('records an office bank transfer on a Reviewed order', async () => {
    const id = (await t.createOrder({ technician: t.people.ali })).id as string
    await t.advance(id, 'reviewed')
    const p = await t.pay(t.people.finance, id, 250, 'bank_transfer')
    expect(p).toMatchObject({ recorded_by: t.people.finance, method: 'bank_transfer' })
    const receipts = await t.q('select 1 from attachments where payment_id = $1', [p.id])
    expect(receipts).toHaveLength(1)
    expect((await t.summary(id)).payment_status).toBe('paid')
  })
})

describe('finance_orders', () => {
  it('lists every branch, with a branch filter', async () => {
    const sa = (await reviewedWithPayment('cash')).id
    const klId = (await t.createOrder({ technician: t.people.john, branch: 'Kuala Lumpur' })).id as string
    await t.advance(klId, 'reviewed')
    await t.pay(t.people.finance, klId, 250)
    const all = (await t.qAs<{ id: string }>(t.people.finance, `select id from finance_orders('ready')`)).map((r) => r.id)
    expect(all).toEqual(expect.arrayContaining([sa, klId]))
    const onlyKl = (
      await t.qAs<{ id: string }>(t.people.finance, 'select id from finance_orders($1, $2)', [
        'ready',
        await t.branchId('Kuala Lumpur'),
      ])
    ).map((r) => r.id)
    expect(onlyKl).toContain(klId)
    expect(onlyKl).not.toContain(sa)
  })

  it('is for Finance only and knows its tabs', async () => {
    for (const who of [t.people.admin, t.people.managerSA, t.people.ali]) {
      await expectRejects(t.qAs(who, `select * from finance_orders('ready')`), 'Only Finance has a payment queue')
    }
    await expectRejects(t.qAs(t.people.finance, `select * from finance_orders('soon')`), 'Unknown payment queue view: soon')
    await expectRejects(t.qAs(SIGNED_OUT, `select * from finance_orders('ready')`), /permission denied/i)
  })
})
