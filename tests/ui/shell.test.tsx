// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { axe } from 'vitest-axe'
import App from '../../src/App'
import { Toast } from '../../src/components/Toast'
import type { StaffRole } from '../../src/domain'
import type { AuthState } from '../../src/features/auth'
import * as auth from '../../src/features/auth'
import * as authHook from '../../src/features/auth/useAuth'
import * as jobsApi from '../../src/features/jobs/api'
import * as notificationsApi from '../../src/features/notifications/api'
import * as reviewApi from '../../src/features/order-review/api'
import * as api from '../../src/features/orders/api'
import { THEME_STORAGE_KEY, readThemeChoice } from '../../src/lib/theme'
import { reference } from './fixtures'

vi.mock('../../src/features/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof auth>()
  return { ...actual, AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>, useAuth: vi.fn() }
})
// The sign-in form reads useAuth from its own module.
vi.mock('../../src/features/auth/useAuth', () => ({ useAuth: vi.fn() }))
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
vi.mock('../../src/features/feedback/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/features/feedback/api')>()),
  fetchOrderFeedback: async () => [],
}))
vi.mock('../../src/features/orders/api', async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  listOrders: vi.fn(),
  fetchReferenceData: vi.fn(),
}))

const signOut = vi.fn()

// jsdom has no PointerEvent; a MouseEvent carries the same coordinates.
if (!('PointerEvent' in window)) {
  class PointerEventShim extends MouseEvent {
    pointerId: number
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init)
      this.pointerId = init.pointerId ?? 1
    }
  }
  ;(window as unknown as { PointerEvent: typeof PointerEventShim }).PointerEvent = PointerEventShim
}

function signedInAs(role: StaffRole, name = 'Aisyah Rahman') {
  const state: AuthState = {
    status: 'signed-in',
    email: `${role}@sejuk.example.com`,
    profile: { status: 'ready', profile: { id: 's-1', name, role, branchName: 'Shah Alam' } },
    signIn: vi.fn(),
    signOut,
    reloadProfile: vi.fn(),
    notice: null,
  }
  vi.mocked(auth.useAuth).mockReturnValue(state)
}

beforeEach(() => {
  window.localStorage.clear()
  delete document.documentElement.dataset.theme
  signOut.mockReset()
  vi.mocked(api.listOrders).mockReset().mockResolvedValue({ rows: [], total: 0 })
  vi.mocked(api.fetchReferenceData).mockReset().mockResolvedValue(reference)
  vi.mocked(jobsApi.fetchMyJobs).mockReset().mockResolvedValue([])
  vi.mocked(notificationsApi.fetchUnreadCount).mockReset().mockResolvedValue(3)
  vi.mocked(notificationsApi.subscribeToNotifications).mockReset().mockReturnValue(() => {})
  vi.mocked(reviewApi.fetchManagerOrders).mockReset().mockResolvedValue([])
  vi.mocked(reviewApi.fetchFinanceOrders).mockReset().mockResolvedValue([])
  vi.mocked(reviewApi.fetchCoveredBranches).mockReset().mockResolvedValue([{ id: 'b-sa', name: 'Shah Alam' }])
  vi.mocked(reviewApi.fetchBranches).mockReset().mockResolvedValue([])
  window.history.replaceState(null, '', '/')
})
afterEach(() => window.localStorage.clear())

const linkNames = (nav: HTMLElement) => within(nav).getAllByRole('link').map((a) => a.getAttribute('aria-label') ?? a.textContent)

describe('App frame: one navigation per role (0011 Q8, Q9)', () => {
  it.each([
    ['admin', 'Admin', ['Orders', 'New order', 'Staff', 'Dashboard', 'AI log']],
    ['manager', 'Manager', ['Review queue', 'Staff', 'Dashboard', 'Notifications, 3 unread']],
    ['finance', 'Finance', ['Payments and closing', 'Dashboard', 'Notifications, 3 unread']],
    ['technician', 'Technician', ['My jobs', 'My week', 'Notifications, 3 unread']],
  ] as const)('a %s sees only their own menu, with the unread count', async (role, navName, items) => {
    signedInAs(role)
    render(<App />)
    const nav = await screen.findByRole('navigation', { name: navName })
    await within(nav).findAllByRole('link')
    if (role !== 'admin') await within(nav).findByRole('link', { name: /unread/ })
    expect(linkNames(nav)).toEqual(items)
    expect(screen.getAllByRole('navigation').filter((n) => ['Admin', 'Manager', 'Finance', 'Technician'].includes(n.getAttribute('aria-label') ?? ''))).toHaveLength(1)
  })

  it('puts the Admin items that do not fit in the phone bar under More', async () => {
    const user = userEvent.setup()
    signedInAs('admin')
    render(<App />)
    const nav = await screen.findByRole('navigation', { name: 'Admin' })
    await user.click(within(nav).getByRole('button', { name: 'More' }))
    const more = within(nav).getAllByRole('link', { name: 'AI log' })
    expect(more).toHaveLength(2)
  })

  it('has a skip link to the main content', async () => {
    signedInAs('technician')
    render(<App />)
    await screen.findByRole('heading', { name: 'My jobs' })
    expect(screen.getByRole('link', { name: 'Skip to content' }).getAttribute('href')).toBe('#main')
    expect(document.getElementById('main')?.tagName).toBe('MAIN')
  })
})

describe('Account menu: theme, password, sign out (0011 Q7)', () => {
  it('says who is signed in and offers change password and sign out', async () => {
    const user = userEvent.setup()
    signedInAs('manager', 'Nurul Huda')
    render(<App />)
    expect(await screen.findByText('Signed in as Nurul Huda (Manager, Shah Alam)')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Account menu for Nurul Huda' }))
    expect(screen.getByRole('link', { name: 'Change password' }).getAttribute('href')).toBe('/account/password')
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(signOut).toHaveBeenCalledTimes(1)
  })

  it('switches to dark and back to the device setting, remembered on the device', async () => {
    const user = userEvent.setup()
    signedInAs('admin')
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Account menu for Aisyah Rahman' }))
    const theme = within(screen.getByRole('radiogroup', { name: 'Theme' }))
    expect(theme.getByRole('radio', { name: 'System' }).getAttribute('aria-checked')).toBe('true')
    await user.click(theme.getByRole('radio', { name: 'Dark' }))
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    await user.click(theme.getByRole('radio', { name: 'System' }))
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull()
  })

  it('falls back to the device setting when storage is blocked', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(readThemeChoice()).toBe('system')
    spy.mockRestore()
  })

  it('remembers a collapsed sidebar on the device', async () => {
    const user = userEvent.setup()
    signedInAs('finance')
    const { unmount } = render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Collapse sidebar' }))
    expect(window.localStorage.getItem('sejuk.sidebar')).toBe('collapsed')
    unmount()
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Expand sidebar' })).toBeTruthy()
  })
})

describe('Toasts (0011 Q13)', () => {
  it('shows a success message and goes away by itself', () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()
    render(<Toast onDismiss={onDismiss}>Order saved.</Toast>)
    expect(screen.getByRole('status').textContent).toContain('Order saved.')
    act(() => vi.advanceTimersByTime(5000))
    expect(onDismiss).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
})

describe('Ask button (0011 Q10, Q10b)', () => {
  it('can be dragged without opening, opens on a tap, and is back in its corner after a reload', async () => {
    signedInAs('technician')
    const { unmount } = render(<App />)
    const button = await screen.findByRole('button', { name: 'Ask the assistant' })
    expect(button.className).toContain('right-4')

    fireEvent.pointerDown(button, { button: 0, clientX: 300, clientY: 700, pointerId: 1 })
    fireEvent.pointerMove(button, { clientX: 40, clientY: 400, pointerId: 1 })
    fireEvent.pointerUp(button, { clientX: 40, clientY: 400, pointerId: 1 })
    fireEvent.click(button)
    expect(screen.queryByRole('dialog', { name: 'Ask the assistant' })).toBeNull()
    expect(button.style.left).toBe('1rem')
    expect(button.className).not.toContain('right-4')

    fireEvent.click(button)
    expect(screen.getByRole('dialog', { name: 'Ask the assistant' })).toBeTruthy()

    unmount()
    render(<App />)
    const again = await screen.findByRole('button', { name: 'Ask the assistant' })
    expect(again.className).toContain('right-4')
    expect(again.style.left).toBe('')
  })
})

describe('Accessibility of the frame (0011 P6)', () => {
  it.each(['admin', 'technician'] as const)('the %s frame has no axe violations', async (role) => {
    signedInAs(role)
    const { container } = render(<App />)
    await screen.findByRole('navigation', { name: role === 'admin' ? 'Admin' : 'Technician' })
    await screen.findAllByRole('heading', { level: 2 })
    // Colour contrast needs real layout; it is checked in the browser.
    const result = await axe(container, { rules: { 'color-contrast': { enabled: false } } })
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
  })
})

describe('Sign-in page (0011 Q17)', () => {
  it('keeps the words the live check reads, has a show-password button, and no axe violations', async () => {
    const user = userEvent.setup()
    const signedOut = {
      status: 'signed-out',
      email: null,
      profile: { status: 'loading' },
      signIn: vi.fn(),
      signOut,
      reloadProfile: vi.fn(),
      notice: null,
    } as unknown as AuthState
    vi.mocked(auth.useAuth).mockReturnValue(signedOut)
    vi.mocked(authHook.useAuth).mockReturnValue(signedOut)
    const { container } = render(<App />)
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeTruthy()
    expect(screen.getByText('Use your work email and the password you chose.')).toBeTruthy()
    const password = screen.getByLabelText('Password') as HTMLInputElement
    expect(password.type).toBe('password')
    await user.click(screen.getByRole('button', { name: 'Show password' }))
    expect(password.type).toBe('text')
    const result = await axe(container, { rules: { 'color-contrast': { enabled: false } } })
    expect(result.violations.map((v) => v.id)).toEqual([])
  })
})
