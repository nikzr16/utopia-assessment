import { PageHeader } from '../../components/ui'
import { KPI_TREND_COUNTS, emptyPeriodMessage, isEmptyPeriod, periodRange, type KpiAddress } from '../../domain'
import { useLoad } from '../../lib/useLoad'
import { fetchKpiSummary, fetchKpiTechnicianEvents, fetchKpiTrend } from './api'
import { TrendChart } from './charts/TrendChart'
import { EventList } from './components/EventList'
import { EmptyPeriod, KpiError, KpiLoading } from './components/KpiState'
import { PeriodPicker } from './components/PeriodPicker'
import { SummaryCards } from './components/SummaryCards'
import { addressKey, useKpiAddress } from './useKpiAddress'

/**
 * "My week" for a technician (PRD Q1): only their own cards, trend and the jobs
 * behind them. The database returns nothing else (no leaderboard, no rank, no
 * other names), and nothing here asks for it.
 */
export function MyWeekPage({ staffId }: { staffId: string }) {
  const [address, setAddress] = useKpiAddress()
  return (
    <div className="space-y-5">
      <PageHeader title="My week" description="Your approved jobs, money and ratings." />
      <PeriodPicker view={address.view} start={address.start} onChange={setAddress} />
      <MyWeekBody key={addressKey(address)} staffId={staffId} address={address} />
    </div>
  )
}

function MyWeekBody({ staffId, address }: { staffId: string; address: KpiAddress }) {
  const { view, start } = address
  const period = periodRange(view, start)
  const [state, reload] = useLoad(async () => {
    const [summary, trend, events] = await Promise.all([
      fetchKpiSummary(period.start, period.end, null),
      fetchKpiTrend(view, period.end, KPI_TREND_COUNTS[view], null, staffId),
      fetchKpiTechnicianEvents(staffId, period.start, period.end, null),
    ])
    return { summary, trend, events }
  }, addressKey(address))

  if (state.status === 'loading') return <KpiLoading what="your numbers" tiles={5} />
  if (state.status === 'error') return <KpiError message={state.message} onRetry={reload} />

  const { summary, trend, events } = state.data
  const { active_technicians: _team, ...mine } = summary
  return (
    <div className="space-y-5">
      <SummaryCards figures={mine} />
      {isEmptyPeriod(summary) ? (
        <EmptyPeriod message={emptyPeriodMessage(view)}>Jobs are counted when a Manager approves them.</EmptyPeriod>
      ) : (
        <TrendChart points={trend} view={view} title="My jobs completed over time" />
      )}
      <EventList events={events} orderPath={(orderNo) => `/jobs/${encodeURIComponent(orderNo)}`} />
    </div>
  )
}
