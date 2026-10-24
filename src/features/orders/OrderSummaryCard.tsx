import { CARD, LINK } from '../../components/styles'
import { initials } from '../../components/shell/UserMenu'
import { Badge, DetailList } from '../../components/ui'
import { formatMYR, formatMalaysiaDateTime, formatMyPhone } from '../../domain'
import type { OrderSummary } from './api'
import { staffName, useInactiveStaff } from '../../lib/staffStatus'
import { OrderFormLink } from '../attachments/OrderFormLink'

const PAYMENT_LABELS = { unpaid: 'Unpaid', partial: 'Partly paid', paid: 'Paid' } as const
const PAYMENT_TONES = { unpaid: 'neutral', partial: 'warning', paid: 'success' } as const

/** The order's money: quoted, extras, final, paid and what is still owed. */
export function OrderMoney({ order }: { order: OrderSummary }) {
  const owed = order.balance > 0 && order.status !== 'cancelled'
  return (
    <dl className="space-y-2 text-sm tabular">
      <div className="flex justify-between gap-4">
        <dt className="text-ink-muted">Quoted price</dt>
        <dd className="text-ink">{formatMYR(order.quoted_price)}</dd>
      </div>
      <div className="flex justify-between gap-4">
        <dt className="text-ink-muted">Extra charges</dt>
        <dd className="text-ink">{formatMYR(order.extra_charges)}</dd>
      </div>
      <div className="flex justify-between gap-4 border-t border-line pt-2">
        <dt className="font-medium text-ink">Final amount</dt>
        <dd className="font-semibold text-ink">{formatMYR(order.final_amount)}</dd>
      </div>
      <div className="flex justify-between gap-4">
        <dt className="text-ink-muted">Paid</dt>
        <dd className="text-ink">{formatMYR(order.amount_paid)}</dd>
      </div>
      <div
        className={`flex items-center justify-between gap-4 ${owed ? '-mx-1 rounded-lg bg-brand-soft px-2.5 py-2 text-brand-ink' : ''}`}
      >
        <dt className={owed ? 'font-medium' : 'text-ink-muted'}>Balance</dt>
        <dd className={owed ? 'text-base font-semibold' : 'text-ink'}>{formatMYR(order.balance)}</dd>
      </div>
      <div className="flex items-center justify-between gap-4">
        <dt className="text-ink-muted">Payment status</dt>
        <dd>
          <Badge tone={PAYMENT_TONES[order.payment_status]}>{PAYMENT_LABELS[order.payment_status]}</Badge>
        </dd>
      </div>
    </dl>
  )
}

/**
 * Everything saved on the order (PRD AC6, AC9). `showMoney={false}` leaves
 * the money out when the page shows it in its own action panel.
 */
export function OrderSummaryCard({ order, showMoney = true }: { order: OrderSummary; showMoney?: boolean }) {
  useInactiveStaff() // re-render with "(inactive)" tags once known
  return (
    <div className={showMoney ? 'grid gap-4 lg:grid-cols-3' : undefined}>
      <section className={`${CARD} ${showMoney ? 'lg:col-span-2' : ''}`} aria-labelledby="summary-job">
        <h3 id="summary-job" className="text-base font-semibold text-ink">
          Order details
        </h3>

        <div className="mt-3 flex items-start gap-3">
          <span
            aria-hidden="true"
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-semibold text-brand-ink"
          >
            {initials(order.customer_name)}
          </span>
          <dl className="min-w-0 space-y-0.5">
            <dt className="sr-only">Customer</dt>
            <dd className="break-words text-base font-semibold text-ink">{order.customer_name}</dd>
            <dt className="sr-only">Phone</dt>
            <dd className="text-sm">
              <a href={`tel:+${order.customer_phone}`} className={`${LINK} tabular`}>
                {formatMyPhone(order.customer_phone)}
              </a>
            </dd>
            <dt className="sr-only">Address</dt>
            <dd className="whitespace-pre-line break-words text-sm text-ink-muted">{order.customer_address}</dd>
          </dl>
        </div>

        <div className="mt-4 border-t border-line pt-4">
          <DetailList
            items={[
              {
                label: 'Problem description',
                value: <span className="whitespace-pre-line">{order.problem_description}</span>,
                wide: true,
              },
              { label: 'Service type', value: order.service_type_name },
              { label: 'Branch', value: order.branch_name },
              {
                label: 'Assigned technician',
                value: staffName(order.technician_name, order.assigned_technician_id) ?? (
                  <span className="text-ink-faint">Not assigned yet</span>
                ),
              },
              {
                label: 'Scheduled',
                value: order.scheduled_at ? (
                  formatMalaysiaDateTime(order.scheduled_at)
                ) : (
                  <span className="text-ink-faint">Not scheduled yet</span>
                ),
              },
              {
                label: 'Admin notes',
                value: order.admin_notes ? (
                  <span className="whitespace-pre-line">{order.admin_notes}</span>
                ) : (
                  <span className="text-ink-faint">—</span>
                ),
                wide: true,
              },
              { label: 'Created', value: formatMalaysiaDateTime(order.created_at) },
            ]}
          />
        </div>
        <OrderFormLink orderId={order.id} />
      </section>

      {showMoney ? (
        <section className={CARD} aria-labelledby="summary-money">
          <h3 id="summary-money" className="text-base font-semibold text-ink">
            Money
          </h3>
          <div className="mt-3">
            <OrderMoney order={order} />
          </div>
        </section>
      ) : null}
    </div>
  )
}
