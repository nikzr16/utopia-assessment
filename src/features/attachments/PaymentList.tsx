import { PAYMENT_METHOD_LABELS, formatMYR, formatMalaysiaDateTime } from '../../domain'
import type { Payment } from '../../lib/orderRecords'
import { ReceiptLink } from './ReceiptLink'

/** Payments on an order, oldest first, each with its receipt when there is one. */
export function PaymentList({ payments, className = '' }: { payments: Payment[]; className?: string }) {
  if (payments.length === 0) return null
  return (
    <ul className={`space-y-1 text-sm ${className}`} aria-label="Payments">
      {payments.map((p) => (
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
        </li>
      ))}
    </ul>
  )
}
