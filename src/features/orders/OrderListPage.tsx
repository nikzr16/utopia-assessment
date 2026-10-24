import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
import { ChevronRight, Clock, ClipboardList, Plus, Search, SearchX, UserRound, Wallet } from 'lucide-react'
import { FilterPanel, type FilterChip } from '../../components/FilterPanel'
import { Pager } from '../../components/Pager'
import { StatusBadge } from '../../components/StatusBadge'
import { BUTTON, INPUT, LINK, TABLE } from '../../components/styles'
import { EmptyState, ErrorState, LoadingState, PageHeader } from '../../components/ui'
import {
  ORDER_STATUSES,
  STATUS_LABELS,
  TERMINAL_STATUSES,
  formatMYR,
  formatMalaysiaDate,
  formatMalaysiaDateTime,
  formatMyPhone,
  malaysiaDayRange,
  type OrderStatus,
} from '../../domain'
import { fetchReferenceData, listOrders, type OrderListQuery, type OrderListRow, type ReferenceData } from './api'
import { useLoad } from '../../lib/useLoad'
import { staffName, useInactiveStaff } from '../../lib/staffStatus'

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
  const ref = reference.status === 'ready' ? reference.data : null

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
    <div className="space-y-5">
      <PageHeader
        row
        title="Orders"
        actions={
          <Link to="/orders/new" className={BUTTON.primary}>
            <Plus aria-hidden="true" />
            New order
          </Link>
        }
      />

      <section aria-label="Search and filters">
        <FilterPanel
          chips={filterChips(params, ref, update)}
          search={
            <form role="search" onSubmit={onSearch} className="flex gap-2">
              <label htmlFor="orders-search" className="sr-only">
                Search orders
              </label>
              <div className="relative min-w-0 flex-1">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint"
                  aria-hidden="true"
                />
                <input
                  id="orders-search"
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Order number, customer name or phone"
                  className={`${INPUT} pl-9 max-md:min-h-11`}
                />
              </div>
              <button type="submit" className={`${BUTTON.secondary} shrink-0 max-md:min-h-11 max-sm:px-3`}>
                <Search className="sm:hidden" aria-hidden="true" />
                <span className="max-sm:sr-only">Search</span>
              </button>
            </form>
          }
        >
          <Filters params={params} reference={ref} update={update} />
        </FilterPanel>
      </section>

      {state.status === 'loading' ? (
        <LoadingState variant="rows" count={6} label="Loading orders…" />
      ) : state.status === 'error' ? (
        <ErrorState title="Could not load orders" onRetry={reload}>
          <p>{state.message}</p>
        </ErrorState>
      ) : (
        <>
          <div
            className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm ${
              state.data.total === 0 && !filtered ? 'hidden' : ''
            }`}
          >
            <p className="text-ink-muted">
              <span className="font-medium text-ink tabular">{state.data.total}</span>{' '}
              {state.data.total === 1 ? 'order' : 'orders'}
              {filtered ? ' found' : ''}
            </p>
            {filtered ? (
              <button
                type="button"
                onClick={() => {
                  setSearch('')
                  setParams(new URLSearchParams())
                }}
                className={`${LINK} max-md:min-h-11`}
              >
                Clear search and filters
              </button>
            ) : null}
          </div>

          {state.data.rows.length === 0 ? (
            filtered ? (
              <EmptyState title="No orders match your search and filters." icon={<SearchX className="size-5" />}>
                Try another name, phone number or order number, or clear the filters.
              </EmptyState>
            ) : (
              <EmptyState
                title="No orders yet."
                icon={<ClipboardList className="size-5" />}
                action={
                  <Link to="/orders/new" className={BUTTON.primary}>
                    <Plus aria-hidden="true" />
                    New order
                  </Link>
                }
              >
                New orders show up here, newest first.
              </EmptyState>
            )
          ) : (
            <>
              <OrderTable rows={state.data.rows} />
              <Pager
                page={page}
                pageSize={PAGE_SIZE}
                total={state.data.total}
                onPage={(p) => update({ page: p > 1 ? String(p) : '' })}
              />
            </>
          )}
        </>
      )}
    </div>
  )
}

/** The chosen filters as removable chips (phone, PRD 0011 Q12). */
function filterChips(
  params: URLSearchParams,
  reference: ReferenceData | null,
  update: (changes: Record<string, string>) => void,
): FilterChip[] {
  const chips: FilterChip[] = []
  const status = params.get('status')
  if (status) {
    chips.push({
      key: 'status',
      label: status === 'open' ? 'Open orders' : (STATUS_LABELS[status as OrderStatus] ?? status),
      onRemove: () => update({ status: '' }),
    })
  }
  const branch = params.get('branch')
  if (branch) {
    chips.push({
      key: 'branch',
      label: reference?.branches.find((b) => b.id === branch)?.name ?? 'Branch',
      onRemove: () => update({ branch: '' }),
    })
  }
  const tech = params.get('tech')
  if (tech) {
    chips.push({
      key: 'tech',
      label: reference?.technicians.find((t) => t.id === tech)?.name ?? 'Technician',
      onRemove: () => update({ tech: '' }),
    })
  }
  const from = params.get('from')
  if (from) chips.push({ key: 'from', label: `From ${from}`, onRemove: () => update({ from: '' }) })
  const to = params.get('to')
  if (to) chips.push({ key: 'to', label: `To ${to}`, onRemove: () => update({ to: '' }) })
  return chips
}

const FILTER_LABEL = 'block text-xs font-medium text-ink-muted'

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
      <label htmlFor={id} className={FILTER_LABEL}>
        {label}
      </label>
      <select
        id={id}
        value={params.get(key) ?? ''}
        onChange={(e) => update({ [key]: e.target.value })}
        className={`${INPUT} mt-1 max-md:min-h-11`}
      >
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
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
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
        <label htmlFor="filter-from" className={FILTER_LABEL}>
          Scheduled from
        </label>
        <input
          id="filter-from"
          type="date"
          value={params.get('from') ?? ''}
          onChange={(e) => update({ from: e.target.value })}
          className={`${INPUT} mt-1 max-md:min-h-11`}
        />
      </div>
      <div>
        <label htmlFor="filter-to" className={FILTER_LABEL}>
          Scheduled to
        </label>
        <input
          id="filter-to"
          type="date"
          value={params.get('to') ?? ''}
          onChange={(e) => update({ to: e.target.value })}
          className={`${INPUT} mt-1 max-md:min-h-11`}
        />
      </div>
    </div>
  )
}

function OrderTable({ rows }: { rows: OrderListRow[] }) {
  useInactiveStaff() // re-render with "(inactive)" tags once known
  const link = (row: OrderListRow) => `/orders/${encodeURIComponent(row.order_no)}`
  return (
    <>
      {/* Phone widths: compact cards; the whole card opens the order (PRD 0011 Q11). */}
      <ul className="space-y-3 md:hidden" aria-label="Orders">
        {rows.map((row) => {
          const technician = staffName(row.technician_name, row.assigned_technician_id)
          return (
            <li key={row.id}>
              <Link
                to={link(row)}
                className="group block rounded-xl border border-line bg-surface p-4 shadow-card transition-colors hover:border-brand/40 active:bg-sunken"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-xs font-medium tracking-wide text-ink-faint">{row.order_no}</span>
                  <StatusBadge status={row.status} />
                </div>
                <div className="mt-1 flex items-center justify-between gap-3">
                  <p className="min-w-0 break-words text-base font-semibold text-ink">{row.customer_name}</p>
                  <ChevronRight
                    className="size-5 shrink-0 text-ink-faint transition-transform group-hover:translate-x-0.5"
                    aria-hidden="true"
                  />
                </div>
                <p className="mt-0.5 text-sm text-ink-muted">
                  {row.service_type_name} · {row.branch_name}
                </p>
                <div className="mt-2.5 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 border-t border-line pt-2.5 text-sm text-ink-muted">
                  <p className="flex min-w-0 items-center gap-2">
                    <UserRound className="size-4 shrink-0 text-ink-faint" aria-hidden="true" />
                    <span className={`truncate ${technician ? '' : 'text-ink-faint'}`}>{technician ?? 'Not assigned'}</span>
                  </p>
                  <p className="flex items-center justify-end gap-1.5 font-medium text-ink tabular">
                    <Wallet className="size-4 shrink-0 text-ink-faint" aria-hidden="true" />
                    {formatMYR(row.quoted_price)}
                  </p>
                  <p className="col-span-2 flex items-center gap-2">
                    <Clock className="size-4 shrink-0 text-ink-faint" aria-hidden="true" />
                    {row.scheduled_at ? formatMalaysiaDateTime(row.scheduled_at) : 'Not scheduled'}
                  </p>
                </div>
              </Link>
            </li>
          )
        })}
      </ul>

      {/* Wider screens: a table. */}
      <div className={`${TABLE.wrap} hidden md:block`}>
        <div className="overflow-x-auto">
          <table className={TABLE.table}>
            <thead className={TABLE.head}>
              <tr>
                <th scope="col" className={TABLE.th}>Order</th>
                <th scope="col" className={TABLE.th}>Customer</th>
                <th scope="col" className={TABLE.th}>Service</th>
                <th scope="col" className={TABLE.th}>Technician</th>
                <th scope="col" className={TABLE.th}>Status</th>
                <th scope="col" className={TABLE.th}>Scheduled</th>
                <th scope="col" className={`${TABLE.th} hidden xl:table-cell`}>Created</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className={TABLE.row}>
                  <td className={`${TABLE.td} whitespace-nowrap`}>
                    <Link to={link(row)} className={LINK}>
                      {row.order_no}
                    </Link>
                    <div className="mt-0.5 text-xs text-ink-faint">{row.branch_name}</div>
                  </td>
                  <td className={TABLE.td}>
                    <div className="font-medium">{row.customer_name}</div>
                    <div className="mt-0.5 whitespace-nowrap text-xs text-ink-faint tabular">{formatMyPhone(row.customer_phone)}</div>
                  </td>
                  <td className={TABLE.td}>{row.service_type_name}</td>
                  <td className={TABLE.td}>
                    {staffName(row.technician_name, row.assigned_technician_id) ?? <span className="text-ink-faint">Not assigned</span>}
                  </td>
                  <td className={TABLE.td}>
                    <StatusBadge status={row.status} />
                  </td>
                  <td className={`${TABLE.td} tabular xl:whitespace-nowrap`}>
                    {row.scheduled_at ? formatMalaysiaDateTime(row.scheduled_at) : <span className="text-ink-faint">—</span>}
                  </td>
                  <td className={`${TABLE.td} hidden whitespace-nowrap text-ink-muted tabular xl:table-cell`}>
                    {formatMalaysiaDate(row.created_at)}
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
