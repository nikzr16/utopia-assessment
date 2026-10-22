import { useId, useRef, useState } from 'react'
import { Dialog } from '../../components/Dialog'
import { Field } from '../../components/Field'
import { BUTTON, CARD, INPUT } from '../../components/styles'
import {
  CUSTOMER_MESSAGE_MAX_LENGTH,
  canCallCustomer,
  canEditCustomerMessage,
  canSendCustomerMessage,
  checkCustomerMessageBody,
  customerMessageEdited,
  customerMessageEditedLabel,
  customerMessageOffered,
  customerMessageStateLabel,
  customerNotTold,
  telUrl,
  whatsAppUrl,
  type CustomerMessage,
  type OrderStatus,
} from '../../domain'
import { isNetworkError } from '../../lib/api'
import { useLoad } from '../../lib/useLoad'
import { useRefreshOnReturn } from '../../lib/useRefreshOnReturn'
import { confirmCustomerMessage, editCustomerMessage, fetchLatestCustomerMessage } from './api'

/** The "Customer not told yet" flag, shown until the message is sent or the customer is told by phone. */
export function CustomerNotToldBadge() {
  return (
    <span className="inline-flex items-center whitespace-nowrap rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-900 ring-1 ring-inset ring-amber-200">
      Customer not told yet
    </span>
  )
}

/**
 * The customer message of a finished order (PRD AC1–AC9): the text the
 * database prepared, Edit, Send on WhatsApp (or Call for a landline), the
 * "Have you sent it?" question, and who sent it and when. It loads the
 * order's latest message itself and shows nothing unless the order is Job
 * Done, Reviewed or Closed and the signed-in person can see a message.
 * `canManage` turns the buttons on; without it the state is read-only.
 */
export function CustomerMessagePanel({
  orderId,
  orderStatus,
  canManage,
  onChange,
}: {
  orderId: string
  orderStatus: OrderStatus
  canManage: boolean
  /** Called after an edit or confirmation is written (or rejected), e.g. to reload the order history. */
  onChange?: () => void
}) {
  const offered = customerMessageOffered(orderStatus)
  const [state, reload] = useLoad(
    () => (offered ? fetchLatestCustomerMessage(orderId) : Promise.resolve(null)),
    `${orderId}:${orderStatus}`,
  )
  useRefreshOnReturn(reload)
  const reloadAfterWrite = () => {
    reload()
    onChange?.()
  }

  if (!offered) return null
  if (state.status === 'error') {
    return (
      <section className={CARD} aria-label="Customer message">
        <p role="alert" className="text-sm text-red-900">
          Could not load the customer message. {state.message}
        </p>
        <button type="button" onClick={reload} className="mt-2 min-h-11 text-sm font-medium underline">
          Try again
        </button>
      </section>
    )
  }
  if (state.status !== 'ready' || !state.data) return null
  // Keyed by message: a newer message (after a rework) starts with a clean panel.
  return (
    <MessageCard
      key={state.data.id}
      message={state.data}
      orderStatus={orderStatus}
      canManage={canManage}
      reload={reloadAfterWrite}
    />
  )
}

type Write = 'edit' | 'confirm'

/** How a write ended: done, failed but worth trying again as it is (no signal), or failed for good. */
type Outcome = 'done' | 'retry' | 'failed'

function MessageCard({
  message,
  orderStatus,
  canManage,
  reload,
}: {
  message: CustomerMessage
  orderStatus: OrderStatus
  canManage: boolean
  reload: () => void
}) {
  const headingId = useId()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(message.body)
  const [fieldError, setFieldError] = useState<string | undefined>()
  const [showOriginal, setShowOriginal] = useState(false)
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<Write | null>(null)
  const inFlight = useRef(false)

  const canSend = canSendCustomerMessage(message)
  const canCall = canCallCustomer(message)
  const canEdit = canEditCustomerMessage(message)
  const stateLabel = customerMessageStateLabel(message)
  const editedLabel = customerMessageEditedLabel(message)
  const waUrl = whatsAppUrl(message.phone, message.body)
  const callUrl = telUrl(message.phone)
  const isWhatsApp = message.channel === 'whatsapp'

  /**
   * Runs one write. A rule error ("Already sent by Ali at …") is shown as it
   * is and the latest message is reloaded, so the sent state appears.
   */
  async function write(kind: Write, action: () => Promise<void>): Promise<Outcome> {
    if (inFlight.current) return 'failed'
    inFlight.current = true
    setPending(kind)
    setError(null)
    try {
      await action()
      reload()
      return 'done'
    } catch (e) {
      setError((e as Error).message)
      if (isNetworkError(e)) return 'retry'
      reload()
      return 'failed'
    } finally {
      inFlight.current = false
      setPending(null)
    }
  }

  async function save() {
    const checked = checkCustomerMessageBody(draft)
    if (!checked.ok) {
      setFieldError(checked.error)
      return
    }
    setFieldError(undefined)
    // Nothing changed: leave the original untouched rather than record an edit.
    if (checked.value === message.body) {
      setEditing(false)
      return
    }
    const outcome = await write('edit', () => editCustomerMessage(message.id, checked.value))
    if (outcome === 'done') setEditing(false)
  }

  async function confirm() {
    const outcome = await write('confirm', () => confirmCustomerMessage(message.id))
    // The question stays open only when asking again can help (no signal).
    if (outcome !== 'retry') setAsking(false)
  }

  const startEdit = () => {
    setDraft(message.body)
    setFieldError(undefined)
    setError(null)
    setEditing(true)
  }
  const cancelEdit = () => {
    setEditing(false)
    setFieldError(undefined)
    setError(null)
  }
  const openQuestion = () => {
    setError(null)
    setAsking(true)
  }

  const showEditor = editing && canManage && canEdit
  const showQuestion = asking && canManage && (canSend || canCall)
  const alert = error ? (
    <p role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
      {error}
    </p>
  ) : null

  return (
    <section className={CARD} aria-labelledby={headingId}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={headingId} className="text-sm font-semibold uppercase tracking-wide text-slate-600">
          Customer message
        </h3>
        {customerNotTold(message, orderStatus) ? <CustomerNotToldBadge /> : null}
      </div>

      <div className="mt-3 space-y-3">
        {isWhatsApp ? (
          <div>
            <p className="text-sm font-medium text-slate-800">Message to the customer</p>
            <p className="mt-1 whitespace-pre-line break-words rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900">
              {message.body}
            </p>
            {customerMessageEdited(message) ? (
              <div className="mt-2 text-sm text-slate-700">
                <p>{editedLabel}</p>
                <button
                  type="button"
                  aria-expanded={showOriginal}
                  onClick={() => setShowOriginal((v) => !v)}
                  className="min-h-11 text-sm font-medium text-sky-700 underline"
                >
                  {showOriginal ? 'Hide original' : 'Show original'}
                </button>
                {showOriginal ? (
                  <div className="mt-1">
                    <p className="text-sm font-medium text-slate-800">Original message</p>
                    <p className="mt-1 whitespace-pre-line break-words rounded-md border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-700">
                      {message.prepared_body}
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-slate-700">No WhatsApp number for this customer (landline). Call them instead.</p>
        )}

        {stateLabel ? (
          <p role="status" className="rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm font-medium text-green-900">
            {stateLabel}
          </p>
        ) : null}

        {showEditor ? (
          <form
            noValidate
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault()
              void save()
            }}
          >
            <Field
              id={`${headingId}-body`}
              label="Message to send to the customer"
              hint={`1 to ${CUSTOMER_MESSAGE_MAX_LENGTH.toLocaleString('en-US')} characters. The original is kept.`}
              error={fieldError}
            >
              {(control) => (
                <textarea
                  {...control}
                  rows={6}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  disabled={pending === 'edit'}
                  className={INPUT}
                />
              )}
            </Field>
            {alert}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={cancelEdit}
                disabled={pending === 'edit'}
                className={`${BUTTON.secondary} min-h-11`}
              >
                Cancel
              </button>
              <button type="submit" disabled={pending === 'edit'} className={`${BUTTON.primary} min-h-11`}>
                {pending === 'edit' ? 'Saving…' : 'Save message'}
              </button>
            </div>
          </form>
        ) : (
          <>
            {showQuestion ? null : alert}
            {canManage && isWhatsApp ? (
              <div className="flex flex-col gap-2 sm:flex-row">
                {canSend && waUrl ? (
                  <a
                    href={waUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={openQuestion}
                    className={`${BUTTON.whatsapp} min-h-11 flex-1`}
                  >
                    Send to customer on WhatsApp
                    <span className="sr-only"> (opens WhatsApp in a new tab)</span>
                  </a>
                ) : (
                  <button type="button" disabled className={`${BUTTON.whatsapp} min-h-11 flex-1`}>
                    Send to customer on WhatsApp
                  </button>
                )}
                <button
                  type="button"
                  disabled={!canEdit}
                  onClick={startEdit}
                  className={`${BUTTON.secondary} min-h-11 flex-1`}
                >
                  Edit message
                </button>
              </div>
            ) : null}
            {canManage && !isWhatsApp ? (
              <div className="flex flex-col sm:flex-row">
                {canCall && callUrl ? (
                  <a href={callUrl} onClick={openQuestion} className={`${BUTTON.primary} min-h-11 flex-1 sm:flex-none`}>
                    Call the customer
                  </a>
                ) : (
                  <button type="button" disabled className={`${BUTTON.primary} min-h-11 flex-1 sm:flex-none`}>
                    Call the customer
                  </button>
                )}
              </div>
            ) : null}
          </>
        )}
      </div>

      {showQuestion ? (
        <Dialog
          title={
            isWhatsApp
              ? 'Have you sent it to the customer?'
              : 'Did the customer pick up, and did you tell them the job is done?'
          }
          onClose={() => setAsking(false)}
        >
          <p className="text-sm text-slate-700">
            {isWhatsApp
              ? 'Tap Yes only after you pressed Send in WhatsApp. You cannot undo this.'
              : 'Tap Yes only if you spoke to the customer. You cannot undo this.'}
          </p>
          {alert ? <div className="mt-3">{alert}</div> : null}
          <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => setAsking(false)}
              disabled={pending === 'confirm'}
              className={`${BUTTON.secondary} min-h-11`}
            >
              No, not yet
            </button>
            <button
              type="button"
              onClick={() => void confirm()}
              disabled={pending === 'confirm'}
              className={`${BUTTON.primary} min-h-11`}
            >
              {pending === 'confirm' ? 'Saving…' : isWhatsApp ? 'Yes, I sent it' : 'Yes, I told them by phone'}
            </button>
          </div>
        </Dialog>
      ) : null}
    </section>
  )
}
