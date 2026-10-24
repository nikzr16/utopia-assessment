import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Notice } from '../../components/Notice'
import { BUTTON } from '../../components/styles'
import { EMPTY_ORDER_FORM, type OrderFormValues } from '../../domain'
import { saveOrderForm } from '../attachments/api'
import { createOrder, fetchReferenceData } from './api'
import { OrderForm } from './OrderForm'
import { ReadFromPhoto, type KeptForm } from './ReadFromPhoto'
import { useLoad } from '../../lib/useLoad'

/**
 * New order (brief Module 1). The branch defaults to the Admin's own (PRD Q2).
 * 0009: "Read from photo" fills the form from a paper order form; the file is
 * uploaded as the order's Order form only after the order is saved.
 */
export function NewOrderPage({ adminBranchName }: { adminBranchName: string | null }) {
  const navigate = useNavigate()
  const [reference, reload] = useLoad(fetchReferenceData, 'reference')
  const [kept, setKept] = useState<KeptForm | null>(null)
  const [fill, setFill] = useState<{ values: Partial<OrderFormValues>; key: number }>({ values: {}, key: 0 })
  // The order was saved but its form file was not attached (Try again keeps the file).
  const [unattached, setUnattached] = useState<{ id: string; orderNo: string; message: string } | null>(null)

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

  const openOrder = (orderNo: string) => navigate(`/orders/${encodeURIComponent(orderNo)}?created=1`)
  const attach = async (order: { id: string; orderNo: string }, form: KeptForm) => {
    try {
      await saveOrderForm(order.id, form.body, form.mime, form.name, null)
      openOrder(order.orderNo)
    } catch (e) {
      setUnattached({ ...order, message: (e as Error).message })
    }
  }

  if (unattached && kept) {
    return (
      <Notice tone="error" title={`Order ${unattached.orderNo} is saved, but the form photo was not attached`}>
        <p>{unattached.message}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => void attach(unattached, kept)} className={`${BUTTON.primary} min-h-11`}>
            Try again
          </button>
          <Link to={`/orders/${encodeURIComponent(unattached.orderNo)}?created=1`} className={`${BUTTON.secondary} min-h-11`}>
            Open the order without it
          </Link>
        </div>
      </Notice>
    )
  }

  const ownBranch = reference.data.branches.find((b) => b.name === adminBranchName)
  return (
    <div>
      <h2 className="text-xl font-semibold">New order</h2>
      <p className="mt-1 text-sm text-slate-600">The order number is created when you save.</p>
      <div className="mt-4 space-y-4">
        <ReadFromPhoto
          kept={kept}
          onKeep={setKept}
          onFilled={(values) => setFill((f) => ({ values, key: f.key + 1 }))}
        />
        <OrderForm
          mode="create"
          initial={{ ...EMPTY_ORDER_FORM, branchId: ownBranch?.id ?? '' }}
          reference={reference.data}
          submitLabel="Save order"
          fill={fill}
          onCancel={() => navigate('/orders')}
          onSubmit={async (input) => {
            let order: { id: string; orderNo: string }
            try {
              order = await createOrder(input)
            } catch (e) {
              return (e as Error).message
            }
            if (kept) await attach(order, kept)
            else openOrder(order.orderNo)
            return null
          }}
        />
      </div>
    </div>
  )
}
