import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, expectRejects, type Row, type TestDb } from './helpers'

// 0002 database functions: job files, retry-safe payments with receipts, the
// extra-charges rule, technician notifications, and the job list.

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

const MB = 1024 * 1024

async function aliJob(status: 'assigned' | 'acknowledged' | 'in_progress' | 'job_done' | 'reviewed' = 'in_progress') {
  const o = await t.createOrder({ technician: t.people.ali })
  await t.advance(o.id as string, status)
  return o.id as string
}

const addFile = (actor: string, orderId: string, path: string, fileName: string | null = null) =>
  t.rpcAs(actor, 'add_attachment', { p_order_id: orderId, p_storage_path: path, p_file_name: fileName })

const removeFile = (actor: string, attachmentId: string) =>
  t.rpcAs(actor, 'remove_attachment', { p_attachment_id: attachmentId })

const attachmentsOf = (orderId: string) =>
  t.q('select * from attachments where order_id = $1 order by created_at, id', [orderId])

describe('add_attachment', () => {
  it('registers an uploaded file with the type and size Storage recorded', async () => {
    const id = await aliJob()
    const path = await t.upload(t.people.ali, t.filePath(id, { ext: 'mp4' }), { mime: 'video/mp4', size: 12 * MB })
    const row = await addFile(t.people.ali, id, path, '  outdoor unit.mp4  ')
    expect(row).toMatchObject({
      order_id: id,
      payment_id: null,
      kind: 'video',
      storage_path: path,
      mime_type: 'video/mp4',
      file_name: 'outdoor unit.mp4',
      uploaded_by: t.people.ali,
    })
    expect(Number(row.size_bytes)).toBe(12 * MB)
    const audit = (await t.audit(id)).filter((a) => a.action === 'file_added')
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ actor_id: t.people.ali, from_status: null, to_status: null })
    expect(audit[0].details).toMatchObject({ attachment_id: row.id, kind: 'video', file_name: 'outdoor unit.mp4' })
  })

  it('maps every allowed type to its kind', async () => {
    const id = await aliJob()
    const cases: Array<[string, string]> = [
      ['image/jpeg', 'photo'],
      ['image/png', 'photo'],
      ['image/webp', 'photo'],
      ['image/heic', 'photo'],
      ['video/quicktime', 'video'],
      ['application/pdf', 'pdf'],
    ]
    for (const [mime, kind] of cases) {
      const path = await t.upload(t.people.ali, t.filePath(id), { mime })
      expect((await addFile(t.people.ali, id, path)).kind).toBe(kind)
    }
  })

  it('rejects types and sizes outside the rules', async () => {
    const id = await aliJob()
    const cases: Array<[{ mime: string; size: number }, string]> = [
      [{ mime: 'text/plain', size: 100 }, 'This file type is not allowed'],
      [{ mime: 'image/gif', size: 100 }, 'This file type is not allowed'],
      [{ mime: 'image/jpeg', size: 10 * MB + 1 }, 'Photos can be at most 10 MB'],
      [{ mime: 'video/webm', size: 50 * MB + 1 }, 'Videos can be at most 50 MB'],
      [{ mime: 'application/pdf', size: 10 * MB + 1 }, 'PDFs can be at most 10 MB'],
      [{ mime: 'image/png', size: 0 }, 'The file is empty'],
    ]
    for (const [file, message] of cases) {
      const path = await t.upload(t.people.ali, t.filePath(id), file)
      await expectRejects(addFile(t.people.ali, id, path), message)
    }
    // The limits themselves are allowed.
    const path = await t.upload(t.people.ali, t.filePath(id), { mime: 'image/jpeg', size: 10 * MB })
    await addFile(t.people.ali, id, path)
    expect(await attachmentsOf(id)).toHaveLength(1)
  })

  it('rejects a file that was not uploaded, or was uploaded by someone else', async () => {
    const id = await aliJob()
    await expectRejects(addFile(t.people.ali, id, t.filePath(id)), 'The file was not uploaded. Try again.')
    const byAdmin = await t.upload(t.people.admin, t.filePath(id))
    await expectRejects(addFile(t.people.ali, id, byAdmin), 'The file was not uploaded. Try again.')
    await addFile(t.people.admin, id, byAdmin)
    expect(await attachmentsOf(id)).toHaveLength(1)
  })

  it('rejects a path of another order, a receipt path, or a malformed path', async () => {
    const id = await aliJob()
    const other = await aliJob()
    const otherPath = await t.upload(t.people.ali, t.filePath(other))
    await expectRejects(addFile(t.people.ali, id, otherPath), 'This file does not belong to')
    const receipt = await t.upload(t.people.ali, t.filePath(id, { receipt: true }))
    await expectRejects(addFile(t.people.ali, id, receipt), 'This file does not belong to')
    await expectRejects(addFile(t.people.ali, id, `${id}/photo.jpg`), 'This file does not belong to')
  })

  it('lets only the assigned technician or an Admin add files', async () => {
    const id = await aliJob()
    for (const who of [t.people.bala, t.people.managerSA, t.people.finance]) {
      await expectRejects(
        addFile(who, id, t.filePath(id)),
        'Only the assigned technician or an Admin can change the files of a job',
      )
    }
  })

  it('only while the job is In Progress', async () => {
    for (const status of ['assigned', 'acknowledged', 'job_done', 'reviewed'] as const) {
      const id = await aliJob(status)
      await expectRejects(addFile(t.people.ali, id, t.filePath(id)), 'Files can only be changed while the job is In Progress')
    }
  })

  it('is safe to retry: the same file returns the same row', async () => {
    const id = await aliJob()
    const path = await t.upload(t.people.ali, t.filePath(id))
    const first = await addFile(t.people.ali, id, path)
    const again = await addFile(t.people.ali, id, path)
    expect(again.id).toBe(first.id)
    expect(await attachmentsOf(id)).toHaveLength(1)
    expect((await t.audit(id)).filter((a) => a.action === 'file_added')).toHaveLength(1)
    // An Admin registering the technician's file is not a retry.
    await expectRejects(addFile(t.people.admin, id, path), 'This file is already attached')
  })

  it('stops at 6 files per job', async () => {
    const id = await aliJob()
    for (let i = 0; i < 6; i++) {
      await addFile(t.people.ali, id, await t.upload(t.people.ali, t.filePath(id)))
    }
    const seventh = await t.upload(t.people.ali, t.filePath(id))
    await expectRejects(addFile(t.people.ali, id, seventh), 'at most 6 completion attachments')
    expect(await attachmentsOf(id)).toHaveLength(6)
  })
})

describe('remove_attachment', () => {
  it('removes the row, audits it, and returns the path to delete', async () => {
    const id = await aliJob()
    const path = await t.upload(t.people.ali, t.filePath(id))
    const row = await addFile(t.people.ali, id, path, 'a.jpg')
    const removed = await removeFile(t.people.ali, row.id as string)
    expect(removed.storage_path).toBe(path)
    expect(await attachmentsOf(id)).toHaveLength(0)
    const audit = (await t.audit(id)).filter((a) => a.action === 'file_removed')
    expect(audit).toHaveLength(1)
    expect(audit[0].details).toMatchObject({ attachment_id: row.id, file_name: 'a.jpg' })
  })

  it("lets an Admin remove the technician's file", async () => {
    const id = await aliJob()
    const row = await addFile(t.people.ali, id, await t.upload(t.people.ali, t.filePath(id)))
    await removeFile(t.people.admin, row.id as string)
    expect(await attachmentsOf(id)).toHaveLength(0)
  })

  it('hides files of other technicians and refuses Managers and Finance', async () => {
    const id = await aliJob()
    const row = await addFile(t.people.ali, id, await t.upload(t.people.ali, t.filePath(id)))
    await expectRejects(removeFile(t.people.bala, row.id as string), 'File not found')
    for (const who of [t.people.managerSA, t.people.finance]) {
      await expectRejects(
        removeFile(who, row.id as string),
        'Only the assigned technician or an Admin can change the files of a job',
      )
    }
    await expectRejects(removeFile(t.people.ali, randomUUID()), 'File not found')
    expect(await attachmentsOf(id)).toHaveLength(1)
  })

  it('locks files once the job is submitted, and unlocks them for rework', async () => {
    const id = await aliJob()
    const row = await addFile(t.people.ali, id, await t.upload(t.people.ali, t.filePath(id)))
    await t.submit(t.people.ali, id)
    await expectRejects(removeFile(t.people.ali, row.id as string), 'Files can only be changed while the job is In Progress')
    await t.transition(t.people.managerSA, id, 'in_progress', 'Wrong photo')
    await removeFile(t.people.ali, row.id as string)
    expect(await attachmentsOf(id)).toHaveLength(0)
  })

  it('never removes a payment receipt', async () => {
    const id = await aliJob()
    const payment = await t.pay(t.people.ali, id, 50, 'bank_transfer')
    const [receipt] = await t.q('select id from attachments where payment_id = $1', [payment.id])
    await expectRejects(removeFile(t.people.ali, receipt.id as string), 'A payment receipt cannot be removed')
  })
})

describe('record_payment with client key and receipt', () => {
  it('saves a receipt with the payment in one go', async () => {
    const id = await aliJob()
    const path = await t.upload(t.people.ali, t.filePath(id, { receipt: true, ext: 'pdf' }), {
      mime: 'application/pdf',
      size: 80_000,
    })
    const payment = await t.rpcAs(t.people.ali, 'record_payment', {
      p_order_id: id,
      p_amount: 250,
      p_method: 'ewallet',
      p_receipt_path: path,
      p_receipt_file_name: 'tng.pdf',
    })
    const [receipt] = await t.q('select * from attachments where payment_id = $1', [payment.id])
    expect(receipt).toMatchObject({ order_id: id, kind: 'pdf', storage_path: path, file_name: 'tng.pdf' })
    const audit = (await t.audit(id)).filter((a) => a.action === 'payment_recorded')
    expect(audit[0].details).toMatchObject({ receipt: true, method: 'ewallet' })
  })

  it('requires a receipt for bank transfer, card and e-wallet, not for cash', async () => {
    const id = await aliJob()
    for (const method of ['bank_transfer', 'card', 'ewallet']) {
      await expectRejects(
        t.pay(t.people.ali, id, 10, method, { receiptPath: null }),
        'Attach a receipt for bank transfer, card or e-wallet payments',
      )
      await expectRejects(
        t.pay(t.people.finance, id, 10, method, { receiptPath: null }),
        'Attach a receipt for bank transfer, card or e-wallet payments',
      )
    }
    await t.pay(t.people.ali, id, 10, 'cash')
    expect(await t.q('select 1 from payments where order_id = $1', [id])).toHaveLength(1)
  })

  it('rejects a receipt that is a video, too large, missing, or not this order’s receipt', async () => {
    const id = await aliJob()
    const other = await aliJob()
    const pay = (receiptPath: string) => t.pay(t.people.ali, id, 10, 'card', { receiptPath })
    await expectRejects(
      pay(await t.upload(t.people.ali, t.filePath(id, { receipt: true }), { mime: 'video/mp4' })),
      'A receipt must be a photo or a PDF',
    )
    await expectRejects(
      pay(await t.upload(t.people.ali, t.filePath(id, { receipt: true }), { size: 11 * MB })),
      'Photos can be at most 10 MB',
    )
    await expectRejects(pay(t.filePath(id, { receipt: true })), 'The file was not uploaded. Try again.')
    await expectRejects(pay(await t.upload(t.people.ali, t.filePath(other, { receipt: true }))), 'This receipt does not belong to')
    await expectRejects(pay(t.filePath(id)), 'This receipt does not belong to')
    expect(await t.q('select 1 from payments where order_id = $1', [id])).toHaveLength(0)
  })

  it('does not count receipts toward the 6 job files', async () => {
    const id = await aliJob()
    for (let i = 0; i < 6; i++) {
      await addFile(t.people.ali, id, await t.upload(t.people.ali, t.filePath(id)))
    }
    await t.pay(t.people.ali, id, 10, 'bank_transfer')
    expect(await attachmentsOf(id)).toHaveLength(7)
  })

  it('is safe to retry: the same client key returns the first payment', async () => {
    const id = await aliJob()
    const key = randomUUID()
    const first = await t.pay(t.people.ali, id, 120, 'cash', { clientKey: key })
    const again = await t.pay(t.people.ali, id, 120, 'cash', { clientKey: key })
    expect(again.id).toBe(first.id)
    expect(await t.q('select 1 from payments where order_id = $1', [id])).toHaveLength(1)
    expect((await t.audit(id)).filter((a) => a.action === 'payment_recorded')).toHaveLength(1)
    expect((await t.notifications(id)).filter((n) => n.event === 'payment_recorded')).toHaveLength(1)
    expect(Number((await t.summary(id)).amount_paid)).toBe(120)
  })

  it('refuses a client key already used for another order or by someone else', async () => {
    const id = await aliJob()
    const other = await aliJob()
    const key = randomUUID()
    await t.pay(t.people.ali, id, 10, 'cash', { clientKey: key })
    await expectRejects(
      t.pay(t.people.ali, other, 10, 'cash', { clientKey: key }),
      'This payment key has already been used',
    )
    await expectRejects(
      t.pay(t.people.finance, id, 10, 'cash', { clientKey: key }),
      'This payment key has already been used',
    )
  })

  it('notifies every active Finance user when a technician records a payment', async () => {
    const id = await aliJob()
    await t.pay(t.people.ali, id, 99.5, 'card')
    const sent = (await t.notifications(id)).filter((n) => n.event === 'payment_recorded')
    expect(sent.map((n) => n.recipient_id)).toEqual([t.people.finance])
    expect(sent[0].message).toMatch(/^ORDER\d+: Ali recorded a payment of RM 99\.50 \(Card\)$/)
  })

  it('does not notify Finance about its own payments', async () => {
    const id = await aliJob()
    await t.pay(t.people.finance, id, 10, 'cash')
    expect((await t.notifications(id)).filter((n) => n.event === 'payment_recorded')).toHaveLength(0)
  })
})

describe('submit_completion: extra charges', () => {
  const submitRaw = (orderId: string, extra: number | null, remarks: string | null) =>
    t.rpcAs(t.people.ali, 'submit_completion', {
      p_order_id: orderId,
      p_work_done: 'Replaced capacitor',
      p_extra_charges: extra,
      p_remarks: remarks,
    })

  it('follows the money rule: RM 0.00 - 100,000.00, at most 2 decimals', async () => {
    const id = await aliJob()
    await expectRejects(submitRaw(id, -1, 'x'), 'Extra charges cannot be negative')
    await expectRejects(submitRaw(id, 100000.01, 'x'), 'Extra charges cannot be more than RM 100,000.00')
    await expectRejects(submitRaw(id, 10.555, 'x'), 'Extra charges can have at most 2 decimal places')
    expect((await t.summary(id)).status).toBe('in_progress')
    await submitRaw(id, 100000, 'Full replacement')
    expect(Number((await t.summary(id)).extra_charges)).toBe(100000)
  })

  it('needs remarks when there are extra charges', async () => {
    const id = await aliJob()
    await expectRejects(submitRaw(id, 50, null), 'Explain the extra charges in the remarks')
    await expectRejects(submitRaw(id, 50, '   '), 'Explain the extra charges in the remarks')
    await submitRaw(id, 50, 'Extra copper pipe')
    expect((await t.summary(id)).status).toBe('job_done')
  })

  it('does not need remarks without extra charges; empty means zero', async () => {
    const a = await aliJob()
    await submitRaw(a, 0, null)
    const b = await aliJob()
    await submitRaw(b, null, null)
    expect(Number((await t.summary(b)).extra_charges)).toBe(0)
  })
})

describe('technician notifications on cancel and reassign', () => {
  it('tells the technician their job was cancelled, with the reason', async () => {
    const o = await t.createOrder({ technician: t.people.ali })
    const id = o.id as string
    await t.transition(t.people.admin, id, 'cancelled', '  Customer changed their mind ')
    const sent = (await t.notifications(id)).filter((n) => n.event === 'cancelled')
    expect(sent.map((n) => n.recipient_id)).toEqual([t.people.ali])
    expect(sent[0].message).toBe(`${o.order_no} was cancelled: Customer changed their mind`)
  })

  it('tells the previous technician the job went to someone else', async () => {
    const o = await t.createOrder({ technician: t.people.ali })
    const id = o.id as string
    await t.advance(id, 'acknowledged')
    await t.transition(t.people.admin, id, 'assigned', null, t.people.bala)
    const events = (await t.notifications(id)).map((n) => [n.event, n.recipient_id])
    expect(events).toContainEqual(['reassigned_away', t.people.ali])
    expect(events).toContainEqual(['assigned', t.people.bala])
    // Ali still sees the notification, though no longer the order.
    const mine = await t.qAs(t.people.ali, `select event, message from notifications where order_id = $1`, [id])
    expect(mine).toContainEqual({
      event: 'reassigned_away',
      message: `${o.order_no} has been reassigned to another technician`,
    })
    expect(await t.qAs(t.people.ali, 'select 1 from orders where id = $1', [id])).toHaveLength(0)
  })

  it('a first assignment notifies only the new technician', async () => {
    const o = await t.createOrder()
    await t.transition(t.people.admin, o.id as string, 'assigned', null, t.people.yusoff)
    expect((await t.notifications(o.id as string)).map((n) => n.event)).toEqual(['assigned'])
  })
})

describe('mark_all_notifications_read', () => {
  it("marks only the caller's unread notifications and returns how many", async () => {
    const a = await t.createOrder({ technician: t.people.yusoff })
    const b = await t.createOrder({ technician: t.people.yusoff })
    const other = await t.createOrder({ technician: t.people.john, branch: 'Kuala Lumpur' })
    const unread = await t.q<{ n: number }>(
      'select count(*)::int as n from notifications where recipient_id = $1 and read_at is null',
      [t.people.yusoff],
    )
    expect(unread[0].n).toBeGreaterThanOrEqual(2)
    expect(await t.rpcAs(t.people.yusoff, 'mark_all_notifications_read')).toEqual({
      mark_all_notifications_read: unread[0].n,
    })
    expect(await t.rpcAs(t.people.yusoff, 'mark_all_notifications_read')).toEqual({
      mark_all_notifications_read: 0,
    })
    for (const id of [a.id, b.id]) {
      expect((await t.notifications(id as string)).every((n) => n.read_at !== null)).toBe(true)
    }
    expect((await t.notifications(other.id as string))[0].read_at).toBeNull()
  })
})

describe('my_jobs', () => {
  // A separate database so the counts are exact.
  let d: TestDb
  beforeAll(async () => {
    d = await createTestDb()
  })
  afterAll(() => d.close())

  const view = async (actor: string, v: string) =>
    (await d.qAs<Row>(actor, 'select order_no, status from my_jobs($1)', [v])).map((r) => r.order_no)

  /** Set updated_at without the trigger bumping it to now(). */
  const backdate = (id: string, days: number) =>
    d.db.transaction(async (tx) => {
      await tx.exec('set local session_replication_role = replica')
      await tx.query(`update orders set updated_at = now() - make_interval(days => $2) where id = $1`, [id, days])
    })

  it('splits the signed-in technician’s jobs into Open, Submitted and Finished', async () => {
    const { people } = d
    const later = await d.createOrder({ technician: people.ali, scheduledAt: '2026-11-03T02:00:00Z' })
    const soon = await d.createOrder({ technician: people.ali, scheduledAt: '2026-11-01T02:00:00Z' })
    const undated = await d.createOrder({ technician: people.ali, scheduledAt: null })
    const started = await d.createOrder({ technician: people.ali, scheduledAt: '2026-11-02T02:00:00Z' })
    await d.advance(started.id as string, 'in_progress')
    const done = await d.createOrder({ technician: people.ali })
    await d.advance(done.id as string, 'job_done')
    const reviewed = await d.createOrder({ technician: people.ali })
    await d.advance(reviewed.id as string, 'reviewed')
    const closed = await d.createOrder({ technician: people.ali })
    await d.closeOrder(closed.id as string)
    const cancelled = await d.createOrder({ technician: people.ali })
    await d.transition(people.admin, cancelled.id as string, 'cancelled', 'Duplicate')
    const old = await d.createOrder({ technician: people.ali })
    await d.closeOrder(old.id as string)
    await backdate(old.id as string, 31)
    await d.createOrder({ technician: people.bala }) // not Ali's

    expect(await view(people.ali, 'open')).toEqual([soon.order_no, started.order_no, later.order_no, undated.order_no])
    expect((await view(people.ali, 'submitted')).sort()).toEqual([done.order_no, reviewed.order_no].sort())
    expect((await view(people.ali, 'finished')).sort()).toEqual([closed.order_no, cancelled.order_no].sort())
  })

  it('is for technicians only and rejects an unknown view', async () => {
    await expectRejects(d.qAs(d.people.admin, `select * from my_jobs('open')`), 'Only technicians have a job list')
    await expectRejects(d.qAs(d.people.ali, `select * from my_jobs('all')`), 'Unknown job list view: all')
  })
})

describe('realtime', () => {
  it('adds notifications (and, since 0006, staff; since 0009, warnings and AI check runs) to the supabase_realtime publication when it exists', async () => {
    const r = await createTestDb({ beforeMigrations: 'create publication supabase_realtime', provisionLogins: false })
    const rows = await r.q(
      `select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'`,
    )
    expect(rows.map((r) => r.tablename).sort()).toEqual(['notifications', 'order_warnings', 'staff', 'supervisor_runs'])
    await r.close()
  })
})
