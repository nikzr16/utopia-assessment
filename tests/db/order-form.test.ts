import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, expectRejects, type Row, type TestDb } from './helpers'

// 0009 Document Understanding: the paper order form an Admin read with "Read
// from photo" is kept with the order (<order>/form/<uuid>.<ext>), not as one
// of the 6 job files.

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

const formPath = (orderId: string, ext = 'jpg') => `${orderId}/form/${randomUUID()}.${ext}`

async function uploadForm(orderId: string, opts: { actor?: string; mime?: string; size?: number; ext?: string } = {}) {
  return t.upload(opts.actor ?? t.people.admin, formPath(orderId, opts.ext), { mime: opts.mime, size: opts.size })
}

const setForm = (orderId: string, path: string, actor = t.people.admin) =>
  t.rpcAs<Row>(actor, 'set_order_form', { p_order_id: orderId, p_storage_path: path, p_file_name: 'form.jpg' })

const formsOf = (orderId: string) =>
  t.q<Row>('select * from attachments where order_id = $1 and is_order_form', [orderId])

describe('Order form file', () => {
  it('registers a photo or PDF uploaded by an Admin, and is safe to retry', async () => {
    const id = (await t.createOrder()).id as string
    const path = await uploadForm(id)
    const row = await setForm(id, path)
    expect(row).toMatchObject({ is_order_form: true, kind: 'photo', storage_path: path, file_name: 'form.jpg' })
    expect((await setForm(id, path)).id).toBe(row.id)

    const pdfOrder = (await t.createOrder()).id as string
    const pdf = await uploadForm(pdfOrder, { mime: 'application/pdf', ext: 'pdf' })
    expect((await setForm(pdfOrder, pdf)).kind).toBe('pdf')

    const actions = (await t.audit(id)).map((a) => a.action)
    expect(actions).toContain('order_form_added')
  })

  it('replaces the previous form; the old file may then be deleted from Storage', async () => {
    const id = (await t.createOrder({ technician: t.people.ali })).id as string
    const first = await uploadForm(id)
    await setForm(id, first)
    // Still referenced: Storage refuses to delete it.
    expect(await t.removeObject(t.people.admin, first)).toBe(0)
    const second = await uploadForm(id)
    await setForm(id, second)
    expect((await formsOf(id)).map((r) => r.storage_path)).toEqual([second])
    expect(await t.removeObject(t.people.admin, first)).toBe(1)
  })

  it('lets only Admins change it, and only while New, Assigned or Acknowledged', async () => {
    const id = (await t.createOrder({ technician: t.people.ali })).id as string
    await expectRejects(uploadForm(id, { actor: t.people.managerSA }), /row-level security/i)
    await expectRejects(uploadForm(id, { actor: t.people.ali }), /row-level security/i)
    await t.advance(id, 'acknowledged')
    await setForm(id, await uploadForm(id))
    const pending = await uploadForm(id)
    await t.advance(id, 'in_progress')
    await expectRejects(
      setForm(id, pending),
      'The order form can only be changed while the order is New, Assigned or Acknowledged (it is currently In Progress)',
    )
    await expectRejects(t.rpcAs(t.people.admin, 'remove_order_form', { p_order_id: id }), /currently In Progress/)
    await expectRejects(uploadForm(id), /row-level security/i)
    await expectRejects(setForm(id, pending, t.people.finance), 'Only an Admin can change the order form')
  })

  it('accepts only a photo or a PDF at its own order path', async () => {
    const id = (await t.createOrder()).id as string
    const other = (await t.createOrder()).id as string
    await expectRejects(setForm(id, await uploadForm(other)), /does not belong to ORDER/)
    const video = await uploadForm(id, { mime: 'video/mp4', ext: 'mp4' })
    await expectRejects(setForm(id, video), 'The order form must be a photo or a PDF')
    await expectRejects(setForm(id, await uploadForm(id, { size: 11 * 1024 * 1024 })), 'Photos can be at most 10 MB')
    // A job-file path is not an order form, and an order-form path is not a job file.
    await expectRejects(setForm(id, t.filePath(id)), /does not belong to ORDER/)
    await expectRejects(setForm(id, `${id}/form/${randomUUID()}.jpg`), 'The file was not uploaded. Try again.')
  })

  it('does not count as one of the 6 job files and does not satisfy the photo rule', async () => {
    const id = (await t.createOrder({ technician: t.people.ali })).id as string
    await setForm(id, await uploadForm(id))
    await t.advance(id, 'in_progress')
    for (let i = 0; i < 6; i++) {
      const path = await t.upload(t.people.ali, t.filePath(id, { ext: 'pdf' }), { mime: 'application/pdf' })
      await t.rpcAs(t.people.ali, 'add_attachment', { p_order_id: id, p_storage_path: path })
    }
    await t.submit(t.people.ali, id)
    const warnings = await t.q<Row>(`select rule from order_warnings where order_id = $1 and status = 'open'`, [id])
    expect(warnings.map((w) => w.rule)).toEqual(['no_photo'])
  })

  it('is readable like job files: the assigned technician, Admins, Finance and covering Managers', async () => {
    const id = (await t.createOrder({ technician: t.people.ali })).id as string
    const path = await uploadForm(id)
    await setForm(id, path)
    const sees = async (actor: string) =>
      (await t.qAs(actor, `select name from storage.objects where bucket_id = 'job-files' and name = $1`, [path])).length
    expect(await sees(t.people.ali)).toBe(1)
    expect(await sees(t.people.finance)).toBe(1)
    expect(await sees(t.people.managerSA)).toBe(1)
    expect(await sees(t.people.managerKL)).toBe(0)
    expect(await sees(t.people.bala)).toBe(0)
    expect((await t.qAs(t.people.ali, 'select id from attachments where order_id = $1 and is_order_form', [id])).length).toBe(1)
  })

  it('can be removed, after which the stored file may be deleted', async () => {
    const id = (await t.createOrder()).id as string
    const path = await uploadForm(id)
    await setForm(id, path)
    const removed = await t.rpcAs<Row>(t.people.admin, 'remove_order_form', { p_order_id: id })
    expect(removed.storage_path).toBe(path)
    expect(await formsOf(id)).toEqual([])
    expect(await t.removeObject(t.people.admin, path)).toBe(1)
    await expectRejects(t.rpcAs(t.people.admin, 'remove_order_form', { p_order_id: id }), 'This order has no order form')
    expect((await t.audit(id)).map((a) => a.action)).toContain('order_form_removed')
  })
})
