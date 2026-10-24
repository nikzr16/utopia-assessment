import { Link, useNavigate, useParams } from 'react-router'
import { Ban, SearchX } from 'lucide-react'
import { BUTTON } from '../../components/styles'
import { EmptyState, ErrorState, LoadingState } from '../../components/ui'
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
      <div className="mx-auto max-w-2xl">
        <LoadingState variant="cards" count={2} label={`Loading… Getting order ${orderNo}.`} />
      </div>
    )
  }
  if (state.status === 'error') {
    return (
      <ErrorState title="Could not load the order" onRetry={reload}>
        <p>{state.message}</p>
      </ErrorState>
    )
  }
  if (!state.data || !canRecordPayment(state.data.status, 'finance', false)) {
    return (
      <EmptyState
        title={state.data ? 'Payments cannot be recorded now' : 'Order not found'}
        icon={state.data ? <Ban className="size-5" /> : <SearchX className="size-5" />}
        action={
          <Link to={state.data ? orderPath : '/finance'} className={BUTTON.secondary}>
            {state.data ? 'Back to the order' : 'Back to the list'}
          </Link>
        }
      >
        <p>
          {state.data
            ? 'Payments are recorded while the order is In Progress, Job Done or Reviewed.'
            : `There is no order ${orderNo}.`}
        </p>
      </EmptyState>
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
