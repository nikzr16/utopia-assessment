import { useId } from 'react'
import { Link } from 'react-router'
import { ArrowDown, ArrowDownWideNarrow, ArrowUp, ArrowUpNarrowWide, ChevronsUpDown, Download, Star, Trophy } from 'lucide-react'
import { BUTTON, INPUT, TABLE } from '../../../components/styles'
import { Badge, EmptyState } from '../../../components/ui'
import {
  LEADERBOARD_COLUMNS,
  ariaSort,
  defaultSortDirection,
  formatAverageRating,
  formatMYR,
  nextSort,
  ratedLabel,
  sortLeaderboardRows,
  staffLabel,
  type LeaderboardColumn,
  type SortDirection,
} from '../../../domain'
import type { KpiTechnicianRow } from '../api'

export interface LeaderboardSort {
  column: LeaderboardColumn
  direction: SortDirection
}

/** The default order is the ranking: rank 1 first. */
export const DEFAULT_SORT: LeaderboardSort = { column: 'rank', direction: 'asc' }

const HEADERS: Record<LeaderboardColumn, string> = {
  rank: 'Rank',
  name: 'Technician',
  branch_name: 'Branch',
  jobs_completed: 'Jobs',
  total_amount: 'Amount',
  collected: 'Collected',
  reschedules: 'Reschedules',
  returned: 'Returned',
  average_rating: 'Rating',
  poor_ratings: 'Poor ratings',
}

const SORT_LABELS: Record<LeaderboardColumn, string> = {
  ...HEADERS,
  jobs_completed: 'Jobs completed',
  total_amount: 'Total amount',
  average_rating: 'Average rating',
}

const TEXT_COLUMNS: readonly LeaderboardColumn[] = ['rank', 'name', 'branch_name']

/** The figure a phone row adds when the list is sorted by a column the row does not show. */
function sortedExtra(row: KpiTechnicianRow, column: LeaderboardColumn): string | null {
  switch (column) {
    case 'collected':
      return `Collected ${formatMYR(row.collected)}`
    case 'reschedules':
      return `Reschedules ${row.reschedules}`
    case 'returned':
      return `Returned ${row.returned}`
    case 'poor_ratings':
      return `Poor ratings ${row.poor_ratings}`
    default:
      return null
  }
}

/** "Needs attention": 3 or more returns for rework in the period (PRD Q7). */
function AttentionTag() {
  return <Badge tone="warning">Needs attention</Badge>
}

/** The rank in a round chip; the top three stand out. */
function RankChip({ rank, srLabel = false }: { rank: number | null; srLabel?: boolean }) {
  if (rank === null) return <span className="inline-block size-7 shrink-0" />
  return (
    <span
      className={`inline-flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular ${
        rank <= 3 ? 'bg-brand-soft text-brand-ink ring-1 ring-inset ring-brand/25' : 'bg-sunken text-ink-muted'
      }`}
    >
      {srLabel ? <span className="sr-only">Rank </span> : null}
      {rank}
    </span>
  )
}

const NAME_LINK =
  'rounded-sm font-medium text-ink hover:text-brand hover:underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus'

/**
 * The technician leaderboard (PRD Q10, Q11; 0011 Q15): a table on wide
 * screens with sortable headers (`aria-sort`), and a compact ranked list
 * below 1024 px where the whole row opens the technician (rank, name, jobs,
 * amount, rating). The rank is the database's ranking (ties share one) and
 * stays as it is when another column sorts. Each name opens the technician's
 * page for the same period.
 */
export function Leaderboard({
  rows,
  sort,
  onSortChange,
  technicianPath,
  onDownloadCsv,
}: {
  rows: readonly KpiTechnicianRow[]
  sort: LeaderboardSort
  onSortChange: (sort: LeaderboardSort) => void
  technicianPath: (id: string) => string
  onDownloadCsv: (sortedRows: KpiTechnicianRow[]) => void
}) {
  const selectId = useId()
  const sorted = sortLeaderboardRows(rows, sort.column, sort.direction)
  const SortIcon = (column: LeaderboardColumn) => {
    if (sort.column !== column) return <ChevronsUpDown aria-hidden="true" className="size-3.5 opacity-40 group-hover:opacity-80" />
    return sort.direction === 'asc' ? (
      <ArrowUp aria-hidden="true" className="size-3.5 text-brand" />
    ) : (
      <ArrowDown aria-hidden="true" className="size-3.5 text-brand" />
    )
  }

  return (
    <section aria-labelledby={`${selectId}-title`} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span aria-hidden="true" className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">
            <Trophy className="size-4.5" />
          </span>
          <div className="min-w-0">
            <h3 id={`${selectId}-title`} className="text-lg font-semibold leading-tight text-ink">
              Leaderboard
            </h3>
            <p className="text-xs text-ink-faint">
              {rows.length} {rows.length === 1 ? 'technician' : 'technicians'} in this period
            </p>
          </div>
        </div>
        <button type="button" onClick={() => onDownloadCsv(sorted)} disabled={rows.length === 0} className={`${BUTTON.secondary} max-md:min-h-11`}>
          <Download aria-hidden="true" />
          Download CSV
        </button>
      </div>

      {rows.length === 0 ? (
        <EmptyState compact title="No technicians were active in this period." />
      ) : (
        <>
          {/* Below 1024 px: a sort picker (the headers are not shown) and a compact ranked list. */}
          <div className="flex items-center gap-2 xl:hidden">
            <label htmlFor={`${selectId}-sort`} className="shrink-0 text-xs font-medium text-ink-muted">
              Sort by
            </label>
            <select
              id={`${selectId}-sort`}
              value={sort.column}
              onChange={(e) => {
                const column = e.target.value as LeaderboardColumn
                onSortChange({ column, direction: defaultSortDirection(column) })
              }}
              className={`${INPUT} min-w-0 flex-1 max-md:min-h-11 sm:max-w-60`}
            >
              {LEADERBOARD_COLUMNS.map((c) => (
                <option key={c} value={c}>
                  {SORT_LABELS[c]}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => onSortChange({ column: sort.column, direction: sort.direction === 'asc' ? 'desc' : 'asc' })}
              className={`${BUTTON.secondary} shrink-0 px-3 max-md:min-h-11 max-md:min-w-11`}
              aria-label={`Order: ${sort.direction === 'asc' ? 'ascending' : 'descending'}. Reverse`}
            >
              {sort.direction === 'asc' ? <ArrowUpNarrowWide aria-hidden="true" /> : <ArrowDownWideNarrow aria-hidden="true" />}
              <span className="max-sm:hidden" aria-hidden="true">
                {sort.direction === 'asc' ? 'Ascending' : 'Descending'}
              </span>
            </button>
          </div>

          <ul
            className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface shadow-card xl:hidden"
            aria-label="Leaderboard cards"
          >
            {sorted.map((row) => {
              const extra = sortedExtra(row, sort.column)
              return (
                <li key={row.id} className="relative flex items-start gap-3 px-4 py-3 transition-colors hover:bg-sunken focus-within:bg-sunken">
                  <RankChip rank={row.rank} srLabel />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      {/* The link covers the whole row, so a tap anywhere opens the technician. */}
                      <Link
                        to={technicianPath(row.id)}
                        className="font-medium text-ink after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:rounded-sm focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-focus"
                      >
                        {staffLabel(row.name, row.active)}
                      </Link>
                      {row.needs_attention ? <AttentionTag /> : null}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-ink-faint">{row.branch_name}</p>
                    <p className="mt-1 flex items-center gap-1 text-xs text-ink-muted tabular">
                      <Star aria-hidden="true" className="size-3.5 shrink-0 text-warning" />
                      <span>
                        {formatAverageRating(row.average_rating)} ({ratedLabel(row.rated, row.jobs_completed)})
                      </span>
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold text-ink tabular">{formatMYR(row.total_amount)}</p>
                    <p className="mt-0.5 text-xs text-ink-muted tabular">
                      {row.jobs_completed} {row.jobs_completed === 1 ? 'job' : 'jobs'}
                    </p>
                    {extra ? <p className="mt-1 text-xs font-medium text-brand-ink tabular">{extra}</p> : null}
                  </div>
                </li>
              )
            })}
          </ul>

          {/* Wide screens: the full table. */}
          <div className={`${TABLE.wrap} hidden xl:block`}>
            <div className="overflow-x-auto">
              <table className={TABLE.table}>
                <caption className="sr-only">Technician leaderboard</caption>
                <thead className={TABLE.head}>
                  <tr>
                    {LEADERBOARD_COLUMNS.map((column) => {
                      const numeric = !TEXT_COLUMNS.includes(column)
                      return (
                        <th
                          key={column}
                          scope="col"
                          aria-sort={ariaSort(column, sort)}
                          className={`px-1 py-2 align-bottom font-medium normal-case tracking-normal ${numeric ? 'text-right' : ''}`}
                        >
                          <button
                            type="button"
                            onClick={() => onSortChange(nextSort(column, sort))}
                            className={`group inline-flex min-h-9 items-center gap-1 rounded-md px-1.5 text-left font-medium leading-tight hover:bg-sunken hover:text-ink focus-visible:outline-2 focus-visible:outline-focus ${
                              numeric ? 'flex-row-reverse' : ''
                            } ${sort.column === column ? 'text-ink' : ''}`}
                          >
                            {HEADERS[column]}
                            {SortIcon(column)}
                          </button>
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((row) => (
                    <tr key={row.id} className={TABLE.row}>
                      <td className="px-2.5 py-2.5 align-middle">
                        <RankChip rank={row.rank} />
                      </td>
                      <td className="px-2.5 py-2.5 align-middle">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <Link to={technicianPath(row.id)} className={NAME_LINK}>
                            {staffLabel(row.name, row.active)}
                          </Link>
                          {row.needs_attention ? <AttentionTag /> : null}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-2.5 py-2.5 align-middle text-ink-muted">{row.branch_name}</td>
                      <td className="px-2.5 py-2.5 text-right align-middle font-semibold text-ink tabular">{row.jobs_completed}</td>
                      <td className="whitespace-nowrap px-2.5 py-2.5 text-right align-middle text-ink tabular">{formatMYR(row.total_amount)}</td>
                      <td className="whitespace-nowrap px-2.5 py-2.5 text-right align-middle text-ink-muted tabular">{formatMYR(row.collected)}</td>
                      <td className="px-2.5 py-2.5 text-right align-middle text-ink tabular">{row.reschedules}</td>
                      <td className="px-2.5 py-2.5 text-right align-middle text-ink tabular">{row.returned}</td>
                      <td className="px-2.5 py-2.5 text-right align-middle text-ink tabular">
                        {formatAverageRating(row.average_rating)}
                        <div className="whitespace-nowrap text-xs text-ink-faint">{ratedLabel(row.rated, row.jobs_completed)}</div>
                      </td>
                      <td className="px-2.5 py-2.5 text-right align-middle text-ink tabular">{row.poor_ratings}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </section>
  )
}
