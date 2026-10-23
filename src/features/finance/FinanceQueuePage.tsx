import { useSearchParams } from 'react-router'
import { FINANCE_VIEWS, FINANCE_VIEW_LABELS, formatMYR, formatMalaysiaDateTime, type FinanceView } from '../../domain'
import { useLoad } from '../../lib/useLoad'
import { useRefreshOnReturn } from '../../lib/useRefreshOnReturn'
import { BranchFilter, QueueList, QueueTabs, type QueueColumn } from '../order-review'
import { fetchBranches, fetchFinanceOrders } from '../order-review/api'

const EMPTY: Record<FinanceView, string> = {
  not_reviewed: 'No payments on jobs waiting for review.',
  ready: 'Nothing ready to close.',
  outstanding: 'No reviewed orders with money owing.',
  closed: 'No orders closed in the last 30 days.',
}

const MONEY: QueueColumn[] = [
  { header: 'Final amount', cell: (o) => formatMYR(o.final_amount) },
  { header: 'Paid', cell: (o) => formatMYR(o.amount_paid) },
  { header: 'Balance', cell: (o) => formatMYR(o.balance) },
  {
    header: 'Receipts to verify',
    cell: (o) => (o.unverified_count > 0 ? <span className="font-medium text-amber-900">{o.unverified_count}</span> : '—'),
  },
]

const APPROVED: QueueColumn = {
  header: 'Approved',
  cell: (o) => (o.reviewed_at ? formatMalaysiaDateTime(o.reviewed_at) : '—'),
}

const COLUMNS: Record<FinanceView, QueueColumn[]> = {
  not_reviewed: MONEY,
  ready: [...MONEY, APPROVED],
  outstanding: [...MONEY, APPROVED],
  closed: [
    { header: 'Final amount', cell: (o) => formatMYR(o.final_amount) },
    { header: 'Closed', cell: (o) => (o.closed_at ? formatMalaysiaDateTime(o.closed_at) : '—') },
    { header: 'By', cell: (o) => o.closed_by_name ?? '—' },
  ],
}

/**
 * Finance's queue (0004 PRD Q6): every branch, with a branch filter, in four
 * tabs: Not yet reviewed, Ready to close, Payment outstanding, Closed.
 */
export function FinanceQueuePage() {
  const [params] = useSearchParams()
  const tab = params.get('tab')
  const view: FinanceView = FINANCE_VIEWS.includes(tab as FinanceView) ? (tab as FinanceView) : 'ready'
  const branch = params.get('branch') || null
  const [state, reload] = useLoad(() => fetchFinanceOrders(view, branch), `${view}|${branch ?? ''}`)
  const [branches] = useLoad(fetchBranches, 'branches')
  useRefreshOnReturn(reload)

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold">Payments and closing</h2>
          <p className="text-sm text-slate-600">Every branch.</p>
        </div>
        {branches.status === 'ready' ? <BranchFilter branches={branches.data} allLabel="All branches" /> : null}
      </div>
      <QueueTabs label="Finance queue" views={FINANCE_VIEWS} labels={FINANCE_VIEW_LABELS} current={view} />
      <QueueList
        state={state}
        reload={reload}
        columns={COLUMNS[view]}
        link={(o) => `/finance/${encodeURIComponent(o.order_no)}`}
        label={FINANCE_VIEW_LABELS[view]}
        empty={EMPTY[view]}
      />
    </div>
  )
}
