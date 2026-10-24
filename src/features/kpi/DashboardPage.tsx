import { useState } from 'react'
import { CARD, BUTTON } from '../../components/styles'
import {
  KPI_TREND_COUNTS,
  emptyPeriodMessage,
  isEmptyPeriod,
  kpiAddress,
  leaderboardCsv,
  leaderboardCsvFileName,
  periodRange,
  rankLeaderboard,
  type KpiAddress,
  type StaffRole,
} from '../../domain'
import { useLoad } from '../../lib/useLoad'
import {
  fetchKpiBranchOptions,
  fetchKpiBranches,
  fetchKpiSummary,
  fetchKpiTechnicians,
  fetchKpiTrend,
  type KpiTechnicianRow,
} from './api'
import { JobsByTechnicianChart } from './charts/JobsByTechnicianChart'
import { ReschedulesByReasonChart } from './charts/ReschedulesByReasonChart'
import { TrendChart } from './charts/TrendChart'
import { BranchComparison } from './components/BranchComparison'
import { BranchFilter } from './components/BranchFilter'
import { InsightsCard } from './components/InsightsCard'
import { KpiError, KpiLoading } from './components/KpiState'
import { DEFAULT_SORT, Leaderboard, type LeaderboardSort } from './components/Leaderboard'
import { PeriodPicker } from './components/PeriodPicker'
import { SummaryCards } from './components/SummaryCards'
import { downloadTextFile } from './download'
import { addressKey, useKpiAddress } from './useKpiAddress'

/**
 * The KPI dashboard for Admins, Managers and Finance (PRD 0007): the period
 * and branch (kept in the address), the cards, the leaderboard, the charts and,
 * where there is more than one branch, the branch comparison. Every number
 * comes from the `kpi_*` database functions, already limited to what the
 * signed-in person may see.
 */
export function DashboardPage({ role }: { role: StaffRole }) {
  const [address, setAddress] = useKpiAddress()
  const [options] = useLoad(() => fetchKpiBranchOptions(role), role)
  const [sort, setSort] = useState<LeaderboardSort>(DEFAULT_SORT)
  const branches = options.status === 'ready' ? options.data : []
  const branchName = address.branch ? (branches.find((b) => b.id === address.branch)?.name ?? null) : null

  return (
    <div className="space-y-5">
      <h2 className="text-xl font-semibold">Dashboard</h2>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <PeriodPicker view={address.view} start={address.start} onChange={setAddress} />
        <BranchFilter
          branches={branches}
          value={address.branch}
          allLabel={role === 'manager' ? 'All my branches' : 'All branches'}
          onChange={(branch) => setAddress({ branch })}
        />
      </div>
      {/* 0009: Managers and Admins (PRD Q16). */}
      {role === 'admin' || role === 'manager' ? <InsightsCard key={addressKey(address)} address={address} /> : null}
      <DashboardBody
        key={addressKey(address)}
        address={address}
        branchName={branchName}
        sort={sort}
        onSortChange={setSort}
        onShowAllBranches={() => setAddress({ branch: null })}
      />
    </div>
  )
}

function DashboardBody({
  address,
  branchName,
  sort,
  onSortChange,
  onShowAllBranches,
}: {
  address: KpiAddress
  branchName: string | null
  sort: LeaderboardSort
  onSortChange: (sort: LeaderboardSort) => void
  onShowAllBranches: () => void
}) {
  const { view, start, branch } = address
  const period = periodRange(view, start)
  const [state, reload] = useLoad(async () => {
    const [summary, technicians, trend, branches] = await Promise.all([
      fetchKpiSummary(period.start, period.end, branch),
      fetchKpiTechnicians(period.start, period.end, branch),
      fetchKpiTrend(view, period.end, KPI_TREND_COUNTS[view], branch),
      fetchKpiBranches(period.start, period.end),
    ])
    return { summary, technicians, trend, branches }
  }, addressKey(address))

  if (state.status === 'loading') return <KpiLoading />
  if (state.status === 'error') {
    return (
      <div className="space-y-3">
        <KpiError message={state.message} onRetry={reload} />
        {branch ? (
          <div className="text-center">
            <button type="button" onClick={onShowAllBranches} className={BUTTON.secondary}>
              Show all branches
            </button>
          </div>
        ) : null}
      </div>
    )
  }

  const { summary, technicians, trend, branches } = state.data
  const empty = isEmptyPeriod(summary)
  // The default order is the ranking; the charts follow it whatever the table is sorted by.
  const ranked = rankLeaderboard(technicians)
  const compare = branches.length >= 2

  const download = (rows: KpiTechnicianRow[]) =>
    downloadTextFile(
      leaderboardCsvFileName(view, start, branchName ?? (branch ? 'selected branch' : null)),
      leaderboardCsv(rows),
    )

  return (
    <div className="space-y-5">
      <SummaryCards figures={summary} />

      {empty ? (
        <div className={CARD} role="status">
          <p className="font-medium">{emptyPeriodMessage(view)}</p>
          <p className="mt-1 text-sm text-slate-600">
            Jobs are counted when a Manager approves them. Every technician active in the period is still listed below.
          </p>
        </div>
      ) : null}

      <Leaderboard
        rows={technicians}
        sort={sort}
        onSortChange={onSortChange}
        technicianPath={(id) => `/dashboard/technicians/${encodeURIComponent(id)}?${kpiAddress(address)}`}
        onDownloadCsv={download}
      />

      {empty ? (
        compare ? <BranchComparison rows={branches} view={view} drawChart={false} /> : null
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="min-w-0">
            <JobsByTechnicianChart rows={ranked} view={view} />
          </div>
          <div className="min-w-0">
            <TrendChart points={trend} view={view} />
          </div>
          <div className={`min-w-0 ${compare ? '' : 'lg:col-span-2'}`}>
            <ReschedulesByReasonChart data={summary.reason_by_requester} />
          </div>
          {compare ? (
            <div className="min-w-0">
              <BranchComparison rows={branches} view={view} drawChart />
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
