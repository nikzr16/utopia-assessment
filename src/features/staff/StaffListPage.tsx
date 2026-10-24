import { useId, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
import {
  Building2,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  Phone,
  Search,
  TriangleAlert,
  UserPlus,
  UserRound,
  Users,
  UsersRound,
} from 'lucide-react'
import { FilterPanel, type FilterChip } from '../../components/FilterPanel'
import { Pager } from '../../components/Pager'
import { BUTTON, CARD, INPUT, LINK, TABLE } from '../../components/styles'
import { EmptyState, ErrorState, LoadingState, PageHeader } from '../../components/ui'
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
import { ActiveBadge, RoleBadge, StaffAvatar } from './StaffBits'

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
  const branchName = (id: string) => (branches.status === 'ready' ? branches.data.find((b) => b.id === id)?.name : undefined)
  const chips: FilterChip[] = []
  if (params.get('q')) {
    chips.push({
      key: 'q',
      label: `“${params.get('q')}”`,
      onRemove: () => {
        setSearch('')
        update({ q: '' })
      },
    })
  }
  if (query.role) chips.push({ key: 'role', label: ROLE_LABELS[query.role], onRemove: () => update({ role: '' }) })
  if (params.get('branch')) {
    chips.push({ key: 'branch', label: branchName(params.get('branch')!) ?? 'Branch', onRemove: () => update({ branch: '' }) })
  }
  if (query.status !== 'active') {
    chips.push({ key: 'status', label: STAFF_STATUS_FILTER_LABELS[query.status], onRemove: () => update({ status: '' }) })
  }

  const select = (id: string, label: string, key: string, options: { value: string; label: string }[], all: string | null) => (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-ink-muted">
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
    <div className="space-y-5">
      <PageHeader
        row
        title="Staff"
        description={actorRole === 'manager' ? 'The branches you cover.' : 'Every branch.'}
        actions={
          <Link to="/staff/new" className={BUTTON.primary}>
            <UserPlus aria-hidden="true" />
            {actorRole === 'manager' ? 'Add technician' : 'Add staff'}
          </Link>
        }
      />

      <BranchCoverPanel />

      <section aria-label="Search and filters">
        <FilterPanel
          chips={chips}
          search={
            <form role="search" onSubmit={onSearch} className="flex gap-2">
              <label htmlFor="staff-search" className="sr-only">
                Search staff
              </label>
              <div className="relative min-w-0 flex-1">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint"
                  aria-hidden="true"
                />
                <input
                  id="staff-search"
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Name, email or phone"
                  className={`${INPUT} pl-9`}
                />
              </div>
              <button type="submit" className={`${BUTTON.secondary} shrink-0 max-md:min-h-11 max-sm:px-3`}>
                <Search className="sm:hidden" aria-hidden="true" />
                <span className="max-sm:sr-only">Search</span>
              </button>
            </form>
          }
        >
          <div className="grid gap-3 md:grid-cols-3">
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
              className={`${LINK} mt-3 inline-flex min-h-11 items-center text-sm md:min-h-0`}
            >
              Clear search and filters
            </button>
          ) : null}
        </FilterPanel>
      </section>

      {state.status === 'loading' ? (
        <LoadingState variant="rows" count={6} label="Loading staff…" />
      ) : state.status === 'error' ? (
        <ErrorState title="Could not load staff" onRetry={reload}>
          <p>{state.message}</p>
        </ErrorState>
      ) : state.data.rows.length === 0 ? (
        <EmptyState
          title={filtered ? 'No staff match your search and filters.' : 'No staff yet.'}
          icon={<UsersRound className="size-5" />}
        />
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

function BranchLine({ row }: { row: StaffRow }) {
  return (
    <>
      {row.branch_name}
      {row.additional_branch_names.length > 0 ? (
        <div className="text-xs text-ink-faint">Also covers {row.additional_branch_names.join(', ')}</div>
      ) : null}
    </>
  )
}

function StaffTable({ rows }: { rows: StaffRow[] }) {
  const link = (row: StaffRow) => `/staff/${row.id}`
  return (
    <>
      {/* Phone widths: compact cards, the whole card opens the person. */}
      <ul className="space-y-3 md:hidden" aria-label="Staff">
        {rows.map((row) => (
          <li key={row.id}>
            <Link
              to={link(row)}
              className="group flex gap-3 rounded-xl border border-line bg-surface p-4 shadow-card transition-colors hover:border-brand/40 active:bg-sunken"
            >
              <StaffAvatar name={row.name} active={row.active} />
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 break-words text-base font-semibold text-ink">{row.name}</p>
                  <ActiveBadge active={row.active} />
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-muted">
                  <RoleBadge role={row.role} />
                  <span className="inline-flex items-center gap-1">
                    <Building2 className="size-3.5 text-ink-faint" aria-hidden="true" />
                    {row.branch_name}
                  </span>
                </div>
                {row.additional_branch_names.length > 0 ? (
                  <p className="mt-1 text-xs text-ink-faint">Also covers {row.additional_branch_names.join(', ')}</p>
                ) : null}
                <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-muted tabular">
                  <Phone className="size-3.5 text-ink-faint" aria-hidden="true" />
                  {formatMyPhone(row.phone)}
                </p>
                {row.active && row.sign_in_state !== 'ready' ? (
                  <p className="mt-1 text-xs font-medium text-warning-ink">{SIGN_IN_STATE_LABELS[row.sign_in_state]}</p>
                ) : null}
              </div>
              <ChevronRight className="mt-2.5 size-5 shrink-0 self-start text-ink-faint" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>

      {/* Wider screens: a table. */}
      <div className={`${TABLE.wrap} hidden md:block`}>
        <div className="overflow-x-auto">
          <table className={TABLE.table}>
            <thead className={TABLE.head}>
              <tr>
                <th scope="col" className={TABLE.th}>Name</th>
                <th scope="col" className={TABLE.th}>Role</th>
                <th scope="col" className={TABLE.th}>Branch</th>
                <th scope="col" className={TABLE.th}>Phone</th>
                <th scope="col" className={TABLE.th}>Sign-in</th>
                <th scope="col" className={TABLE.th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className={TABLE.row}>
                  <td className={TABLE.td}>
                    <div className="flex items-center gap-3">
                      <StaffAvatar name={row.name} active={row.active} />
                      <div className="min-w-0">
                        <Link to={link(row)} className={LINK}>
                          {row.name}
                        </Link>
                        <div className="break-all text-xs text-ink-faint">{row.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className={TABLE.td}>
                    <RoleBadge role={row.role} />
                  </td>
                  <td className={TABLE.td}>
                    <BranchLine row={row} />
                  </td>
                  <td className={`${TABLE.td} tabular xl:whitespace-nowrap`}>{formatMyPhone(row.phone)}</td>
                  <td className={`${TABLE.td} text-xs xl:whitespace-nowrap`}>
                    {row.active ? (
                      <span className={row.sign_in_state === 'ready' ? 'text-ink-muted' : 'font-medium text-warning-ink'}>
                        {SIGN_IN_STATE_LABELS[row.sign_in_state]}
                      </span>
                    ) : (
                      <span className="text-ink-faint">Blocked</span>
                    )}
                  </td>
                  <td className={TABLE.td}>
                    <ActiveBadge active={row.active} />
                    <div className="mt-1 whitespace-nowrap text-xs text-ink-faint">
                      {row.active ? `Joined ${formatMalaysiaDate(row.joined_at)}` : `Left ${formatMalaysiaDate(row.left_at!)}`}
                    </div>
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

/**
 * Each branch's covering Managers and active staff; branches with no Manager
 * stand out (PRD Q6). A card with the summary always in view; the branches
 * open on their own when one has no Manager.
 */
export function BranchCoverPanel() {
  const [state] = useLoad(fetchBranchCover, 'branch-cover')
  const [toggled, setToggled] = useState<boolean | null>(null)
  const titleId = useId()
  const listId = useId()
  if (state.status !== 'ready') return null
  const rows: BranchCoverRow[] = state.data
  const missing = rows.filter((r) => !r.has_manager)
  const open = toggled ?? missing.length > 0
  return (
    <section className={`${CARD} ${missing.length > 0 ? 'border-danger/35' : ''}`} aria-labelledby={titleId}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <span
            aria-hidden="true"
            className={`inline-flex size-10 shrink-0 items-center justify-center rounded-full ${
              missing.length > 0 ? 'bg-danger-soft text-danger' : 'bg-success-soft text-success'
            }`}
          >
            {missing.length > 0 ? <TriangleAlert className="size-5" /> : <CircleCheck className="size-5" />}
          </span>
          <div className="min-w-0">
            <h3 id={titleId} className="text-base font-semibold text-ink">
              Branch cover
            </h3>
            {missing.length === 0 ? (
              <p className="text-sm text-ink-muted">Every branch has a Manager.</p>
            ) : (
              <p className="text-sm font-medium text-danger-ink">
                {missing.map((r) => r.branch_name).join(', ')} {missing.length === 1 ? 'has' : 'have'} no Manager
              </p>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setToggled(!open)}
          aria-expanded={open}
          aria-controls={listId}
          className={`${BUTTON.ghost} max-md:min-h-11`}
        >
          {open ? 'Hide branches' : `Show ${rows.length} branches`}
          <ChevronDown className={`transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
      </div>
      {open ? (
        <ul id={listId} className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3" aria-label="Branch cover">
          {rows.map((r) => (
            <li
              key={r.branch_id}
              className={`rounded-lg border p-3 text-sm ${r.has_manager ? 'border-line bg-sunken/50' : 'border-danger/35 bg-danger-soft'}`}
            >
              <p className="flex items-center gap-1.5 font-medium text-ink">
                <Building2 className="size-4 shrink-0 text-ink-faint" aria-hidden="true" />
                {r.branch_name}
              </p>
              <p className={`mt-1 flex gap-1.5 ${r.has_manager ? 'text-ink-muted' : 'font-medium text-danger-ink'}`}>
                <UserRound className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                <span className="min-w-0">
                  {r.managers.length === 0
                    ? 'No Manager'
                    : r.managers.map((m) => (m.home ? m.name : `${m.name} (cover)`)).join(', ')}
                </span>
              </p>
              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-faint">
                <Users className="size-3.5 shrink-0" aria-hidden="true" />
                {r.active_staff} active staff
              </p>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
