import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Dialog } from '../../components/Dialog'
import { Field } from '../../components/Field'
import { Notice } from '../../components/Notice'
import { BUTTON, CARD, INPUT, LINK } from '../../components/styles'
import {
  PAYMENT_FORM_FIELDS,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  RECEIPT_ACCEPT,
  amountOverBalance,
  canRecordPayment,
  checkJobFile,
  defaultPaymentAmount,
  fileMimeType,
  formatFileSize,
  formatMYR,
  jobFilePath,
  receiptRequired,
  validatePaymentForm,
  type PaymentFormErrors,
  type PaymentFormValues,
  type PaymentInput,
  type PaymentMethod,
} from '../../domain'
import { isNetworkError } from '../../lib/api'
import { clearDraft, loadDraft, saveDraft } from '../../lib/drafts'
import { useLoad } from '../../lib/useLoad'
import { deleteStoredFile, uploadFile } from '../attachments/api'
import { preparePhoto, type PhotoCodec } from '../attachments/resize'
import { fetchJob, recordPayment, type JobDetail } from './api'

/** A receipt uploaded to Storage, waiting to be saved with the payment. */
interface UploadedReceipt {
  path: string
  fileName: string
  size: number
}

type Receipt =
  | { status: 'none' }
  | { status: 'uploading'; fileName: string }
  | ({ status: 'ready' } & UploadedReceipt)
  | { status: 'failed'; fileName: string; error: string; file?: File }

/** What survives a reload: typed values, the payment's one-time key, an uploaded receipt. */
interface PaymentDraft {
  values: PaymentFormValues
  clientKey: string
  receipt: UploadedReceipt | null
}

const fieldId = (field: string) => `payment-${field}`

/** Load the job; payments are recorded while In Progress, Job Done or Reviewed. */
export function PaymentPage({ codec, newId }: { codec?: PhotoCodec; newId?: () => string } = {}) {
  const { orderNo = '' } = useParams()
  const [state, reload] = useLoad(() => fetchJob(orderNo), orderNo)

  if (state.status === 'loading') {
    return (
      <Notice title="Loading…">
        <p>Getting job {orderNo}.</p>
      </Notice>
    )
  }
  if (state.status === 'error') {
    return (
      <Notice tone="error" title="Could not load the job">
        <p>{state.message}</p>
        <button type="button" onClick={reload} className="mt-3 min-h-11 font-medium underline">
          Try again
        </button>
      </Notice>
    )
  }
  if (!state.data || !canRecordPayment(state.data.job.status, 'technician', true)) {
    return (
      <Notice tone="error" title={state.data ? 'Payments cannot be recorded now' : 'Job not found'}>
        <p>
          {state.data
            ? 'Payments are recorded while the job is In Progress, Job Done or Reviewed.'
            : `${orderNo} is not in your jobs.`}
        </p>
        <Link to={state.data ? `/jobs/${encodeURIComponent(orderNo)}` : '/jobs'} className={`${LINK} mt-3 inline-block`}>
          {state.data ? 'Back to the job' : 'Back to my jobs'}
        </Link>
      </Notice>
    )
  }
  return <PaymentForm detail={state.data} codec={codec} newId={newId ?? (() => crypto.randomUUID())} />
}

/** Record a payment collected from the customer (PRD Q10, AC10). */
function PaymentForm({ detail, codec, newId }: { detail: JobDetail; codec?: PhotoCodec; newId: () => string }) {
  const { job } = detail
  const navigate = useNavigate()
  const draftKey = `payment:${job.id}`
  const [draft] = useState<PaymentDraft>(() => {
    const saved = loadDraft<PaymentDraft>(draftKey)
    if (saved) return saved
    const fresh: PaymentDraft = {
      values: { amount: defaultPaymentAmount(job.balance), method: '', note: '' },
      clientKey: newId(),
      receipt: null,
    }
    saveDraft(draftKey, fresh)
    return fresh
  })
  const [values, setValues] = useState<PaymentFormValues>(draft.values)
  const [receipt, setReceipt] = useState<Receipt>(
    draft.receipt ? { status: 'ready', ...draft.receipt } : { status: 'none' },
  )
  const [errors, setErrors] = useState<PaymentFormErrors>({})
  const [checked, setChecked] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [confirmOver, setConfirmOver] = useState<{ input: PaymentInput; over: number } | null>(null)
  const [saving, setSaving] = useState(false)
  const inFlight = useRef(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const persist = (nextValues: PaymentFormValues, nextReceipt: Receipt) =>
    saveDraft(draftKey, {
      values: nextValues,
      clientKey: draft.clientKey,
      receipt:
        nextReceipt.status === 'ready'
          ? { path: nextReceipt.path, fileName: nextReceipt.fileName, size: nextReceipt.size }
          : null,
    } satisfies PaymentDraft)

  function change(field: keyof PaymentFormValues, value: string) {
    const next = { ...values, [field]: value } as PaymentFormValues
    setValues(next)
    persist(next, receipt)
    if (checked) {
      const result = validatePaymentForm(next, receipt.status === 'ready')
      setErrors(result.ok ? {} : result.errors)
    }
  }

  async function uploadReceipt(file: File) {
    const name = file.name
    const type = checkJobFile(fileMimeType(file), 1, { receipt: true })
    if (!type.ok) {
      setReceipt({ status: 'failed', fileName: name, error: type.error })
      return
    }
    setReceipt({ status: 'uploading', fileName: name })
    try {
      const prepared = await preparePhoto(file, fileMimeType(file), codec)
      const check = checkJobFile(prepared.mime, prepared.body.size, { receipt: true })
      if (!check.ok) {
        setReceipt({ status: 'failed', fileName: name, error: check.error })
        return
      }
      const path = jobFilePath(job.id, newId(), prepared.mime, { receipt: true })
      await uploadFile(path, prepared.body, prepared.mime)
      const ready: Receipt = { status: 'ready', path, fileName: name, size: prepared.body.size }
      setReceipt(ready)
      persist(values, ready)
      if (checked) setErrors((e) => ({ ...e, receipt: undefined }))
    } catch (e) {
      setReceipt({
        status: 'failed',
        fileName: name,
        error: (e as Error).message,
        file: isNetworkError(e) ? file : undefined,
      })
    }
  }

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    // Replacing a receipt: the old copy was never saved with a payment.
    if (receipt.status === 'ready') void deleteStoredFile(receipt.path)
    void uploadReceipt(file)
  }

  function removeReceipt() {
    if (receipt.status === 'ready') void deleteStoredFile(receipt.path)
    const none: Receipt = { status: 'none' }
    setReceipt(none)
    persist(values, none)
  }

  async function save(input: PaymentInput) {
    if (inFlight.current) return
    inFlight.current = true
    setSaving(true)
    setFormError(null)
    try {
      await recordPayment(
        job.id,
        input,
        draft.clientKey,
        receipt.status === 'ready' ? { path: receipt.path, fileName: receipt.fileName } : null,
      )
      clearDraft(draftKey)
      navigate(`/jobs/${encodeURIComponent(job.order_no)}?paid=1`)
    } catch (e) {
      // The draft keeps the same key, so trying again cannot record it twice.
      setFormError((e as Error).message)
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (inFlight.current) return
    setChecked(true)
    setFormError(null)
    if (receipt.status === 'uploading') {
      setFormError('Wait for the receipt to finish uploading.')
      return
    }
    const result = validatePaymentForm(values, receipt.status === 'ready')
    if (!result.ok) {
      setErrors(result.errors)
      const first = PAYMENT_FORM_FIELDS.find((f) => result.errors[f])
      if (first) document.getElementById(fieldId(first))?.focus()
      return
    }
    setErrors({})
    const over = amountOverBalance(result.input.amount, job.balance)
    if (over > 0) {
      setConfirmOver({ input: result.input, over })
      return
    }
    void save(result.input)
  }

  const method = values.method as PaymentMethod | ''
  const needsReceipt = method !== '' && receiptRequired(method)

  return (
    <form noValidate onSubmit={submit} aria-label="Record payment" className="space-y-4">
      <Link to={`/jobs/${encodeURIComponent(job.order_no)}`} className={`${LINK} inline-flex min-h-11 items-center text-sm`}>
        ← Back to the job
      </Link>
      <div>
        <h2 className="text-xl font-semibold">Record payment</h2>
        <p className="text-sm text-slate-600">
          {job.order_no} · Final amount {formatMYR(job.final_amount)} · Paid {formatMYR(job.amount_paid)} ·{' '}
          <strong>Balance {formatMYR(job.balance)}</strong>
        </p>
      </div>

      {formError ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
          {formError}
        </p>
      ) : null}

      <div className={`${CARD} space-y-4`}>
        <Field id={fieldId('amount')} label="Amount received (RM)" error={errors.amount}>
          {(control) => (
            <input
              {...control}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={values.amount}
              onChange={(e) => change('amount', e.target.value)}
              className={INPUT}
            />
          )}
        </Field>

        <fieldset aria-describedby={errors.method ? 'payment-method-error' : undefined}>
          <legend className="text-sm font-medium text-slate-800">Payment method</legend>
          <div className="mt-1 grid grid-cols-2 gap-2">
            {PAYMENT_METHODS.map((m, i) => (
              <label
                key={m}
                className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm ${
                  values.method === m ? 'border-sky-600 bg-sky-50 text-sky-900' : 'border-slate-300 bg-white'
                }`}
              >
                <input
                  id={i === 0 ? fieldId('method') : undefined}
                  type="radio"
                  name="payment-method"
                  value={m}
                  checked={values.method === m}
                  onChange={() => change('method', m)}
                  className="h-4 w-4"
                />
                {PAYMENT_METHOD_LABELS[m]}
              </label>
            ))}
          </div>
          {errors.method ? (
            <p id="payment-method-error" className="mt-1 text-sm text-red-700">
              {errors.method}
            </p>
          ) : null}
        </fieldset>

        <div>
          <p className="text-sm font-medium text-slate-800">
            Receipt photo or PDF
            {needsReceipt ? null : <span className="font-normal text-slate-500"> (optional for cash)</span>}
          </p>
          <p className="text-xs text-slate-500">Required for bank transfer, card and e-wallet: the slip or screenshot.</p>
          <input
            ref={fileInput}
            id={fieldId('receipt-file')}
            type="file"
            accept={RECEIPT_ACCEPT}
            onChange={onPick}
            className="sr-only"
          />
          <div className="mt-2 space-y-2">
            {receipt.status === 'uploading' ? (
              <p role="status" className="text-sm text-slate-700">
                Uploading {receipt.fileName}…
              </p>
            ) : receipt.status === 'ready' ? (
              <p className="text-sm text-slate-800">
                ✓ {receipt.fileName} <span className="text-slate-500">· {formatFileSize(receipt.size)}</span>
              </p>
            ) : receipt.status === 'failed' ? (
              <div role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
                <p>
                  {receipt.fileName}: {receipt.error}
                </p>
                {receipt.file ? (
                  <button
                    type="button"
                    onClick={() => receipt.file && void uploadReceipt(receipt.file)}
                    className={`${BUTTON.primary} mt-2 min-h-11`}
                  >
                    Retry
                  </button>
                ) : null}
              </div>
            ) : null}
            <div className="flex gap-2">
              <button
                type="button"
                id={fieldId('receipt')}
                onClick={() => fileInput.current?.click()}
                disabled={receipt.status === 'uploading'}
                aria-describedby={errors.receipt ? 'payment-receipt-error' : undefined}
                className={`${BUTTON.secondary} min-h-11 flex-1`}
              >
                {receipt.status === 'ready' ? 'Replace receipt' : 'Add receipt'}
              </button>
              {receipt.status === 'ready' ? (
                <button type="button" onClick={removeReceipt} className={`${BUTTON.secondary} min-h-11`}>
                  Remove receipt
                </button>
              ) : null}
            </div>
            {errors.receipt ? (
              <p id="payment-receipt-error" className="text-sm text-red-700">
                {errors.receipt}
              </p>
            ) : null}
          </div>
        </div>

        <Field id={fieldId('note')} label="Note" optional error={errors.note}>
          {(control) => (
            <textarea
              {...control}
              rows={2}
              maxLength={500}
              value={values.note}
              onChange={(e) => change('note', e.target.value)}
              className={INPUT}
            />
          )}
        </Field>
      </div>

      <div className="sticky bottom-0 -mx-4 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
        <button type="submit" disabled={saving} className={`${BUTTON.primary} min-h-11 w-full`}>
          {saving ? 'Saving…' : 'Record payment'}
        </button>
      </div>

      {confirmOver ? (
        <Dialog title="More than the balance" onClose={() => setConfirmOver(null)}>
          <p className="text-sm text-slate-700">
            {formatMYR(confirmOver.input.amount)} is {formatMYR(confirmOver.over)} more than the balance of{' '}
            {formatMYR(job.balance)}. Record it anyway?
          </p>
          <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={() => setConfirmOver(null)} className={`${BUTTON.secondary} min-h-11`}>
              Change amount
            </button>
            <button
              type="button"
              onClick={() => {
                const input = confirmOver.input
                setConfirmOver(null)
                void save(input)
              }}
              className={`${BUTTON.primary} min-h-11`}
            >
              Record anyway
            </button>
          </div>
        </Dialog>
      ) : null}
    </form>
  )
}
