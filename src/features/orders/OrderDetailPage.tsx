import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import {
  Ban,
  CalendarClock,
  Clock,
  MapPin,
  MessageCircle,
  Pencil,
  SearchX,
  UserRoundPlus,
  UserRoundX,
  Wrench,
} from 'lucide-react'
import { ActionBar } from '../../components/ActionBar'
import { StatusBadge } from '../../components/StatusBadge'
import { BUTTON, CARD, EYEBROW } from '../../components/styles'
import { Toast } from '../../components/Toast'
import {
  OPEN_JOB_STATUSES,
  availableTransitions,
  canEditOrder,
  canManageCustomerMessage,
  canRescheduleOrder,
  formatMalaysiaDateTime,
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
import { OrderMoney, OrderSummaryCard } from './OrderSummaryCard'
import { WarningsBox } from '../supervisor'
import { useInactiveStaff } from '../../lib/staffStatus'
import { useLoad } from '../../lib/useLoad'
import { WhatsAppButton } from './WhatsAppButton'
import { BackLink, EmptyState, ErrorState, LoadingState } from '../../components/ui'

type DialogName = 'assign' | 'cancel' | 'reschedule'

/** Statuses in which the technician still needs the job details. */
const WHATSAPP_STATUSES: readonly OrderStatus[] = ['assigned', 'acknowledged', 'in_progress']

async function loadDetail(orderNo: string): Promise<{ detail: OrderDetail | null; history: HistoryEntry[] }> {
  const detail = await fetchOrder(orderNo)
  const history = detail ? await fetchOrderHistory(detail.order.id) : []
  return { detail, history }
}

/** One order: summary, WhatsApp, actions, history (PRD AC6, AC7, AC9, AC12; 0011 Q16 layout). */
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
    return <LoadingState variant="page" label={`Loading… Getting order ${orderNo}.`} />
  }
  if (state.status === 'error') {
    return (
      <ErrorState title="Could not load the order" onRetry={reload}>
        <p>{state.message}</p>
      </ErrorState>
    )
  }
  const { detail, history } = state.data
  if (!detail) {
    return (
      <EmptyState
        title="Order not found"
        icon={<SearchX className="size-5" />}
        action={
          <Link to="/orders" className={BUTTON.secondary}>
            Back to orders
          </Link>
        }
      >
        <p>There is no order {orderNo}.</p>
      </EmptyState>
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

  const hasActions = canEdit || canAssign || canReschedule || canCancel

  return (
    <div className="space-y-5">
      <BackLink to="/orders">All orders</BackLink>

      {flash ? (
        <Toast key={flash.text} onDismiss={() => setFlash(null)}>
          <p>
            {flash.text}
            {flash.kind && showWhatsApp ? ` Send the job to ${order.technician_name} on WhatsApp.` : ''}
          </p>
        </Toast>
      ) : null}

      <header>
        <p className="text-sm text-ink-muted">{justCreated ? 'Order summary' : 'Order'}</p>
        <h2 className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xl font-semibold tracking-tight text-ink">
          {order.order_no} <StatusBadge status={order.status} />
        </h2>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-muted">
          <span className="inline-flex items-center gap-1.5">
            <Wrench className="size-4 text-ink-faint" aria-hidden="true" />
            {order.service_type_name}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="size-4 text-ink-faint" aria-hidden="true" />
            {order.branch_name}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Clock className="size-4 text-ink-faint" aria-hidden="true" />
            {order.scheduled_at ? formatMalaysiaDateTime(order.scheduled_at) : 'Not scheduled yet'}
          </span>
        </p>
      </header>

      {technicianLeft ? (
        <p
          role="alert"
          className="flex items-start gap-2.5 rounded-xl border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-warning-ink"
        >
          <UserRoundX className="mt-0.5 size-4.5 shrink-0" aria-hidden="true" />
          <span>
            {order.technician_name} is no longer active. {canAssign ? 'Reassign this job to another technician.' : 'It needs another technician.'}
          </span>
        </p>
      ) : null}

      {/* PRD 0011 Q16: details on the left, an action panel on the right that
          stays in view. On a phone: one column, money first, the main buttons
          stuck to the bottom. */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="min-w-0 space-y-5">
          {showWhatsApp ? (
            <section className={`${CARD} ${flash?.kind ? 'border-whatsapp/40' : ''}`} aria-label="Notify technician">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <span
                    aria-hidden="true"
                    className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-whatsapp/15 text-whatsapp"
                  >
                    <MessageCircle className="size-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="font-semibold text-ink">Assigned to {order.technician_name}</p>
                    <p className="text-sm text-ink-muted">WhatsApp opens with the job details filled in; tap Send there.</p>
                  </div>
                </div>
                <WhatsAppButton
                  order={order}
                  technicianPhone={technicianPhone}
                  kind={flash?.kind ?? 'assigned'}
                  emphasis={Boolean(flash?.kind)}
                />
              </div>
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

          {/* 0009: supervisor warnings (Admins read; Managers check them). */}
          <WarningsBox orderId={order.id} orderStatus={order.status} isManager={false} />

          <OrderSummaryCard order={order} showMoney={false} />
          {COMPLETION_STATUSES.includes(order.status) ? <CompletionSection order={order} /> : null}
          <OrderHistory entries={history} />
        </div>

        {/* On a phone this wrapper is display: contents, so the panel can go
            first and the action bar sticks to the bottom over the whole page.
            On a wide screen it is the right column that stays in view. */}
        <div className="contents lg:sticky lg:top-6 lg:block lg:space-y-4 lg:self-start">
          <section className={`${CARD} max-lg:order-first`} aria-labelledby="order-panel-money">
            <h3 id="order-panel-money" className={EYEBROW}>
              Money
            </h3>
            <div className="mt-3">
              <OrderMoney order={order} />
            </div>
          </section>

          {hasActions ? (
            <ActionBar label="Order actions" panelOnWide>
              {canAssign || canEdit ? (
                <div className="flex gap-2">
                  {canAssign ? (
                    <button
                      type="button"
                      onClick={() => setDialog('assign')}
                      className={`${order.assigned_technician_id ? BUTTON.secondary : BUTTON.primary} min-h-11 flex-1`}
                    >
                      <UserRoundPlus aria-hidden="true" />
                      {order.assigned_technician_id ? 'Reassign' : 'Assign technician'}
                    </button>
                  ) : null}
                  {canEdit ? (
                    <Link
                      to={`/orders/${encodeURIComponent(order.order_no)}/edit`}
                      className={`${BUTTON.secondary} min-h-11 ${canAssign ? 'shrink-0' : 'flex-1'}`}
                    >
                      <Pencil aria-hidden="true" />
                      Edit
                    </Link>
                  ) : null}
                </div>
              ) : null}
              {canReschedule || canCancel ? (
                <div className="flex gap-2 lg:flex-col">
                  {canReschedule ? (
                    <button
                      type="button"
                      onClick={() => setDialog('reschedule')}
                      className={`${BUTTON.secondary} min-h-11 flex-1`}
                    >
                      <CalendarClock aria-hidden="true" />
                      Reschedule
                    </button>
                  ) : null}
                  {canCancel ? (
                    <div className="flex flex-1 lg:mt-2 lg:border-t lg:border-line lg:pt-3">
                      <button
                        type="button"
                        onClick={() => setDialog('cancel')}
                        className={`${BUTTON.dangerSoft} min-h-11 flex-1`}
                      >
                        <Ban aria-hidden="true" />
                        Cancel order
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </ActionBar>
          ) : null}
        </div>
      </div>

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
