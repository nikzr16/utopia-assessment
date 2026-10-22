import { useNavigate } from 'react-router'
import { Notice } from '../../components/Notice'
import { EMPTY_ORDER_FORM } from '../../domain'
import { createOrder, fetchReferenceData } from './api'
import { OrderForm } from './OrderForm'
import { useLoad } from './useLoad'

/** New order (brief Module 1). The branch defaults to the Admin's own (PRD Q2). */
export function NewOrderPage({ adminBranchName }: { adminBranchName: string | null }) {
  const navigate = useNavigate()
  const [reference, reload] = useLoad(fetchReferenceData, 'reference')

  if (reference.status === 'loading') {
    return (
      <Notice title="Loading…">
        <p>Getting service types and technicians.</p>
      </Notice>
    )
  }
  if (reference.status === 'error') {
    return (
      <Notice tone="error" title="Could not load the form">
        <p>{reference.message}</p>
        <button type="button" onClick={reload} className="mt-3 font-medium underline">
          Try again
        </button>
      </Notice>
    )
  }

  const ownBranch = reference.data.branches.find((b) => b.name === adminBranchName)
  return (
    <div>
      <h2 className="text-xl font-semibold">New order</h2>
      <p className="mt-1 text-sm text-slate-600">The order number is created when you save.</p>
      <div className="mt-4">
        <OrderForm
          mode="create"
          initial={{ ...EMPTY_ORDER_FORM, branchId: ownBranch?.id ?? '' }}
          reference={reference.data}
          submitLabel="Save order"
          onCancel={() => navigate('/orders')}
          onSubmit={async (input) => {
            try {
              const orderNo = await createOrder(input)
              navigate(`/orders/${encodeURIComponent(orderNo)}?created=1`)
              return null
            } catch (e) {
              return (e as Error).message
            }
          }}
        />
      </div>
    </div>
  )
}
