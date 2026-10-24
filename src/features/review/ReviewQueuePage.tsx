import type { ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { ClipboardCheck, RotateCcw, ShieldCheck, TriangleAlert, X } from 'lucide-react'
import { Badge, PageHeader } from '../../components/ui'
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

const EMPTY_ICON: Record<ManagerView, ReactNode> = {
  to_review: <ClipboardCheck className="size-5" />,
  returned: <RotateCcw className="size-5" />,
  reviewed: <ShieldCheck className="size-5" />,
}

function told(status: string | null) {
  if (status === 'not_sent') return <Badge tone="warning">Not told yet</Badge>
  if (status === 'told_by_phone') return 'By phone'
  if (status === 'sent') return 'WhatsApp sent'
  return '—'
}

/** 0005: the latest visit's customer rating; poor ones in red. */
function rating(stars: number | null, workingWell: boolean | null) {
  if (stars === null) return '—'
  const low = isLowFeedback(stars, workingWell ?? true)
  return (
    <span className={low ? 'font-medium text-danger-ink' : undefined}>
      <span role="img" aria-label={`${stars} out of ${FEEDBACK_RATING_MAX} stars`} className="text-warning">
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
    <Badge tone="warning">
      <TriangleAlert className="size-3.5" aria-hidden="true" />
      {open} {open === 1 ? 'warning' : 'warnings'}
    </Badge>
  )
}

/** The To review list with each job's open warnings (a failed count never hides the list). */
async function loadQueue(view: ManagerView, branch: string | null): Promise<OrderReview[]> {
  const orders = await fetchManagerOrders(view, branch)
  if (view !== 'to_review') return orders
  const counts = await fetchOpenWarningCounts(orders.map((o) => o.id)).catch(() => ({}) as Record<string, number>)
  return orders.map((o) => ({ ...o, open_warnings: counts[o.id] ?? 0 }))
}

const technician: QueueColumn = {
  header: 'Technician',
  cell: (o) => staffName(o.technician_name, o.assigned_technician_id) ?? '—',
}

const COLUMNS: Record<ManagerView, QueueColumn[]> = {
  to_review: [
    { header: 'Warnings', cell: (o) => warnings(o.open_warnings) },
    technician,
    { header: 'Done', wrap: true, cell: (o) => (o.completed_at ? formatMalaysiaDateTime(o.completed_at) : '—') },
    { header: 'Customer told', wrap: true, cell: (o) => told(o.latest_message_status) },
    { header: 'Final amount', cell: (o) => formatMYR(o.final_amount) },
  ],
  returned: [
    technician,
    { header: 'Returned', wrap: true, cell: (o) => (o.last_returned_at ? formatMalaysiaDateTime(o.last_returned_at) : '—') },
    { header: 'Note', wrap: true, cell: (o) => o.last_return_note ?? '—' },
  ],
  reviewed: [
    technician,
    { header: 'Approved', wrap: true, cell: (o) => (o.reviewed_at ? formatMalaysiaDateTime(o.reviewed_at) : '—') },
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
    <div className="space-y-5">
      <PageHeader
        title="Review queue"
        description="Finished jobs in your branches."
        actions={branches.status === 'ready' ? <BranchFilter branches={branches.data} allLabel="All my branches" /> : null}
      />
      <QueueTabs label="Review queue" views={MANAGER_VIEWS} labels={MANAGER_VIEW_LABELS} current={view} />
      {view === 'to_review' ? (
        <Link
          to={toggleWarnings()}
          className={`inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus md:min-h-9 ${
            onlyWarnings
              ? 'border border-warning/40 bg-warning-soft text-warning-ink'
              : 'border border-line-strong bg-surface text-ink-muted hover:bg-sunken hover:text-ink'
          }`}
        >
          {onlyWarnings ? (
            <X className="size-4 shrink-0" aria-hidden="true" />
          ) : (
            <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
          )}
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
        emptyIcon={EMPTY_ICON[view]}
      />
    </div>
  )
}
