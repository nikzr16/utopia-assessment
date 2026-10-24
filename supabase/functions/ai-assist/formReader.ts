/**
 * Document Understanding (0009): read a photo or PDF of a paper order form
 * and return the five fields of the brief (customer name, service type,
 * service details, amount, date) for the Admin's New Order form. All or
 * nothing (PRD Q11): if any field that is on the form cannot be read with
 * confidence, nothing is filled. Phone numbers and addresses are not asked
 * for (PRD Q22). Nothing is stored here; the browser keeps the file and
 * uploads it when the Admin saves (plan P2).
 */
import { aiFailure, askJson, boolean, nullableString, object, type JsonAiClient, type Usage } from './ai.ts'
import { FORM_INSTRUCTIONS } from './prompts.ts'
import type { AiLog } from './supervisor.ts'

export const FORM_TIMEOUT_MS = 35_000
export const FORM_MAX_BYTES = 10 * 1024 * 1024
export const FORM_MAX_PAGES = 3

/** Same types as src/domain/attachments.ts ORDER_FORM_TYPES. */
export const FORM_TYPES: Readonly<Record<string, 'photo' | 'pdf'>> = {
  'image/jpeg': 'photo',
  'image/png': 'photo',
  'image/webp': 'photo',
  'application/pdf': 'pdf',
}

export const FORM_MESSAGES = {
  type: 'Use a photo (JPG, PNG or WebP) or a PDF',
  size: 'The file can be at most 10 MB',
  empty: 'The file is empty',
  pages: `The PDF can have at most ${FORM_MAX_PAGES} pages`,
  damaged: 'This file could not be opened. Try another photo or PDF.',
  unclear: "Couldn't read this form clearly. Try a clearer photo or fill the form by hand.",
  not_set_up: 'The assistant is not set up yet. Fill the form by hand.',
  ai_unavailable: "Can't read photos right now. Fill the form by hand.",
  timeout: 'Reading the form took too long. Try again or fill the form by hand.',
} as const

export interface FormFile {
  name: string
  type: string
  /** The file's bytes, base64 (no data: prefix). */
  data: string
}

export interface ServiceType {
  id: string
  name: string
}

export interface FilledForm {
  customerName: string | null
  serviceTypeId: string | null
  serviceTypeName: string | null
  problemDescription: string | null
  /** "250.00" */
  quotedPrice: string | null
  /** YYYY-MM-DD */
  scheduledDate: string | null
  /** HH:MM */
  scheduledTime: string | null
}

export type FormResult =
  | { ok: true; fields: FilledForm }
  | { ok: false; code: 'bad_file' | 'unclear' | 'not_set_up' | 'ai_unavailable' | 'timeout'; message: string }

export interface FormDeps {
  ai: JsonAiClient | null
  log: AiLog
  staffId: string
  serviceTypes: ServiceType[]
  /** Pages of a PDF, or null if it cannot be opened (pdf-lib in index.ts). */
  pdfPages(bytes: Uint8Array): Promise<number | null>
  /** Today in Malaysia, YYYY-MM-DD. */
  today: string
  now(): number
  timeoutMs?: number
}

const FIELD = (description: string) =>
  object({
    value: nullableString(description),
    on_form: boolean('True if the form has this field filled in.'),
    clear: boolean('True only if it can be read with confidence.'),
  })

export const FORM_SCHEMA = object({
  readable: boolean('False if this is not an order form or cannot be read at all.'),
  customer_name: FIELD('The customer name exactly as written.'),
  service_type: FIELD('Exactly one of the listed service type names.'),
  details: FIELD('The problem or service details exactly as written, in the original language.'),
  amount: FIELD('The quoted price as a plain number, e.g. 250 or 1250.50.'),
  date: FIELD('YYYY-MM-DD, optionally followed by " HH:MM".'),
})

const FIELDS = ['customer_name', 'service_type', 'details', 'amount', 'date'] as const
type Field = (typeof FIELDS)[number]
interface ReadField {
  value: string | null
  on_form: boolean
  clear: boolean
}

function base64Bytes(data: string): Uint8Array | null {
  try {
    const binary = atob(data.replace(/\s/g, ''))
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}

/** The file's real type from its first bytes. */
export function sniffType(bytes: Uint8Array): string | null {
  const b = (i: number) => bytes[i]
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return 'image/jpeg'
  if (b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47) return 'image/png'
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to))
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp'
  if (ascii(0, 5) === '%PDF-') return 'application/pdf'
  return null
}

const AMOUNT = /^\d{1,6}(\.\d{1,2})?$/

/** "250" -> "250.00", within the quoted-price rule (RM 0 - 100,000, 2 decimals). */
export function readAmount(value: string): string | null {
  const text = value.replace(/^RM\s*/i, '').replace(/,/g, '').trim()
  if (!AMOUNT.test(text)) return null
  const n = Number(text)
  return n >= 0 && n <= 100_000 ? n.toFixed(2) : null
}

/** "2026-10-28" or "2026-10-28 14:30" -> date and time, or null if not a real date / time. */
export function readDate(value: string): { date: string; time: string | null } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/.exec(value.trim())
  if (!m) return null
  const [, y, mo, d, h, mi] = m
  const day = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)))
  if (day.getUTCFullYear() !== Number(y) || day.getUTCMonth() !== Number(mo) - 1 || day.getUTCDate() !== Number(d)) {
    return null
  }
  if (h !== undefined && (Number(h) > 23 || Number(mi) > 59)) return null
  return { date: `${y}-${mo}-${d}`, time: h === undefined ? null : `${h}:${mi}` }
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

/**
 * Turn the model's answer into filled fields, all or nothing. Null when the
 * form is unreadable or any field on it is unclear or invalid.
 */
export function readForm(value: unknown, serviceTypes: ServiceType[]): FilledForm | null {
  const v = value as Record<string, unknown> | null
  if (!v || v.readable !== true) return null
  const fields = {} as Record<Field, ReadField>
  for (const f of FIELDS) {
    const raw = v[f] as Record<string, unknown> | undefined
    if (!raw || typeof raw.on_form !== 'boolean' || typeof raw.clear !== 'boolean') return null
    const text = typeof raw.value === 'string' ? raw.value.replace(/\s+/g, ' ').trim() : ''
    fields[f] = { value: text === '' ? null : text, on_form: raw.on_form, clear: raw.clear }
  }
  // Something must be on the form, and everything on it must be clear.
  if (!FIELDS.some((f) => fields[f].on_form)) return null
  if (FIELDS.some((f) => fields[f].on_form && (!fields[f].clear || fields[f].value === null))) return null

  const out: FilledForm = {
    customerName: null,
    serviceTypeId: null,
    serviceTypeName: null,
    problemDescription: null,
    quotedPrice: null,
    scheduledDate: null,
    scheduledTime: null,
  }
  if (fields.customer_name.on_form) out.customerName = fields.customer_name.value!.slice(0, 200)
  if (fields.service_type.on_form) {
    const type = serviceTypes.find((t) => norm(t.name) === norm(fields.service_type.value!))
    if (!type) return null
    out.serviceTypeId = type.id
    out.serviceTypeName = type.name
  }
  if (fields.details.on_form) out.problemDescription = fields.details.value!.slice(0, 2000)
  if (fields.amount.on_form) {
    out.quotedPrice = readAmount(fields.amount.value!)
    if (out.quotedPrice === null) return null
  }
  if (fields.date.on_form) {
    const when = readDate(fields.date.value!)
    if (!when) return null
    out.scheduledDate = when.date
    out.scheduledTime = when.time
  }
  return out
}

/** The model's input: the list of service types, today's date, and the file. */
export function formInput(file: FormFile, mime: string, serviceTypes: ServiceType[], today: string) {
  const text =
    `Today is ${today} (Malaysia). Service types: ${serviceTypes.map((t) => `"${t.name}"`).join(', ')}.\n` +
    'Read the attached order form.'
  const attachment =
    mime === 'application/pdf'
      ? { type: 'input_file', filename: 'order-form.pdf', file_data: `data:application/pdf;base64,${file.data}` }
      : { type: 'input_image', image_url: `data:${mime};base64,${file.data}`, detail: 'high' }
  return [{ role: 'user', content: [{ type: 'input_text', text }, attachment] }]
}

/** Check the file, ask the model, and fill the form or say why not. */
export async function readOrderForm(file: FormFile, deps: FormDeps): Promise<FormResult> {
  const bytes = typeof file?.data === 'string' ? base64Bytes(file.data) : null
  if (!bytes) return { ok: false, code: 'bad_file', message: FORM_MESSAGES.damaged }
  if (bytes.length === 0) return { ok: false, code: 'bad_file', message: FORM_MESSAGES.empty }
  if (bytes.length > FORM_MAX_BYTES) return { ok: false, code: 'bad_file', message: FORM_MESSAGES.size }
  const mime = sniffType(bytes)
  if (!mime || !FORM_TYPES[mime]) return { ok: false, code: 'bad_file', message: FORM_MESSAGES.type }
  if (mime === 'application/pdf') {
    const pages = await deps.pdfPages(bytes)
    if (pages === null || pages < 1) return { ok: false, code: 'bad_file', message: FORM_MESSAGES.damaged }
    if (pages > FORM_MAX_PAGES) return { ok: false, code: 'bad_file', message: FORM_MESSAGES.pages }
  }

  const started = deps.now()
  const size = `${(bytes.length / (1024 * 1024)).toFixed(1)} MB`
  const log = (outcome: string, usage: Usage | null) =>
    deps.log.record({
      staffId: deps.staffId,
      feature: 'form',
      summary: `Read order form (${FORM_TYPES[mime] === 'pdf' ? 'PDF' : 'photo'}, ${size})`,
      orderId: null,
      outcome,
      durationMs: Math.round(deps.now() - started),
      inputTokens: usage?.input_tokens ?? null,
      outputTokens: usage?.output_tokens ?? null,
    })

  try {
    const { value, usage } = await askJson(
      deps.ai,
      {
        instructions: FORM_INSTRUCTIONS,
        input: formInput(file, mime, deps.serviceTypes, deps.today),
        format: { name: 'order_form', schema: FORM_SCHEMA },
        maxOutputTokens: 4000,
      },
      deps.timeoutMs ?? FORM_TIMEOUT_MS,
    )
    const fields = readForm(value, deps.serviceTypes)
    await log(fields ? 'filled' : 'unclear', usage)
    return fields ? { ok: true, fields } : { ok: false, code: 'unclear', message: FORM_MESSAGES.unclear }
  } catch (e) {
    const failure = aiFailure(e)
    await log(failure ?? 'error', null)
    if (!failure) throw e
    return { ok: false, code: failure, message: FORM_MESSAGES[failure] }
  }
}
