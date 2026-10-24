import { Link, useNavigate, useParams } from 'react-router'
import { Notice } from '../../components/Notice'
import { LINK } from '../../components/styles'
import { STATUS_LABELS, canEditOrder, orderToFormValues } from '../../domain'
import { fetchOrder, fetchReferenceData, updateOrder } from './api'
import { OrderForm } from './OrderForm'
import { OrderFormEditor } from './OrderFormEditor'
import { useLoad } from '../../lib/useLoad'

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
  const { detail, reference } = state.data
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
  const { order } = detail
  if (!canEditOrder(order.status)) {
    return (
      <Notice tone="error" title="This order can no longer be edited">
        <p>
          {order.order_no} is {STATUS_LABELS[order.status]}. Details can be edited only while an order is New,
          Assigned or Acknowledged.
        </p>
        <Link to={orderPath} className={`${LINK} mt-3 inline-block`}>
          Back to the order
        </Link>
      </Notice>
    )
  }

  return (
    <div>
      <Link to={orderPath} className={`${LINK} text-sm`}>
        ← Back to {order.order_no}
      </Link>
      <h2 className="mt-2 text-xl font-semibold">Edit {order.order_no}</h2>
      {order.technician_name ? (
        <p className="mt-1 text-sm text-slate-600">{order.technician_name} will be notified of the changes.</p>
      ) : null}
      <div className="mt-4 space-y-4">
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
