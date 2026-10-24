import { JOB_FILES_BUCKET, orderFormPath, type AttachmentKind } from '../../domain'
import { ApiError, client, run, toApiError, toNumber } from '../../lib/api'

export { ApiError } from '../../lib/api'

/**
 * Job files in the private `job-files` Storage bucket. A file is uploaded to
 * Storage first (its policies decide who may), then registered with
 * `add_attachment`, which checks the type and size Storage recorded. Removing
 * is the reverse: `remove_attachment`, then the stored file is deleted.
 */
export interface Attachment {
  id: string
  order_id: string
  payment_id: string | null
  kind: AttachmentKind
  storage_path: string
  mime_type: string | null
  file_name: string | null
  size_bytes: number | null
  uploaded_by: string
  created_at: string
  /** 0009: the paper order form read with "Read from photo" (not a job file). */
  is_order_form?: boolean
}

/** Signed links last an hour; the gallery fetches new ones when it reloads. */
export const SIGNED_URL_SECONDS = 60 * 60

const bucket = () => client().storage.from(JOB_FILES_BUCKET)

function toAttachment(row: Record<string, unknown>): Attachment {
  return {
    ...(row as unknown as Attachment),
    size_bytes: row.size_bytes === null || row.size_bytes === undefined ? null : toNumber(row.size_bytes),
  }
}

/** The job files of an order (not payment receipts or the order form), oldest first. */
export async function fetchJobFiles(orderId: string): Promise<Attachment[]> {
  const rows = await run(
    client()
      .from('attachments')
      .select('*')
      .eq('order_id', orderId)
      .is('payment_id', null)
      .eq('is_order_form', false)
      .order('created_at')
      .order('id'),
  )
  return (rows as Record<string, unknown>[]).map(toAttachment)
}

/** Receipts of an order's payments, keyed by payment id. */
export async function fetchReceipts(orderId: string): Promise<Record<string, Attachment>> {
  const rows = await run(
    client().from('attachments').select('*').eq('order_id', orderId).not('payment_id', 'is', null),
  )
  const byPayment: Record<string, Attachment> = {}
  for (const row of rows as Record<string, unknown>[]) {
    const a = toAttachment(row)
    if (a.payment_id) byPayment[a.payment_id] = a
  }
  return byPayment
}

/** Short-lived links to view stored files, keyed by path (missing when not allowed). */
export async function signedUrls(paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {}
  const data = await run(bucket().createSignedUrls(paths, SIGNED_URL_SECONDS))
  const urls: Record<string, string> = {}
  for (const item of data as Array<{ path: string | null; signedUrl: string | null; error: string | null }>) {
    if (item.path && item.signedUrl && !item.error) urls[item.path] = item.signedUrl
  }
  return urls
}

/**
 * Upload a file to `path`. A retry after a dropped connection may find the
 * file already there; that counts as uploaded.
 */
export async function uploadFile(path: string, body: Blob, contentType: string): Promise<void> {
  let result: { error: { message?: string; statusCode?: string; status?: number } | null }
  try {
    result = await bucket().upload(path, body, { contentType, upsert: false, cacheControl: '3600' })
  } catch (e) {
    throw toApiError(e as { message?: string })
  }
  const error = result.error
  if (!error) return
  if (error.statusCode === '409' || error.status === 409 || /already exists/i.test(error.message ?? '')) return
  if (error.statusCode === '403' || error.status === 403 || /row-level security/i.test(error.message ?? '')) {
    throw new ApiError('You cannot add files to this job right now.')
  }
  if (error.statusCode === '413' || error.status === 413) {
    throw new ApiError('The file is too large to upload.')
  }
  throw toApiError(error)
}

/** Delete a stored file. Best effort: a file left behind is invisible in the app. */
export async function deleteStoredFile(path: string): Promise<void> {
  try {
    await bucket().remove([path])
  } catch {
    // Left for the orphan-file clean-up (see the hosted SQL notes).
  }
}

/** Register an uploaded job file (safe to retry). */
export async function addAttachment(orderId: string, path: string, fileName: string | null): Promise<Attachment> {
  const row = await run(
    client().rpc('add_attachment', { p_order_id: orderId, p_storage_path: path, p_file_name: fileName }),
  )
  return toAttachment(row as Record<string, unknown>)
}

/** Unregister a job file, then delete the stored file. */
export async function removeAttachment(attachmentId: string): Promise<void> {
  const row = await run(client().rpc('remove_attachment', { p_attachment_id: attachmentId }))
  await deleteStoredFile((row as { storage_path: string }).storage_path)
}

// ---------------------------------------------------------------------------
// The order form (0009): uploaded only when the Admin saves (plan P2), at
// `<order>/form/<uuid>.<ext>`, then registered with `set_order_form`.
// ---------------------------------------------------------------------------
/** The order's paper order form, if it has one. */
export async function fetchOrderForm(orderId: string): Promise<Attachment | null> {
  const rows = await run(
    client().from('attachments').select('*').eq('order_id', orderId).eq('is_order_form', true).limit(1),
  )
  const row = (rows as Record<string, unknown>[])[0]
  return row ? toAttachment(row) : null
}

/** Upload and register the order form; the one it replaced is deleted from Storage. */
export async function saveOrderForm(orderId: string, file: Blob, mime: string, fileName: string, replacing: string | null): Promise<Attachment> {
  const path = orderFormPath(orderId, crypto.randomUUID(), mime)
  await uploadFile(path, file, mime)
  const row = await run(
    client().rpc('set_order_form', { p_order_id: orderId, p_storage_path: path, p_file_name: fileName }),
  )
  if (replacing && replacing !== path) await deleteStoredFile(replacing)
  return toAttachment(row as Record<string, unknown>)
}

/** Remove the order form, then delete the stored file. */
export async function removeOrderForm(orderId: string): Promise<void> {
  const row = await run(client().rpc('remove_order_form', { p_order_id: orderId }))
  await deleteStoredFile((row as { storage_path: string }).storage_path)
}
