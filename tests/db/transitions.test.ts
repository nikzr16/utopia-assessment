import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ORDER_STATUSES, STAFF_ROLES, canTransition, type StaffRole } from '../../src/domain'
import { createTestDb, expectRejects, type TestDb } from './helpers'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

const statusOf = async (id: string) => (await t.summary(id)).status
const techOf = async (id: string) => (await t.summary(id)).assigned_technician_id

describe('AC3 every allowed transition succeeds for the listed role and condition', () => {
  it('(create) -> New by Admin, no technician selected', async () => {
    const o = await t.createOrder()
    expect(o.status).toBe('new')
    expect(o.assigned_technician_id).toBeNull()
  })

  it('(create) -> Assigned by Admin, technician selected on create', async () => {
    const o = await t.createOrder({ technician: t.people.ali })
    expect(o.status).toBe('assigned')
    expect(o.assigned_technician_id).toBe(t.people.ali)
  })

  it('New -> Assigned by Admin with a technician', async () => {
    const o = await t.createOrder()
    const r = await t.transition(t.people.admin, o.id as string, 'assigned', null, t.people.ali)
    expect(r.status).toBe('assigned')
    expect(r.assigned_technician_id).toBe(t.people.ali)
  })

  it('Assigned -> Assigned (reassign) by Admin', async () => {
    const o = await t.createOrder({ technician: t.people.ali })
    const r = await t.transition(t.people.admin, o.id as string, 'assigned', null, t.people.bala)
    expect(r.status).toBe('assigned')
    expect(r.assigned_technician_id).toBe(t.people.bala)
  })

  it('Acknowledged -> Assigned (reassign) by Admin', async () => {
    const o = await t.createOrder({ technician: t.people.ali })
    await t.transition(t.people.ali, o.id as string, 'acknowledged')
    const r = await t.transition(t.people.admin, o.id as string, 'assigned', null, t.people.john)
    expect(r.status).toBe('assigned')
    expect(r.assigned_technician_id).toBe(t.people.john)
  })

  it('Assigned -> Acknowledged by the assigned technician', async () => {
    const o = await t.createOrder({ technician: t.people.ali })
    const r = await t.transition(t.people.ali, o.id as string, 'acknowledged')
    expect(r.status).toBe('acknowledged')
  })

  it('Assigned -> In Progress by the assigned technician (starting implies acknowledging)', async () => {
    const o = await t.createOrder({ technician: t.people.ali })
    const r = await t.transition(t.people.ali, o.id as string, 'in_progress')
    expect(r.status).toBe('in_progress')
  })

  it('Acknowledged -> In Progress by the assigned technician', async () => {
    const o = await t.createOrder({ technician: t.people.ali })
    await t.transition(t.people.ali, o.id as string, 'acknowledged')
    const r = await t.transition(t.people.ali, o.id as string, 'in_progress')
    expect(r.status).toBe('in_progress')
  })

  it('In Progress -> Job Done by the assigned technician via submit_completion', async () => {
    const o = await t.createOrder({ technician: t.people.ali })
    await t.advance(o.id as string, 'in_progress')
    const r = await t.rpcAs(t.people.ali, 'submit_completion', {
      p_order_id: o.id,
      p_work_done: 'Replaced capacitor',
      p_extra_charges: 30,
      p_remarks: 'Customer happy',
    })
    expect(r.status).toBe('job_done')
    const completions = await t.q('select * from order_completions where order_id = $1', [o.id])
    expect(completions).toHaveLength(1)
    expect(completions[0].technician_id).toBe(t.people.ali)
  })

  it('Job Done -> Reviewed by a Manager', async () => {
    const o = await t.createOrder({ technician: t.people.ali })
    await t.advance(o.id as string, 'job_done')
    await t.tellCustomer(o.id as string)
    const r = await t.transition(t.people.managerSA, o.id as string, 'reviewed')
    expect(r.status).toBe('reviewed')
  })

  it('Job Done -> In Progress by a Manager with a review note (rework)', async () => {
    const o = await t.createOrder({ technician: t.people.ali })
    await t.advance(o.id as string, 'job_done')
    const r = await t.transition(t.people.managerSA, o.id as string, 'in_progress', 'Gas level still low')
    expect(r.status).toBe('in_progress')
    expect(r.assigned_technician_id).toBe(t.people.ali)
  })

  it('Reviewed -> Closed by Finance when payment status is paid', async () => {
    const o = await t.createOrder({ technician: t.people.ali })
    await t.advance(o.id as string, 'reviewed')
    await t.pay(t.people.finance, o.id as string, 250)
    const r = await t.transition(t.people.finance, o.id as string, 'closed')
    expect(r.status).toBe('closed')
  })

  for (const from of ['new', 'assigned', 'acknowledged'] as const) {
    it(`${from} -> Cancelled by Admin with a reason`, async () => {
      const o = await t.createOrder({ technician: from === 'new' ? null : t.people.ali })
      if (from === 'acknowledged') await t.transition(t.people.ali, o.id as string, 'acknowledged')
      const r = await t.transition(t.people.admin, o.id as string, 'cancelled', 'Customer cancelled')
      expect(r.status).toBe('cancelled')
    })
  }

  it('lets either seeded Admin perform admin transitions', async () => {
    const o = await t.createOrder({ actor: t.people.admin2 })
    const r = await t.transition(t.people.admin2, o.id as string, 'assigned', null, t.people.yusoff)
    expect(r.assigned_technician_id).toBe(t.people.yusoff)
  })
})

/** One order sitting in each status; rejected calls must leave it untouched. */
async function orderIn(status: string): Promise<string> {
  switch (status) {
    case 'new':
      return (await t.createOrder()).id as string
    case 'cancelled': {
      const o = await t.createOrder()
      await t.transition(t.people.admin, o.id as string, 'cancelled', 'Duplicate order')
      return o.id as string
    }
    case 'closed': {
      const o = await t.createOrder({ technician: t.people.ali })
      await t.closeOrder(o.id as string)
      return o.id as string
    }
    default: {
      const o = await t.createOrder({ technician: t.people.ali })
      await t.advance(o.id as string, status as 'assigned')
      return o.id as string
    }
  }
}

describe('AC4 any transition not in the table, or by the wrong role, is rejected with a clear message', () => {
  it('rejects every (from, to, role) combination that is not in the allowed table', async () => {
    const actorFor: Record<StaffRole, string> = {
      admin: t.people.admin,
      technician: t.people.ali, // the assigned technician on every order below
      manager: t.people.managerSA,
      finance: t.people.finance,
    }
    let checked = 0
    for (const from of ORDER_STATUSES) {
      const orderId = await orderIn(from)
      const before = await t.summary(orderId)
      for (const to of ORDER_STATUSES) {
        for (const role of STAFF_ROLES) {
          if (canTransition(from, to, role)) continue
          let message = ''
          try {
            await t.transition(actorFor[role], orderId, to, 'note', t.people.bala)
          } catch (e) {
            message = (e as Error).message
          }
          expect(message, `${role}: ${from} -> ${to} should be rejected`).not.toBe('')
          checked++
        }
      }
      const after = await t.summary(orderId)
      expect(after.status, `order in ${from} must be unchanged`).toBe(before.status)
      expect(after.assigned_technician_id).toBe(before.assigned_technician_id)
    }
    // 8 statuses x 8 targets x 4 roles = 256 combinations, minus the 13 allowed ones.
    expect(checked).toBe(256 - 13)
  })

  it('names the role that is allowed when the wrong role tries', async () => {
    const o = await t.createOrder({ technician: t.people.ali })
    await expectRejects(
      t.transition(t.people.managerSA, o.id as string, 'assigned', null, t.people.bala),
      'Only Admin can assign or reassign an order',
    )
    await expectRejects(
      t.transition(t.people.admin, o.id as string, 'acknowledged'),
      'Only the assigned technician can acknowledge a job',
    )
    await t.advance(o.id as string, 'job_done')
    await expectRejects(
      t.transition(t.people.admin, o.id as string, 'reviewed'),
      'Only Manager can review a job',
    )
    await expectRejects(
      t.transition(t.people.finance, o.id as string, 'in_progress', 'redo'),
      'Only Manager can return a job for rework',
    )
  })

  it('rejects an illegal move with a plain-language message', async () => {
    const o = await t.createOrder()
    await expectRejects(
      t.transition(t.people.managerSA, o.id as string, 'reviewed'),
      'An order cannot change from New to Reviewed',
    )
  })

  it('rejects any change to a Closed or Cancelled order', async () => {
    const closed = await orderIn('closed')
    await expectRejects(t.transition(t.people.admin, closed, 'cancelled', 'x'), 'is Closed and can no longer be changed')
    const cancelled = await orderIn('cancelled')
    await expectRejects(
      t.transition(t.people.admin, cancelled, 'assigned', null, t.people.ali),
      'is Cancelled and can no longer be changed',
    )
  })

  it('does not allow Job Done through transition_order (only submit_completion)', async () => {
    const o = await t.createOrder({ technician: t.people.ali })
    await t.advance(o.id as string, 'in_progress')
    await expectRejects(
      t.transition(t.people.ali, o.id as string, 'job_done'),
      'Submit the completion record to mark a job as done',
    )
    expect(await statusOf(o.id as string)).toBe('in_progress')
  })

  it('rejects submit_completion unless the job is In Progress', async () => {
    const o = await t.createOrder({ technician: t.people.ali })
    await expectRejects(
      t.rpcAs(t.people.ali, 'submit_completion', {
        p_order_id: o.id,
        p_work_done: 'Done',
      }),
      'A completion record can only be submitted while the job is In Progress',
    )
    expect(await statusOf(o.id as string)).toBe('assigned')
  })

  it('rejects assigning without a technician, or to a non-technician', async () => {
    const o = await t.createOrder()
    await expectRejects(t.transition(t.people.admin, o.id as string, 'assigned'), 'Select a technician')
    await expectRejects(
      t.transition(t.people.admin, o.id as string, 'assigned', null, t.people.finance),
      'not an active technician',
    )
    expect(await statusOf(o.id as string)).toBe('new')
  })

  it('writes nothing when a call is rejected', async () => {
    const o = await t.createOrder({ technician: t.people.ali })
    const auditBefore = (await t.audit(o.id as string)).length
    const notesBefore = (await t.notifications(o.id as string)).length
    await expectRejects(t.transition(t.people.bala, o.id as string, 'in_progress'), 'Only the assigned technician')
    expect((await t.audit(o.id as string)).length).toBe(auditBefore)
    expect((await t.notifications(o.id as string)).length).toBe(notesBefore)
  })
})

describe('AC5 only the assigned technician can acknowledge, start, or submit a job', () => {
  it('rejects another technician acknowledging', async () => {
    const o = await t.createOrder({ technician: t.people.ali })
    await expectRejects(
      t.transition(t.people.bala, o.id as string, 'acknowledged'),
      'Only the assigned technician can acknowledge a job',
    )
    expect(await statusOf(o.id as string)).toBe('assigned')
  })

  it('rejects another technician starting (from Assigned and from Acknowledged)', async () => {
    const o = await t.createOrder({ technician: t.people.ali })
    await expectRejects(
      t.transition(t.people.john, o.id as string, 'in_progress'),
      'Only the assigned technician can start a job',
    )
    await t.transition(t.people.ali, o.id as string, 'acknowledged')
    await expectRejects(
      t.transition(t.people.bala, o.id as string, 'in_progress'),
      'Only the assigned technician can start a job',
    )
    expect(await statusOf(o.id as string)).toBe('acknowledged')
  })

  it('rejects another technician submitting the completion', async () => {
    const o = await t.createOrder({ technician: t.people.ali })
    await t.advance(o.id as string, 'in_progress')
    await expectRejects(
      t.rpcAs(t.people.bala, 'submit_completion', { p_order_id: o.id, p_work_done: 'Done' }),
      'Only the assigned technician can submit a completion record',
    )
    expect(await statusOf(o.id as string)).toBe('in_progress')
    expect(await t.q('select 1 from order_completions where order_id = $1', [o.id])).toHaveLength(0)
  })

  it('rejects non-technicians submitting the completion', async () => {
    const o = await t.createOrder({ technician: t.people.ali })
    await t.advance(o.id as string, 'in_progress')
    for (const actor of [t.people.admin, t.people.managerSA, t.people.finance]) {
      await expectRejects(
        t.rpcAs(actor, 'submit_completion', { p_order_id: o.id, p_work_done: 'Done' }),
        'Only the assigned technician can submit a completion record',
      )
    }
  })

  it('stops the previous technician after a reassign', async () => {
    const o = await t.createOrder({ technician: t.people.ali })
    await t.transition(t.people.admin, o.id as string, 'assigned', null, t.people.bala)
    await expectRejects(
      t.transition(t.people.ali, o.id as string, 'acknowledged'),
      'Only the assigned technician',
    )
    const r = await t.transition(t.people.bala, o.id as string, 'acknowledged')
    expect(r.status).toBe('acknowledged')
  })

  it('requires a non-empty work description to submit', async () => {
    const o = await t.createOrder({ technician: t.people.ali })
    await t.advance(o.id as string, 'in_progress')
    await expectRejects(
      t.rpcAs(t.people.ali, 'submit_completion', { p_order_id: o.id, p_work_done: '   ' }),
      'Describe the work done',
    )
    await expectRejects(
      t.rpcAs(t.people.ali, 'submit_completion', {
        p_order_id: o.id,
        p_work_done: 'Done',
        p_extra_charges: -5,
      }),
      'Extra charges cannot be negative',
    )
  })
})

describe('AC6 closing needs Finance and payment status paid', () => {
  let orderId: string
  beforeAll(async () => {
    const o = await t.createOrder({ technician: t.people.ali, quotedPrice: 300 })
    orderId = o.id as string
    await t.advance(orderId, 'reviewed', { extraCharges: 50 }) // final = 350
  })

  it('rejects non-Finance roles even when the job is fully paid-up later', async () => {
    for (const actor of [t.people.admin, t.people.managerSA, t.people.ali]) {
      await expectRejects(t.transition(actor, orderId, 'closed'), 'Only Finance can close an order')
    }
  })

  it('rejects Finance while unpaid', async () => {
    await expectRejects(
      t.transition(t.people.finance, orderId, 'closed'),
      'Order must be fully paid before closing',
    )
  })

  it('rejects Finance while only partially paid', async () => {
    await t.pay(t.people.finance, orderId, 100)
    await expectRejects(
      t.transition(t.people.finance, orderId, 'closed'),
      'Order must be fully paid before closing (outstanding balance RM 250.00)',
    )
    expect(await statusOf(orderId)).toBe('reviewed')
  })

  it('rejects non-Finance even once fully paid', async () => {
    await t.pay(t.people.finance, orderId, 250)
    await expectRejects(t.transition(t.people.managerSA, orderId, 'closed'), 'Only Finance can close an order')
    expect(await statusOf(orderId)).toBe('reviewed')
  })

  it('lets Finance close once paid in full', async () => {
    const r = await t.transition(t.people.finance, orderId, 'closed')
    expect(r.status).toBe('closed')
  })

  it('treats an overpayment as paid', async () => {
    const o = await t.createOrder({ technician: t.people.ali, quotedPrice: 100 })
    await t.advance(o.id as string, 'reviewed')
    await t.pay(t.people.finance, o.id as string, 150)
    const r = await t.transition(t.people.finance, o.id as string, 'closed')
    expect(r.status).toBe('closed')
  })

  it('cannot close an order that is not Reviewed', async () => {
    const o = await t.createOrder({ technician: t.people.ali })
    await t.advance(o.id as string, 'job_done')
    await t.pay(t.people.finance, o.id as string, 250)
    await expectRejects(t.transition(t.people.finance, o.id as string, 'closed'), 'cannot change from Job Done to Closed')
  })
})

describe('AC7 rework and cancel are rejected without a note / reason', () => {
  it('rejects returning for rework with no note, empty note, or whitespace', async () => {
    const o = await t.createOrder({ technician: t.people.ali })
    await t.advance(o.id as string, 'job_done')
    for (const note of [undefined, null, '', '   ']) {
      await expectRejects(
        t.transition(t.people.managerSA, o.id as string, 'in_progress', note),
        'A review note is required to return a job for rework',
      )
    }
    expect(await statusOf(o.id as string)).toBe('job_done')
  })

  it('rejects cancelling with no reason, empty reason, or whitespace', async () => {
    for (const from of ['new', 'assigned', 'acknowledged'] as const) {
      const o = await t.createOrder({ technician: from === 'new' ? null : t.people.ali })
      if (from === 'acknowledged') await t.transition(t.people.ali, o.id as string, 'acknowledged')
      for (const note of [undefined, '', '  ']) {
        await expectRejects(
          t.transition(t.people.admin, o.id as string, 'cancelled', note),
          'A reason is required to cancel an order',
        )
      }
      expect(await statusOf(o.id as string)).toBe(from)
    }
  })

  it('stores the note and reason on the audit entry when supplied', async () => {
    const o = await t.createOrder()
    await t.transition(t.people.admin, o.id as string, 'cancelled', 'Customer moved house')
    const log = await t.audit(o.id as string)
    expect(log.at(-1)?.note).toBe('Customer moved house')
  })

  it('rejects cancelling after work has started', async () => {
    for (const status of ['in_progress', 'job_done', 'reviewed'] as const) {
      const o = await t.createOrder({ technician: t.people.ali })
      await t.advance(o.id as string, status)
      await expectRejects(
        t.transition(t.people.admin, o.id as string, 'cancelled', 'Too late'),
        'An order can only be cancelled while it is New, Assigned or Acknowledged',
      )
      expect(await statusOf(o.id as string)).toBe(status)
    }
  })
})

describe('AC8 reassigning sets Assigned and records both technicians', () => {
  it('from Assigned: stays Assigned, new technician set, both recorded in the audit log', async () => {
    const o = await t.createOrder({ technician: t.people.ali })
    const r = await t.transition(t.people.admin, o.id as string, 'assigned', 'Ali is on leave', t.people.bala)
    expect(r.status).toBe('assigned')
    expect(await techOf(o.id as string)).toBe(t.people.bala)

    const entry = (await t.audit(o.id as string)).at(-1)!
    expect(entry.action).toBe('reassigned')
    expect(entry.from_status).toBe('assigned')
    expect(entry.to_status).toBe('assigned')
    expect(entry.note).toBe('Ali is on leave')
    expect(entry.details).toMatchObject({
      previous_technician_id: t.people.ali,
      previous_technician_name: 'Ali',
      new_technician_id: t.people.bala,
      new_technician_name: 'Bala',
    })
  })

  it('from Acknowledged: status goes back to Assigned so the new technician must acknowledge', async () => {
    const o = await t.createOrder({ technician: t.people.ali })
    await t.transition(t.people.ali, o.id as string, 'acknowledged')
    const r = await t.transition(t.people.admin, o.id as string, 'assigned', null, t.people.john)
    expect(r.status).toBe('assigned')
    const entry = (await t.audit(o.id as string)).at(-1)!
    expect(entry.from_status).toBe('acknowledged')
    expect(entry.to_status).toBe('assigned')
    expect(entry.details).toMatchObject({
      previous_technician_name: 'Ali',
      new_technician_name: 'John',
    })
  })

  it('rejects reassigning to the same technician', async () => {
    const o = await t.createOrder({ technician: t.people.ali })
    await expectRejects(
      t.transition(t.people.admin, o.id as string, 'assigned', null, t.people.ali),
      'Choose a different technician',
    )
  })

  it('rejects reassigning once the job is In Progress (or later)', async () => {
    for (const status of ['in_progress', 'job_done', 'reviewed'] as const) {
      const o = await t.createOrder({ technician: t.people.ali })
      await t.advance(o.id as string, status)
      await expectRejects(
        t.transition(t.people.admin, o.id as string, 'assigned', null, t.people.bala),
        'An order can only be reassigned while it is Assigned or Acknowledged',
      )
      expect(await techOf(o.id as string)).toBe(t.people.ali)
      expect(await statusOf(o.id as string)).toBe(status)
    }
  })

  it('rejects reassignment by anyone but Admin', async () => {
    const o = await t.createOrder({ technician: t.people.ali })
    for (const actor of [t.people.ali, t.people.managerSA, t.people.finance]) {
      await expectRejects(
        t.transition(actor, o.id as string, 'assigned', null, t.people.bala),
        'Only Admin can assign or reassign an order',
      )
    }
  })
})
