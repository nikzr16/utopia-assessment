import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Notice } from '../../components/Notice'
import { Pager } from '../../components/Pager'
import { BUTTON, CARD, INPUT, LINK } from '../../components/styles'
import {
  ROLE_LABELS,
  SIGN_IN_STATE_LABELS,
  STAFF_PAGE_SIZE,
  STAFF_ROLES,
  STAFF_STATUS_FILTERS,
  STAFF_STATUS_FILTER_LABELS,
  formatMalaysiaDate,
  formatMyPhone,
  type StaffRole,
  type StaffStatusFilter,
} from '../../domain'
import { useLoad } from '../../lib/useLoad'
import { fetchBranchCover, fetchBranchOptions, listStaff, type BranchCoverRow, type StaffListQuery, type StaffRow } from './api'

/** URL search params → list query (`q`, `role`, `branch`, `status`, `page`). */
export function toStaffQuery(params: URLSearchParams): StaffListQuery {
  const role = params.get('role') ?? ''
  const status = params.get('status') ?? 'active'
  const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1)
  return {
    search: params.get('q') ?? undefined,
    role: (STAFF_ROLES as readonly string[]).includes(role) ? (role as StaffRole) : undefined,
    branchId: params.get('branch') ?? undefined,
    status: (STAFF_STATUS_FILTERS as readonly string[]).includes(status) ? (status as StaffStatusFilter) : 'active',
    limit: STAFF_PAGE_SIZE,
    offset: (page - 1) * STAFF_PAGE_SIZE,
  }
}

/** Staff of every branch (Admins) or the branches a Manager covers (PRD 0006 Q1, Q12). */
export function StaffListPage({ actorRole }: { actorRole: StaffRole }) {
  const [params, setParams] = useSearchParams()
  const query = toStaffQuery(params)
  const [state, reload] = useLoad(() => listStaff(query), params.toString())
  const [branches] = useLoad(() => fetchBranchOptions('admin'), 'branches')
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

  const filtered = ['q', 'role', 'branch', 'status'].some((k) => params.get(k))
  const page = query.offset / STAFF_PAGE_SIZE + 1
  const select = (id: string, label: string, key: string, options: { value: string; label: string }[], all: string | null) => (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-slate-600">
        {label}
      </label>
      <select
        id={id}
        value={params.get(key) ?? (all === null ? 'active' : '')}
        onChange={(e) => update({ [key]: e.target.value === 'active' && key === 'status' ? '' : e.target.value })}
        className={`${INPUT} mt-1`}
      >
        {all !== null ? <option value="">{all}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-xl font-semibold">Staff</h2>
        <Link to="/staff/new" className={BUTTON.primary}>
          {actorRole === 'manager' ? 'Add technician' : 'Add staff'}
        </Link>
      </div>

      <BranchCoverPanel />

      <section className={CARD} aria-label="Search and filters">
        <form role="search" onSubmit={onSearch} className="flex flex-col gap-2 sm:flex-row">
          <label htmlFor="staff-search" className="sr-only">
            Search staff
          </label>
          <input
            id="staff-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name, email or phone"
            className={INPUT}
          />
          <button type="submit" className={BUTTON.secondary}>
            Search
          </button>
        </form>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {select('filter-role', 'Role', 'role', STAFF_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] })), 'All roles')}
          {select(
            'filter-branch',
            'Branch',
            'branch',
            (branches.status === 'ready' ? branches.data : []).map((b) => ({ value: b.id, label: b.name })),
            'All branches',
          )}
          {select(
            'filter-status',
            'Status',
            'status',
            STAFF_STATUS_FILTERS.map((s) => ({ value: s, label: STAFF_STATUS_FILTER_LABELS[s] })),
            null,
          )}
        </div>
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
          Loading staff…
        </p>
      ) : state.status === 'error' ? (
        <Notice tone="error" title="Could not load staff">
          <p>{state.message}</p>
          <button type="button" onClick={reload} className="mt-3 font-medium underline">
            Try again
          </button>
        </Notice>
      ) : state.data.rows.length === 0 ? (
        <div className={`${CARD} text-center`}>
          <p className="text-sm text-slate-700">{filtered ? 'No staff match your search and filters.' : 'No staff yet.'}</p>
        </div>
      ) : (
        <>
          <StaffTable rows={state.data.rows} />
          <Pager
            page={page}
            pageSize={STAFF_PAGE_SIZE}
            total={state.data.total}
            onPage={(p) => update({ page: p > 1 ? String(p) : '' })}
          />
        </>
      )}
    </div>
  )
}

function StatusTag({ active }: { active: boolean }) {
  return active ? (
    <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">Active</span>
  ) : (
    <span className="inline-flex rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700">Inactive</span>
  )
}

function BranchLine({ row }: { row: StaffRow }) {
  return (
    <>
      {row.branch_name}
      {row.additional_branch_names.length > 0 ? (
        <div className="text-xs text-slate-500">Also covers {row.additional_branch_names.join(', ')}</div>
      ) : null}
    </>
  )
}

function StaffTable({ rows }: { rows: StaffRow[] }) {
  const link = (row: StaffRow) => `/staff/${row.id}`
  return (
    <>
      {/* Phone widths: cards. */}
      <ul className="space-y-3 md:hidden" aria-label="Staff">
        {rows.map((row) => (
          <li key={row.id} className={CARD}>
            <div className="flex items-start justify-between gap-3">
              <Link to={link(row)} className={`${LINK} text-base`}>
                {row.name}
              </Link>
              <StatusTag active={row.active} />
            </div>
            <p className="mt-1 text-sm text-slate-700">
              {ROLE_LABELS[row.role]} · <BranchLine row={row} />
            </p>
            <p className="text-sm text-slate-600">{formatMyPhone(row.phone)}</p>
            <p className="break-words text-sm text-slate-600">{row.email}</p>
            {row.active && row.sign_in_state !== 'ready' ? (
              <p className="mt-1 text-xs text-amber-800">{SIGN_IN_STATE_LABELS[row.sign_in_state]}</p>
            ) : null}
          </li>
        ))}
      </ul>

      {/* Wider screens: a table. */}
      <div className="hidden overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm md:block">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-600">
            <tr>
              <th scope="col" className="px-4 py-3">Name</th>
              <th scope="col" className="px-4 py-3">Role</th>
              <th scope="col" className="px-4 py-3">Branch</th>
              <th scope="col" className="px-4 py-3">Phone</th>
              <th scope="col" className="px-4 py-3">Sign-in</th>
              <th scope="col" className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <Link to={link(row)} className={LINK}>
                    {row.name}
                  </Link>
                  <div className="text-xs text-slate-500">{row.email}</div>
                </td>
                <td className="px-4 py-3">{ROLE_LABELS[row.role]}</td>
                <td className="px-4 py-3">
                  <BranchLine row={row} />
                </td>
                <td className="whitespace-nowrap px-4 py-3">{formatMyPhone(row.phone)}</td>
                <td className="px-4 py-3 text-xs">
                  {row.active ? SIGN_IN_STATE_LABELS[row.sign_in_state] : <span className="text-slate-500">Blocked</span>}
                </td>
                <td className="px-4 py-3">
                  <StatusTag active={row.active} />
                  <div className="mt-1 whitespace-nowrap text-xs text-slate-500">
                    {row.active ? `Joined ${formatMalaysiaDate(row.joined_at)}` : `Left ${formatMalaysiaDate(row.left_at!)}`}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

/** Each branch's covering Managers and active staff; branches with no Manager stand out (PRD Q6). */
export function BranchCoverPanel() {
  const [state] = useLoad(fetchBranchCover, 'branch-cover')
  if (state.status !== 'ready') return null
  const rows: BranchCoverRow[] = state.data
  const missing = rows.filter((r) => !r.has_manager)
  return (
    <details className={CARD} open={missing.length > 0}>
      <summary className="cursor-pointer text-sm font-medium">
        Branch cover:{' '}
        {missing.length === 0 ? (
          <span>every branch has a Manager</span>
        ) : (
          <span className="text-red-700">
            {missing.map((r) => r.branch_name).join(', ')} {missing.length === 1 ? 'has' : 'have'} no Manager
          </span>
        )}
      </summary>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3" aria-label="Branch cover">
        {rows.map((r) => (
          <li key={r.branch_id} className={`rounded-md border p-3 text-sm ${r.has_manager ? 'border-slate-200' : 'border-red-300 bg-red-50'}`}>
            <p className="font-medium">{r.branch_name}</p>
            <p className="text-slate-700">
              {r.managers.length === 0
                ? 'No Manager'
                : r.managers.map((m) => (m.home ? m.name : `${m.name} (cover)`)).join(', ')}
            </p>
            <p className="text-xs text-slate-500">{r.active_staff} active staff</p>
          </li>
        ))}
      </ul>
    </details>
  )
}
