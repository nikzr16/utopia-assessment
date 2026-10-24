import { useState, type ReactNode } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import {
  Banknote,
  Building2,
  CircleCheckBig,
  ClipboardCheck,
  Info,
  Lock,
  RotateCcw,
  SearchX,
  TriangleAlert,
  UserRound,
  Wallet,
} from 'lucide-react'
import { ActionBar } from '../../components/ActionBar'
import { StatusBadge } from '../../components/StatusBadge'
import { BUTTON, CARD } from '../../components/styles'
import { Toast } from '../../components/Toast'
import { BackLink, EmptyState, ErrorState, LoadingState, PageHeader } from '../../components/ui'
import {
  approveBlockReason,
  approveWarningsBlock,
  canConfirmCustomerMessage,
  canRecordPayment,
  closeBlockReason,
  customerOnBehalfMessage,
  formatMYR,
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
import { useWide } from './useWide'

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
 *
 * 0011 Q16: details on the left and an action panel (status, money, main
 * buttons) on the right that stays in view; on a phone one column with the
 * main buttons in the sticky bottom bar.
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
  const wide = useWide()

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
  const { order, history } = state.data
  if (!order) {
    return (
      <EmptyState
        title="Order not found"
        icon={<SearchX className="size-5" />}
        action={
          <Link to={basePath} className={BUTTON.secondary}>
            Back to the list
          </Link>
        }
      >
        <p>
          There is no order {orderNo}
          {role === 'manager' ? ' in the branches you cover' : ''}.
        </p>
      </EmptyState>
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

  const canReview = isManager && order.status === 'job_done'
  const canPay = !isManager && canRecordPayment(order.status, 'finance', false)
  const canClose = !isManager && order.status === 'reviewed'
  const hasButtons = canReview || canPay || canClose
  const paymentPath = `${basePath}/${encodeURIComponent(order.order_no)}/payment`
  const big = wide ? 'min-h-11 w-full' : 'min-h-12 w-full text-base'
  const small = wide ? 'min-h-11 w-full' : 'min-h-11 flex-1 whitespace-nowrap px-3'

  // The main buttons, once: in the side panel on a desktop, in the bottom bar on a phone.
  const buttons = hasButtons ? (
    <>
      {canReview ? (
        <>
          <button
            type="button"
            onClick={() => setDialog('approve')}
            disabled={approveBlocked !== null || warningsBlock !== null}
            className={`${BUTTON.primary} ${big}`}
          >
            <CircleCheckBig aria-hidden="true" />
            Approve job
          </button>
          <div className={wide ? '' : 'flex gap-2'}>
            <button type="button" onClick={() => setDialog('return')} className={`${BUTTON.secondary} ${small}`}>
              <RotateCcw aria-hidden="true" />
              Return for rework
            </button>
          </div>
        </>
      ) : null}
      {canClose ? (
        <button
          type="button"
          onClick={() => setDialog('close')}
          disabled={closeBlocked !== null}
          className={`${BUTTON.primary} ${big}`}
        >
          <Lock aria-hidden="true" />
          Close order
        </button>
      ) : null}
      {canPay ? (
        <div className={wide ? '' : 'flex gap-2'}>
          <Link to={paymentPath} className={`${canClose ? BUTTON.secondary : BUTTON.primary} ${canClose ? small : big}`}>
            <Banknote aria-hidden="true" />
            Record payment
          </Link>
        </div>
      ) : null}
    </>
  ) : null

  const warningsBox = (
    <WarningsBox orderId={order.id} orderStatus={order.status} isManager={isManager} onOpenCount={setOpenWarnings} />
  )
  const returnsCard =
    returns.length > 0 ? (
      <section className={CARD} aria-labelledby="review-returns">
        <h3 id="review-returns" className="flex items-center gap-2 text-base font-semibold text-ink">
          <RotateCcw className="size-4.5 text-warning" aria-hidden="true" />
          Returned {returns.length} time{returns.length === 1 ? '' : 's'}
        </h3>
        {needsAttention(returns.length) ? (
          <p className="mt-2 rounded-lg bg-danger-soft px-3 py-2 text-sm font-medium text-danger-ink">
            Needs attention: returned {NEEDS_ATTENTION_RETURNS} or more times.
          </p>
        ) : null}
        <ol className="mt-3 space-y-3 text-sm">
          {returns.map((r) => (
            <li key={r.id} className="border-l-2 border-warning/50 pl-3">
              <p className="whitespace-pre-line break-words text-ink">{r.note}</p>
              <p className="mt-0.5 text-xs text-ink-faint">
                {tagStaff(r.actor_name, r.actor_id)} · {formatMalaysiaDateTime(r.created_at)}
              </p>
            </li>
          ))}
        </ol>
      </section>
    ) : null
  const messagePanel = (
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
  )
  const summary = <OrderSummaryCard order={order} />
  const completion = (
    <CompletionSection
      order={order}
      canChangeFiles={false}
      toggleVerified={role === 'finance' && !isTerminal(order.status) ? toggleVerified : undefined}
      onPaymentsChange={reload}
    />
  )
  const feedback = (
    <FeedbackCard
      orderId={order.id}
      orderStatus={order.status}
      role={role}
      coversBranch={isManager}
      refreshKey={feedbackKey}
    />
  )

  return (
    <div className="space-y-5">
      <BackLink to={basePath}>Back to the list</BackLink>

      {flash ? (
        <Toast key={flash} onDismiss={() => setFlash(null)}>
          {flash}
        </Toast>
      ) : null}

      <PageHeader
        eyebrow={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1.5">
              <Building2 className="size-4 text-ink-faint" aria-hidden="true" />
              {order.branch_name}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <UserRound className="size-4 text-ink-faint" aria-hidden="true" />
              {tagStaff(order.technician_name, order.assigned_technician_id) ?? 'No technician'}
            </span>
          </span>
        }
        title={order.order_no}
        badge={
          <>
            <StatusBadge status={order.status} />
            <ReturnFlags order={order} />
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        {/* Details. A Manager checks the warnings and the message first; Finance the money. */}
        <div className="min-w-0 space-y-4">
          {isManager ? (
            <>
              {warningsBox}
              {messagePanel}
              {returnsCard}
              {summary}
              {completion}
              {feedback}
            </>
          ) : (
            <>
              {completion}
              {summary}
              {warningsBox}
              {messagePanel}
              {feedback}
              {returnsCard}
            </>
          )}
          <OrderHistory entries={history} />
        </div>

        {/* The action panel: first on a phone, beside the details (and in view) on a wide screen. */}
        <aside className="order-first space-y-4 self-start lg:sticky lg:top-6 lg:order-none">
          <section className={CARD} aria-labelledby="review-actions">
            <h3 id="review-actions" className="flex items-center gap-2 text-base font-semibold text-ink">
              {isManager ? (
                <ClipboardCheck className="size-4.5 text-brand" aria-hidden="true" />
              ) : (
                <Wallet className="size-4.5 text-brand" aria-hidden="true" />
              )}
              {isManager ? 'Review' : 'Payment and close'}
            </h3>
            <div className="mt-3 space-y-3">
              <ReviewOutcomeLines facts={order} />

              <dl className="space-y-1.5 text-sm tabular">
                <MoneyRow label="Final amount">
                  <strong className="font-semibold">{formatMYR(order.final_amount)}</strong>
                </MoneyRow>
                <MoneyRow label="Paid">{formatMYR(order.amount_paid)}</MoneyRow>
              </dl>
              <dl
                className={`flex items-center justify-between rounded-lg px-3 py-2.5 ${
                  order.balance > 0 ? 'bg-warning-soft text-warning-ink' : 'bg-success-soft text-success-ink'
                }`}
              >
                <dt className="text-sm font-medium">Balance</dt>
                <dd className="text-lg font-semibold tabular">{formatMYR(order.balance)}</dd>
              </dl>

              {canReview ? (
                <>
                  {approveBlocked ? (
                    <Callout>{approveBlocked}. Send the customer message (or call) first.</Callout>
                  ) : null}
                  {warningsBlock ? <Callout>{warningsBlock}. See Warnings.</Callout> : null}
                </>
              ) : null}
              {isManager && order.status !== 'job_done' && !order.reviewed_at ? (
                <Note>Nothing to review: the job is not Job Done.</Note>
              ) : null}

              {!isManager ? (
                <>
                  {order.unverified_count > 0 ? (
                    <Callout>
                      {order.unverified_count} receipt{order.unverified_count === 1 ? '' : 's'} to verify under
                      Payments.
                    </Callout>
                  ) : null}
                  {order.status === 'reviewed' && closeBlocked ? <Callout>{closeBlocked}</Callout> : null}
                  {order.status !== 'reviewed' && order.status !== 'closed' ? (
                    <Note>The order can be closed once a Manager has approved it.</Note>
                  ) : null}
                </>
              ) : null}

              {wide && buttons ? <div className="space-y-2 border-t border-line pt-3">{buttons}</div> : null}
            </div>
          </section>
        </aside>
      </div>

      {!wide && buttons ? <ActionBar>{buttons}</ActionBar> : null}

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

function MoneyRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-ink">{children}</dd>
    </div>
  )
}

/** Why a main button is held, next to it. */
function Callout({ children }: { children: ReactNode }) {
  return (
    <p className="flex gap-2 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-warning-ink">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0">{children}</span>
    </p>
  )
}

function Note({ children }: { children: ReactNode }) {
  return (
    <p className="flex gap-2 text-sm text-ink-muted">
      <Info className="mt-0.5 size-4 shrink-0 text-ink-faint" aria-hidden="true" />
      <span className="min-w-0">{children}</span>
    </p>
  )
}

