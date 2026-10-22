import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Notice } from '../../components/Notice'
import { StatusBadge } from '../../components/StatusBadge'
import { BUTTON, CARD, INPUT, LINK } from '../../components/styles'
import {
  ORDER_STATUSES,
  STATUS_LABELS,
  TERMINAL_STATUSES,
  formatMalaysiaDate,
  formatMalaysiaDateTime,
  formatMyPhone,
  malaysiaDayRange,
  type OrderStatus,
} from '../../domain'
import { fetchReferenceData, listOrders, type OrderListQuery, type OrderListRow, type ReferenceData } from './api'
import { useLoad } from './useLoad'

export const PAGE_SIZE = 25

const OPEN_STATUSES = ORDER_STATUSES.filter((s) => !TERMINAL_STATUSES.includes(s))

/** URL search params → list query. `status` is '' (all), 'open', or one status. */
export function toListQuery(params: URLSearchParams): OrderListQuery {
  const status = params.get('status') ?? ''
  const statuses: OrderStatus[] =
    status === 'open'
      ? [...OPEN_STATUSES]
      : (ORDER_STATUSES as readonly string[]).includes(status)
        ? [status as OrderStatus]
        : []
  const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1)
  return {
    search: params.get('q') ?? undefined,
    statuses,
    branchId: params.get('branch') ?? undefined,
    technicianId: params.get('tech') ?? undefined,
    scheduledFrom: malaysiaDayRange(params.get('from') ?? '')?.from,
    scheduledTo: malaysiaDayRange(params.get('to') ?? '')?.to,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  }
}

/** The Admin's home: every order, newest first, with search and filters (PRD Q11, AC8). */
export function OrderListPage() {
  const [params, setParams] = useSearchParams()
  const query = toListQuery(params)
  const [state, reload] = useLoad(() => listOrders(query), params.toString())
  const [reference] = useLoad(fetchReferenceData, 'reference')
  const [search, setSearch] = useState(params.get('q') ?? '')

  const update = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v)
      else next.delete(k)
    }
    if (!('page' in changes)) next.delete('page')
    setParams(next)
  }

  const onSearch = (e: FormEvent) => {
    e.preventDefault()
    update({ q: search.trim() })
  }

  const filtered = ['q', 'status', 'branch', 'tech', 'from', 'to'].some((k) => params.get(k))
  const page = query.offset / PAGE_SIZE + 1

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-xl font-semibold">Orders</h2>
        <Link to="/orders/new" className={BUTTON.primary}>
          New order
        </Link>
      </div>

      <section className={CARD} aria-label="Search and filters">
        <form role="search" onSubmit={onSearch} className="flex flex-col gap-2 sm:flex-row">
          <label htmlFor="orders-search" className="sr-only">
            Search orders
          </label>
          <input
            id="orders-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Order number, customer name or phone"
            className={INPUT}
          />
          <button type="submit" className={BUTTON.secondary}>
            Search
          </button>
        </form>
        <Filters params={params} reference={reference.status === 'ready' ? reference.data : null} update={update} />
        {filtered ? (
          <button
            type="button"
            onClick={() => {
              setSearch('')
              setParams(new URLSearchParams())
            }}
            className={`${LINK} mt-3 text-sm`}
          >
            Clear search and filters
          </button>
        ) : null}
      </section>

      {state.status === 'loading' ? (
        <p className="text-sm text-slate-600" role="status">
          Loading orders…
        </p>
      ) : state.status === 'error' ? (
        <Notice tone="error" title="Could not load orders">
          <p>{state.message}</p>
          <button type="button" onClick={reload} className="mt-3 font-medium underline">
            Try again
          </button>
        </Notice>
      ) : state.data.rows.length === 0 ? (
        <div className={`${CARD} text-center`}>
          <p className="text-sm text-slate-700">{filtered ? 'No orders match your search and filters.' : 'No orders yet.'}</p>
          {!filtered ? (
            <Link to="/orders/new" className={`${BUTTON.primary} mt-3`}>
              Create the first order
            </Link>
          ) : null}
        </div>
      ) : (
        <>
          <OrderTable rows={state.data.rows} />
          <Pager
            page={page}
            total={state.data.total}
            onPage={(p) => update({ page: p > 1 ? String(p) : '' })}
          />
        </>
      )}
    </div>
  )
}

function Filters({
  params,
  reference,
  update,
}: {
  params: URLSearchParams
  reference: ReferenceData | null
  update: (changes: Record<string, string>) => void
}) {
  const select = (id: string, label: string, key: string, options: { value: string; label: string }[], all: string) => (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-slate-600">
        {label}
      </label>
      <select id={id} value={params.get(key) ?? ''} onChange={(e) => update({ [key]: e.target.value })} className={`${INPUT} mt-1`}>
        <option value="">{all}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {select(
        'filter-status',
        'Status',
        'status',
        [{ value: 'open', label: 'Open (not Closed or Cancelled)' }, ...ORDER_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))],
        'All statuses',
      )}
      {select('filter-branch', 'Branch', 'branch', (reference?.branches ?? []).map((b) => ({ value: b.id, label: b.name })), 'All branches')}
      {select(
        'filter-technician',
        'Technician',
        'tech',
        (reference?.technicians ?? []).map((t) => ({ value: t.id, label: `${t.name} (${t.branch_name})` })),
        'All technicians',
      )}
      <div>
        <label htmlFor="filter-from" className="block text-xs font-medium text-slate-600">
          Scheduled from
        </label>
        <input id="filter-from" type="date" value={params.get('from') ?? ''} onChange={(e) => update({ from: e.target.value })} className={`${INPUT} mt-1`} />
      </div>
      <div>
        <label htmlFor="filter-to" className="block text-xs font-medium text-slate-600">
          Scheduled to
        </label>
        <input id="filter-to" type="date" value={params.get('to') ?? ''} onChange={(e) => update({ to: e.target.value })} className={`${INPUT} mt-1`} />
      </div>
    </div>
  )
}

function OrderTable({ rows }: { rows: OrderListRow[] }) {
  const link = (row: OrderListRow) => `/orders/${encodeURIComponent(row.order_no)}`
  return (
    <>
      {/* Phone widths: cards. */}
      <ul className="space-y-3 md:hidden" aria-label="Orders">
        {rows.map((row) => (
          <li key={row.id} className={CARD}>
            <div className="flex items-start justify-between gap-3">
              <Link to={link(row)} className={`${LINK} text-base`}>
                {row.order_no}
              </Link>
              <StatusBadge status={row.status} />
            </div>
            <p className="mt-2 text-sm font-medium">{row.customer_name}</p>
            <p className="text-sm text-slate-600">{formatMyPhone(row.customer_phone)}</p>
            <p className="mt-1 text-sm text-slate-600">
              {row.service_type_name} · {row.technician_name ?? 'Not assigned'} · {row.branch_name}
            </p>
            <p className="text-sm text-slate-600">
              {row.scheduled_at ? formatMalaysiaDateTime(row.scheduled_at) : 'Not scheduled'}
            </p>
          </li>
        ))}
      </ul>

      {/* Wider screens: a table. */}
      <div className="hidden overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm md:block">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-600">
            <tr>
              <th scope="col" className="px-4 py-3">Order</th>
              <th scope="col" className="px-4 py-3">Customer</th>
              <th scope="col" className="px-4 py-3">Service</th>
              <th scope="col" className="px-4 py-3">Technician</th>
              <th scope="col" className="px-4 py-3">Status</th>
              <th scope="col" className="px-4 py-3">Scheduled</th>
              <th scope="col" className="px-4 py-3">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-slate-50">
                <td className="whitespace-nowrap px-4 py-3">
                  <Link to={link(row)} className={LINK}>
                    {row.order_no}
                  </Link>
                  <div className="text-xs text-slate-500">{row.branch_name}</div>
                </td>
                <td className="px-4 py-3">
                  <div className="font-medium">{row.customer_name}</div>
                  <div className="whitespace-nowrap text-xs text-slate-500">{formatMyPhone(row.customer_phone)}</div>
                </td>
                <td className="px-4 py-3">{row.service_type_name}</td>
                <td className="px-4 py-3">{row.technician_name ?? <span className="text-slate-500">Not assigned</span>}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={row.status} />
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  {row.scheduled_at ? formatMalaysiaDateTime(row.scheduled_at) : <span className="text-slate-500">—</span>}
                </td>
                <td className="whitespace-nowrap px-4 py-3">{formatMalaysiaDate(row.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function Pager({ page, total, onPage }: { page: number; total: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const first = (page - 1) * PAGE_SIZE + 1
  const last = Math.min(total, page * PAGE_SIZE)
  return (
    <nav aria-label="Pages" className="flex flex-col items-center justify-between gap-2 text-sm sm:flex-row">
      <p className="text-slate-600">
        Showing {first}–{last} of {total}
      </p>
      <div className="flex gap-2">
        <button type="button" className={BUTTON.secondary} disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </button>
        <button type="button" className={BUTTON.secondary} disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </button>
      </div>
    </nav>
  )
}
