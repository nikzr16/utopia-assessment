import { useRef, useState } from 'react'
import { BUTTON, CARD } from '../../components/styles'
import { ORDER_FORM_ACCEPT, checkOrderFormFile, fileMimeType, type OrderFormValues } from '../../domain'
import { preparePhoto, type PhotoCodec } from '../attachments/resize'
import { readOrderFormPhoto, type ReadFormFields } from './api'

/** The paper form kept in the browser until the order is saved (plan P2). */
export interface KeptForm {
  body: Blob
  mime: string
  name: string
}

const LABELS: [keyof ReadFormFields, string][] = [
  ['customerName', 'customer'],
  ['serviceTypeId', 'service type'],
  ['problemDescription', 'problem description'],
  ['quotedPrice', 'quoted price'],
  ['scheduledDate', 'date'],
]

/** The form values the read fields fill (other fields are left as they are). */
export function filledValues(fields: ReadFormFields): Partial<OrderFormValues> {
  const out: Partial<OrderFormValues> = {}
  if (fields.customerName) out.customerName = fields.customerName
  if (fields.serviceTypeId) out.serviceTypeId = fields.serviceTypeId
  if (fields.problemDescription) out.problemDescription = fields.problemDescription
  if (fields.quotedPrice) out.quotedPrice = fields.quotedPrice
  // A date with no time on the form starts at 09:00 (the Admin can change it).
  if (fields.scheduledDate) out.scheduledAt = `${fields.scheduledDate}T${fields.scheduledTime ?? '09:00'}`
  return out
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'reading' }
  | { kind: 'filled'; filled: string[]; timeGuessed: boolean }
  | { kind: 'failed'; message: string }

/**
 * "Read from photo" on the New Order form (0009 Document Understanding): an
 * Admin picks a photo or PDF of a paper order form; the AI reads the customer
 * name, service type, details, amount and date. All or nothing: an unclear
 * form fills nothing. Nothing is saved until the Admin presses Save; then the
 * file is kept with the order as its Order form.
 */
export function ReadFromPhoto({
  onFilled,
  kept,
  onKeep,
  codec,
}: {
  onFilled: (values: Partial<OrderFormValues>) => void
  kept: KeptForm | null
  onKeep: (form: KeptForm | null) => void
  /** Tests pass a fake photo codec. */
  codec?: PhotoCodec
}) {
  const input = useRef<HTMLInputElement>(null)
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })

  const pick = async (file: File | undefined) => {
    if (!file) return
    const mime = fileMimeType(file)
    const check = checkOrderFormFile(mime, file.size)
    if (!check.ok) {
      setPhase({ kind: 'failed', message: check.error })
      return
    }
    setPhase({ kind: 'reading' })
    try {
      const prepared = check.kind === 'photo' ? await preparePhoto(file, mime, codec) : { body: file as Blob, mime }
      onKeep({ body: prepared.body, mime: prepared.mime, name: file.name })
      const result = await readOrderFormPhoto(prepared.body, prepared.mime, file.name)
      if (!result.ok) {
        setPhase({ kind: 'failed', message: result.message })
        return
      }
      onFilled(filledValues(result.fields))
      setPhase({
        kind: 'filled',
        filled: LABELS.filter(([key]) => result.fields[key]).map(([, label]) => label),
        timeGuessed: Boolean(result.fields.scheduledDate && !result.fields.scheduledTime),
      })
    } catch (e) {
      setPhase({ kind: 'failed', message: (e as Error).message })
    } finally {
      if (input.current) input.current.value = ''
    }
  }

  return (
    <section className={CARD} aria-labelledby="read-from-photo">
      <h3 id="read-from-photo" className="text-base font-semibold">
        Paper order form
      </h3>
      <p className="mt-1 text-sm text-slate-600">
        Take or choose a photo (or a PDF) of a paper order form and the AI fills the customer, service type, details,
        amount and date for you to check.
      </p>
      <input
        ref={input}
        type="file"
        accept={ORDER_FORM_ACCEPT}
        className="sr-only"
        id="read-from-photo-file"
        aria-label="Photo or PDF of the order form"
        onChange={(e) => void pick(e.target.files?.[0])}
      />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={phase.kind === 'reading'}
          className={`${BUTTON.secondary} min-h-11`}
        >
          {kept ? 'Read another photo' : 'Read from photo'}
        </button>
        {kept && phase.kind !== 'reading' ? (
          <button
            type="button"
            onClick={() => {
              onKeep(null)
              setPhase({ kind: 'idle' })
            }}
            className={`${BUTTON.secondary} min-h-11`}
          >
            Remove photo
          </button>
        ) : null}
      </div>

      <div className="mt-3 space-y-2 text-sm" aria-live="polite">
        {phase.kind === 'reading' ? <p role="status">Reading the form… this can take up to 30 seconds.</p> : null}
        {phase.kind === 'filled' ? (
          <p role="status" className="rounded-md border border-green-300 bg-green-50 px-3 py-2 text-green-900">
            Filled from the photo: {phase.filled.join(', ')}. Check every field before saving.
            {phase.timeGuessed ? ' No time was on the form: the time is set to 09:00.' : ''}
          </p>
        ) : null}
        {phase.kind === 'failed' ? (
          <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-950">
            {phase.message}
          </p>
        ) : null}
        {kept && phase.kind !== 'reading' ? (
          <p className="text-slate-600">“{kept.name}” will be saved with the order as its order form.</p>
        ) : null}
      </div>
    </section>
  )
}
