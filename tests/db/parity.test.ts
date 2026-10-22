import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  CUSTOMER_MESSAGE_CHANNELS,
  CUSTOMER_MESSAGE_STATES,
  CUSTOMER_MESSAGE_STATUSES,
  EDITABLE_STATUSES,
  JOB_VIEWS,
  JOB_VIEW_STATUSES,
  NOTIFICATION_EVENTS,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  RESCHEDULABLE_STATUSES,
  STAFF_ROLES,
  TRANSITION_RULES,
  canAddReceipt,
  canChangeJobFiles,
  canManageCustomerMessage,
  canRecordPayment,
  checkCustomerMessageBody,
  checkJobFile,
  formatMalaysiaDateTime,
  isMyMobile,
  jobFileOrder,
  normalizeMyPhone,
  parseExtraCharges,
  parseQuotedPrice,
  receiptRequired,
  validateCompletionForm,
  type OrderStatus,
  type StaffRole,
} from '../../src/domain'
import { createTestDb, expectRejects, type TestDb } from './helpers'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

interface DbRule {
  from_status: string
  to_status: string
  actor_role: string
  assigned_technician_only: boolean
  note_required: boolean
  paid_required: boolean
}

const key = (r: { from: string; to: string; role: string }) => `${r.from}>${r.to}>${r.role}`

describe('Rules parity: src/domain transition mirror equals order_status_transitions', () => {
  it('has exactly the same rows with the same flags', async () => {
    const rows = await t.q<DbRule>(
      'select * from order_status_transitions order by from_status, to_status, actor_role',
    )
    const fromDb = rows
      .map((r) => ({
        from: r.from_status,
        to: r.to_status,
        role: r.actor_role,
        assignedTechnicianOnly: r.assigned_technician_only,
        noteRequired: r.note_required,
        paidRequired: r.paid_required,
      }))
      .sort((a, b) => key(a).localeCompare(key(b)))
    const fromTs = TRANSITION_RULES.map((r) => ({ ...r })).sort((a, b) => key(a).localeCompare(key(b)))
    expect(fromDb).toEqual(fromTs)
  })

  it('has the same status values as the order_status enum, in lifecycle order', async () => {
    const rows = await t.q<{ label: string }>(
      `select enumlabel as label from pg_enum e join pg_type ty on ty.oid = e.enumtypid
        where ty.typname = 'order_status' order by e.enumsortorder`,
    )
    expect(rows.map((r) => r.label)).toEqual([...ORDER_STATUSES])
  })

  it('has the same role values as the staff_role enum', async () => {
    const rows = await t.q<{ label: string }>(
      `select enumlabel as label from pg_enum e join pg_type ty on ty.oid = e.enumtypid
        where ty.typname = 'staff_role' order by e.enumsortorder`,
    )
    expect(rows.map((r) => r.label)).toEqual([...STAFF_ROLES])
  })
})

// One table of cases, run through the TypeScript mirror and the SQL rule.
const PHONE_CASES = [
  '012-345 6789', '0123456789', '+60 12-345 6789', '60123456789', '+60 012-345 6789',
  '011-2345 6789', '015-4123 4567', '(03) 1234 5678', '03-1234 5678', '04-123 4567',
  '07.123.4567', '082-123 456', '088-123 456', '012-345 678', '012-345 67890',
  '011-234 5678', '03-123 4567', '081-123 456', '02-1234 5678', '1234567', '+65 9123 4567',
  '+600123456789', '', '   ', 'abc', '012-345 6789 ext 2', '6012345678',
]

const PRICE_CASES = [
  '0', '-0', '0.01', '250', '250.5', '250.50', '250.500', '99999.99', '100000', '100000.00',
  '100000.01', '-1', '-0.01', '0.001', '12.345',
]

/** SQL result as { ok, value } / { ok: false, error } so both sides compare equal. */
async function sqlResult(t: TestDb, sql: string, arg: string) {
  try {
    const rows = await t.q<{ v: string }>(sql, [arg])
    return { ok: true, value: rows[0].v }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

describe('Rules parity: Malaysian phone numbers (src/domain/phone.ts = _normalize_my_phone)', () => {
  it.each(PHONE_CASES)('%j', async (input) => {
    const sql = await sqlResult(t, 'select _normalize_my_phone($1) as v', input)
    expect(sql).toEqual(normalizeMyPhone(input))
  })
})

describe('Rules parity: quoted price (src/domain/price.ts = _check_quoted_price)', () => {
  it.each(PRICE_CASES)('%j', async (input) => {
    const sql = await sqlResult(t, 'select _check_quoted_price($1::numeric)::text as v', input)
    const ts = parseQuotedPrice(input)
    if (ts.ok) {
      expect(sql.ok).toBe(true)
      expect(Number(sql.value)).toBe(ts.value)
    } else {
      expect(sql).toEqual(ts)
    }
  })
})

describe('Rules parity: editable and reschedulable statuses (src/domain/orderEditing.ts)', () => {
  it('update_order accepts exactly the EDITABLE_STATUSES; reschedule_order the RESCHEDULABLE_STATUSES', async () => {
    const reached: Record<string, string> = {}
    for (const target of ['assigned', 'acknowledged', 'in_progress', 'job_done', 'reviewed'] as const) {
      reached[target] = (await t.advance((await t.createOrder()).id as string, target)).id as string
    }
    reached.new = (await t.createOrder()).id as string
    reached.closed = (await t.closeOrder((await t.createOrder()).id as string)).id as string
    const cancelled = await t.createOrder()
    await t.transition(t.people.admin, cancelled.id as string, 'cancelled', 'Customer cancelled')
    reached.cancelled = cancelled.id as string

    for (const status of ORDER_STATUSES) {
      const order = await t.summary(reached[status])
      expect(order.status).toBe(status)
      const call = t.rpcAs(t.people.admin, 'update_order', {
        p_order_id: order.id,
        p_expected_updated_at: order.updated_at,
        p_branch_id: order.branch_id,
        p_customer_name: 'Parity Check',
        p_customer_phone: order.customer_phone,
        p_customer_address: order.customer_address,
        p_problem_description: order.problem_description,
        p_service_type_id: order.service_type_id,
        p_quoted_price: order.quoted_price,
        p_scheduled_at: order.scheduled_at,
        p_admin_notes: order.admin_notes,
      })
      if (EDITABLE_STATUSES.includes(status)) await call
      else await expectRejects(call, 'An order can only be edited while it is New, Assigned or Acknowledged')

      const reschedule = t.rpcAs(t.people.admin, 'reschedule_order', {
        p_order_id: order.id,
        p_new_scheduled_at: null,
        p_reason: 'weather',
        p_requested_by: 'customer',
        p_note: null,
      })
      if (RESCHEDULABLE_STATUSES.includes(status)) await reschedule
      else await expectRejects(reschedule, 'Only an order that is not yet completed can be rescheduled')
    }
  })
})

/** One order per status, assigned to `technician` (except New). */
async function ordersInEveryStatus(technician: string): Promise<Record<OrderStatus, string>> {
  const reached: Partial<Record<OrderStatus, string>> = {}
  for (const target of ['assigned', 'acknowledged', 'in_progress', 'job_done', 'reviewed'] as const) {
    reached[target] = (await t.advance((await t.createOrder({ technician })).id as string, target)).id as string
  }
  reached.new = (await t.createOrder()).id as string
  reached.closed = (await t.closeOrder((await t.createOrder({ technician })).id as string)).id as string
  const cancelled = await t.createOrder({ technician })
  await t.transition(t.people.admin, cancelled.id as string, 'cancelled', 'Customer cancelled')
  reached.cancelled = cancelled.id as string
  return reached as Record<OrderStatus, string>
}

const EXTRA_CASES = [
  '', '0', '-0', '0.01', '50', '50.5', '99999.99', '100000', '100000.00', '100000.01', '-1', '-0.01',
  '0.001', '12.345',
]

describe('Rules parity: extra charges (src/domain/price.ts = _check_extra_charges)', () => {
  it.each(EXTRA_CASES)('%j', async (input) => {
    let sql: { ok: boolean; value?: string; error?: string }
    try {
      const rows = await t.q<{ v: string }>('select _check_extra_charges($1::numeric)::text as v', [
        input === '' ? null : input,
      ])
      sql = { ok: true, value: rows[0].v }
    } catch (e) {
      sql = { ok: false, error: (e as Error).message }
    }
    const ts = parseExtraCharges(input)
    if (ts.ok) {
      expect(sql.ok).toBe(true)
      expect(Number(sql.value)).toBe(ts.value)
    } else {
      expect(sql).toEqual(ts)
    }
  })
})

describe('Rules parity: completion form (src/domain/completionForm.ts = submit_completion)', () => {
  const cases: Array<{ workDone: string; extraCharges: string; remarks: string }> = [
    { workDone: 'Cleaned', extraCharges: '', remarks: '' },
    { workDone: 'Cleaned', extraCharges: '40', remarks: '' },
    { workDone: 'Cleaned', extraCharges: '40', remarks: '   ' },
    { workDone: 'Cleaned', extraCharges: '40', remarks: 'New filter' },
    { workDone: '  ', extraCharges: '', remarks: '' },
  ]
  it.each(cases)('%j', async (values) => {
    const id = (await t.advance((await t.createOrder({ technician: t.people.ali })).id as string, 'in_progress'))
      .id as string
    const ts = validateCompletionForm(values)
    const call = t.rpcAs(t.people.ali, 'submit_completion', {
      p_order_id: id,
      p_work_done: values.workDone,
      p_extra_charges: values.extraCharges === '' ? null : values.extraCharges,
      p_remarks: values.remarks,
    })
    if (ts.ok) {
      await call
      const s = await t.summary(id)
      expect(s.status).toBe('job_done')
      expect(Number(s.extra_charges)).toBe(ts.input.extraCharges)
    } else {
      // The database stops at the first problem; it must be one the form reports.
      let message = ''
      await call.catch((e: Error) => (message = e.message))
      expect(Object.values(ts.errors)).toContain(message)
    }
  })
})

const MB = 1024 * 1024
const FILE_CASES: Array<[string, number, boolean]> = [
  ['image/jpeg', 1, false],
  ['image/png', 10 * MB, false],
  ['image/png', 10 * MB + 1, false],
  ['image/webp', 500, false],
  ['image/heic', 500, false],
  ['IMAGE/HEIF', 500, false],
  ['image/gif', 500, false],
  ['video/mp4', 50 * MB, false],
  ['video/quicktime', 50 * MB + 1, false],
  ['video/webm', 0, false],
  ['application/pdf', 10 * MB + 1, false],
  ['application/pdf; charset=binary', 300, false],
  ['text/plain', 10, false],
  ['', 10, false],
  ['video/mp4', 10, true],
  ['image/jpeg', 10, true],
  ['application/pdf', 10, true],
  ['image/jpeg', 0, true],
]

describe('Rules parity: file types and sizes (src/domain/attachments.ts = _job_file_kind)', () => {
  it.each(FILE_CASES)('%s, %d bytes, receipt %s', async (mime, size, receipt) => {
    let sql: { ok: boolean; kind?: string; error?: string }
    try {
      const rows = await t.q<{ v: string }>('select _job_file_kind($1, $2, $3)::text as v', [mime, size, receipt])
      sql = { ok: true, kind: rows[0].v }
    } catch (e) {
      sql = { ok: false, error: (e as Error).message }
    }
    expect(sql).toEqual(checkJobFile(mime, size, { receipt }))
  })
})

describe('Rules parity: job file paths (src/domain/attachments.ts = _job_file_order)', () => {
  const order = '0b6f3c1e-8a2d-4c5e-9f10-1a2b3c4d5e6f'
  const file = '7d9e8f00-1111-4222-8333-444455556666'
  const paths = [
    `${order}/${file}.jpg`,
    `${order}/receipts/${file}.pdf`,
    `${order}/${file}.heic`,
    `${order}/${file}`,
    `${order}/photo.jpg`,
    `${order}/other/${file}.jpg`,
    `x/${order}/${file}.jpg`,
    `${order}/${file}.JPG`,
    `${order}/${file}.toolong`,
    '',
  ]
  it.each(paths)('%j', async (path) => {
    const rows = await t.q<{ v: string | null }>('select _job_file_order($1)::text as v', [path])
    expect(rows[0].v).toBe(jobFileOrder(path))
  })
})

describe('Rules parity: who may change files (src/domain/attachments.ts = _job_file_write_error)', () => {
  it('matches for every status, role and file kind', async () => {
    const order = await t.createOrder({ technician: t.people.ali })
    const actors: Array<[string, StaffRole, boolean]> = [
      [t.people.ali, 'technician', true],
      [t.people.bala, 'technician', false],
      [t.people.admin, 'admin', false],
      [t.people.managerSA, 'manager', false],
      [t.people.finance, 'finance', false],
    ]
    for (const status of ORDER_STATUSES) {
      for (const [staffId, role, assigned] of actors) {
        for (const receipt of [false, true]) {
          const rows = await t.q<{ allowed: boolean }>(
            `select _job_file_write_error(s, jsonb_populate_record(o, jsonb_build_object('status', $3::text)), $4) is null as allowed
               from staff s, orders o where s.id = $1 and o.id = $2`,
            [staffId, order.id, status, receipt],
          )
          const ts = receipt ? canAddReceipt(status, role, assigned) : canChangeJobFiles(status, role, assigned)
          expect({ status, role, assigned, receipt, allowed: rows[0].allowed }).toEqual({
            status,
            role,
            assigned,
            receipt,
            allowed: ts,
          })
        }
      }
    }
  })
})

describe('Rules parity: payments (src/domain/paymentForm.ts = record_payment)', () => {
  it('has the same methods and labels', async () => {
    const rows = await t.q<{ label: string; text: string }>(
      `select e.enumlabel as label, _payment_method_label(e.enumlabel::payment_method) as text
         from pg_enum e join pg_type ty on ty.oid = e.enumtypid
        where ty.typname = 'payment_method' order by e.enumsortorder`,
    )
    expect(rows.map((r) => r.label)).toEqual([...PAYMENT_METHODS])
    expect(rows.map((r) => r.text)).toEqual(PAYMENT_METHODS.map((m) => PAYMENT_METHOD_LABELS[m]))
  })

  it('requires a receipt for the same methods', async () => {
    const id = (await t.advance((await t.createOrder({ technician: t.people.ali })).id as string, 'in_progress'))
      .id as string
    for (const method of PAYMENT_METHODS) {
      const call = t.pay(t.people.ali, id, 1, method, { receiptPath: null })
      if (receiptRequired(method)) {
        await expectRejects(call, 'Attach a receipt for bank transfer, card or e-wallet payments')
      } else {
        await call
      }
    }
  })

  it('accepts payments in exactly the statuses and from exactly the people canRecordPayment allows', async () => {
    const reached = await ordersInEveryStatus(t.people.ali)
    const actors: Array<[string, StaffRole, boolean]> = [
      [t.people.ali, 'technician', true],
      [t.people.bala, 'technician', false],
      [t.people.admin, 'admin', false],
      [t.people.finance, 'finance', false],
    ]
    for (const status of ORDER_STATUSES) {
      for (const [staffId, role, assigned] of actors) {
        // The New order has no technician, so Ali is not assigned to it.
        const isAssigned = assigned && status !== 'new'
        const ok = await t.pay(staffId, reached[status], 1, 'cash').then(
          () => true,
          () => false,
        )
        expect({ status, role, ok }).toEqual({ status, role, ok: canRecordPayment(status, role, isAssigned) })
      }
    }
  })
})

describe('Rules parity: job list views (src/domain/jobs.ts = my_jobs)', () => {
  it('puts every status in the same tab', async () => {
    const reached = await ordersInEveryStatus(t.people.yusoff)
    const mine = new Set(Object.values(reached))
    for (const view of JOB_VIEWS) {
      const rows = await t.qAs<{ id: string; status: string }>(t.people.yusoff, 'select id, status from my_jobs($1)', [
        view,
      ])
      const statuses = rows.filter((r) => mine.has(r.id)).map((r) => r.status)
      expect(statuses.sort()).toEqual([...JOB_VIEW_STATUSES[view]].sort())
    }
  })
})

describe('Rules parity: notification events (src/domain/jobs.ts = notifications_event_check)', () => {
  it('has the same events', async () => {
    const [row] = await t.q<{ def: string }>(
      `select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'notifications_event_check'`,
    )
    const events = [...row.def.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1])
    expect(events.sort()).toEqual([...NOTIFICATION_EVENTS].sort())
  })
})

// ---------------------------------------------------------------------------
// 0003 customer messages
// ---------------------------------------------------------------------------
const MOBILE_CASES = [
  '60123456789', '601123456789', '60112345678', '601234567890', '6012345678', '60123456',
  '6011234567890', '60312345678', '60412345678', '0123456789', '+60123456789', '123456789',
  '5123456789', '60223456789', '60 123456789', '60123456789 ', ' 60123456789', '60123456789\n',
  '6012345678a', '٦٠١٢٣٤٥٦٧٨٩', '',
]

describe('Rules parity: mobile numbers (src/domain/phone.ts isMyMobile = _is_my_mobile)', () => {
  it.each(MOBILE_CASES)('%j', async (input) => {
    const rows = await t.q<{ v: boolean }>('select _is_my_mobile($1) as v', [input])
    expect(rows[0].v).toBe(isMyMobile(input))
  })

  it('is false for no number at all', async () => {
    expect((await t.q<{ v: boolean }>('select _is_my_mobile(null) as v'))[0].v).toBe(false)
  })

  it('agrees with normalizeMyPhone: every number it stores is WhatsApp-capable exactly when it is a mobile', async () => {
    for (const input of PHONE_CASES) {
      const result = normalizeMyPhone(input)
      if (!result.ok) continue
      const rows = await t.q<{ v: boolean }>('select _is_my_mobile($1) as v', [result.value])
      expect(rows[0].v, input).toBe(isMyMobile(result.value))
    }
  })
})

// Malaysia is UTC+8 all year. The cases cover midnight and noon (12 AM / 12 PM),
// single-digit days, every month and weekday, month / year / leap-day
// boundaries, and instants whose UTC date differs from the Malaysia date.
const MALAYSIA_TIME_CASES = [
  '2026-10-22T07:15:00Z', // Thu 22 Oct 2026, 3:15 PM
  '2026-10-21T16:00:00Z', // midnight: 12:00 AM on the 22nd
  '2026-10-21T15:59:00Z', // 11:59 PM on the 21st
  '2026-10-22T04:00:00Z', // noon: 12:00 PM
  '2026-10-22T03:59:00Z', // 11:59 AM
  '2026-10-22T04:01:00Z', // 12:01 PM
  '2026-10-21T16:01:00Z', // 12:01 AM
  '2026-10-22T20:30:00Z', // UTC 22nd, Malaysia 23rd 4:30 AM
  '2026-10-22T00:00:00Z', // 8:00 AM
  '2026-10-09T01:05:00Z', // single-digit day, 9:05 AM
  '2026-10-01T00:00:00Z', // first of the month
  '2026-09-30T16:00:00Z', // month boundary: 1 Oct, 12:00 AM
  '2026-12-31T16:00:00Z', // year boundary: Fri 1 Jan 2027
  '2026-12-31T15:59:00Z',
  '2028-02-29T10:00:00Z', // leap day
  '2026-02-28T16:30:00Z', // 1 Mar, 12:30 AM
  '2026-01-04T00:00:00Z', // a Sunday
  '2026-10-22T07:15:00.999Z',
  ...Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}-15T04:30:00Z`),
  ...Array.from({ length: 7 }, (_, i) => `2026-11-0${i + 1}T10:07:00Z`),
]

describe('Rules parity: Malaysia date and time (src/domain/malaysiaTime.ts = _malaysia_date_time)', () => {
  it.each(MALAYSIA_TIME_CASES)('%s', async (iso) => {
    const rows = await t.q<{ v: string }>('select _malaysia_date_time($1::timestamptz) as v', [iso])
    expect(rows[0].v).toBe(formatMalaysiaDateTime(iso))
  })

  it('is empty for no time, like the app', async () => {
    expect((await t.q<{ v: string }>('select _malaysia_date_time(null) as v'))[0].v).toBe(formatMalaysiaDateTime(null))
  })
})

const MESSAGE_BODY_CASES = [
  '', '   ', '\n\t ', 'Hello', '  Hello  ', 'Line one\nLine two', ' \n padded \n ',
  'a'.repeat(999), 'a'.repeat(1000), 'a'.repeat(1001), ` ${'a'.repeat(1000)} `, ` ${'a'.repeat(1001)} `,
  '😀'.repeat(1000), '😀'.repeat(1001), 'é'.repeat(1000), 'é'.repeat(1001),
]

describe('Rules parity: customer message text (src/domain/customerMessages.ts = _check_customer_message_body)', () => {
  it.each(MESSAGE_BODY_CASES.map((c) => [c.length > 40 ? `${c.slice(0, 8)}… (${[...c].length} characters)` : c, c]))(
    '%j',
    async (_label, input) => {
      const sql = await sqlResult(t, 'select _check_customer_message_body($1) as v', input)
      expect(sql).toEqual(checkCustomerMessageBody(input))
    },
  )
})

describe('Rules parity: customer message states (src/domain/customerMessages.ts)', () => {
  const checkValues = async (name: string) => {
    const [row] = await t.q<{ def: string }>(
      `select pg_get_constraintdef(oid) as def from pg_constraint where conname = $1`,
      [name],
    )
    return [...row.def.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1])
  }

  it('has the same states and channels as the table checks', async () => {
    expect((await checkValues('customer_messages_status_check')).sort()).toEqual([...CUSTOMER_MESSAGE_STATES].sort())
    expect((await checkValues('customer_messages_channel_check')).sort()).toEqual([...CUSTOMER_MESSAGE_CHANNELS].sort())
  })

  it('lets exactly the people and statuses of canManageCustomerMessage edit a message', async () => {
    const reached = await ordersInEveryStatus(t.people.ali)
    const actors: Array<[string, StaffRole, boolean]> = [
      [t.people.ali, 'technician', true],
      [t.people.bala, 'technician', false],
      [t.people.admin, 'admin', false],
      [t.people.managerSA, 'manager', false],
      [t.people.finance, 'finance', false],
    ]
    for (const status of ORDER_STATUSES) {
      // A fresh not_sent WhatsApp message, the newest of its order.
      const [message] = await t.q<{ id: string }>(
        `insert into customer_messages (order_id, channel, phone, prepared_body, body)
         values ($1, 'whatsapp', '60123456789', 'Prepared', 'Prepared') returning id`,
        [reached[status]],
      )
      for (const [staffId, role, assigned] of actors) {
        // The New order has no technician, so Ali is not assigned to it.
        const isAssigned = assigned && status !== 'new'
        const ok = await t
          .rpcAs(staffId, 'edit_customer_message', { p_message_id: message.id, p_body: 'Edited' })
          .then(
            () => true,
            () => false,
          )
        expect({ status, role, ok }).toEqual({ status, role, ok: canManageCustomerMessage(status, role, isAssigned) })
      }
    }
    expect(ORDER_STATUSES.filter((s) => canManageCustomerMessage(s, 'admin', false))).toEqual([
      ...CUSTOMER_MESSAGE_STATUSES,
    ])
  })
})
