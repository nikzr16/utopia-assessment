import type { OrderStatus, StaffRole } from './statuses'

/**
 * Job files and receipts in the `job-files` Storage bucket. Mirrors
 * `_job_file_kind`, `_job_file_order` and `_job_file_write_error` in
 * `supabase/migrations/20261022000006_technician_job_portal.sql`;
 * `tests/db/parity.test.ts` runs the same cases through both.
 */
export type AttachmentKind = 'photo' | 'video' | 'pdf'

export const JOB_FILES_BUCKET = 'job-files'
/** Job files per order (receipts do not count). */
export const MAX_JOB_FILES = 6

const MB = 1024 * 1024
export const MAX_FILE_BYTES: Record<AttachmentKind, number> = {
  photo: 10 * MB,
  video: 50 * MB,
  pdf: 10 * MB,
}

/** Allowed MIME types, their kind, and the extension used in the stored path. */
export const FILE_TYPES: Readonly<Record<string, { kind: AttachmentKind; ext: string }>> = {
  'image/jpeg': { kind: 'photo', ext: 'jpg' },
  'image/png': { kind: 'photo', ext: 'png' },
  'image/webp': { kind: 'photo', ext: 'webp' },
  'image/heic': { kind: 'photo', ext: 'heic' },
  'image/heif': { kind: 'photo', ext: 'heif' },
  'video/mp4': { kind: 'video', ext: 'mp4' },
  'video/quicktime': { kind: 'video', ext: 'mov' },
  'video/webm': { kind: 'video', ext: 'webm' },
  'application/pdf': { kind: 'pdf', ext: 'pdf' },
}

/** `accept` for a job-file input: camera or gallery photos, videos, PDFs. */
export const JOB_FILE_ACCEPT = Object.keys(FILE_TYPES).join(',')
/** `accept` for a receipt input: photos and PDFs. */
export const RECEIPT_ACCEPT = Object.entries(FILE_TYPES)
  .filter(([, t]) => t.kind !== 'video')
  .map(([mime]) => mime)
  .join(',')

export const FILE_TYPE_MESSAGE =
  'This file type is not allowed. Use a photo (JPEG, PNG, WebP, HEIC), a video (MP4, MOV, WebM) or a PDF'
export const RECEIPT_TYPE_MESSAGE = 'A receipt must be a photo or a PDF'
export const FILE_EMPTY_MESSAGE = 'The file is empty'
export const FILE_TOO_LARGE_MESSAGES: Record<AttachmentKind, string> = {
  photo: 'Photos can be at most 10 MB',
  video: 'Videos can be at most 50 MB',
  pdf: 'PDFs can be at most 10 MB',
}
export const TOO_MANY_FILES_MESSAGE = `A job can have at most ${MAX_JOB_FILES} files`

export type FileCheck = { ok: true; kind: AttachmentKind } | { ok: false; error: string }

/** `image/JPEG; x=y` → `image/jpeg`. */
export function normalizeMimeType(mime: string): string {
  return mime.split(';')[0].trim().toLowerCase()
}

const EXTENSION_TYPES: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  pdf: 'application/pdf',
}

/**
 * The MIME type to upload a file with. Some phones report no type for HEIC
 * photos or MOV videos; then the file name's extension decides.
 */
export function fileMimeType(file: { name: string; type: string }): string {
  const type = normalizeMimeType(file.type)
  if (type && type !== 'application/octet-stream') return type
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  return EXTENSION_TYPES[ext] ?? type
}

/** Type and size rule for a job file (or a receipt). Mirrors `_job_file_kind`. */
export function checkJobFile(mime: string, size: number, options: { receipt?: boolean } = {}): FileCheck {
  const type = FILE_TYPES[normalizeMimeType(mime)]
  if (!type) return { ok: false, error: FILE_TYPE_MESSAGE }
  if (options.receipt && type.kind === 'video') return { ok: false, error: RECEIPT_TYPE_MESSAGE }
  if (!(size > 0)) return { ok: false, error: FILE_EMPTY_MESSAGE }
  if (size > MAX_FILE_BYTES[type.kind]) return { ok: false, error: FILE_TOO_LARGE_MESSAGES[type.kind] }
  return { ok: true, kind: type.kind }
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const JOB_FILE_PATH = new RegExp(`^(${UUID})/(receipts/)?${UUID}\\.[a-z0-9]{1,5}$`)

/**
 * Where a new file is stored: `<order id>/<file id>.<ext>`, or
 * `<order id>/receipts/<file id>.<ext>` for a receipt.
 */
export function jobFilePath(orderId: string, fileId: string, mime: string, options: { receipt?: boolean } = {}): string {
  const ext = FILE_TYPES[normalizeMimeType(mime)]?.ext ?? 'bin'
  return `${orderId}/${options.receipt ? 'receipts/' : ''}${fileId}.${ext}`
}

/** The order a stored path belongs to, or null for a malformed path. Mirrors `_job_file_order`. */
export function jobFileOrder(path: string): string | null {
  return JOB_FILE_PATH.exec(path)?.[1] ?? null
}

/** Statuses in which job files can be added or removed. */
export const FILE_CHANGE_STATUSES: readonly OrderStatus[] = ['in_progress']
/** Statuses in which a receipt can be added (with a payment). */
export const RECEIPT_STATUSES: readonly OrderStatus[] = ['in_progress', 'job_done', 'reviewed']

/**
 * Who may add or remove job files: the assigned technician or an Admin,
 * while the job is In Progress. Mirrors `_job_file_write_error`.
 */
export function canChangeJobFiles(status: OrderStatus, role: StaffRole, isAssignedTechnician: boolean): boolean {
  const who = (role === 'technician' && isAssignedTechnician) || role === 'admin'
  return who && FILE_CHANGE_STATUSES.includes(status)
}

/** Who may attach a receipt: the assigned technician or Finance, while In Progress, Job Done or Reviewed. */
export function canAddReceipt(status: OrderStatus, role: StaffRole, isAssignedTechnician: boolean): boolean {
  const who = (role === 'technician' && isAssignedTechnician) || role === 'finance'
  return who && RECEIPT_STATUSES.includes(status)
}

/** Photo types the browser can shrink before upload (HEIC is sent as it is). */
export function canResizePhoto(mime: string): boolean {
  return ['image/jpeg', 'image/png', 'image/webp'].includes(normalizeMimeType(mime))
}

/** Photos are resized to at most this many pixels on the long side. */
export const PHOTO_MAX_DIMENSION = 2048
export const PHOTO_JPEG_QUALITY = 0.85

/** Size that fits within `max` on the long side, keeping the aspect ratio; never enlarged. */
export function fitWithin(width: number, height: number, max = PHOTO_MAX_DIMENSION): { width: number; height: number } {
  const long = Math.max(width, height)
  if (long <= max) return { width, height }
  const scale = max / long
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/** `850 KB`, `12.4 MB`. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < MB) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / MB).toFixed(1)} MB`
}

// ---------------------------------------------------------------------------
// The order form (0009): the paper form an Admin read with "Read from photo",
// kept with the order. Mirrors `_order_form_order` and
// `_order_form_write_error` in
// `supabase/migrations/20261024000002_ai_advanced.sql`.
// ---------------------------------------------------------------------------
/** Types "Read from photo" accepts: a photo or a PDF (HEIC is not read). */
export const ORDER_FORM_TYPES: Readonly<Record<string, { kind: AttachmentKind; ext: string }>> = {
  'image/jpeg': { kind: 'photo', ext: 'jpg' },
  'image/png': { kind: 'photo', ext: 'png' },
  'image/webp': { kind: 'photo', ext: 'webp' },
  'application/pdf': { kind: 'pdf', ext: 'pdf' },
}
export const ORDER_FORM_ACCEPT = Object.keys(ORDER_FORM_TYPES).join(',')
export const ORDER_FORM_MAX_BYTES = 10 * MB
export const ORDER_FORM_MAX_PAGES = 3
export const ORDER_FORM_TYPE_MESSAGE = 'Use a photo (JPG, PNG or WebP) or a PDF'
export const ORDER_FORM_SIZE_MESSAGE = 'The file can be at most 10 MB'
export const ORDER_FORM_PAGES_MESSAGE = `The PDF can have at most ${ORDER_FORM_MAX_PAGES} pages`

/** Type and size rule for "Read from photo". */
export function checkOrderFormFile(mime: string, size: number): FileCheck {
  const type = ORDER_FORM_TYPES[normalizeMimeType(mime)]
  if (!type) return { ok: false, error: ORDER_FORM_TYPE_MESSAGE }
  if (!(size > 0)) return { ok: false, error: FILE_EMPTY_MESSAGE }
  if (size > ORDER_FORM_MAX_BYTES) return { ok: false, error: ORDER_FORM_SIZE_MESSAGE }
  return { ok: true, kind: type.kind }
}

const ORDER_FORM_PATH = new RegExp(`^(${UUID})/form/${UUID}\.[a-z0-9]{1,5}$`)

/** Where the order form is stored: `<order id>/form/<file id>.<ext>`. */
export function orderFormPath(orderId: string, fileId: string, mime: string): string {
  const ext = ORDER_FORM_TYPES[normalizeMimeType(mime)]?.ext ?? 'bin'
  return `${orderId}/form/${fileId}.${ext}`
}

/** The order an order-form path belongs to, or null. Mirrors `_order_form_order`. */
export function orderFormOrder(path: string): string | null {
  return ORDER_FORM_PATH.exec(path)?.[1] ?? null
}

/** Statuses in which an Admin may replace or remove the order form (plan P8). */
export const ORDER_FORM_STATUSES: readonly OrderStatus[] = ['new', 'assigned', 'acknowledged']

/** Who may change the order form, and when. Mirrors `_order_form_write_error`. */
export function canChangeOrderForm(status: OrderStatus, role: StaffRole): boolean {
  return role === 'admin' && ORDER_FORM_STATUSES.includes(status)
}
