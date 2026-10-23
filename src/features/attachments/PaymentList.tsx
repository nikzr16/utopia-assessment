import { useState } from 'react'
import { BUTTON } from '../../components/styles'
import {
  PAYMENT_METHOD_LABELS,
  formatMYR,
  formatMalaysiaDateTime,
  paymentNeedsVerifying,
  verifiedLabel,
} from '../../domain'
import type { Payment } from '../../lib/orderRecords'
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
        const verified = verifiedLabel({ verified_at: p.verified_at ?? null, verified_by_name: p.verified_by_name ?? null })
        return (
          <li key={p.id}>
            {formatMYR(p.amount)} · {PAYMENT_METHOD_LABELS[p.method]} · {formatMalaysiaDateTime(p.recorded_at)} ·{' '}
            {p.recorded_by_name}
            {p.receipt ? (
              <>
                {' · '}
                <ReceiptLink path={p.receipt.storage_path} fileName={p.receipt.file_name} />
              </>
            ) : null}
            {p.note ? <span className="block text-slate-600">{p.note}</span> : null}
            {needsTick ? (
              <span className="mt-1 flex flex-wrap items-center gap-2">
                {verified ? (
                  <span className="text-green-800">✓ {verified}</span>
                ) : (
                  <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-900 ring-1 ring-inset ring-amber-200">
                    Not verified yet
                  </span>
                )}
                {verifying ? (
                  <button
                    type="button"
                    onClick={() => void toggle(p)}
                    disabled={pending !== null}
                    className={`${verified ? BUTTON.secondary : BUTTON.primary} min-h-11 sm:min-h-0`}
                  >
                    {pending === p.id
                      ? 'Saving…'
                      : verified
                        ? `Undo verified (${formatMYR(p.amount)})`
                        : `Mark verified (${formatMYR(p.amount)})`}
                  </button>
                ) : null}
              </span>
            ) : null}
            {error?.id === p.id ? (
              <span role="alert" className="mt-1 block text-red-800">
                {error.message}
              </span>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
