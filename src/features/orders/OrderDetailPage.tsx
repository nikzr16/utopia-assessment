import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { Notice } from '../../components/Notice'
import { StatusBadge } from '../../components/StatusBadge'
import { BUTTON, CARD, LINK } from '../../components/styles'
import {
  OPEN_JOB_STATUSES,
  availableTransitions,
  canEditOrder,
  canManageCustomerMessage,
  canRescheduleOrder,
  type OrderStatus,
  type TechnicianMessageKind,
} from '../../domain'
import { CustomerMessagePanel } from '../customer-messages'
import { FeedbackCard } from '../feedback'
import { ReviewOutcome } from '../order-review'
import { fetchOrder, fetchOrderHistory, type OrderDetail, type HistoryEntry } from './api'
import { AssignDialog } from './actions/AssignDialog'
import { CancelDialog } from './actions/CancelDialog'
import { COMPLETION_STATUSES, CompletionSection } from './CompletionSection'
import { RescheduleDialog } from './actions/RescheduleDialog'
import { OrderHistory } from './OrderHistory'
import { OrderSummaryCard } from './OrderSummaryCard'
import { useInactiveStaff } from '../../lib/staffStatus'
import { useLoad } from '../../lib/useLoad'
import { WhatsAppButton } from './WhatsAppButton'

type DialogName = 'assign' | 'cancel' | 'reschedule'

/** Statuses in which the technician still needs the job details. */
const WHATSAPP_STATUSES: readonly OrderStatus[] = ['assigned', 'acknowledged', 'in_progress']

async function loadDetail(orderNo: string): Promise<{ detail: OrderDetail | null; history: HistoryEntry[] }> {
  const detail = await fetchOrder(orderNo)
  const history = detail ? await fetchOrderHistory(detail.order.id) : []
  return { detail, history }
}

/** One order: summary, WhatsApp, actions, history (PRD AC6, AC7, AC9, AC12). */
export function OrderDetailPage() {
  const { orderNo = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const [state, reload] = useLoad(() => loadDetail(orderNo), orderNo)
  const [dialog, setDialog] = useState<DialogName | null>(params.get('action') === 'reschedule' ? 'reschedule' : null)
  const [feedbackKey, setFeedbackKey] = useState(0)
  const inactive = useInactiveStaff()
  const [flash, setFlash] = useState<{ text: string; kind?: TechnicianMessageKind } | null>(() => {
    if (params.get('created')) return { text: 'Order saved.', kind: 'assigned' }
    if (params.get('updated')) return { text: 'Changes saved.', kind: 'updated' }
    return null
  })

  const closeDialog = () => {
    setDialog(null)
    if (params.get('action')) {
      params.delete('action')
      setParams(params, { replace: true })
    }
  }
  const finish = (text: string, kind?: TechnicianMessageKind) => {
    closeDialog()
    setFlash({ text, kind })
    reload()
  }

  if (state.status === 'loading') {
    return (
      <Notice title="Loading…">
        <p>Getting order {orderNo}.</p>
      </Notice>
    )
  }
  if (state.status === 'error') {
    return (
      <Notice tone="error" title="Could not load the order">
        <p>{state.message}</p>
        <button type="button" onClick={reload} className="mt-3 font-medium underline">
          Try again
        </button>
      </Notice>
    )
  }
  const { detail, history } = state.data
  if (!detail) {
    return (
      <Notice tone="error" title="Order not found">
        <p>There is no order {orderNo}.</p>
        <Link to="/orders" className={`${LINK} mt-3 inline-block`}>
          Back to orders
        </Link>
      </Notice>
    )
  }

  const { order, technicianPhone } = detail
  const actions = availableTransitions(order.status, 'admin')
  const canAssign = actions.some((a) => a.to === 'assigned')
  const canCancel = actions.some((a) => a.to === 'cancelled')
  const canEdit = canEditOrder(order.status)
  const canReschedule = canRescheduleOrder(order.status)
  // 0006: a job returned for rework to a technician who has since left.
  const technicianLeft =
    order.assigned_technician_id !== null &&
    inactive.has(order.assigned_technician_id) &&
    OPEN_JOB_STATUSES.includes(order.status)
  const showWhatsApp = order.technician_name !== null && WHATSAPP_STATUSES.includes(order.status) && !technicianLeft
  const justCreated = Boolean(params.get('created'))

  return (
    <div className="space-y-4">
      <div>
        <Link to="/orders" className={`${LINK} text-sm`}>
          ← All orders
        </Link>
      </div>

      {flash ? (
        <div
          role="status"
          className="flex items-start justify-between gap-4 rounded-md border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-900"
        >
          <p>
            {flash.text}
            {flash.kind && showWhatsApp ? ` Send the job to ${order.technician_name} on WhatsApp below.` : ''}
          </p>
          <button type="button" onClick={() => setFlash(null)} className="font-medium underline">
            Dismiss
          </button>
        </div>
      ) : null}

      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm text-slate-600">{justCreated ? 'Order summary' : 'Order'}</p>
          <h2 className="flex flex-wrap items-center gap-3 text-2xl font-semibold">
            {order.order_no} <StatusBadge status={order.status} />
          </h2>
        </div>
        <div className="flex flex-wrap gap-2">
          {canEdit ? (
            <Link to={`/orders/${encodeURIComponent(order.order_no)}/edit`} className={BUTTON.secondary}>
              Edit
            </Link>
          ) : null}
          {canAssign ? (
            <button type="button" onClick={() => setDialog('assign')} className={BUTTON.secondary}>
              {order.assigned_technician_id ? 'Reassign' : 'Assign technician'}
            </button>
          ) : null}
          {canReschedule ? (
            <button type="button" onClick={() => setDialog('reschedule')} className={BUTTON.secondary}>
              Reschedule
            </button>
          ) : null}
          {canCancel ? (
            <button type="button" onClick={() => setDialog('cancel')} className={BUTTON.secondary}>
              Cancel order
            </button>
          ) : null}
        </div>
      </header>

      {technicianLeft ? (
        <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {order.technician_name} is no longer active. {canAssign ? 'Reassign this job to another technician.' : 'It needs another technician.'}
        </p>
      ) : null}

      {showWhatsApp ? (
        <section className={`${CARD} flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`} aria-label="Notify technician">
          <p className="text-sm text-slate-700">
            Assigned to <strong>{order.technician_name}</strong>. WhatsApp opens with the job details filled in; tap
            Send there.
          </p>
          <WhatsAppButton
            order={order}
            technicianPhone={technicianPhone}
            kind={flash?.kind ?? 'assigned'}
            emphasis={Boolean(flash?.kind)}
          />
        </section>
      ) : null}

      <ReviewOutcome orderId={order.id} status={order.status} />

      <CustomerMessagePanel
        orderId={order.id}
        orderStatus={order.status}
        canManage={canManageCustomerMessage(order.status, 'admin', false)}
        onChange={() => {
          reload()
          setFeedbackKey((k) => k + 1)
        }}
      />

      <FeedbackCard orderId={order.id} orderStatus={order.status} role="admin" refreshKey={feedbackKey} />

      <OrderSummaryCard order={order} />
      {COMPLETION_STATUSES.includes(order.status) ? <CompletionSection order={order} /> : null}
      <OrderHistory entries={history} />

      {dialog === 'assign' ? (
        <AssignDialog
          order={order}
          onClose={closeDialog}
          onDone={(name) =>
            finish(
              order.assigned_technician_id ? `Reassigned to ${name}.` : `Assigned to ${name}.`,
              order.assigned_technician_id ? 'reassigned' : 'assigned',
            )
          }
        />
      ) : null}
      {dialog === 'cancel' ? (
        <CancelDialog order={order} onClose={closeDialog} onDone={() => finish('Order cancelled.')} />
      ) : null}
      {dialog === 'reschedule' && canReschedule ? (
        <RescheduleDialog order={order} onClose={closeDialog} onDone={() => finish('New date saved.')} />
      ) : null}
    </div>
  )
}
