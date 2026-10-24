import type { ReactNode } from 'react'
import { useSearchParams } from 'react-router'
import { Banknote, CircleCheckBig, Lock, ReceiptText } from 'lucide-react'
import { Badge, PageHeader } from '../../components/ui'
import { FINANCE_VIEWS, FINANCE_VIEW_LABELS, formatMYR, formatMalaysiaDateTime, type FinanceView } from '../../domain'
import { useLoad } from '../../lib/useLoad'
import { staffName } from '../../lib/staffStatus'
import { useRefreshOnReturn } from '../../lib/useRefreshOnReturn'
import { BranchFilter, QueueList, QueueTabs, type QueueColumn } from '../order-review'
import { fetchBranches, fetchFinanceOrders } from '../order-review/api'

const EMPTY: Record<FinanceView, string> = {
  not_reviewed: 'No payments on jobs waiting for review.',
  ready: 'Nothing ready to close.',
  outstanding: 'No reviewed orders with money owing.',
  closed: 'No orders closed in the last 30 days.',
}

const EMPTY_ICON: Record<FinanceView, ReactNode> = {
  not_reviewed: <ReceiptText className="size-5" />,
  ready: <CircleCheckBig className="size-5" />,
  outstanding: <Banknote className="size-5" />,
  closed: <Lock className="size-5" />,
}

const MONEY: QueueColumn[] = [
  { header: 'Final amount', cell: (o) => formatMYR(o.final_amount) },
  { header: 'Paid', cell: (o) => formatMYR(o.amount_paid), hideOnPhone: true },
  {
    header: 'Balance',
    cell: (o) => (o.balance > 0 ? <span className="font-medium text-ink">{formatMYR(o.balance)}</span> : formatMYR(o.balance)),
  },
  {
    header: 'Receipts to verify',
    cell: (o) => (o.unverified_count > 0 ? <Badge tone="warning">{o.unverified_count}</Badge> : '—'),
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
    { header: 'By', cell: (o) => staffName(o.closed_by_name, o.closed_by_id) ?? '—' },
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
    <div className="space-y-5">
      <PageHeader
        title="Payments and closing"
        description="Every branch."
        actions={branches.status === 'ready' ? <BranchFilter branches={branches.data} allLabel="All branches" /> : null}
      />
      <QueueTabs label="Finance queue" views={FINANCE_VIEWS} labels={FINANCE_VIEW_LABELS} current={view} />
      <QueueList
        state={state}
        reload={reload}
        columns={COLUMNS[view]}
        link={(o) => `/finance/${encodeURIComponent(o.order_no)}`}
        label={FINANCE_VIEW_LABELS[view]}
        empty={EMPTY[view]}
        emptyIcon={EMPTY_ICON[view]}
      />
    </div>
  )
}
