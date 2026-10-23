// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../src/App'
import type { StaffRole } from '../../src/domain'
import type { AuthState } from '../../src/features/auth'
import * as auth from '../../src/features/auth'
import * as jobsApi from '../../src/features/jobs/api'
import * as notificationsApi from '../../src/features/notifications/api'
import * as reviewApi from '../../src/features/order-review/api'
import * as api from '../../src/features/orders/api'
import { reference } from './fixtures'

vi.mock('../../src/features/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof auth>()
  return {
    ...actual,
    AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
    useAuth: vi.fn(),
  }
})
vi.mock('../../src/features/jobs/api', async (importOriginal) => {
  const actual = await importOriginal<typeof jobsApi>()
  return { ...actual, fetchMyJobs: vi.fn() }
})
vi.mock('../../src/features/notifications/api', async (importOriginal) => {
  const actual = await importOriginal<typeof notificationsApi>()
  return { ...actual, fetchUnreadCount: vi.fn(), subscribeToNotifications: vi.fn() }
})
vi.mock('../../src/features/order-review/api', async (importOriginal) => {
  const actual = await importOriginal<typeof reviewApi>()
  return {
    ...actual,
    fetchManagerOrders: vi.fn(),
    fetchFinanceOrders: vi.fn(),
    fetchCoveredBranches: vi.fn(),
    fetchBranches: vi.fn(),
  }
})
// 0005: the order pages show the customer feedback card; no feedback here.
vi.mock('../../src/features/feedback/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/features/feedback/api')>()),
  fetchOrderFeedback: async () => [],
}))
vi.mock('../../src/features/orders/api', async (importOriginal) => {
  const actual = await importOriginal<typeof api>()
  return { ...actual, listOrders: vi.fn(), fetchReferenceData: vi.fn() }
})

function signedInAs(role: StaffRole, branchName = 'Shah Alam') {
  const state: AuthState = {
    status: 'signed-in',
    email: `${role}@sejuk.example.com`,
    profile: { status: 'ready', profile: { id: 's-1', name: 'Staff', role, branchName } },
    signIn: vi.fn(),
    signOut: vi.fn(),
    reloadProfile: vi.fn(),
  }
  vi.mocked(auth.useAuth).mockReturnValue(state)
}

beforeEach(() => {
  vi.mocked(api.listOrders).mockReset().mockResolvedValue({ rows: [], total: 0 })
  vi.mocked(api.fetchReferenceData).mockReset().mockResolvedValue(reference)
  vi.mocked(jobsApi.fetchMyJobs).mockReset().mockResolvedValue([])
  vi.mocked(notificationsApi.fetchUnreadCount).mockReset().mockResolvedValue(1)
  vi.mocked(notificationsApi.subscribeToNotifications).mockReset().mockReturnValue(() => {})
  vi.mocked(reviewApi.fetchManagerOrders).mockReset().mockResolvedValue([])
  vi.mocked(reviewApi.fetchFinanceOrders).mockReset().mockResolvedValue([])
  vi.mocked(reviewApi.fetchCoveredBranches).mockReset().mockResolvedValue([{ id: 'b-sa', name: 'Shah Alam' }])
  vi.mocked(reviewApi.fetchBranches).mockReset().mockResolvedValue([])
  window.history.replaceState(null, '', '/')
})

describe('Admin portal is for Admins only (AC1)', () => {
  it('an Admin lands on the order list and can open the new order form', async () => {
    signedInAs('admin')
    const user = userEvent.setup()
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Orders' })).toBeTruthy()
    expect(window.location.pathname).toBe('/orders')
    expect(await screen.findByText('No orders yet.')).toBeTruthy()

    await user.click(within(screen.getByRole('navigation', { name: 'Admin' })).getByRole('link', { name: 'New order' }))
    expect(await screen.findByRole('heading', { name: 'New order' })).toBeTruthy()
    expect(window.location.pathname).toBe('/orders/new')
  })

  it.each(['manager', 'finance'] as const)('a %s does not get the portal, even at /orders', async (role) => {
    signedInAs(role)
    window.history.replaceState(null, '', '/orders/new')
    render(<App />)
    expect(await screen.findByRole('navigation', { name: role === 'manager' ? 'Manager' : 'Finance' })).toBeTruthy()
    expect(screen.queryByRole('navigation', { name: 'Admin' })).toBeNull()
    expect(screen.queryByRole('form', { name: 'New order' })).toBeNull()
    expect(api.listOrders).not.toHaveBeenCalled()
  })
})

describe('Manager and Finance portals (0004 AC1, AC14)', () => {
  it('a Manager lands on the review queue with the bell, whatever the URL', async () => {
    signedInAs('manager')
    window.history.replaceState(null, '', '/jobs')
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Review queue' })).toBeTruthy()
    expect(window.location.pathname).toBe('/review')
    expect(reviewApi.fetchManagerOrders).toHaveBeenCalledWith('to_review', null)
    expect(await screen.findByRole('link', { name: 'Notifications, 1 unread' })).toBeTruthy()
    expect(notificationsApi.subscribeToNotifications).toHaveBeenCalledWith('s-1', expect.any(Function))
    expect(jobsApi.fetchMyJobs).not.toHaveBeenCalled()
  })

  it('Finance lands on Ready to close with the bell, whatever the URL', async () => {
    signedInAs('finance')
    window.history.replaceState(null, '', '/orders')
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Payments and closing' })).toBeTruthy()
    expect(window.location.pathname).toBe('/finance')
    expect(reviewApi.fetchFinanceOrders).toHaveBeenCalledWith('ready', null)
    expect(await screen.findByRole('link', { name: 'Notifications, 1 unread' })).toBeTruthy()
  })

  it.each(['admin', 'technician', 'finance'] as const)('a %s does not get the review queue, even at /review', async (role) => {
    signedInAs(role)
    window.history.replaceState(null, '', '/review')
    render(<App />)
    await screen.findAllByRole('navigation')
    expect(screen.queryByRole('navigation', { name: 'Manager' })).toBeNull()
    expect(reviewApi.fetchManagerOrders).not.toHaveBeenCalled()
  })
})

describe('Technician portal is for technicians only (0002 AC1)', () => {
  it('a technician lands on their job list, whatever the URL', async () => {
    signedInAs('technician')
    window.history.replaceState(null, '', '/orders/new')
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'My jobs' })).toBeTruthy()
    expect(window.location.pathname).toBe('/jobs')
    expect(screen.queryByRole('navigation', { name: 'Admin' })).toBeNull()
    expect(jobsApi.fetchMyJobs).toHaveBeenCalledWith('open')
    expect(api.listOrders).not.toHaveBeenCalled()
    // Notifications for this technician: the bell listens for their staff id.
    expect(await screen.findByRole('link', { name: 'Notifications, 1 unread' })).toBeTruthy()
    expect(notificationsApi.subscribeToNotifications).toHaveBeenCalledWith('s-1', expect.any(Function))
  })

  it.each(['admin', 'manager', 'finance'] as const)('a %s does not get the job list, even at /jobs', async (role) => {
    signedInAs(role)
    window.history.replaceState(null, '', '/jobs')
    render(<App />)
    expect(screen.queryByRole('navigation', { name: 'Technician' })).toBeNull()
    expect(jobsApi.fetchMyJobs).not.toHaveBeenCalled()
  })
})
