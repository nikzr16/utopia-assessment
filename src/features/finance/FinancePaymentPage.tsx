import { Link, useNavigate, useParams } from 'react-router'
import { Notice } from '../../components/Notice'
import { LINK } from '../../components/styles'
import { canRecordPayment } from '../../domain'
import { useLoad } from '../../lib/useLoad'
import type { PhotoCodec } from '../attachments/resize'
import { fetchOrderReview, recordPayment } from '../order-review/api'
import { PaymentForm } from '../payments'

/**
 * Finance records a payment that came to the office (0004 PRD Q7) with the
 * same form technicians use: balance pre-filled, receipt for non-cash.
 */
export function FinancePaymentPage({ codec, newId }: { codec?: PhotoCodec; newId?: () => string } = {}) {
  const { orderNo = '' } = useParams()
  const navigate = useNavigate()
  const [state, reload] = useLoad(() => fetchOrderReview(orderNo), orderNo)
  const orderPath = `/finance/${encodeURIComponent(orderNo)}`

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
        <button type="button" onClick={reload} className="mt-3 min-h-11 font-medium underline">
          Try again
        </button>
      </Notice>
    )
  }
  if (!state.data || !canRecordPayment(state.data.status, 'finance', false)) {
    return (
      <Notice tone="error" title={state.data ? 'Payments cannot be recorded now' : 'Order not found'}>
        <p>
          {state.data
            ? 'Payments are recorded while the order is In Progress, Job Done or Reviewed.'
            : `There is no order ${orderNo}.`}
        </p>
        <Link to={state.data ? orderPath : '/finance'} className={`${LINK} mt-3 inline-block`}>
          {state.data ? 'Back to the order' : 'Back to the list'}
        </Link>
      </Notice>
    )
  }
  return (
    <div className="mx-auto max-w-2xl">
      <PaymentForm
        order={state.data}
        backTo={orderPath}
        backLabel="Back to the order"
        record={recordPayment}
        onDone={() => navigate(`${orderPath}?paid=1`)}
        codec={codec}
        newId={newId ?? (() => crypto.randomUUID())}
      />
    </div>
  )
}
