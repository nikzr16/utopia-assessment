import { Link, useNavigate, useParams } from 'react-router'
import { Lock, SearchX } from 'lucide-react'
import { StatusBadge } from '../../components/StatusBadge'
import { BUTTON } from '../../components/styles'
import { STATUS_LABELS, canEditOrder, orderToFormValues } from '../../domain'
import { fetchOrder, fetchReferenceData, updateOrder } from './api'
import { OrderForm } from './OrderForm'
import { OrderFormEditor } from './OrderFormEditor'
import { useLoad } from '../../lib/useLoad'
import { BackLink, EmptyState, ErrorState, LoadingState, PageHeader } from '../../components/ui'

async function loadForEdit(orderNo: string) {
  const [detail, reference] = await Promise.all([fetchOrder(orderNo), fetchReferenceData()])
  return { detail, reference }
}

/** Edit an order's details (PRD Q6, AC10). Technician and status change elsewhere. */
export function EditOrderPage() {
  const { orderNo = '' } = useParams()
  const navigate = useNavigate()
  const [state, reload] = useLoad(() => loadForEdit(orderNo), orderNo)
  const orderPath = `/orders/${encodeURIComponent(orderNo)}`

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
  const { detail, reference } = state.data
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
  const { order } = detail
  if (!canEditOrder(order.status)) {
    return (
      <EmptyState
        title="This order can no longer be edited"
        icon={<Lock className="size-5" />}
        action={
          <Link to={orderPath} className={BUTTON.secondary}>
            Back to the order
          </Link>
        }
      >
        <p>
          {order.order_no} is {STATUS_LABELS[order.status]}. Details can be edited only while an order is New,
          Assigned or Acknowledged.
        </p>
      </EmptyState>
    )
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="space-y-2">
        <BackLink to={orderPath}>Back to {order.order_no}</BackLink>
        <PageHeader
          title={`Edit ${order.order_no}`}
          badge={<StatusBadge status={order.status} />}
          description={order.technician_name ? `${order.technician_name} will be notified of the changes.` : undefined}
        />
      </div>
      <div className="space-y-5">
        <OrderFormEditor orderId={order.id} />
        <OrderForm
          // A fresh form whenever the order is reloaded (e.g. after a conflict).
          key={order.updated_at}
          mode="edit"
          orderNo={order.order_no}
          initial={orderToFormValues(order)}
          reference={reference}
          technicianName={order.technician_name}
          lockedScheduledAt={order.scheduled_at}
          rescheduleHref={`${orderPath}?action=reschedule`}
          submitLabel="Save changes"
          onCancel={() => navigate(orderPath)}
          onSubmit={async (input) => {
            try {
              // An existing date is read-only here (plan P6): send it back unchanged.
              await updateOrder(order.id, order.updated_at, {
                ...input,
                scheduledAt: order.scheduled_at ?? input.scheduledAt,
              })
              navigate(`${orderPath}?updated=1`)
              return null
            } catch (e) {
              const message = (e as Error).message
              return message.includes('changed by someone else') ? `${message} Your edits are still in the form.` : message
            }
          }}
        />
      </div>
    </div>
  )
}
