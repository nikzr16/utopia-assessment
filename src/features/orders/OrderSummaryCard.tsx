import type { ReactNode } from 'react'
import { CARD, LINK } from '../../components/styles'
import { formatMYR, formatMalaysiaDateTime, formatMyPhone } from '../../domain'
import type { OrderSummary } from './api'
import { staffName, useInactiveStaff } from '../../lib/staffStatus'
import { OrderFormLink } from '../attachments/OrderFormLink'

const PAYMENT_LABELS = { unpaid: 'Unpaid', partial: 'Partly paid', paid: 'Paid' } as const

function Item({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-2' : undefined}>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-line break-words text-sm text-slate-900">{children}</dd>
    </div>
  )
}

/** Everything saved on the order (PRD AC6, AC9). */
export function OrderSummaryCard({ order }: { order: OrderSummary }) {
  useInactiveStaff() // re-render with "(inactive)" tags once known
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <section className={`${CARD} lg:col-span-2`} aria-labelledby="summary-job">
        <h3 id="summary-job" className="text-base font-semibold">
          Order details
        </h3>
        <dl className="mt-3 grid gap-4 sm:grid-cols-2">
          <Item label="Customer">{order.customer_name}</Item>
          <Item label="Phone">
            <a href={`tel:+${order.customer_phone}`} className={LINK}>
              {formatMyPhone(order.customer_phone)}
            </a>
          </Item>
          <Item label="Address" wide>
            {order.customer_address}
          </Item>
          <Item label="Problem description" wide>
            {order.problem_description}
          </Item>
          <Item label="Service type">{order.service_type_name}</Item>
          <Item label="Branch">{order.branch_name}</Item>
          <Item label="Assigned technician">{staffName(order.technician_name, order.assigned_technician_id) ?? 'Not assigned yet'}</Item>
          <Item label="Scheduled">
            {order.scheduled_at ? formatMalaysiaDateTime(order.scheduled_at) : 'Not scheduled yet'}
          </Item>
          <Item label="Admin notes" wide>
            {order.admin_notes ?? '—'}
          </Item>
          <Item label="Created">{formatMalaysiaDateTime(order.created_at)}</Item>
        </dl>
        <OrderFormLink orderId={order.id} />
      </section>

      <section className={CARD} aria-labelledby="summary-money">
        <h3 id="summary-money" className="text-base font-semibold">
          Money
        </h3>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-slate-600">Quoted price</dt>
            <dd className="font-medium">{formatMYR(order.quoted_price)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-600">Extra charges</dt>
            <dd>{formatMYR(order.extra_charges)}</dd>
          </div>
          <div className="flex justify-between gap-4 border-t border-slate-200 pt-2">
            <dt className="font-medium">Final amount</dt>
            <dd className="font-semibold">{formatMYR(order.final_amount)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-600">Paid</dt>
            <dd>{formatMYR(order.amount_paid)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-600">Balance</dt>
            <dd>{formatMYR(order.balance)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-600">Payment status</dt>
            <dd>{PAYMENT_LABELS[order.payment_status]}</dd>
          </div>
        </dl>
      </section>
    </div>
  )
}
