// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../src/App'
import { CSV_BOM, addDays, type StaffRole } from '../../src/domain'
import type { AuthState } from '../../src/features/auth'
import * as auth from '../../src/features/auth'
import * as notificationsApi from '../../src/features/notifications/api'
import * as jobsApi from '../../src/features/jobs/api'
import * as reviewApi from '../../src/features/order-review/api'
import * as api from '../../src/features/kpi/api'
import { downloadTextFile } from '../../src/features/kpi/download'
import { DashboardRoutes, MyWeek } from '../../src/features/kpi'
import './fixtures'

vi.mock('../../src/features/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof auth>()
  return { ...actual, AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>, useAuth: vi.fn() }
})
vi.mock('../../src/features/kpi/api', async (importOriginal) => {
  const actual = await importOriginal<typeof api>()
  return {
    ...actual,
    fetchKpiSummary: vi.fn(),
    fetchKpiTechnicians: vi.fn(),
    fetchKpiBranches: vi.fn(),
    fetchKpiTrend: vi.fn(),
    fetchKpiTechnicianEvents: vi.fn(),
    fetchKpiBranchOptions: vi.fn(),
    fetchInsightFacts: vi.fn(),
    fetchInsightWording: vi.fn(),
  }
})
vi.mock('../../src/features/kpi/download', () => ({ downloadTextFile: vi.fn() }))
vi.mock('../../src/features/jobs/api', async (importOriginal) => ({
  ...(await importOriginal<typeof jobsApi>()),
  fetchMyJobs: vi.fn(),
}))
vi.mock('../../src/features/notifications/api', async (importOriginal) => ({
  ...(await importOriginal<typeof notificationsApi>()),
  fetchUnreadCount: vi.fn(),
  subscribeToNotifications: vi.fn(),
}))
vi.mock('../../src/features/order-review/api', async (importOriginal) => ({
  ...(await importOriginal<typeof reviewApi>()),
  fetchManagerOrders: vi.fn(),
  fetchFinanceOrders: vi.fn(),
  fetchCoveredBranches: vi.fn(),
  fetchBranches: vi.fn(),
}))
vi.mock('../../src/features/orders/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/features/orders/api')>()),
  listOrders: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
  fetchReferenceData: vi.fn().mockResolvedValue({ branches: [], serviceTypes: [], technicians: [] }),
}))

const m = vi.mocked(api)
const download = vi.mocked(downloadTextFile)

// "Today" is Saturday 24 Oct 2026 (Malaysia): this week starts Monday 19 Oct.
const NOW = new Date('2026-10-24T04:00:00Z')

beforeAll(async () => {
  // The dashboard loads on demand; the first import transforms Recharts, which can take
  // longer than a test may wait, so load the chunk once up front.
  await Promise.all([import('../../src/features/kpi/KpiRoutes'), import('../../src/features/kpi/MyWeekPage')])
  // Recharts measures its container; jsdom has no layout and no ResizeObserver.
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

const BRANCHES = [
  { id: 'b-kl', name: 'Kuala Lumpur' },
  { id: 'b-pg', name: 'Penang' },
  { id: 'b-sa', name: 'Shah Alam' },
]

function reasonByRequester(): api.ReasonByRequester {
  const out = {} as api.ReasonByRequester
  for (const reason of api.RESCHEDULE_REASONS) out[reason] = { customer: 0, technician: 0, admin: 0 }
  out.customer_not_home.customer = 2
  out.parts_unavailable.technician = 1
  return out
}

const summary = (over: Partial<api.KpiSummary> = {}): api.KpiSummary => ({
  jobs_completed: 13,
  total_amount: 3900,
  collected: 3300.5,
  rescheduled: 2,
  postponed: 1,
  requested_by_customer: 2,
  requested_by_technician: 1,
  requested_by_admin: 0,
  reason_customer_not_home: 2,
  reason_parts_unavailable: 1,
  reason_weather: 0,
  reason_technician_unavailable: 0,
  reason_other: 0,
  reason_by_requester: reasonByRequester(),
  returned: 3,
  rated: 5,
  average_rating: 3.9,
  poor_ratings: 1,
  active_technicians: 3,
  ...over,
})

const EMPTY_SUMMARY = summary({
  jobs_completed: 0,
  total_amount: 0,
  collected: 0,
  rescheduled: 0,
  postponed: 0,
  requested_by_customer: 0,
  requested_by_technician: 0,
  reason_customer_not_home: 0,
  reason_parts_unavailable: 0,
  reason_by_requester: Object.fromEntries(
    api.RESCHEDULE_REASONS.map((r) => [r, { customer: 0, technician: 0, admin: 0 }]),
  ) as api.ReasonByRequester,
  returned: 0,
  rated: 0,
  average_rating: null,
  poor_ratings: 0,
})

const tech = (over: Partial<api.KpiTechnicianRow>): api.KpiTechnicianRow => ({
  id: 't-ali',
  name: 'Ali',
  active: true,
  branch_id: 'b-sa',
  branch_name: 'Shah Alam',
  jobs_completed: 0,
  total_amount: 0,
  collected: 0,
  rescheduled: 0,
  postponed: 0,
  reschedules: 0,
  requested_by_customer: 0,
  requested_by_technician: 0,
  requested_by_admin: 0,
  reason_customer_not_home: 0,
  reason_parts_unavailable: 0,
  reason_weather: 0,
  reason_technician_unavailable: 0,
  reason_other: 0,
  returned: 0,
  rated: 0,
  average_rating: null,
  poor_ratings: 0,
  rank: 1,
  needs_attention: false,
  ...over,
})

// Default order: Ali 8 jobs, Bala and Chong tie on 5 jobs / RM 1,500 (rank 2, 2), Dev 0 jobs (rank 4).
const TECHS: api.KpiTechnicianRow[] = [
  tech({ id: 't-ali', name: 'Ali', jobs_completed: 8, total_amount: 2400, collected: 1800, rescheduled: 1, postponed: 1, reschedules: 2, rated: 3, average_rating: 4.5, rank: 1 }),
  tech({ id: 't-bala', name: 'Bala', jobs_completed: 5, total_amount: 1500, collected: 1500.5, returned: 3, needs_attention: true, rated: 2, average_rating: 3, poor_ratings: 1, rank: 2 }),
  tech({ id: 't-chong', name: 'Chong', jobs_completed: 5, total_amount: 1500, collected: 0, reschedules: 1, rescheduled: 1, rated: 1, average_rating: 4, rank: 2, branch_id: 'b-kl', branch_name: 'Kuala Lumpur' }),
  tech({ id: 't-dev', name: 'Dev', active: false, rank: 4 }),
]

const BRANCH_ROWS: api.KpiBranchRow[] = [
  { branch_id: 'b-kl', branch_name: 'Kuala Lumpur', jobs_completed: 5, total_amount: 1500, collected: 0, rescheduled: 1, postponed: 0, reschedules: 1, returned: 0, rated: 1, average_rating: 4, poor_ratings: 0, active_technicians: 1 },
  { branch_id: 'b-sa', branch_name: 'Shah Alam', jobs_completed: 8, total_amount: 2400, collected: 1800, rescheduled: 1, postponed: 1, reschedules: 2, returned: 0, rated: 3, average_rating: 4.5, poor_ratings: 0, active_technicians: 2 },
]

const trend = (n: number, unit: 'week' | 'month'): api.KpiTrendPoint[] =>
  Array.from({ length: n }, (_, i) => ({
    period_start: unit === 'week' ? addDays('2026-09-07', i * 7) : `2026-0${i + 4}-01`,
    period_end: '2026-10-01',
    jobs_completed: i,
    total_amount: i * 100,
    reschedules: 0,
    average_rating: i === 0 ? null : 4,
  }))

const EVENTS: api.KpiEvent[] = [
  { kind: 'completed', order_id: 'o-1', order_no: 'ORDER1001', service_type: 'Repair', branch_id: 'b-sa', branch_name: 'Shah Alam', happened_at: '2026-10-21T02:30:00+00:00', amount: 180, rating: 5, working_well: true, reason: null, requested_by: null, note: null },
  { kind: 'completed', order_id: 'o-2', order_no: 'ORDER1002', service_type: 'Aircond cleaning', branch_id: 'b-sa', branch_name: 'Shah Alam', happened_at: '2026-10-22T02:30:00+00:00', amount: 120, rating: 2, working_well: false, reason: null, requested_by: null, note: null },
  { kind: 'rescheduled', order_id: 'o-3', order_no: 'ORDER1003', service_type: 'Repair', branch_id: 'b-sa', branch_name: 'Shah Alam', happened_at: '2026-10-20T02:00:00+00:00', amount: null, rating: null, working_well: null, reason: 'customer_not_home', requested_by: 'customer', note: 'Gate was locked' },
  { kind: 'returned', order_id: 'o-4', order_no: 'ORDER1004', service_type: 'Repair', branch_id: 'b-sa', branch_name: 'Shah Alam', happened_at: '2026-10-23T02:00:00+00:00', amount: null, rating: null, working_well: null, reason: null, requested_by: null, note: 'Photos missing' },
]

function Where() {
  const loc = useLocation()
  return <p data-testid="where">{loc.pathname + loc.search}</p>
}

function renderDashboard(url: string, role: StaffRole = 'admin') {
  const orderPath = (no: string) => (role === 'manager' ? `/review/${no}` : role === 'finance' ? `/finance/${no}` : `/orders/${no}`)
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/dashboard/*" element={<DashboardRoutes role={role} orderPath={orderPath} />} />
        <Route path="/my-week" element={<MyWeek staffId="t-ali" />} />
        <Route path="*" element={<p>Elsewhere</p>} />
      </Routes>
      <Where />
    </MemoryRouter>,
  )
}

const where = () => screen.getByTestId('where').textContent
const leaderboard = () => screen.getByRole('table', { name: 'Technician leaderboard' })
/** Names in the table, top to bottom. */
const tableNames = () =>
  within(leaderboard())
    .getAllByRole('row')
    .slice(1)
    .map((r) => within(r).getAllByRole('cell')[1].textContent!.replace('Needs attention', '').trim())

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  m.fetchKpiSummary.mockReset().mockResolvedValue(summary())
  m.fetchKpiTechnicians.mockReset().mockResolvedValue(TECHS)
  m.fetchKpiBranches.mockReset().mockResolvedValue(BRANCH_ROWS)
  m.fetchKpiTrend.mockReset().mockImplementation(async (unit, _end, count) => trend(count, unit))
  m.fetchKpiTechnicianEvents.mockReset().mockResolvedValue(EVENTS)
  m.fetchKpiBranchOptions.mockReset().mockResolvedValue(BRANCHES)
  m.fetchInsightFacts.mockReset().mockResolvedValue([])
  m.fetchInsightWording.mockReset().mockResolvedValue({ sentences: [], tip: null, source: 'fixed' })
  download.mockReset()
  vi.mocked(jobsApi.fetchMyJobs).mockReset().mockResolvedValue([])
  vi.mocked(notificationsApi.fetchUnreadCount).mockReset().mockResolvedValue(0)
  vi.mocked(notificationsApi.subscribeToNotifications).mockReset().mockReturnValue(() => {})
  vi.mocked(reviewApi.fetchManagerOrders).mockReset().mockResolvedValue([])
  vi.mocked(reviewApi.fetchFinanceOrders).mockReset().mockResolvedValue([])
  vi.mocked(reviewApi.fetchCoveredBranches).mockReset().mockResolvedValue([{ id: 'b-sa', name: 'Shah Alam' }])
  vi.mocked(reviewApi.fetchBranches).mockReset().mockResolvedValue([])
  window.history.replaceState(null, '', '/')
})
afterEach(() => vi.useRealTimers())

describe('Dashboard: period and address (AC8)', () => {
  it('opens on this week for all branches and asks the database for Monday to the next Monday', async () => {
    renderDashboard('/dashboard')
    expect(await screen.findByRole('region', { name: 'Summary' })).toBeTruthy()
    expect(screen.getByText('Mon 19 – Sun 25 Oct 2026')).toBeTruthy()
    expect(m.fetchKpiSummary).toHaveBeenCalledWith('2026-10-19', '2026-10-26', null)
    expect(m.fetchKpiTechnicians).toHaveBeenCalledWith('2026-10-19', '2026-10-26', null)
    expect(m.fetchKpiBranches).toHaveBeenCalledWith('2026-10-19', '2026-10-26')
    // The 8-week trend ends with the chosen week.
    expect(m.fetchKpiTrend).toHaveBeenCalledWith('week', '2026-10-26', 8, null)
    expect(screen.getByRole('button', { name: 'This week', pressed: true })).toBeTruthy()
  })

  it('reads view, start and branch from the address, so a reload keeps the choice', async () => {
    renderDashboard('/dashboard?view=month&start=2026-09-17&branch=b-sa')
    expect(await screen.findByRole('region', { name: 'Summary' })).toBeTruthy()
    expect(screen.getByText('September 2026')).toBeTruthy()
    expect(m.fetchKpiSummary).toHaveBeenCalledWith('2026-09-01', '2026-10-01', 'b-sa')
    expect(m.fetchKpiTrend).toHaveBeenCalledWith('month', '2026-10-01', 6, 'b-sa')
    expect(screen.getByRole('button', { name: 'Month', pressed: true })).toBeTruthy()
    expect((screen.getByLabelText('Branch') as HTMLSelectElement).value).toBe('b-sa')
  })

  it('falls back to this week when the address is invalid or in the future', async () => {
    renderDashboard('/dashboard?view=year&start=2030-01-07')
    expect(await screen.findByRole('region', { name: 'Summary' })).toBeTruthy()
    expect(m.fetchKpiSummary).toHaveBeenCalledWith('2026-10-19', '2026-10-26', null)
  })

  it('steps with the arrows, Last week and This week, writing each choice to the address', async () => {
    const user = userEvent.setup()
    renderDashboard('/dashboard')
    await screen.findByRole('region', { name: 'Summary' })
    // No future periods.
    expect((screen.getByRole('button', { name: 'Next week' }) as HTMLButtonElement).disabled).toBe(true)

    await user.click(screen.getByRole('button', { name: 'Previous week' }))
    await screen.findByText('Mon 12 – Sun 18 Oct 2026')
    expect(where()).toBe('/dashboard?view=week&start=2026-10-12')
    expect(m.fetchKpiSummary).toHaveBeenLastCalledWith('2026-10-12', '2026-10-19', null)
    expect((screen.getByRole('button', { name: 'Next week' }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getByRole('button', { name: 'Last week', pressed: true })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Previous week' }))
    await screen.findByText('Mon 5 – Sun 11 Oct 2026')
    await user.click(screen.getByRole('button', { name: 'This week' }))
    await screen.findByText('Mon 19 – Sun 25 Oct 2026')
    expect(where()).toBe('/dashboard?view=week&start=2026-10-19')

    await user.click(screen.getByRole('button', { name: 'Last week' }))
    await screen.findByText('Mon 12 – Sun 18 Oct 2026')
    await user.click(screen.getByRole('button', { name: 'Next week' }))
    await screen.findByText('Mon 19 – Sun 25 Oct 2026')
  })

  it('switches to Month (calendar months, 6-month trend) and steps across a year end', async () => {
    const user = userEvent.setup()
    renderDashboard('/dashboard?view=week&start=2026-01-05')
    await screen.findByRole('region', { name: 'Summary' })
    await user.click(screen.getByRole('button', { name: 'Month' }))
    await screen.findByText('January 2026')
    expect(where()).toBe('/dashboard?view=month&start=2026-01-01')
    expect(m.fetchKpiSummary).toHaveBeenLastCalledWith('2026-01-01', '2026-02-01', null)
    expect(m.fetchKpiTrend).toHaveBeenLastCalledWith('month', '2026-02-01', 6, null)
    await user.click(screen.getByRole('button', { name: 'Previous month' }))
    await screen.findByText('December 2025')
    expect(m.fetchKpiSummary).toHaveBeenLastCalledWith('2025-12-01', '2026-01-01', null)
    await user.click(screen.getByRole('button', { name: 'This month' }))
    await screen.findByText('October 2026')
    expect(screen.getByRole('button', { name: 'Last month' })).toBeTruthy()
  })

  it('a date picked in a week snaps to that week; a future date is held at this week', async () => {
    renderDashboard('/dashboard')
    await screen.findByRole('region', { name: 'Summary' })
    const date = screen.getByLabelText('Go to a date') as HTMLInputElement
    expect(date.max).toBe('2026-10-24')
    fireEvent.change(date, { target: { value: '2026-10-14' } }) // a Wednesday
    await screen.findByText('Mon 12 – Sun 18 Oct 2026')
    expect(where()).toBe('/dashboard?view=week&start=2026-10-12')
    fireEvent.change(date, { target: { value: '2026-11-20' } })
    await screen.findByText('Mon 19 – Sun 25 Oct 2026')
  })
})

describe('Dashboard: branch filter (AC9)', () => {
  it('offers every branch to an Admin and writes the choice to the address', async () => {
    const user = userEvent.setup()
    renderDashboard('/dashboard', 'admin')
    const select = (await screen.findByLabelText('Branch')) as HTMLSelectElement
    expect(m.fetchKpiBranchOptions).toHaveBeenCalledWith('admin')
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['All branches', 'Kuala Lumpur', 'Penang', 'Shah Alam'])
    await user.selectOptions(select, 'b-pg')
    await waitFor(() => expect(where()).toBe('/dashboard?view=week&start=2026-10-19&branch=b-pg'))
    expect(m.fetchKpiSummary).toHaveBeenLastCalledWith('2026-10-19', '2026-10-26', 'b-pg')
    await user.selectOptions(select, '')
    await waitFor(() => expect(where()).toBe('/dashboard?view=week&start=2026-10-19'))
  })

  it('offers a Manager only the branches they cover, as "All my branches"', async () => {
    m.fetchKpiBranchOptions.mockResolvedValue([BRANCHES[0], BRANCHES[2]])
    renderDashboard('/dashboard', 'manager')
    const select = (await screen.findByLabelText('Branch')) as HTMLSelectElement
    expect(m.fetchKpiBranchOptions).toHaveBeenCalledWith('manager')
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['All my branches', 'Kuala Lumpur', 'Shah Alam'])
  })

  it('hides the filter, and the comparison, for a Manager with one branch', async () => {
    m.fetchKpiBranchOptions.mockResolvedValue([BRANCHES[2]])
    m.fetchKpiBranches.mockResolvedValue([BRANCH_ROWS[1]])
    renderDashboard('/dashboard', 'manager')
    await screen.findByRole('region', { name: 'Summary' })
    await waitFor(() => expect(m.fetchKpiBranchOptions).toHaveBeenCalled())
    expect(screen.queryByLabelText('Branch')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Branch comparison' })).toBeNull()
  })

  it('shows a Manager the plain-language refusal for a branch they do not cover, and a way back', async () => {
    const user = userEvent.setup()
    m.fetchKpiSummary.mockRejectedValue(new api.ApiError('You can only see the branches you cover'))
    renderDashboard('/dashboard?branch=b-pg', 'manager')
    expect(await screen.findByText('You can only see the branches you cover')).toBeTruthy()
    m.fetchKpiSummary.mockResolvedValue(summary())
    await user.click(screen.getByRole('button', { name: 'Show all branches' }))
    expect(await screen.findByRole('region', { name: 'Summary' })).toBeTruthy()
    expect(where()).toBe('/dashboard?view=week&start=2026-10-19')
  })
})

describe('Dashboard: cards (AC4, AC5, AC6, AC7, AC10)', () => {
  it('shows each figure with its hint, Collected beside the amount, and the team size', async () => {
    renderDashboard('/dashboard')
    const cards = within(await screen.findByRole('region', { name: 'Summary' }))
    const card = (label: string) => cards.getByText(label).closest('div')!
    expect(within(card('Jobs completed')).getByText('13')).toBeTruthy()
    expect(within(card('Jobs completed')).getByText('Counted when a Manager approves the job')).toBeTruthy()
    expect(within(card('Total amount')).getByText('RM 3,900.00')).toBeTruthy()
    expect(within(card('Total amount')).getByText('Collected RM 3,300.50')).toBeTruthy()
    expect(within(card('Rescheduled / Postponed')).getByText('2 / 1')).toBeTruthy()
    expect(within(card('Rescheduled / Postponed')).getByText('Asked by customer 2, technician 1, admin 0')).toBeTruthy()
    expect(within(card('Returned')).getByText('3')).toBeTruthy()
    expect(within(card('Average rating')).getByText('3.9')).toBeTruthy()
    expect(within(card('Average rating')).getByText('5 of 13 rated, 1 poor')).toBeTruthy()
    expect(within(card('Active technicians')).getByText('3')).toBeTruthy()
  })

  it('shows a dash for an average when nothing is rated', async () => {
    m.fetchKpiSummary.mockResolvedValue(summary({ rated: 0, average_rating: null, poor_ratings: 0 }))
    renderDashboard('/dashboard')
    const cards = within(await screen.findByRole('region', { name: 'Summary' }))
    const card = cards.getByText('Average rating').closest('div')!
    expect(within(card).getByText('–')).toBeTruthy()
    expect(within(card).getByText('0 of 13 rated, 0 poor')).toBeTruthy()
  })
})

describe('Dashboard: leaderboard (AC10, AC11)', () => {
  it('lists every technician in rank order with tied ranks, zeros, and the (inactive) and Needs attention tags', async () => {
    renderDashboard('/dashboard')
    await screen.findByRole('region', { name: 'Summary' })
    const rows = within(leaderboard()).getAllByRole('row').slice(1)
    const cell = (i: number, c: number) => within(rows[i]).getAllByRole('cell')[c].textContent
    expect(tableNames()).toEqual(['Ali', 'Bala', 'Chong', 'Dev (inactive)'])
    expect([0, 1, 2, 3].map((i) => cell(i, 0))).toEqual(['1', '2', '2', '4'])
    // Ali: branch, jobs, amount, collected, reschedules, returned, rating, poor.
    expect([2, 3, 4, 5, 6, 7, 9].map((c) => cell(0, c))).toEqual(['Shah Alam', '8', 'RM 2,400.00', 'RM 1,800.00', '2', '0', '0'])
    expect(cell(0, 8)).toBe('4.53 of 8 rated')
    // A technician with nothing shows zeros and a dash.
    expect([3, 4, 5, 6, 7, 9].map((c) => cell(3, c))).toEqual(['0', 'RM 0.00', 'RM 0.00', '0', '0', '0'])
    expect(cell(3, 8)).toBe('–0 of 0 rated')
    expect(within(rows[1]).getByText('Needs attention')).toBeTruthy()
    expect(within(leaderboard()).getAllByText('Needs attention')).toHaveLength(1)
  })

  it('opens a technician for the same period, week and branch', async () => {
    renderDashboard('/dashboard?view=week&start=2026-10-12&branch=b-sa')
    await screen.findByRole('region', { name: 'Summary' })
    const link = within(leaderboard()).getByRole('link', { name: 'Ali' })
    expect(link.getAttribute('href')).toBe('/dashboard/technicians/t-ali?view=week&start=2026-10-12&branch=b-sa')
  })

  it('sorts by a header (aria-sort), flips on a second click, and keeps the default rank numbers', async () => {
    const user = userEvent.setup()
    renderDashboard('/dashboard')
    await screen.findByRole('region', { name: 'Summary' })
    const header = (name: string) => within(leaderboard()).getByRole('columnheader', { name: new RegExp(`^${name}`) })
    expect(header('Rank').getAttribute('aria-sort')).toBe('ascending')
    expect(header('Jobs').getAttribute('aria-sort')).toBe('none')

    await user.click(within(header('Rating')).getByRole('button'))
    expect(header('Rating').getAttribute('aria-sort')).toBe('descending')
    expect(header('Rank').getAttribute('aria-sort')).toBe('none')
    // 4.5, 4.0, 3.0, then no rating last.
    expect(tableNames()).toEqual(['Ali', 'Chong', 'Bala', 'Dev (inactive)'])
    const ranks = within(leaderboard()).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0].textContent)
    expect(ranks).toEqual(['1', '2', '2', '4'])

    await user.click(within(header('Rating')).getByRole('button'))
    expect(header('Rating').getAttribute('aria-sort')).toBe('ascending')
    expect(tableNames()).toEqual(['Bala', 'Chong', 'Ali', 'Dev (inactive)'])

    await user.click(within(header('Technician')).getByRole('button'))
    expect(header('Technician').getAttribute('aria-sort')).toBe('ascending')
    expect(tableNames()).toEqual(['Ali', 'Bala', 'Chong', 'Dev (inactive)'])
    await user.click(within(header('Technician')).getByRole('button'))
    expect(tableNames()).toEqual(['Dev (inactive)', 'Chong', 'Bala', 'Ali'])

    await user.click(within(header('Rank')).getByRole('button'))
    expect(tableNames()).toEqual(['Ali', 'Bala', 'Chong', 'Dev (inactive)'])
  })

  it('keeps the chosen sort when the period changes', async () => {
    const user = userEvent.setup()
    renderDashboard('/dashboard')
    await screen.findByRole('region', { name: 'Summary' })
    await user.click(within(within(leaderboard()).getByRole('columnheader', { name: /^Rating/ })).getByRole('button'))
    await user.click(screen.getByRole('button', { name: 'Previous week' }))
    await screen.findByText('Mon 12 – Sun 18 Oct 2026')
    await screen.findByRole('table', { name: 'Technician leaderboard' })
    expect(within(leaderboard()).getByRole('columnheader', { name: /^Rating/ }).getAttribute('aria-sort')).toBe('descending')
  })

  it('shows cards with a Sort by picker below 768 px', async () => {
    const user = userEvent.setup()
    renderDashboard('/dashboard')
    await screen.findByRole('region', { name: 'Summary' })
    const cards = screen.getByRole('list', { name: 'Leaderboard cards' })
    const names = () => within(cards).getAllByRole('listitem').map((li) => within(li).getAllByRole('link')[0].textContent)
    expect(names()).toEqual(['Ali', 'Bala', 'Chong', 'Dev (inactive)'])
    const first = within(cards).getAllByRole('listitem')[0]
    expect(within(first).getByText('RM 2,400.00')).toBeTruthy()
    expect(within(first).getByText('4.5 (3 of 8 rated)')).toBeTruthy()
    expect(within(within(cards).getAllByRole('listitem')[1]).getByText('Needs attention')).toBeTruthy()

    await user.selectOptions(screen.getByLabelText('Sort by'), 'name')
    expect(names()).toEqual(['Ali', 'Bala', 'Chong', 'Dev (inactive)'])
    await user.click(screen.getByRole('button', { name: /Order: ascending/ }))
    expect(names()).toEqual(['Dev (inactive)', 'Chong', 'Bala', 'Ali'])
  })
})

describe('Dashboard: empty period (AC10)', () => {
  it('says no jobs were completed, keeps the zero cards and the listed technicians, and draws no charts', async () => {
    m.fetchKpiSummary.mockResolvedValue(EMPTY_SUMMARY)
    m.fetchKpiTechnicians.mockResolvedValue(TECHS.map((t) => tech({ id: t.id, name: t.name, active: t.active, rank: 1 })))
    renderDashboard('/dashboard')
    expect(await screen.findByText('No jobs completed in this week')).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'Summary' })).getByText('RM 0.00')).toBeTruthy()
    expect(tableNames()).toEqual(['Ali', 'Bala', 'Chong', 'Dev (inactive)'])
    expect(screen.queryByRole('heading', { name: 'Jobs completed per technician' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Jobs completed over time' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Reschedules and postponements by reason' })).toBeNull()
    // The comparison is only a table.
    const comparison = screen.getByRole('region', { name: 'Branch comparison' })
    expect(within(comparison).getByRole('table')).toBeTruthy()
    expect(within(comparison).queryByRole('button', { name: 'Show as table' })).toBeNull()
  })

  it('says "this month" in the Month view', async () => {
    m.fetchKpiSummary.mockResolvedValue(EMPTY_SUMMARY)
    renderDashboard('/dashboard?view=month&start=2026-09-01')
    expect(await screen.findByText('No jobs completed in this month')).toBeTruthy()
  })

  it('is not empty when only a payment, a reschedule or a return was counted', async () => {
    m.fetchKpiSummary.mockResolvedValue({ ...EMPTY_SUMMARY, returned: 1 })
    renderDashboard('/dashboard')
    await screen.findByRole('region', { name: 'Summary' })
    expect(screen.queryByText('No jobs completed in this week')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Jobs completed per technician' })).toBeTruthy()
  })
})

describe('Dashboard: charts and their table views (AC12)', () => {
  const panel = (name: string) => within(screen.getByRole('region', { name }))

  it('gives each chart a name that lists its figures and a Show as table switch with the same numbers', async () => {
    const user = userEvent.setup()
    renderDashboard('/dashboard')
    await screen.findByRole('region', { name: 'Summary' })

    const jobs = screen.getByRole('img', { name: /^Jobs completed per technician\./ })
    expect(jobs.getAttribute('aria-label')).toContain('Ali 8, Bala 5, Chong 5, Dev (inactive) 0')
    await user.click(panel('Jobs completed per technician').getByRole('button', { name: 'Show as table' }))
    const jobsTable = panel('Jobs completed per technician').getByRole('table')
    expect(within(jobsTable).getAllByRole('row').map((r) => r.textContent)).toEqual([
      'TechnicianJobs completed',
      'Ali8',
      'Bala5',
      'Chong5',
      'Dev (inactive)0',
    ])
    expect(panel('Jobs completed per technician').getByRole('button', { name: 'Show as chart', pressed: true })).toBeTruthy()
    await user.click(panel('Jobs completed per technician').getByRole('button', { name: 'Show as chart' }))
    expect(screen.getByRole('img', { name: /^Jobs completed per technician\./ })).toBeTruthy()

    await user.click(panel('Jobs completed over time').getByRole('button', { name: 'Show as table' }))
    const trendRows = within(panel('Jobs completed over time').getByRole('table')).getAllByRole('row')
    expect(trendRows).toHaveLength(9) // header + 8 weeks
    expect(trendRows[1].textContent).toBe('Mon 7 – Sun 13 Sep 20260RM 0.000–')
    expect(trendRows[2].textContent).toBe('Mon 14 – Sun 20 Sep 20261RM 100.0004.0')

    const reasons = panel('Reschedules and postponements by reason')
    expect(screen.getByRole('img', { name: /Customer not home 2 \(customer 2, technician 0, admin 0\)/ })).toBeTruthy()
    await user.click(reasons.getByRole('button', { name: 'Show as table' }))
    expect(within(reasons.getByRole('table')).getAllByRole('row').map((r) => r.textContent)).toEqual([
      'ReasonCustomerTechnicianAdminTotal',
      'Customer not home2002',
      'Parts unavailable0101',
      'Weather0000',
      'Technician unavailable0000',
      'Other0000',
    ])
  })

  it('says so instead of drawing a chart with nothing in it', async () => {
    m.fetchKpiSummary.mockResolvedValue({ ...summary(), reason_by_requester: EMPTY_SUMMARY.reason_by_requester })
    m.fetchKpiTechnicians.mockResolvedValue(TECHS.map((t) => ({ ...t, jobs_completed: 0 })))
    renderDashboard('/dashboard')
    await screen.findByRole('region', { name: 'Summary' })
    expect(panel('Jobs completed per technician').getByText('No jobs completed in this week')).toBeTruthy()
    expect(panel('Reschedules and postponements by reason').getByText('No reschedules or postponements in this period')).toBeTruthy()
  })

  it('compares branches in a table and one measure at a time in the chart (no second axis)', async () => {
    const user = userEvent.setup()
    renderDashboard('/dashboard')
    await screen.findByRole('region', { name: 'Summary' })
    const comparison = panel('Branch comparison')
    expect(screen.getByRole('img', { name: /Jobs completed per branch this week: Kuala Lumpur 5 jobs, Shah Alam 8 jobs\./ })).toBeTruthy()
    const measures = comparison.getByRole('radiogroup', { name: 'Measure' })
    expect(within(measures).getAllByRole('radio').map((r) => r.textContent)).toEqual([
      'Jobs completed',
      'Total amount',
      'Reschedules',
      'Average rating',
    ])
    await user.click(within(measures).getByRole('radio', { name: 'Total amount' }))
    expect(screen.getByRole('img', { name: /Total amount per branch this week: Kuala Lumpur RM 1,500.00, Shah Alam RM 2,400.00\./ })).toBeTruthy()
    await user.click(within(measures).getByRole('radio', { name: 'Average rating' }))
    expect(screen.getByRole('img', { name: /Kuala Lumpur 4.0 stars on average, Shah Alam 4.5 stars on average/ })).toBeTruthy()

    await user.click(comparison.getByRole('button', { name: 'Show as table' }))
    expect(within(comparison.getByRole('table')).getAllByRole('row').map((r) => r.textContent)).toEqual([
      'BranchJobs completedTotal amountReschedulesAverage ratingActive technicians',
      'Kuala Lumpur5RM 1,500.0014.01',
      'Shah Alam8RM 2,400.0024.52',
    ])
  })
})

describe('Dashboard: CSV (AC14)', () => {
  it('downloads the leaderboard for the period and branch in the order shown, with a BOM and quoted fields', async () => {
    const user = userEvent.setup()
    m.fetchKpiTechnicians.mockResolvedValue([TECHS[0], { ...TECHS[1], name: 'Bala, "Big" Singh' }, TECHS[2], TECHS[3]])
    renderDashboard('/dashboard?view=week&start=2026-10-19&branch=b-sa')
    await screen.findByRole('region', { name: 'Summary' })
    await user.click(screen.getByRole('button', { name: 'Download CSV' }))
    expect(download).toHaveBeenCalledTimes(1)
    const [fileName, text] = download.mock.calls[0]
    expect(fileName).toBe('kpi-2026-W43-shah-alam.csv')
    expect(text.startsWith(CSV_BOM)).toBe(true)
    const lines = text.slice(1).trimEnd().split('\r\n')
    expect(lines[0]).toBe(
      'Rank,Technician,Status,Branch,Jobs completed,Total amount (MYR),Collected (MYR),Rescheduled,Postponed,Reschedules,Returned,Needs attention,Rated,Average rating,Poor ratings',
    )
    expect(lines).toHaveLength(5)
    expect(lines[1]).toBe('1,Ali,Active,Shah Alam,8,2400.00,1800.00,1,1,2,0,No,3,4.5,0')
    expect(lines[2]).toBe('2,"Bala, ""Big"" Singh",Active,Shah Alam,5,1500.00,1500.50,0,0,0,3,Yes,2,3.0,1')
    expect(lines[4]).toBe('4,Dev,Inactive,Shah Alam,0,0.00,0.00,0,0,0,0,No,0,,0')
  })

  it('names the file for all branches and for a month', async () => {
    const user = userEvent.setup()
    renderDashboard('/dashboard?view=month&start=2026-09-01')
    await screen.findByRole('region', { name: 'Summary' })
    await user.click(screen.getByRole('button', { name: 'Download CSV' }))
    expect(download.mock.calls[0][0]).toBe('kpi-2026-09-all-branches.csv')
  })

  it('follows the sorted table', async () => {
    const user = userEvent.setup()
    renderDashboard('/dashboard')
    await screen.findByRole('region', { name: 'Summary' })
    await user.click(within(within(leaderboard()).getByRole('columnheader', { name: /^Technician/ })).getByRole('button'))
    await user.click(within(within(leaderboard()).getByRole('columnheader', { name: /^Technician/ })).getByRole('button'))
    await user.click(screen.getByRole('button', { name: 'Download CSV' }))
    const rows = download.mock.calls[0][1].slice(1).trimEnd().split('\r\n').slice(1).map((l: string) => l.split(',')[1])
    expect(rows).toEqual(['Dev', 'Chong', 'Bala', 'Ali'])
  })
})

describe('Dashboard: loading and errors', () => {
  it('shows a loading note, then a message with Try again when the database says no', async () => {
    const user = userEvent.setup()
    m.fetchKpiTrend.mockRejectedValueOnce(new api.ApiError('Choose a period of up to a year'))
    renderDashboard('/dashboard')
    expect(await screen.findByText('Loading the dashboard…')).toBeTruthy()
    expect(await screen.findByText('Choose a period of up to a year')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('region', { name: 'Summary' })).toBeTruthy()
  })
})

describe('Technician page (AC16)', () => {
  it('shows the person, their cards, trend and the jobs, reschedules and returns behind them', async () => {
    renderDashboard('/dashboard/technicians/t-ali?view=week&start=2026-10-19&branch=b-sa', 'admin')
    expect(await screen.findByRole('heading', { name: 'Ali' })).toBeTruthy()
    expect(m.fetchKpiTechnicians).toHaveBeenCalledWith('2026-10-19', '2026-10-26', 'b-sa')
    expect(m.fetchKpiTechnicianEvents).toHaveBeenCalledWith('t-ali', '2026-10-19', '2026-10-26', 'b-sa')
    expect(m.fetchKpiTrend).toHaveBeenCalledWith('week', '2026-10-26', 8, 'b-sa', 't-ali')
    const cards = within(screen.getByRole('region', { name: 'Summary' }))
    expect(cards.getByText('RM 2,400.00')).toBeTruthy()
    expect(cards.queryByText('Active technicians')).toBeNull()

    const completed = within(screen.getByRole('region', { name: 'Completed jobs' }))
    expect(completed.getAllByRole('listitem')).toHaveLength(2)
    expect(completed.getByRole('link', { name: 'ORDER1001' }).getAttribute('href')).toBe('/orders/ORDER1001')
    expect(completed.getByText('Final amount RM 180.00 · Rated 5 of 5')).toBeTruthy()
    expect(completed.getByText('Final amount RM 120.00 · Rated 2 of 5, not working well')).toBeTruthy()
    expect(completed.getByText('Approved Wed 21 Oct 2026, 10:30 AM')).toBeTruthy()
    const resched = within(screen.getByRole('region', { name: 'Rescheduled' }))
    expect(resched.getByText('Reason: Customer not home · Asked by customer · Gate was locked')).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'Postponed (no new date)' })).getByText('No postponements in this period.')).toBeTruthy()
    const returned = within(screen.getByRole('region', { name: 'Returned for rework' }))
    expect(returned.getByText('Photos missing')).toBeTruthy()

    expect(screen.getByRole('link', { name: 'Back to the dashboard' }).getAttribute('href')).toBe(
      '/dashboard?view=week&start=2026-10-19&branch=b-sa',
    )
    // The trend is available as a table too.
    await userEvent.setup().click(within(screen.getByRole('region', { name: 'Jobs completed over time' })).getByRole('button', { name: 'Show as table' }))
    expect(within(screen.getByRole('region', { name: 'Jobs completed over time' })).getAllByRole('row')).toHaveLength(9)
  })

  it.each([
    ['manager', '/review/ORDER1001'],
    ['finance', '/finance/ORDER1001'],
  ] as const)('opens each order in the %s portal', async (role, href) => {
    renderDashboard('/dashboard/technicians/t-ali', role)
    const completed = within(await screen.findByRole('region', { name: 'Completed jobs' }))
    expect(completed.getByRole('link', { name: 'ORDER1001' }).getAttribute('href')).toBe(href)
  })

  it('tags an inactive technician and goes back a period with the same person', async () => {
    const user = userEvent.setup()
    renderDashboard('/dashboard/technicians/t-dev?view=week&start=2026-10-19')
    expect(await screen.findByRole('heading', { name: 'Dev (inactive)' })).toBeTruthy()
    expect(screen.getByText('No jobs completed in this week')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Previous week' }))
    await waitFor(() => expect(m.fetchKpiTechnicianEvents).toHaveBeenLastCalledWith('t-dev', '2026-10-12', '2026-10-19', null))
    expect(where()).toBe('/dashboard/technicians/t-dev?view=week&start=2026-10-12')
  })

  it('says so when the person has no numbers in the period and branch', async () => {
    renderDashboard('/dashboard/technicians/t-unknown')
    expect(await screen.findByText('No numbers for this technician')).toBeTruthy()
  })
})

describe('My week (technician, AC1)', () => {
  it('shows only the technician\'s own numbers: no leaderboard, no rank, no other names, no branch calls', async () => {
    const own = summary({ jobs_completed: 2, total_amount: 300, collected: 100, rescheduled: 0, postponed: 0, returned: 0, rated: 2, average_rating: 3.5, poor_ratings: 1 })
    m.fetchKpiSummary.mockResolvedValue(own)
    renderDashboard('/my-week')
    expect(await screen.findByRole('heading', { name: 'My week' })).toBeTruthy()
    const cards = within(await screen.findByRole('region', { name: 'Summary' }))
    expect(cards.getByText('RM 300.00')).toBeTruthy()
    expect(cards.getByText('3.5')).toBeTruthy()
    expect(cards.queryByText('Active technicians')).toBeNull()
    expect(m.fetchKpiSummary).toHaveBeenCalledWith('2026-10-19', '2026-10-26', null)
    expect(m.fetchKpiTrend).toHaveBeenCalledWith('week', '2026-10-26', 8, null, 't-ali')
    expect(m.fetchKpiTechnicianEvents).toHaveBeenCalledWith('t-ali', '2026-10-19', '2026-10-26', null)
    expect(m.fetchKpiTechnicians).not.toHaveBeenCalled()
    expect(m.fetchKpiBranches).not.toHaveBeenCalled()
    expect(m.fetchKpiBranchOptions).not.toHaveBeenCalled()
    expect(screen.queryByRole('heading', { name: 'Leaderboard' })).toBeNull()
    expect(screen.queryByLabelText('Branch')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Download CSV' })).toBeNull()
    for (const other of ['Bala', 'Chong', 'Dev']) expect(screen.queryByText(new RegExp(other))).toBeNull()
    const completed = within(screen.getByRole('region', { name: 'Completed jobs' }))
    expect(completed.getByRole('link', { name: 'ORDER1001' }).getAttribute('href')).toBe('/jobs/ORDER1001')
  })

  it('steps through weeks and months like the dashboard, and says when there is nothing', async () => {
    const user = userEvent.setup()
    m.fetchKpiSummary.mockResolvedValue(EMPTY_SUMMARY)
    m.fetchKpiTechnicianEvents.mockResolvedValue([])
    renderDashboard('/my-week')
    expect(await screen.findByText('No jobs completed in this week')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Month' }))
    expect(await screen.findByText('No jobs completed in this month')).toBeTruthy()
    expect(where()).toBe('/my-week?view=month&start=2026-10-01')
    expect(screen.queryByRole('heading', { name: 'My jobs completed over time' })).toBeNull()
  })
})

describe('Header links and who may open what (AC1, AC13)', () => {
  function signedInAs(role: StaffRole) {
    const state: AuthState = {
      status: 'signed-in',
      email: `${role}@sejuk.example.com`,
      profile: { status: 'ready', profile: { id: 't-ali', name: 'Staff', role, branchName: 'Shah Alam' } },
      signIn: vi.fn(),
      signOut: vi.fn(),
      reloadProfile: vi.fn(),
      notice: null,
    }
    vi.mocked(auth.useAuth).mockReturnValue(state)
  }

  it.each([
    ['admin', 'Admin', '/orders'],
    ['manager', 'Manager', '/review'],
    ['finance', 'Finance', '/finance'],
  ] as const)('%s has a Dashboard link that loads the dashboard on demand', async (role, navName, home) => {
    signedInAs(role)
    window.history.replaceState(null, '', home)
    const user = userEvent.setup()
    render(<App />)
    await user.click(await within(await screen.findByRole('navigation', { name: navName })).findByRole('link', { name: 'Dashboard' }))
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeTruthy()
    expect(await screen.findByRole('region', { name: 'Summary' })).toBeTruthy()
    expect(window.location.pathname).toBe('/dashboard')
    expect(m.fetchKpiBranchOptions).toHaveBeenCalledWith(role)
    expect(screen.queryByRole('link', { name: 'My week' })).toBeNull()
  })

  it('a technician has My week, not Dashboard', async () => {
    signedInAs('technician')
    window.history.replaceState(null, '', '/jobs')
    const user = userEvent.setup()
    render(<App />)
    const nav = await screen.findByRole('navigation', { name: 'Technician' })
    expect(within(nav).queryByRole('link', { name: 'Dashboard' })).toBeNull()
    await user.click(within(nav).getByRole('link', { name: 'My week' }))
    expect(await screen.findByRole('heading', { name: 'My week' })).toBeTruthy()
    expect(await screen.findByRole('region', { name: 'Summary' })).toBeTruthy()
    expect(window.location.pathname).toBe('/my-week')
    expect(m.fetchKpiTrend).toHaveBeenCalledWith('week', '2026-10-26', 8, null, 't-ali')
  })

  it('a technician sent to /dashboard lands on their jobs; the other roles are sent away from /my-week', async () => {
    signedInAs('technician')
    window.history.replaceState(null, '', '/dashboard')
    const { unmount } = render(<App />)
    expect(await screen.findByRole('heading', { name: 'My jobs' })).toBeTruthy()
    expect(m.fetchKpiSummary).not.toHaveBeenCalled()
    unmount()

    signedInAs('manager')
    window.history.replaceState(null, '', '/my-week')
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Review queue' })).toBeTruthy()
    expect(window.location.pathname).toBe('/review')
    expect(m.fetchKpiSummary).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// 0009 Operational Insight
// ---------------------------------------------------------------------------
describe('Dashboard: insights (0009)', () => {
  const BUSY = {
    kind: 'busy' as const,
    technicianId: 't-bala',
    technicianName: 'Bala',
    technicianActive: true,
    branchId: 'b-sa',
    branchName: 'Shah Alam',
    value: 11,
    previous: null,
    teamAverage: 5,
    days: null,
  }
  const BACKLOG = { ...BUSY, kind: 'review_backlog' as const, technicianId: null, technicianName: null, technicianActive: null, value: 6, teamAverage: null, days: 4 }

  it('shows the facts at once, then the AI wording and a tip', async () => {
    m.fetchInsightFacts.mockResolvedValue([BUSY, BACKLOG])
    let answer: (w: api.InsightWording) => void = () => {}
    m.fetchInsightWording.mockImplementation(() => new Promise((r) => (answer = r)))
    renderDashboard('/dashboard', 'manager')
    const card = await screen.findByRole('region', { name: 'Insights' })
    expect(
      await within(card).findByText(/Bala completed 11 jobs this week \(.+\), well above the team average of 5.0\./),
    ).toBeTruthy()
    expect(within(card).getByText("6 jobs in Shah Alam have waited more than 2 days for a Manager's review (oldest 4 days).")).toBeTruthy()
    expect(within(card).getByText('Asking the AI to word these…')).toBeTruthy()
    expect(m.fetchInsightWording).toHaveBeenCalledWith(expect.any(String), expect.any(String), null, expect.stringMatching(/^this week \(/))

    answer({
      sentences: [
        { fact: 0, text: 'Bala has done 11 jobs this week, more than double the team average of 5.0.', ai: true },
        { fact: 1, text: "6 jobs in Shah Alam have waited more than 2 days for a Manager's review (oldest 4 days).", ai: false },
      ],
      tip: 'Consider giving some of Bala’s jobs to Yusoff.',
      source: 'ai',
    })
    expect(await within(card).findByText('Bala has done 11 jobs this week, more than double the team average of 5.0.')).toBeTruthy()
    expect(within(card).getByText('Consider giving some of Bala’s jobs to Yusoff.')).toBeTruthy()
    expect(within(card).getByText(/Worded by AI from the numbers above/)).toBeTruthy()
    expect(within(card).getByRole('link', { name: 'See their numbers' }).getAttribute('href')).toMatch(/^\/dashboard\/technicians\/t-bala\?/)
  })

  it('keeps the plain facts when the AI wording is not available', async () => {
    m.fetchInsightFacts.mockResolvedValue([BUSY])
    m.fetchInsightWording.mockRejectedValue(new Error('The assistant is not set up yet.'))
    renderDashboard('/dashboard', 'admin')
    const card = await screen.findByRole('region', { name: 'Insights' })
    expect(await within(card).findByText('AI wording is not available right now; these are the plain facts.')).toBeTruthy()
    expect(within(card).getByText(/Bala completed 11 jobs/)).toBeTruthy()
  })

  it('says when nothing stands out, without asking the AI', async () => {
    renderDashboard('/dashboard', 'admin')
    const card = await screen.findByRole('region', { name: 'Insights' })
    expect(await within(card).findByText('Nothing stands out for this period.')).toBeTruthy()
    expect(m.fetchInsightWording).not.toHaveBeenCalled()
  })

  it('is not shown to Finance', async () => {
    renderDashboard('/dashboard', 'finance')
    await screen.findByRole('table', { name: 'Technician leaderboard' })
    expect(screen.queryByRole('region', { name: 'Insights' })).toBeNull()
    expect(m.fetchInsightFacts).not.toHaveBeenCalled()
  })
})
