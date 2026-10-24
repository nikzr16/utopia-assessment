import { useParams } from 'react-router'
import { UserRound } from 'lucide-react'
import { KPI_TREND_COUNTS, emptyPeriodMessage, isEmptyPeriod, kpiAddress, periodRange, staffLabel, type KpiAddress } from '../../domain'
import { useLoad } from '../../lib/useLoad'
import { fetchKpiTechnicianEvents, fetchKpiTechnicians, fetchKpiTrend } from './api'
import { TrendChart } from './charts/TrendChart'
import { EventList } from './components/EventList'
import { EmptyPeriod, KpiError, KpiLoading } from './components/KpiState'
import { PeriodPicker } from './components/PeriodPicker'
import { SummaryCards } from './components/SummaryCards'
import { addressKey, useKpiAddress } from './useKpiAddress'
import { BackLink, Badge, EmptyState, PageHeader } from '../../components/ui'

/**
 * One technician for the chosen period (PRD Q16): their cards, their trend and
 * the jobs, reschedules and returns behind each number. Each order opens in
 * the person's own portal through `orderPath`.
 */
export function TechnicianKpiPage({ orderPath }: { orderPath: (orderNo: string) => string }) {
  const { technicianId = '' } = useParams()
  const [address, setAddress] = useKpiAddress()
  const back = `/dashboard?${kpiAddress(address)}`

  return (
    <div className="space-y-5">
      <BackLink to={back}>Back to the dashboard</BackLink>
      <PeriodPicker view={address.view} start={address.start} onChange={setAddress} />
      <TechnicianBody key={`${technicianId}|${addressKey(address)}`} technicianId={technicianId} address={address} orderPath={orderPath} />
    </div>
  )
}

function TechnicianBody({
  technicianId,
  address,
  orderPath,
}: {
  technicianId: string
  address: KpiAddress
  orderPath: (orderNo: string) => string
}) {
  const { view, start, branch } = address
  const period = periodRange(view, start)
  const [state, reload] = useLoad(async () => {
    const [technicians, events, trend] = await Promise.all([
      fetchKpiTechnicians(period.start, period.end, branch),
      fetchKpiTechnicianEvents(technicianId, period.start, period.end, branch),
      fetchKpiTrend(view, period.end, KPI_TREND_COUNTS[view], branch, technicianId),
    ])
    return { row: technicians.find((t) => t.id === technicianId) ?? null, events, trend }
  }, `${technicianId}|${addressKey(address)}`)

  if (state.status === 'loading') return <KpiLoading what="the technician" tiles={5} />
  if (state.status === 'error') return <KpiError message={state.message} onRetry={reload} />

  const { row, events, trend } = state.data
  if (!row) {
    return (
      <EmptyState title="No numbers for this technician" icon={<UserRound className="size-5" />}>
        This person was not listed for this period and branch.
      </EmptyState>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 sm:gap-4">
        <span
          aria-hidden="true"
          className="inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand ring-1 ring-inset ring-brand/25"
        >
          <UserRound className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <PageHeader
            row
            title={staffLabel(row.name, row.active)}
            description={row.branch_name}
            actions={row.needs_attention ? <Badge tone="warning">Needs attention</Badge> : null}
          />
        </div>
      </div>
      <SummaryCards figures={row} />
      {isEmptyPeriod(row) ? (
        <EmptyPeriod message={emptyPeriodMessage(view)}>Jobs are counted when a Manager approves them.</EmptyPeriod>
      ) : (
        <TrendChart points={trend} view={view} title="Jobs completed over time" />
      )}
      <EventList events={events} orderPath={orderPath} />
    </div>
  )
}
