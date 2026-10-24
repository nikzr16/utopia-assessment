import { useState } from 'react'
import { BadgeCheck, Banknote, Check, Undo2 } from 'lucide-react'
import { BUTTON } from '../../components/styles'
import {
  PAYMENT_METHOD_LABELS,
  formatMYR,
  formatMalaysiaDateTime,
  paymentNeedsVerifying,
  verifiedLabel,
} from '../../domain'
import type { Payment } from '../../lib/orderRecords'
import { staffName, useInactiveStaff } from '../../lib/staffStatus'
import { ReceiptLink } from './ReceiptLink'

/**
 * Finance's Verify / Undo on non-cash payments (0004). `toggle` ticks or
 * unticks one payment and throws an error that can be shown as it is.
 */
export interface PaymentVerifying {
  toggle: (payment: Payment) => Promise<void>
}

/**
 * Payments on an order, oldest first, each with its receipt when there is
 * one and, for non-cash payments, whether Finance has verified it.
 */
export function PaymentList({
  payments,
  className = '',
  verifying,
}: {
  payments: Payment[]
  className?: string
  verifying?: PaymentVerifying
}) {
  const [pending, setPending] = useState<string | null>(null)
  useInactiveStaff() // re-render with "(inactive)" tags once known
  const [error, setError] = useState<{ id: string; message: string } | null>(null)

  async function toggle(p: Payment) {
    if (!verifying || pending) return
    setPending(p.id)
    setError(null)
    try {
      await verifying.toggle(p)
    } catch (e) {
      setError({ id: p.id, message: (e as Error).message })
    } finally {
      setPending(null)
    }
  }

  if (payments.length === 0) return null
  return (
    <ul className={`space-y-2 text-sm ${className}`} aria-label="Payments">
      {payments.map((p) => {
        const needsTick = paymentNeedsVerifying(p.method)
        const verified = verifiedLabel({ verified_at: p.verified_at ?? null, verified_by_name: staffName(p.verified_by_name, p.verified_by) })
        return (
          <li key={p.id} className="flex gap-3">
            <span
              aria-hidden="true"
              className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand"
            >
              <Banknote className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="break-words text-ink tabular">
                {formatMYR(p.amount)} · {PAYMENT_METHOD_LABELS[p.method]} · {formatMalaysiaDateTime(p.recorded_at)} ·{' '}
                {staffName(p.recorded_by_name, p.recorded_by)}
                {p.receipt ? (
                  <>
                    {' · '}
                    <ReceiptLink path={p.receipt.storage_path} fileName={p.receipt.file_name} />
                  </>
                ) : null}
              </p>
              {p.note ? <p className="mt-0.5 break-words text-ink-muted">{p.note}</p> : null}
              {needsTick ? (
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  {verified ? (
                    <span className="inline-flex items-center gap-1.5 text-success-ink">
                      <BadgeCheck className="size-4 shrink-0" aria-hidden="true" />
                      <span>{verified}</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-warning-soft px-2.5 py-0.5 text-xs font-medium text-warning-ink ring-1 ring-inset ring-warning/35">
                      <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
                      Not verified yet
                    </span>
                  )}
                  {verifying ? (
                    <button
                      type="button"
                      onClick={() => void toggle(p)}
                      disabled={pending !== null}
                      className={`${verified ? BUTTON.ghost : BUTTON.primary} min-h-11 px-3 sm:min-h-9`}
                    >
                      {verified ? <Undo2 aria-hidden="true" /> : <Check aria-hidden="true" />}
                      {pending === p.id
                        ? 'Saving…'
                        : verified
                          ? `Undo verified (${formatMYR(p.amount)})`
                          : `Mark verified (${formatMYR(p.amount)})`}
                    </button>
                  ) : null}
                </div>
              ) : null}
              {error?.id === p.id ? (
                <p role="alert" className="mt-1 text-danger-ink">
                  {error.message}
                </p>
              ) : null}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
