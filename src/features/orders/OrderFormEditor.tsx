import { useRef, useState } from 'react'
import { FileText, LoaderCircle, RefreshCw, Trash2, Upload } from 'lucide-react'
import { BUTTON, CARD, LINK } from '../../components/styles'
import { Toast } from '../../components/Toast'
import { ORDER_FORM_ACCEPT, checkOrderFormFile, fileMimeType } from '../../domain'
import { removeOrderForm, saveOrderForm } from '../attachments/api'
import { useOrderForm } from '../attachments/OrderFormLink'
import { preparePhoto } from '../attachments/resize'

/**
 * Edit order (0009 plan P8): the Admin replaces or removes the paper order
 * form while the order is New, Assigned or Acknowledged (the page is only
 * open then). The new file is not read by the AI; the details stay as typed.
 */
export function OrderFormEditor({ orderId }: { orderId: string }) {
  const [version, setVersion] = useState(0)
  const { form, url } = useOrderForm(orderId, version)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  const replace = async (file: File | undefined) => {
    if (!file) return
    const mime = fileMimeType(file)
    const check = checkOrderFormFile(mime, file.size)
    setDone(null)
    if (!check.ok) {
      setError(check.error)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const prepared = check.kind === 'photo' ? await preparePhoto(file, mime) : { body: file as Blob, mime }
      await saveOrderForm(orderId, prepared.body, prepared.mime, file.name, form?.storage_path ?? null)
      setDone(form ? 'Order form replaced.' : 'Order form added.')
      setVersion((v) => v + 1)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  const remove = async () => {
    if (!window.confirm('Remove the paper order form from this order?')) return
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      await removeOrderForm(orderId)
      setDone('Order form removed.')
      setVersion((v) => v + 1)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={CARD} aria-labelledby="order-form-file">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand"
        >
          <FileText className="size-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 id="order-form-file" className="text-base font-semibold text-ink">
            Paper order form
          </h3>
          <p className="mt-0.5 break-words text-sm text-ink-muted">
            {form ? (
              url ? (
                <a href={url} target="_blank" rel="noreferrer" className={LINK}>
                  {form.file_name ?? 'Order form'} ({form.kind === 'pdf' ? 'PDF' : 'photo'})
                </a>
              ) : (
                (form.file_name ?? 'Order form')
              )
            ) : (
              'No paper form is attached.'
            )}
          </p>
        </div>
      </div>
      <input
        ref={input}
        type="file"
        accept={ORDER_FORM_ACCEPT}
        className="sr-only"
        aria-label="New photo or PDF of the order form"
        onChange={(e) => void replace(e.target.files?.[0])}
      />
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => input.current?.click()} className={`${BUTTON.secondary} min-h-11`}>
          {form ? <RefreshCw aria-hidden="true" /> : <Upload aria-hidden="true" />}
          {form ? 'Replace' : 'Add photo or PDF'}
        </button>
        {form ? (
          <button type="button" disabled={busy} onClick={() => void remove()} className={`${BUTTON.dangerSoft} min-h-11`}>
            <Trash2 aria-hidden="true" />
            Remove
          </button>
        ) : null}
      </div>
      {busy ? (
        <p role="status" className="mt-3 flex items-center gap-2 text-sm text-ink-muted">
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          Saving…
        </p>
      ) : null}
      {done ? (
        <Toast key={done} onDismiss={() => setDone(null)}>
          {done}
        </Toast>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 rounded-lg border border-danger/35 bg-danger-soft px-3 py-2 text-sm text-danger-ink">
          {error}
        </p>
      ) : null}
    </section>
  )
}
