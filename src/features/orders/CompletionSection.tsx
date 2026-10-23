import type { ReactNode } from 'react'
import { CARD } from '../../components/styles'
import { canChangeJobFiles, formatMYR, formatMalaysiaDateTime, type OrderStatus } from '../../domain'
import { useLoad } from '../../lib/useLoad'
import { staffName, useInactiveStaff } from '../../lib/staffStatus'
import { JobFiles, PaymentList } from '../attachments'
import type { Payment } from '../../lib/orderRecords'
import { fetchOrderRecords, type OrderSummary } from './api'

/** Statuses in which work has started, so a record, files or payments may exist. */
export const COMPLETION_STATUSES: readonly OrderStatus[] = ['in_progress', 'job_done', 'reviewed', 'closed']

/**
 * The technician's side of the order on the Admin order detail (0002 PRD
 * Q17, AC15) and the Manager / Finance order page (0004): the completion
 * record (read-only), the job files (an Admin can add or remove them while
 * the job is In Progress), and the payments with their receipts.
 * `toggleVerified` gives Finance Verify / Undo on non-cash payments;
 * `onPaymentsChange` is told after each one.
 */
export function CompletionSection({
  order,
  canChangeFiles = canChangeJobFiles(order.status, 'admin', false),
  toggleVerified,
  onPaymentsChange,
}: {
  order: OrderSummary
  canChangeFiles?: boolean
  toggleVerified?: (payment: Payment) => Promise<void>
  onPaymentsChange?: () => void
}) {
  useInactiveStaff() // re-render with "(inactive)" tags once known
  const [state, reload] = useLoad(() => fetchOrderRecords(order.id), `${order.id}|${order.updated_at}`)
  const verifying = toggleVerified
    ? {
        toggle: async (payment: Payment) => {
          try {
            await toggleVerified(payment)
          } finally {
            reload()
            onPaymentsChange?.()
          }
        },
      }
    : undefined

  return (
    <section className={CARD} aria-labelledby="order-completion">
      <h3 id="order-completion" className="text-base font-semibold">
        Completion
      </h3>

      {state.status === 'loading' ? (
        <p className="mt-3 text-sm text-slate-600" role="status">
          Loading the completion record…
        </p>
      ) : state.status === 'error' ? (
        <p role="alert" className="mt-3 text-sm text-red-800">
          Could not load the completion record: {state.message}{' '}
          <button type="button" onClick={reload} className="font-medium underline">
            Try again
          </button>
        </p>
      ) : state.data.completion ? (
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <Item label="Work done" wide>
            {state.data.completion.work_done}
          </Item>
          <Item label="Extra charges">{formatMYR(state.data.completion.extra_charges)}</Item>
          <Item label="Final amount">{formatMYR(order.final_amount)}</Item>
          {state.data.completion.remarks ? (
            <Item label="Remarks" wide>
              {state.data.completion.remarks}
            </Item>
          ) : null}
          <Item label="Submitted by" wide>
            {staffName(state.data.completion.technician_name, state.data.completion.technician_id)}, {formatMalaysiaDateTime(state.data.completion.completed_at)}
          </Item>
        </dl>
      ) : (
        <p className="mt-3 text-sm text-slate-600">Not submitted yet.</p>
      )}

      {order.status === 'in_progress' && state.status === 'ready' && state.data.completion && state.data.rework ? (
        <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          Returned for rework by {state.data.rework.by}: {state.data.rework.note}
        </p>
      ) : null}

      <h4 className="mt-5 text-sm font-semibold text-slate-800">Photos, videos and PDFs</h4>
      <div className="mt-2">
        <JobFiles orderId={order.id} canChange={canChangeFiles} />
      </div>

      <h4 className="mt-5 text-sm font-semibold text-slate-800">Payments</h4>
      {state.status === 'ready' && state.data.payments.length > 0 ? (
        <PaymentList payments={state.data.payments} className="mt-2" verifying={verifying} />
      ) : state.status === 'ready' ? (
        <p className="mt-2 text-sm text-slate-600">No payments recorded yet.</p>
      ) : null}
    </section>
  )
}

function Item({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-2' : undefined}>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-line break-words text-slate-900">{children}</dd>
    </div>
  )
}
