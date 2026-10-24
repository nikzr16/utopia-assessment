import { useId } from 'react'
import { Link } from 'react-router'
import { BUTTON, CARD, INPUT, LINK } from '../../../components/styles'
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

const TEXT_COLUMNS: readonly LeaderboardColumn[] = ['name', 'branch_name']

/** "Needs attention": 3 or more returns for rework in the period (PRD Q7). */
function AttentionTag() {
  return (
    <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">Needs attention</span>
  )
}

function NameCell({ row, to }: { row: KpiTechnicianRow; to: string }) {
  return (
    <>
      <Link to={to} className={LINK}>
        {staffLabel(row.name, row.active)}
      </Link>
      {row.needs_attention ? (
        <>
          {' '}
          <AttentionTag />
        </>
      ) : null}
    </>
  )
}

/**
 * The technician leaderboard (PRD Q10, Q11): a table from 768 px with sortable
 * headers (`aria-sort`), cards below it. The rank is the database's ranking
 * (ties share one) and stays as it is when another column sorts. Each name
 * opens the technician's page for the same period.
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
  const arrow = (column: LeaderboardColumn) => (sort.column === column ? (sort.direction === 'asc' ? '▲' : '▼') : '')

  return (
    <section aria-labelledby={`${selectId}-title`} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`${selectId}-title`} className="text-lg font-semibold">
          Leaderboard
        </h3>
        <button type="button" onClick={() => onDownloadCsv(sorted)} disabled={rows.length === 0} className={`${BUTTON.secondary} min-h-11`}>
          Download CSV
        </button>
      </div>

      {rows.length === 0 ? (
        <div className={`${CARD} text-center`}>
          <p className="text-sm text-slate-700">No technicians were active in this period.</p>
        </div>
      ) : (
        <>
          {/* Phone widths: a sort picker (the headers are not visible) and cards. */}
          <div className="flex items-end gap-2 md:hidden">
            <div className="min-w-0 flex-1">
              <label htmlFor={`${selectId}-sort`} className="block text-xs font-medium text-slate-600">
                Sort by
              </label>
              <select
                id={`${selectId}-sort`}
                value={sort.column}
                onChange={(e) => {
                  const column = e.target.value as LeaderboardColumn
                  onSortChange({ column, direction: defaultSortDirection(column) })
                }}
                className={`${INPUT} mt-1 min-h-11`}
              >
                {LEADERBOARD_COLUMNS.map((c) => (
                  <option key={c} value={c}>
                    {SORT_LABELS[c]}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={() => onSortChange({ column: sort.column, direction: sort.direction === 'asc' ? 'desc' : 'asc' })}
              className={`${BUTTON.secondary} min-h-11`}
              aria-label={`Order: ${sort.direction === 'asc' ? 'ascending' : 'descending'}. Reverse`}
            >
              {sort.direction === 'asc' ? '▲ Ascending' : '▼ Descending'}
            </button>
          </div>

          <ul className="space-y-3 md:hidden" aria-label="Leaderboard cards">
            {sorted.map((row) => (
              <li key={row.id} className={CARD}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <NameCell row={row} to={technicianPath(row.id)} />
                    <p className="text-sm text-slate-600">{row.branch_name}</p>
                  </div>
                  <p className="shrink-0 text-sm font-semibold text-slate-700">
                    <span className="sr-only">Rank </span>
                    {row.rank}
                  </p>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                  <Stat label="Jobs" value={String(row.jobs_completed)} />
                  <Stat label="Amount" value={formatMYR(row.total_amount)} />
                  <Stat label="Collected" value={formatMYR(row.collected)} />
                  <Stat label="Reschedules" value={String(row.reschedules)} />
                  <Stat label="Returned" value={String(row.returned)} />
                  <Stat label="Rating" value={`${formatAverageRating(row.average_rating)} (${ratedLabel(row.rated, row.jobs_completed)})`} />
                  <Stat label="Poor ratings" value={String(row.poor_ratings)} />
                </dl>
              </li>
            ))}
          </ul>

          {/* Wider screens: a table. */}
          <div className="hidden overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm md:block">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <caption className="sr-only">Technician leaderboard</caption>
              <thead className="bg-slate-50 text-left text-xs font-medium text-slate-600">
                <tr>
                  {LEADERBOARD_COLUMNS.map((column) => (
                    <th
                      key={column}
                      scope="col"
                      aria-sort={ariaSort(column, sort)}
                      className={`px-3 py-2 ${TEXT_COLUMNS.includes(column) || column === 'rank' ? '' : 'text-right'}`}
                    >
                      <button
                        type="button"
                        onClick={() => onSortChange(nextSort(column, sort))}
                        className="inline-flex min-h-9 items-center gap-1 rounded px-1 font-medium hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-300"
                      >
                        {HEADERS[column]}
                        <span aria-hidden="true" className="w-3 text-[10px]">
                          {arrow(column)}
                        </span>
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sorted.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 tabular-nums">{row.rank}</td>
                    <td className="px-3 py-2">
                      <NameCell row={row} to={technicianPath(row.id)} />
                    </td>
                    <td className="px-3 py-2">{row.branch_name}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.jobs_completed}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatMYR(row.total_amount)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatMYR(row.collected)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.reschedules}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.returned}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatAverageRating(row.average_rating)}
                      <div className="whitespace-nowrap text-xs text-slate-500">{ratedLabel(row.rated, row.jobs_completed)}</div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.poor_ratings}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-600">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  )
}
