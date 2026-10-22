// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../src/App'
import type { StaffRole } from '../../src/domain'
import type { AuthState } from '../../src/features/auth'
import * as auth from '../../src/features/auth'
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

  it.each(['technician', 'manager', 'finance'] as const)('a %s does not get the portal, even at /orders', (role) => {
    signedInAs(role)
    window.history.replaceState(null, '', '/orders/new')
    render(<App />)
    expect(screen.queryByRole('navigation', { name: 'Admin' })).toBeNull()
    expect(screen.queryByRole('form', { name: 'New order' })).toBeNull()
    expect(screen.getByRole('heading', { level: 2 }).textContent).toMatch(/home$/)
    expect(api.listOrders).not.toHaveBeenCalled()
  })
})
