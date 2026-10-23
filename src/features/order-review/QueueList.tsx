import type { ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Notice } from '../../components/Notice'
import { StatusBadge } from '../../components/StatusBadge'
import { CARD, INPUT, LINK } from '../../components/styles'
import { NEEDS_ATTENTION_RETURNS, needsAttention } from '../../domain'
import type { LoadState } from '../../lib/useLoad'
import type { BranchOption, OrderReview } from './api'

export interface QueueColumn {
  header: string
  cell: (order: OrderReview) => ReactNode
}

const TAB = 'inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-sky-300'

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
    <nav aria-label={label} className="flex flex-wrap gap-2">
      {views.map((view) => (
        <Link
          key={view}
          to={to(view)}
          aria-current={view === current ? 'page' : undefined}
          className={`${TAB} ${view === current ? 'bg-sky-100 text-sky-900' : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}
        >
          {labels[view]}
        </Link>
      ))}
    </nav>
  )
}

/** Branch filter kept in `?branch=`; hidden when there is only one branch to choose. */
export function BranchFilter({ branches, allLabel }: { branches: BranchOption[]; allLabel: string }) {
  const [params, setParams] = useSearchParams()
  if (branches.length < 2) return null
  return (
    <div className="w-full sm:w-64">
      <label htmlFor="queue-branch" className="block text-xs font-medium text-slate-600">
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
        <span
          className="inline-flex items-center whitespace-nowrap rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-800 ring-1 ring-inset ring-red-200"
          title={`Returned ${NEEDS_ATTENTION_RETURNS} or more times`}
        >
          Needs attention
        </span>
      ) : null}
      <span className="inline-flex items-center whitespace-nowrap rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700 ring-1 ring-inset ring-slate-300">
        Returned {order.return_count}×
      </span>
    </span>
  )
}

/**
 * One tab of a queue: a table on desktop, cards on a phone (0004 PRD Q10).
 * Each row links to the order page.
 */
export function QueueList({
  state,
  reload,
  columns,
  link,
  label,
  empty,
}: {
  state: LoadState<OrderReview[]>
  reload: () => void
  columns: QueueColumn[]
  link: (order: OrderReview) => string
  label: string
  empty: string
}) {
  if (state.status === 'loading') {
    return (
      <p className="text-sm text-slate-600" role="status">
        Loading…
      </p>
    )
  }
  if (state.status === 'error') {
    return (
      <Notice tone="error" title="Could not load the list">
        <p>{state.message}</p>
        <button type="button" onClick={reload} className="mt-3 min-h-11 font-medium underline">
          Try again
        </button>
      </Notice>
    )
  }
  if (state.data.length === 0) {
    return (
      <div className={`${CARD} text-center`}>
        <p className="text-sm text-slate-700">{empty}</p>
      </div>
    )
  }
  const rows = state.data
  return (
    <>
      {/* Phone widths: cards. */}
      <ul className="space-y-3 md:hidden" aria-label={label}>
        {rows.map((order) => (
          <li key={order.id} className={CARD}>
            <div className="flex items-start justify-between gap-3">
              <Link to={link(order)} className={`${LINK} inline-flex min-h-11 items-center text-base`}>
                {order.order_no}
              </Link>
              <StatusBadge status={order.status} />
            </div>
            <p className="text-sm font-medium">{order.customer_name}</p>
            <ReturnFlags order={order} />
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
              {columns.map((c) => (
                <div key={c.header}>
                  <dt className="text-xs text-slate-500">{c.header}</dt>
                  <dd className="break-words">{c.cell(order)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>

      {/* Wider screens: a table. */}
      <div className="hidden overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm md:block">
        <table className="min-w-full divide-y divide-slate-200 text-sm" aria-label={label}>
          <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-600">
            <tr>
              <th scope="col" className="px-4 py-3">
                Order
              </th>
              <th scope="col" className="px-4 py-3">
                Customer
              </th>
              {columns.map((c) => (
                <th key={c.header} scope="col" className="px-4 py-3">
                  {c.header}
                </th>
              ))}
              <th scope="col" className="px-4 py-3">
                Status
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((order) => (
              <tr key={order.id} className="hover:bg-slate-50">
                <td className="whitespace-nowrap px-4 py-3">
                  <Link to={link(order)} className={LINK}>
                    {order.order_no}
                  </Link>
                  <div className="text-xs text-slate-500">{order.branch_name}</div>
                </td>
                <td className="px-4 py-3">
                  <div className="font-medium">{order.customer_name}</div>
                  <ReturnFlags order={order} />
                </td>
                {columns.map((c) => (
                  <td key={c.header} className="px-4 py-3">
                    {c.cell(order)}
                  </td>
                ))}
                <td className="px-4 py-3">
                  <StatusBadge status={order.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
