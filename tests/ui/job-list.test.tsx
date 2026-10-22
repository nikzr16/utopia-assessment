// @vitest-environment jsdom
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../../src/features/jobs/api'
import { JobListPage, toJobView } from '../../src/features/jobs/JobListPage'
import { makeOrder } from './fixtures'

vi.mock('../../src/features/jobs/api', async (importOriginal) => {
  const actual = await importOriginal<typeof api>()
  return { ...actual, fetchMyJobs: vi.fn() }
})

const fetchMyJobs = vi.mocked(api.fetchMyJobs)

// Tue 27 Oct 2026, 09:00 in Malaysia.
const NOW = new Date('2026-10-27T01:00:00Z')

function Where() {
  const location = useLocation()
  return <p data-testid="where">{location.pathname + location.search}</p>
}

function renderList(url = '/jobs') {
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/jobs" element={<JobListPage />} />
        <Route path="/jobs/:orderNo" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  fetchMyJobs.mockReset().mockResolvedValue([])
})
afterEach(() => vi.useRealTimers())

describe('toJobView', () => {
  it('reads the tab from the URL, defaulting to Open', () => {
    expect(toJobView(null)).toBe('open')
    expect(toJobView('submitted')).toBe('submitted')
    expect(toJobView('finished')).toBe('finished')
    expect(toJobView('everything')).toBe('open')
  })
})

describe('Open jobs (AC2)', () => {
  it('groups open jobs by Malaysia day, overdue first, and flags overdue ones', async () => {
    fetchMyJobs.mockResolvedValue([
      makeOrder({ id: 'a', order_no: 'ORDER1001', scheduled_at: '2026-10-26T02:00:00Z' }), // Mon: overdue
      makeOrder({ id: 'b', order_no: 'ORDER1002', scheduled_at: '2026-10-27T06:00:00Z', status: 'in_progress' }),
      makeOrder({ id: 'c', order_no: 'ORDER1003', scheduled_at: '2026-10-29T02:00:00Z', status: 'acknowledged' }),
      makeOrder({ id: 'd', order_no: 'ORDER1004', scheduled_at: null }),
    ])
    renderList()
    const headings = await screen.findAllByRole('heading', { level: 3 })
    expect(headings.map((h) => h.textContent)).toEqual(['Overdue (1)', 'Today (1)', 'Upcoming (1)', 'No date yet (1)'])
    expect(fetchMyJobs).toHaveBeenCalledWith('open')

    const overdue = within(screen.getByRole('region', { name: 'Overdue (1)' }))
    expect(overdue.getByText('ORDER1001')).toBeTruthy()
    expect(overdue.getByText(/Overdue$/)).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'No date yet (1)' })).getByText('No date yet')).toBeTruthy()
  })

  it('shows what a technician needs on each card and opens the job', async () => {
    fetchMyJobs.mockResolvedValue([
      makeOrder({
        order_no: 'ORDER1007',
        service_type_name: 'Aircond cleaning',
        customer_name: 'Ahmad',
        customer_address: 'No. 12, Jalan Sejuk, Shah Alam',
        scheduled_at: '2026-10-27T02:00:00Z',
        balance: 150,
      }),
    ])
    const user = userEvent.setup()
    renderList()
    const card = await screen.findByRole('link', { name: /ORDER1007/ })
    expect(card.textContent).toContain('Aircond cleaning')
    expect(card.textContent).toContain('Ahmad · Shah Alam')
    expect(card.textContent).toContain('Tue 27 Oct 2026, 10:00 AM')
    expect(card.textContent).toContain('To collect: RM 150.00')
    expect(card.textContent).toContain('Assigned')
    await user.click(card)
    expect(screen.getByTestId('where').textContent).toBe('/jobs/ORDER1007')
  })

  it('says so when there are no open jobs', async () => {
    renderList()
    expect(await screen.findByText('No open jobs. New jobs assigned to you will show up here.')).toBeTruthy()
  })
})

describe('Submitted and Finished tabs', () => {
  it('loads the tab from the URL and switches tabs', async () => {
    fetchMyJobs.mockImplementation(async (view) =>
      view === 'submitted' ? [makeOrder({ order_no: 'ORDER1010', status: 'job_done' })] : [],
    )
    const user = userEvent.setup()
    renderList('/jobs?tab=submitted')
    expect(await screen.findByText('ORDER1010')).toBeTruthy()
    const tabs = within(screen.getByRole('navigation', { name: 'Job lists' }))
    expect(tabs.getByRole('link', { name: 'Submitted' }).getAttribute('aria-current')).toBe('page')

    await user.click(tabs.getByRole('link', { name: 'Finished' }))
    expect(await screen.findByText('No jobs closed or cancelled in the last 30 days.')).toBeTruthy()
    expect(fetchMyJobs).toHaveBeenLastCalledWith('finished')
  })

  it('does not ask a cancelled job to collect money', async () => {
    fetchMyJobs.mockResolvedValue([makeOrder({ order_no: 'ORDER1011', status: 'cancelled', balance: 180 })])
    renderList('/jobs?tab=finished')
    const card = await screen.findByRole('link', { name: /ORDER1011/ })
    expect(card.textContent).not.toContain('To collect')
  })
})

describe('Loading problems and refreshing', () => {
  it('shows the error and tries again', async () => {
    fetchMyJobs.mockRejectedValueOnce(new api.ApiError('Could not reach the server. Check your connection and try again.'))
    fetchMyJobs.mockResolvedValueOnce([makeOrder({ order_no: 'ORDER1020' })])
    const user = userEvent.setup()
    renderList()
    expect(await screen.findByText('Could not load your jobs')).toBeTruthy()
    expect(screen.getByText('Could not reach the server. Check your connection and try again.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('ORDER1020')).toBeTruthy()
  })

  it('reloads when the technician comes back to the app or the connection returns', async () => {
    renderList()
    await screen.findByText(/No open jobs/)
    expect(fetchMyJobs).toHaveBeenCalledTimes(1)
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(fetchMyJobs).toHaveBeenCalledTimes(2)
    await act(async () => {
      window.dispatchEvent(new Event('online'))
    })
    expect(fetchMyJobs).toHaveBeenCalledTimes(3)
  })
})
