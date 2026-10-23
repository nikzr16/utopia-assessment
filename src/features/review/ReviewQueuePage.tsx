import { useSearchParams } from 'react-router'
import { MANAGER_VIEWS, MANAGER_VIEW_LABELS, formatMYR, formatMalaysiaDateTime, type ManagerView } from '../../domain'
import { useLoad } from '../../lib/useLoad'
import { useRefreshOnReturn } from '../../lib/useRefreshOnReturn'
import { BranchFilter, QueueList, QueueTabs, type QueueColumn } from '../order-review'
import { fetchCoveredBranches, fetchManagerOrders } from '../order-review/api'

const EMPTY: Record<ManagerView, string> = {
  to_review: 'No jobs waiting for review.',
  returned: 'No jobs out for rework.',
  reviewed: 'No jobs approved in the last 30 days.',
}

function told(status: string | null) {
  if (status === 'not_sent') return <span className="text-amber-900">Not told yet</span>
  if (status === 'told_by_phone') return 'By phone'
  if (status === 'sent') return 'WhatsApp sent'
  return '—'
}

const COLUMNS: Record<ManagerView, QueueColumn[]> = {
  to_review: [
    { header: 'Technician', cell: (o) => o.technician_name ?? '—' },
    { header: 'Done', cell: (o) => (o.completed_at ? formatMalaysiaDateTime(o.completed_at) : '—') },
    { header: 'Customer told', cell: (o) => told(o.latest_message_status) },
    { header: 'Final amount', cell: (o) => formatMYR(o.final_amount) },
  ],
  returned: [
    { header: 'Technician', cell: (o) => o.technician_name ?? '—' },
    { header: 'Returned', cell: (o) => (o.last_returned_at ? formatMalaysiaDateTime(o.last_returned_at) : '—') },
    { header: 'Note', cell: (o) => o.last_return_note ?? '—' },
  ],
  reviewed: [
    { header: 'Technician', cell: (o) => o.technician_name ?? '—' },
    { header: 'Approved', cell: (o) => (o.reviewed_at ? formatMalaysiaDateTime(o.reviewed_at) : '—') },
    { header: 'By', cell: (o) => o.reviewed_by_name ?? '—' },
  ],
}

/**
 * The Manager's review queue (0004 PRD Q1, Q2): To review, Returned and
 * Reviewed, for the branches they cover, with a branch filter.
 */
export function ReviewQueuePage() {
  const [params] = useSearchParams()
  const tab = params.get('tab')
  const view: ManagerView = MANAGER_VIEWS.includes(tab as ManagerView) ? (tab as ManagerView) : 'to_review'
  const branch = params.get('branch') || null
  const [state, reload] = useLoad(() => fetchManagerOrders(view, branch), `${view}|${branch ?? ''}`)
  const [branches] = useLoad(fetchCoveredBranches, 'covered')
  useRefreshOnReturn(reload)

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold">Review queue</h2>
          <p className="text-sm text-slate-600">Finished jobs in your branches.</p>
        </div>
        {branches.status === 'ready' ? <BranchFilter branches={branches.data} allLabel="All my branches" /> : null}
      </div>
      <QueueTabs label="Review queue" views={MANAGER_VIEWS} labels={MANAGER_VIEW_LABELS} current={view} />
      <QueueList
        state={state}
        reload={reload}
        columns={COLUMNS[view]}
        link={(o) => `/review/${encodeURIComponent(o.order_no)}`}
        label={MANAGER_VIEW_LABELS[view]}
        empty={EMPTY[view]}
      />
    </div>
  )
}
