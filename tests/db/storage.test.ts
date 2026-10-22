import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, expectRejects, SIGNED_OUT, type TestDb } from './helpers'

// The job-files bucket and its policies on storage.objects (0002). Uploads and
// deletes run as the caller like the Storage API does, so the policies decide.

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

/** An order assigned to Ali, moved to `status`. */
async function aliOrder(status: 'assigned' | 'acknowledged' | 'in_progress' | 'job_done' | 'reviewed') {
  const o = await t.createOrder({ technician: t.people.ali })
  await t.advance(o.id as string, status)
  return o.id as string
}

async function canSee(actor: Parameters<TestDb['qAs']>[0], path: string) {
  const rows = await t.qAs(actor, `select name from storage.objects where bucket_id = 'job-files' and name = $1`, [
    path,
  ])
  return rows.length === 1
}

const DENIED = /row-level security/i

describe('job-files bucket', () => {
  it('is private, capped at 50 MB, and accepts only photos, videos and PDFs', async () => {
    const [bucket] = await t.q('select * from storage.buckets where id = $1', ['job-files'])
    expect(bucket.public).toBe(false)
    expect(Number(bucket.file_size_limit)).toBe(50 * 1024 * 1024)
    expect([...(bucket.allowed_mime_types as string[])].sort()).toEqual(
      [
        'application/pdf', 'image/heic', 'image/heif', 'image/jpeg', 'image/png', 'image/webp',
        'video/mp4', 'video/quicktime', 'video/webm',
      ].sort(),
    )
  })
})

describe('who can see files', () => {
  it('the assigned technician and every Admin, Manager and Finance user; not other technicians', async () => {
    const id = await aliOrder('in_progress')
    const path = await t.upload(t.people.ali, t.filePath(id))
    const { people } = t
    for (const who of [people.ali, people.admin, people.admin2, people.managerSA, people.managerKL, people.finance]) {
      expect(await canSee(who, path)).toBe(true)
    }
    for (const who of [people.bala, people.john, people.yusoff]) {
      expect(await canSee(who, path)).toBe(false)
    }
    expect(await canSee(SIGNED_OUT, path)).toBe(false)
  })

  it('a technician reassigned away loses sight of the files', async () => {
    const o = await t.createOrder({ technician: t.people.ali })
    const id = o.id as string
    await t.advance(id, 'in_progress')
    const path = await t.upload(t.people.ali, t.filePath(id))
    await t.q(`update orders set status = 'acknowledged' where id = $1`, [id]) // reassignable again
    await t.transition(t.people.admin, id, 'assigned', null, t.people.bala)
    expect(await canSee(t.people.ali, path)).toBe(false)
    expect(await canSee(t.people.bala, path)).toBe(true)
  })

  it('a signed-in account without an active staff profile sees nothing', async () => {
    const id = await aliOrder('in_progress')
    const path = await t.upload(t.people.ali, t.filePath(id))
    const stranger = await t.createAuthUser('stranger@example.com')
    expect(await canSee({ role: 'authenticated', sub: stranger }, path)).toBe(false)
  })
})

describe('who can upload job files', () => {
  it('the assigned technician and Admins, only while the job is In Progress', async () => {
    const id = await aliOrder('in_progress')
    await t.upload(t.people.ali, t.filePath(id))
    await t.upload(t.people.admin, t.filePath(id, { ext: 'pdf' }), { mime: 'application/pdf' })
    expect(await t.objects(id)).toHaveLength(2)
  })

  it('nobody else: other technicians, Managers, Finance, signed-out visitors', async () => {
    const id = await aliOrder('in_progress')
    const { people } = t
    for (const who of [people.bala, people.managerSA, people.finance]) {
      await expectRejects(t.upload(who, t.filePath(id)), DENIED)
    }
    await expectRejects(t.upload(SIGNED_OUT, t.filePath(id)), DENIED)
    expect(await t.objects(id)).toHaveLength(0)
  })

  it('not before the job starts or after it is submitted', async () => {
    for (const status of ['assigned', 'acknowledged', 'job_done', 'reviewed'] as const) {
      const id = await aliOrder(status)
      await expectRejects(t.upload(t.people.ali, t.filePath(id)), DENIED)
      await expectRejects(t.upload(t.people.admin, t.filePath(id)), DENIED)
    }
  })

  it('again while a job is back In Progress for rework', async () => {
    const id = await aliOrder('job_done')
    await t.transition(t.people.managerSA, id, 'in_progress', 'Photo of the outdoor unit missing')
    await t.upload(t.people.ali, t.filePath(id))
    expect(await t.objects(id)).toHaveLength(1)
  })

  it('only under <order id>/<uuid>.<ext>', async () => {
    const id = await aliOrder('in_progress')
    for (const path of [
      `${id}/photo.jpg`,
      `${id}/sub/${crypto.randomUUID()}.jpg`,
      `${crypto.randomUUID()}/${crypto.randomUUID()}.jpg`, // no such order
      `${id}/${crypto.randomUUID()}`,
      `x/${id}/${crypto.randomUUID()}.jpg`,
    ]) {
      await expectRejects(t.upload(t.people.ali, path), DENIED)
    }
  })
})

describe('who can upload receipts', () => {
  it('the assigned technician or Finance while In Progress, Job Done or Reviewed', async () => {
    for (const status of ['in_progress', 'job_done', 'reviewed'] as const) {
      const id = await aliOrder(status)
      await t.upload(t.people.ali, t.filePath(id, { receipt: true }))
      await t.upload(t.people.finance, t.filePath(id, { receipt: true }))
      expect(await t.objects(id)).toHaveLength(2)
    }
  })

  it('not Admins, Managers or other technicians, and not before the job starts', async () => {
    const id = await aliOrder('in_progress')
    for (const who of [t.people.admin, t.people.managerSA, t.people.bala]) {
      await expectRejects(t.upload(who, t.filePath(id, { receipt: true })), DENIED)
    }
    const early = await aliOrder('acknowledged')
    await expectRejects(t.upload(t.people.ali, t.filePath(early, { receipt: true })), DENIED)
  })
})

describe('who can delete files', () => {
  it('nobody while an attachment row points at the file', async () => {
    const id = await aliOrder('in_progress')
    const path = await t.upload(t.people.ali, t.filePath(id))
    await t.rpcAs(t.people.ali, 'add_attachment', { p_order_id: id, p_storage_path: path })
    expect(await t.removeObject(t.people.ali, path)).toBe(0)
    expect(await t.removeObject(t.people.admin, path)).toBe(0)
    expect(await t.objects(id)).toEqual([path])
  })

  it('the technician or an Admin once the row is removed (or was never added)', async () => {
    const id = await aliOrder('in_progress')
    const path = await t.upload(t.people.ali, t.filePath(id))
    const row = await t.rpcAs(t.people.ali, 'add_attachment', { p_order_id: id, p_storage_path: path })
    await t.rpcAs(t.people.ali, 'remove_attachment', { p_attachment_id: row.id })
    expect(await t.removeObject(t.people.ali, path)).toBe(1)

    const orphan = await t.upload(t.people.ali, t.filePath(id))
    expect(await t.removeObject(t.people.admin, orphan)).toBe(1)
    expect(await t.objects(id)).toEqual([])
  })

  it('not other technicians, Managers or Finance; not after the job is submitted', async () => {
    const id = await aliOrder('in_progress')
    const path = await t.upload(t.people.ali, t.filePath(id))
    for (const who of [t.people.bala, t.people.managerSA, t.people.finance]) {
      expect(await t.removeObject(who, path)).toBe(0)
    }
    await t.submit(t.people.ali, id)
    expect(await t.removeObject(t.people.ali, path)).toBe(0)
    expect(await t.objects(id)).toEqual([path])
  })

  it('direct SQL deletes are refused (only the Storage API may delete)', async () => {
    const id = await aliOrder('in_progress')
    const path = await t.upload(t.people.ali, t.filePath(id))
    await expectRejects(
      t.qAs(t.people.ali, `delete from storage.objects where name = $1`, [path]),
      'Direct deletion from storage tables is not allowed',
    )
  })
})
