import { Link, useSearchParams } from 'react-router'
import {
  FEEDBACK_RATING_MAX,
  MANAGER_VIEWS,
  MANAGER_VIEW_LABELS,
  formatMYR,
  formatMalaysiaDateTime,
  isLowFeedback,
  ratingStars,
  type ManagerView,
} from '../../domain'
import { useLoad } from '../../lib/useLoad'
import { staffName } from '../../lib/staffStatus'
import { useRefreshOnReturn } from '../../lib/useRefreshOnReturn'
import { BranchFilter, QueueList, QueueTabs, type QueueColumn } from '../order-review'
import { fetchCoveredBranches, fetchManagerOrders, type OrderReview } from '../order-review/api'
import { fetchOpenWarningCounts } from '../supervisor'

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

/** 0005: the latest visit's customer rating; poor ones in red. */
function rating(stars: number | null, workingWell: boolean | null) {
  if (stars === null) return '—'
  const low = isLowFeedback(stars, workingWell ?? true)
  return (
    <span className={low ? 'font-medium text-red-800' : undefined}>
      <span role="img" aria-label={`${stars} out of ${FEEDBACK_RATING_MAX} stars`} className="text-amber-500">
        {ratingStars(stars)}
      </span>
      {workingWell === false ? ' Not working' : ''}
    </span>
  )
}

/** 0009: open supervisor warnings to check before approving. */
function warnings(open: number | undefined) {
  if (!open) return '—'
  return (
    <span className="inline-flex items-center whitespace-nowrap rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-900 ring-1 ring-inset ring-amber-300">
      {open} {open === 1 ? 'warning' : 'warnings'}
    </span>
  )
}

/** The To review list with each job's open warnings (a failed count never hides the list). */
async function loadQueue(view: ManagerView, branch: string | null): Promise<OrderReview[]> {
  const orders = await fetchManagerOrders(view, branch)
  if (view !== 'to_review') return orders
  const counts = await fetchOpenWarningCounts(orders.map((o) => o.id)).catch(() => ({}) as Record<string, number>)
  return orders.map((o) => ({ ...o, open_warnings: counts[o.id] ?? 0 }))
}

const COLUMNS: Record<ManagerView, QueueColumn[]> = {
  to_review: [
    { header: 'Warnings', cell: (o) => warnings(o.open_warnings) },
    { header: 'Technician', cell: (o) => staffName(o.technician_name, o.assigned_technician_id) ?? '—' },
    { header: 'Done', cell: (o) => (o.completed_at ? formatMalaysiaDateTime(o.completed_at) : '—') },
    { header: 'Customer told', cell: (o) => told(o.latest_message_status) },
    { header: 'Final amount', cell: (o) => formatMYR(o.final_amount) },
  ],
  returned: [
    { header: 'Technician', cell: (o) => staffName(o.technician_name, o.assigned_technician_id) ?? '—' },
    { header: 'Returned', cell: (o) => (o.last_returned_at ? formatMalaysiaDateTime(o.last_returned_at) : '—') },
    { header: 'Note', cell: (o) => o.last_return_note ?? '—' },
  ],
  reviewed: [
    { header: 'Technician', cell: (o) => staffName(o.technician_name, o.assigned_technician_id) ?? '—' },
    { header: 'Approved', cell: (o) => (o.reviewed_at ? formatMalaysiaDateTime(o.reviewed_at) : '—') },
    { header: 'By', cell: (o) => staffName(o.reviewed_by_name, o.reviewed_by_id) ?? '—' },
    { header: 'Customer rating', cell: (o) => rating(o.latest_rating, o.latest_working_well) },
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
  const onlyWarnings = view === 'to_review' && params.get('warnings') === '1'
  const [loaded, reload] = useLoad(() => loadQueue(view, branch), `${view}|${branch ?? ''}`)
  const state =
    onlyWarnings && loaded.status === 'ready'
      ? { ...loaded, data: loaded.data.filter((o) => (o.open_warnings ?? 0) > 0) }
      : loaded
  const toggleWarnings = () => {
    const next = new URLSearchParams(params)
    if (onlyWarnings) next.delete('warnings')
    else next.set('warnings', '1')
    return `?${next.toString()}`
  }
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
      {view === 'to_review' ? (
        <Link
          to={toggleWarnings()}
          className={`inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-sky-300 ${onlyWarnings ? 'bg-amber-100 text-amber-900' : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}
        >
          {onlyWarnings ? 'Showing jobs with warnings · Show all' : 'Only jobs with warnings'}
        </Link>
      ) : null}
      <QueueList
        state={state}
        reload={reload}
        columns={COLUMNS[view]}
        link={(o) => `/review/${encodeURIComponent(o.order_no)}`}
        label={MANAGER_VIEW_LABELS[view]}
        empty={onlyWarnings ? 'No jobs with warnings to check.' : EMPTY[view]}
      />
    </div>
  )
}
