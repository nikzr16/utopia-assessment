import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { Notice } from '../../components/Notice'
import { StatusBadge } from '../../components/StatusBadge'
import { BUTTON, CARD, LINK } from '../../components/styles'
import {
  approveBlockReason,
  approveWarningsBlock,
  canConfirmCustomerMessage,
  canRecordPayment,
  closeBlockReason,
  customerOnBehalfMessage,
  formatMalaysiaDateTime,
  isTerminal,
  needsAttention,
  NEEDS_ATTENTION_RETURNS,
} from '../../domain'
import type { Payment } from '../../lib/orderRecords'
import { useLoad } from '../../lib/useLoad'
import { staffName as tagStaff } from '../../lib/staffStatus'
import { CustomerMessagePanel } from '../customer-messages'
import { FeedbackCard } from '../feedback'
import { CompletionSection } from '../orders/CompletionSection'
import { OrderHistory } from '../orders/OrderHistory'
import { OrderSummaryCard } from '../orders/OrderSummaryCard'
import { WarningsBox } from '../supervisor'
import { ApproveDialog, CloseDialog, ReturnDialog } from './actions'
import {
  fetchOrderHistory,
  fetchOrderReview,
  unverifyPayment,
  verifyPayment,
  type HistoryEntry,
  type OrderReview,
} from './api'
import { ReturnFlags } from './QueueList'
import { ReviewOutcomeLines } from './ReviewOutcome'

export type ReviewRole = 'manager' | 'finance'

type DialogName = 'approve' | 'return' | 'close'

async function loadPage(orderNo: string): Promise<{ order: OrderReview | null; history: HistoryEntry[] }> {
  const order = await fetchOrderReview(orderNo)
  return { order, history: order ? await fetchOrderHistory(order.id) : [] }
}

/**
 * One order for a Manager or Finance (0004 PRD Q7): the same page for both,
 * with the actions of the role. A Manager approves (once the customer was
 * told) or returns for rework, and can send the customer message on behalf of
 * the technician; Finance verifies receipts, records payments, and closes.
 */
export function OrderReviewPage({
  role,
  basePath,
  staffName,
}: {
  role: ReviewRole
  /** The portal's queue path: `/review` or `/finance`. */
  basePath: string
  /** The signed-in person's name, for the Manager's on-behalf message. */
  staffName: string
}) {
  const { orderNo = '' } = useParams()
  const [state, reload] = useLoad(() => loadPage(orderNo), orderNo)
  const [dialog, setDialog] = useState<DialogName | null>(null)
  const [params] = useSearchParams()
  const [flash, setFlash] = useState<string | null>(params.get('paid') ? 'Payment recorded.' : null)
  const [feedbackKey, setFeedbackKey] = useState(0)
  // 0009: open supervisor warnings hold Approve (null while they load).
  const [openWarnings, setOpenWarnings] = useState<number | null>(null)

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
  const { order, history } = state.data
  const back = (
    <Link to={basePath} className={`${LINK} inline-flex min-h-11 items-center text-sm`}>
      ← Back to the list
    </Link>
  )
  if (!order) {
    return (
      <Notice tone="error" title="Order not found">
        <p>
          There is no order {orderNo}
          {role === 'manager' ? ' in the branches you cover' : ''}.
        </p>
        {back}
      </Notice>
    )
  }

  const finish = (text: string) => {
    setDialog(null)
    setFlash(text)
    reload()
  }

  const isManager = role === 'manager'
  const approveBlocked = approveBlockReason(order)
  const warningsBlock = approveWarningsBlock(openWarnings ?? 0)
  const closeBlocked = closeBlockReason(order)
  const onBehalfBody =
    isManager && order.completed_at
      ? customerOnBehalfMessage({
          customerName: order.customer_name,
          orderNo: order.order_no,
          managerName: staffName,
          branchName: order.branch_name,
          technicianName: order.completion_technician_name ?? order.technician_name ?? 'your technician',
          completedAt: order.completed_at,
        })
      : undefined
  const returns = history.filter((h) => h.action === 'returned_for_rework')
  const toggleVerified = async (p: Payment) => {
    if (p.verified_at) await unverifyPayment(p.id)
    else await verifyPayment(p.id)
  }

  return (
    <div className="space-y-4">
      {back}

      {flash ? (
        <div
          role="status"
          className="flex items-start justify-between gap-4 rounded-md border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-900"
        >
          <p>{flash}</p>
          <button type="button" onClick={() => setFlash(null)} className="font-medium underline">
            Dismiss
          </button>
        </div>
      ) : null}

      <header className="flex flex-col gap-2">
        <p className="text-sm text-slate-600">
          {order.branch_name} · {tagStaff(order.technician_name, order.assigned_technician_id) ?? 'No technician'}
        </p>
        <h2 className="flex flex-wrap items-center gap-3 text-2xl font-semibold">
          {order.order_no} <StatusBadge status={order.status} />
          <ReturnFlags order={order} />
        </h2>
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <OrderSummaryCard order={order} />
          <CompletionSection
            order={order}
            canChangeFiles={false}
            toggleVerified={
              role === 'finance' && !isTerminal(order.status) ? toggleVerified : undefined
            }
            onPaymentsChange={reload}
          />
          <OrderHistory entries={history} />
        </div>

        {/* Actions first on a phone; beside the details on a wide screen. */}
        <div className="order-first space-y-4 lg:order-none">
          <section className={CARD} aria-labelledby="review-actions">
            <h3 id="review-actions" className="text-base font-semibold">
              {isManager ? 'Review' : 'Payment and close'}
            </h3>
            <div className="mt-3 space-y-3">
              <ReviewOutcomeLines facts={order} />

              {isManager && order.status === 'job_done' ? (
                <>
                  {approveBlocked ? (
                    <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                      {approveBlocked}. Send the message below (or call) first.
                    </p>
                  ) : null}
                  {warningsBlock ? (
                    <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                      {warningsBlock}. See Warnings below.
                    </p>
                  ) : null}
                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => setDialog('approve')}
                      disabled={approveBlocked !== null || warningsBlock !== null}
                      className={`${BUTTON.primary} min-h-11`}
                    >
                      Approve job
                    </button>
                    <button type="button" onClick={() => setDialog('return')} className={`${BUTTON.secondary} min-h-11`}>
                      Return for rework
                    </button>
                  </div>
                </>
              ) : null}
              {isManager && order.status !== 'job_done' && !order.reviewed_at ? (
                <p className="text-sm text-slate-600">Nothing to review: the job is not Job Done.</p>
              ) : null}

              {!isManager ? (
                <>
                  {order.unverified_count > 0 ? (
                    <p className="text-sm text-amber-950">
                      {order.unverified_count} receipt{order.unverified_count === 1 ? '' : 's'} to verify under
                      Payments.
                    </p>
                  ) : null}
                  {order.status === 'reviewed' && closeBlocked ? (
                    <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                      {closeBlocked}
                    </p>
                  ) : null}
                  {order.status !== 'reviewed' && order.status !== 'closed' ? (
                    <p className="text-sm text-slate-600">The order can be closed once a Manager has approved it.</p>
                  ) : null}
                  <div className="flex flex-col gap-2">
                    {canRecordPayment(order.status, 'finance', false) ? (
                      <Link
                        to={`${basePath}/${encodeURIComponent(order.order_no)}/payment`}
                        className={`${BUTTON.secondary} min-h-11`}
                      >
                        Record payment
                      </Link>
                    ) : null}
                    {order.status === 'reviewed' ? (
                      <button
                        type="button"
                        onClick={() => setDialog('close')}
                        disabled={closeBlocked !== null}
                        className={`${BUTTON.primary} min-h-11`}
                      >
                        Close order
                      </button>
                    ) : null}
                  </div>
                </>
              ) : null}
            </div>
          </section>

          <WarningsBox
            orderId={order.id}
            orderStatus={order.status}
            isManager={isManager}
            onOpenCount={setOpenWarnings}
          />

          {returns.length > 0 ? (
            <section className={CARD} aria-labelledby="review-returns">
              <h3 id="review-returns" className="text-base font-semibold">
                Returned {returns.length} time{returns.length === 1 ? '' : 's'}
              </h3>
              {needsAttention(returns.length) ? (
                <p className="mt-1 text-sm text-red-800">
                  Needs attention: returned {NEEDS_ATTENTION_RETURNS} or more times.
                </p>
              ) : null}
              <ol className="mt-3 space-y-3 text-sm">
                {returns.map((r) => (
                  <li key={r.id} className="border-l-2 border-amber-300 pl-3">
                    <p className="break-words">{r.note}</p>
                    <p className="text-xs text-slate-500">
                      {tagStaff(r.actor_name, r.actor_id)} · {formatMalaysiaDateTime(r.created_at)}
                    </p>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          <CustomerMessagePanel
            orderId={order.id}
            orderStatus={order.status}
            canManage={isManager && canConfirmCustomerMessage(order.status, 'manager', true)}
            onBehalfBody={onBehalfBody}
            canEdit={false}
            onChange={() => {
              reload()
              setFeedbackKey((k) => k + 1)
            }}
          />

          <FeedbackCard
            orderId={order.id}
            orderStatus={order.status}
            role={role}
            coversBranch={isManager}
            refreshKey={feedbackKey}
          />
        </div>
      </div>

      {dialog === 'approve' ? (
        <ApproveDialog
          order={order}
          onClose={() => setDialog(null)}
          onDone={() => finish('Approved. Finance and the technician have been told.')}
        />
      ) : null}
      {dialog === 'return' ? (
        <ReturnDialog
          order={order}
          onClose={() => setDialog(null)}
          onDone={() => finish('Returned for rework. The technician has your note.')}
        />
      ) : null}
      {dialog === 'close' ? (
        <CloseDialog order={order} onClose={() => setDialog(null)} onDone={() => finish('Order closed.')} />
      ) : null}
    </div>
  )
}
