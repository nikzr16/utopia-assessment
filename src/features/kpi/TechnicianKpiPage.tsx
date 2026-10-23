import { Link, useParams } from 'react-router'
import { Notice } from '../../components/Notice'
import { CARD, LINK } from '../../components/styles'
import { KPI_TREND_COUNTS, emptyPeriodMessage, isEmptyPeriod, kpiAddress, periodRange, staffLabel, type KpiAddress } from '../../domain'
import { useLoad } from '../../lib/useLoad'
import { fetchKpiTechnicianEvents, fetchKpiTechnicians, fetchKpiTrend } from './api'
import { TrendChart } from './charts/TrendChart'
import { EventList } from './components/EventList'
import { KpiError, KpiLoading } from './components/KpiState'
import { PeriodPicker } from './components/PeriodPicker'
import { SummaryCards } from './components/SummaryCards'
import { addressKey, useKpiAddress } from './useKpiAddress'

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
      <Link to={back} className={`${LINK} inline-block text-sm`}>
        ← Back to the dashboard
      </Link>
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

  if (state.status === 'loading') return <KpiLoading what="the technician" />
  if (state.status === 'error') return <KpiError message={state.message} onRetry={reload} />

  const { row, events, trend } = state.data
  if (!row) {
    return (
      <Notice title="No numbers for this technician">
        <p>This person was not listed for this period and branch.</p>
      </Notice>
    )
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold">{staffLabel(row.name, row.active)}</h2>
        <p className="text-sm text-slate-600">{row.branch_name}</p>
      </div>
      <SummaryCards figures={row} />
      {isEmptyPeriod(row) ? (
        <div className={CARD} role="status">
          <p className="font-medium">{emptyPeriodMessage(view)}</p>
          <p className="mt-1 text-sm text-slate-600">Jobs are counted when a Manager approves them.</p>
        </div>
      ) : (
        <TrendChart points={trend} view={view} title="Jobs completed over time" />
      )}
      <EventList events={events} orderPath={orderPath} />
    </div>
  )
}
