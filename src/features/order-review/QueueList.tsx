import type { ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Building2, ChevronRight, Inbox } from 'lucide-react'
import { StatusBadge } from '../../components/StatusBadge'
import { INPUT, LINK, TABLE } from '../../components/styles'
import { Badge, EmptyState, ErrorState, LoadingState, SegmentedTabs } from '../../components/ui'
import { NEEDS_ATTENTION_RETURNS, needsAttention } from '../../domain'
import type { LoadState } from '../../lib/useLoad'
import { useInactiveStaff } from '../../lib/staffStatus'
import type { BranchOption, OrderReview } from './api'

export interface QueueColumn {
  header: string
  /** Dates and notes may wrap (two lines at most for a date); everything else stays on one line. */
  wrap?: boolean
  cell: (order: OrderReview) => ReactNode
  /** Leave this fact out of the compact phone card (the table still shows it). */
  hideOnPhone?: boolean
}

/** Tabs kept in `?tab=` so a reload or the Back button keeps the place. */
export function QueueTabs<V extends string>({
  label,
  views,
  labels,
  current,
}: {
  label: string
  views: readonly V[]
  labels: Record<V, string>
  current: V
}) {
  const [params] = useSearchParams()
  const to = (view: V) => {
    const next = new URLSearchParams(params)
    next.set('tab', view)
    return `?${next.toString()}`
  }
  return (
    <SegmentedTabs
      label={label}
      items={views.map((view) => ({ key: view, to: to(view), label: labels[view], active: view === current }))}
    />
  )
}

/** Branch filter kept in `?branch=`; hidden when there is only one branch to choose. */
export function BranchFilter({ branches, allLabel }: { branches: BranchOption[]; allLabel: string }) {
  const [params, setParams] = useSearchParams()
  if (branches.length < 2) return null
  return (
    <div className="w-full sm:w-64">
      <label htmlFor="queue-branch" className="block text-xs font-medium text-ink-muted">
        Branch
      </label>
      <select
        id="queue-branch"
        value={params.get('branch') ?? ''}
        onChange={(e) => {
          const next = new URLSearchParams(params)
          if (e.target.value) next.set('branch', e.target.value)
          else next.delete('branch')
          setParams(next, { replace: true })
        }}
        className={`${INPUT} mt-1`}
      >
        <option value="">{allLabel}</option>
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
    </div>
  )
}

/** "Resubmitted" and "Needs attention" flags (0004 PRD Q2, Q11). */
export function ReturnFlags({ order }: { order: OrderReview }) {
  if (order.return_count === 0) return null
  return (
    <span className="inline-flex flex-wrap gap-1">
      {needsAttention(order.return_count) ? (
        <span title={`Returned ${NEEDS_ATTENTION_RETURNS} or more times`}>
          <Badge tone="danger">Needs attention</Badge>
        </span>
      ) : null}
      <Badge>Returned {order.return_count}×</Badge>
    </span>
  )
}

/**
 * One tab of a queue: a table on desktop, compact cards on a phone (0004 PRD
 * Q10; 0011 Q11). Each row links to the order page.
 */
export function QueueList({
  state,
  reload,
  columns,
  link,
  label,
  empty,
  emptyIcon,
}: {
  state: LoadState<OrderReview[]>
  reload: () => void
  columns: QueueColumn[]
  link: (order: OrderReview) => string
  label: string
  empty: string
  emptyIcon?: ReactNode
}) {
  useInactiveStaff() // re-render with "(inactive)" tags once known
  if (state.status === 'loading') {
    return <LoadingState variant="rows" count={5} label="Loading…" />
  }
  if (state.status === 'error') {
    return (
      <ErrorState title="Could not load the list" onRetry={reload}>
        <p>{state.message}</p>
      </ErrorState>
    )
  }
  if (state.data.length === 0) {
    return <EmptyState title={empty} icon={emptyIcon ?? <Inbox className="size-5" />} />
  }
  const rows = state.data
  const phoneColumns = columns.filter((c) => !c.hideOnPhone)
  return (
    <>
      {/* Phone widths: compact cards, the whole card opens the order. */}
      <ul className="grid gap-3 md:grid-cols-2 xl:hidden" aria-label={label}>
        {rows.map((order) => (
          <li key={order.id}>
            <Link
              to={link(order)}
              className="group block rounded-xl border border-line bg-surface p-4 shadow-card transition-colors hover:border-brand/40 active:bg-sunken"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-xs font-medium tracking-wide text-ink-faint">{order.order_no}</span>
                <StatusBadge status={order.status} />
              </div>
              <div className="mt-1 flex items-center justify-between gap-3">
                <p className="min-w-0 break-words text-base font-semibold text-ink">{order.customer_name}</p>
                <ChevronRight
                  className="size-5 shrink-0 text-ink-faint transition-transform group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </div>
              <p className="mt-0.5 flex items-center gap-1.5 text-sm text-ink-muted">
                <Building2 className="size-4 shrink-0 text-ink-faint" aria-hidden="true" />
                {order.branch_name}
              </p>
              {order.return_count > 0 ? (
                <div className="mt-2">
                  <ReturnFlags order={order} />
                </div>
              ) : null}
              {phoneColumns.length > 0 ? (
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-line pt-3 text-sm">
                  {phoneColumns.map((c) => (
                    <div key={c.header} className="min-w-0">
                      <dt className="text-xs text-ink-faint">{c.header}</dt>
                      <dd className="break-words text-ink tabular">{c.cell(order)}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>

      {/* Wider screens: a table. */}
      <div className={`${TABLE.wrap} hidden xl:block`}>
        <div className="overflow-x-auto">
          <table className={TABLE.table} aria-label={label}>
            <thead className={TABLE.head}>
              <tr>
                <th scope="col" className={TABLE.th}>
                  Order
                </th>
                <th scope="col" className={TABLE.th}>
                  Customer
                </th>
                {columns.map((c) => (
                  <th key={c.header} scope="col" className={TABLE.th}>
                    {c.header}
                  </th>
                ))}
                <th scope="col" className={TABLE.th}>
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((order) => (
                <tr key={order.id} className={TABLE.row}>
                  <td className={`${TABLE.td} whitespace-nowrap`}>
                    <Link to={link(order)} className={LINK}>
                      {order.order_no}
                    </Link>
                    <div className="mt-0.5 text-xs text-ink-faint">{order.branch_name}</div>
                  </td>
                  <td className={TABLE.td}>
                    <div className="font-medium">{order.customer_name}</div>
                    {order.return_count > 0 ? (
                      <div className="mt-1">
                        <ReturnFlags order={order} />
                      </div>
                    ) : null}
                  </td>
                  {columns.map((c) => (
                    <td key={c.header} className={`${TABLE.td} tabular ${c.wrap ? 'min-w-32' : 'whitespace-nowrap'}`}>
                      {c.cell(order)}
                    </td>
                  ))}
                  <td className={`${TABLE.td} min-w-36 [&>span]:whitespace-normal`}>
                    <StatusBadge status={order.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
