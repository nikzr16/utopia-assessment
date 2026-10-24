import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import {
  Banknote,
  CircleX,
  CreditCard,
  Landmark,
  LoaderCircle,
  Paperclip,
  RotateCw,
  Smartphone,
  Trash2,
  Upload,
  type LucideIcon,
} from 'lucide-react'
import { ActionBar } from '../../components/ActionBar'
import { Dialog } from '../../components/Dialog'
import { Field } from '../../components/Field'
import { BUTTON, CARD, INPUT } from '../../components/styles'
import {
  PAYMENT_FORM_FIELDS,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  RECEIPT_ACCEPT,
  amountOverBalance,
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
import { isNetworkError, type OrderSummary } from '../../lib/api'
import { clearDraft, loadDraft, saveDraft } from '../../lib/drafts'
import { deleteStoredFile, uploadFile } from '../attachments/api'
import { preparePhoto, type PhotoCodec } from '../attachments/resize'
import type { RecordPayment } from './api'
import { BackLink, PageHeader } from '../../components/ui'

const METHOD_ICONS: Record<PaymentMethod, LucideIcon> = {
  cash: Banknote,
  bank_transfer: Landmark,
  card: CreditCard,
  ewallet: Smartphone,
}

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

/**
 * Record a payment (0002 PRD Q10, AC10; 0004 PRD Q7): amount pre-filled with
 * the balance, method, a receipt photo or PDF (required except for cash), a
 * note, and a confirmation above the balance. The draft keeps a one-time
 * client key, so a retry never records the payment twice. Used by the
 * technician's job and by Finance; `record` saves it and `onDone` moves on.
 */
export function PaymentForm({
  order,
  backTo,
  backLabel,
  record,
  onDone,
  codec,
  newId,
}: {
  order: OrderSummary
  backTo: string
  backLabel: string
  record: RecordPayment
  onDone: () => void
  codec?: PhotoCodec
  newId: () => string
}) {
  const draftKey = `payment:${order.id}`
  const [draft] = useState<PaymentDraft>(() => {
    const saved = loadDraft<PaymentDraft>(draftKey)
    if (saved) return saved
    const fresh: PaymentDraft = {
      values: { amount: defaultPaymentAmount(order.balance), method: '', note: '' },
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
      const path = jobFilePath(order.id, newId(), prepared.mime, { receipt: true })
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
      await record(
        order.id,
        input,
        draft.clientKey,
        receipt.status === 'ready' ? { path: receipt.path, fileName: receipt.fileName } : null,
      )
      clearDraft(draftKey)
      onDone()
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
    const over = amountOverBalance(result.input.amount, order.balance)
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
      <BackLink to={backTo}>{backLabel}</BackLink>
      <PageHeader title="Record payment" description={order.order_no} />

      <dl className="grid grid-cols-2 gap-2 text-sm tabular sm:grid-cols-3 sm:gap-3">
        <div className="rounded-xl border border-line bg-surface px-3 py-2.5 shadow-card">
          <dt className="text-xs text-ink-muted">Final amount</dt>
          <dd className="mt-0.5 font-semibold text-ink">{formatMYR(order.final_amount)}</dd>
        </div>
        <div className="rounded-xl border border-line bg-surface px-3 py-2.5 shadow-card">
          <dt className="text-xs text-ink-muted">Paid</dt>
          <dd className="mt-0.5 font-semibold text-ink">{formatMYR(order.amount_paid)}</dd>
        </div>
        <div className="col-span-2 flex items-baseline justify-between gap-3 rounded-xl border border-brand/30 bg-brand-soft px-3 py-2.5 text-brand-ink sm:col-span-1 sm:block">
          <dt className="text-xs font-medium">Balance</dt>
          <dd className="text-base font-semibold sm:mt-0.5 sm:text-sm">{formatMYR(order.balance)}</dd>
        </div>
      </dl>

      {formError ? (
        <p role="alert" className="flex gap-2 rounded-xl border border-danger/35 bg-danger-soft px-4 py-3 text-sm text-danger-ink">
          <CircleX className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0">{formError}</span>
        </p>
      ) : null}

      <div className={`${CARD} space-y-5`}>
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
          <legend className="text-sm font-medium text-ink">Payment method</legend>
          <div className="mt-1.5 grid grid-cols-2 gap-2 sm:gap-3">
            {PAYMENT_METHODS.map((m, i) => {
              const Icon = METHOD_ICONS[m]
              const on = values.method === m
              return (
                <label
                  key={m}
                  className={`flex min-h-14 cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2 text-sm font-medium transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus ${
                    on ? 'border-brand bg-brand-soft text-brand-ink ring-1 ring-brand' : 'border-line-strong bg-surface text-ink hover:bg-sunken'
                  }`}
                >
                  <input
                    id={i === 0 ? fieldId('method') : undefined}
                    type="radio"
                    name="payment-method"
                    value={m}
                    checked={on}
                    onChange={() => change('method', m)}
                    className="size-4 shrink-0 accent-brand"
                  />
                  <Icon className={`size-5 shrink-0 ${on ? 'text-brand' : 'text-ink-faint'}`} aria-hidden="true" />
                  <span className="min-w-0">{PAYMENT_METHOD_LABELS[m]}</span>
                </label>
              )
            })}
          </div>
          {errors.method ? (
            <p id="payment-method-error" className="mt-1 text-sm text-danger-ink">
              {errors.method}
            </p>
          ) : null}
        </fieldset>

        <div>
          <p className="text-sm font-medium text-ink">
            Receipt photo or PDF
            {needsReceipt ? null : <span className="font-normal text-ink-faint"> (optional for cash)</span>}
          </p>
          <p className="text-xs text-ink-faint">Required for bank transfer, card and e-wallet: the slip or screenshot.</p>
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
              <p role="status" className="flex items-center gap-2 rounded-lg border border-line bg-sunken px-3 py-2.5 text-sm text-ink-muted">
                <LoaderCircle className="size-4 shrink-0 animate-spin text-brand" aria-hidden="true" />
                Uploading {receipt.fileName}…
              </p>
            ) : receipt.status === 'ready' ? (
              <div className="flex items-center gap-3 rounded-lg border border-success/35 bg-success-soft px-3 py-2.5 text-sm">
                <span
                  aria-hidden="true"
                  className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-surface text-success"
                >
                  <Paperclip className="size-4" />
                </span>
                <p className="min-w-0 break-words text-success-ink">
                  ✓ {receipt.fileName} <span className="text-ink-muted">· {formatFileSize(receipt.size)}</span>
                </p>
              </div>
            ) : receipt.status === 'failed' ? (
              <div role="alert" className="rounded-lg border border-danger/35 bg-danger-soft px-3 py-2.5 text-sm text-danger-ink">
                <p className="flex gap-2">
                  <CircleX className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 break-words">
                    {receipt.fileName}: {receipt.error}
                  </span>
                </p>
                {receipt.file ? (
                  <button
                    type="button"
                    onClick={() => receipt.file && void uploadReceipt(receipt.file)}
                    className={`${BUTTON.primary} mt-2 min-h-11`}
                  >
                    <RotateCw aria-hidden="true" />
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
                className={`${BUTTON.secondary} min-h-11 flex-1 ${receipt.status === 'ready' ? '' : 'border-dashed'}`}
              >
                <Upload aria-hidden="true" />
                {receipt.status === 'ready' ? 'Replace receipt' : 'Add receipt'}
              </button>
              {receipt.status === 'ready' ? (
                <button type="button" onClick={removeReceipt} className={`${BUTTON.dangerSoft} min-h-11`}>
                  <Trash2 aria-hidden="true" />
                  Remove receipt
                </button>
              ) : null}
            </div>
            {errors.receipt ? (
              <p id="payment-receipt-error" className="text-sm text-danger-ink">
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

      <ActionBar>
        <button type="submit" disabled={saving} className={`${BUTTON.primary} min-h-12 w-full text-base md:min-h-11 md:text-sm`}>
          <Banknote aria-hidden="true" />
          {saving ? 'Saving…' : 'Record payment'}
        </button>
      </ActionBar>

      {confirmOver ? (
        <Dialog title="More than the balance" onClose={() => setConfirmOver(null)}>
          <p className="text-sm text-ink-muted">
            {formatMYR(confirmOver.input.amount)} is {formatMYR(confirmOver.over)} more than the balance of{' '}
            {formatMYR(order.balance)}. Record it anyway?
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
