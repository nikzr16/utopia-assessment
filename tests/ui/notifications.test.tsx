// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../../src/features/notifications/api'
import { NotificationBell, NotificationsPage, NotificationsProvider } from '../../src/features/notifications'
import './fixtures'

vi.mock('../../src/features/notifications/api', async (importOriginal) => {
  const actual = await importOriginal<typeof api>()
  return {
    ...actual,
    fetchNotifications: vi.fn(),
    fetchUnreadCount: vi.fn(),
    markNotificationRead: vi.fn(),
    markAllNotificationsRead: vi.fn(),
    subscribeToNotifications: vi.fn(),
  }
})

const m = vi.mocked(api)
let live: () => void = () => {}
const stop = vi.fn()

const note = (id: number, overrides: Partial<api.AppNotification> = {}): api.AppNotification => ({
  id,
  event: 'assigned',
  message: `ORDER10${id} has been assigned to you`,
  read_at: null,
  created_at: '2026-10-26T02:00:00Z',
  order_no: `ORDER10${id}`,
  ...overrides,
})

function Where() {
  const l = useLocation()
  return <p data-testid="where">{l.pathname}</p>
}

function renderPortal(url = '/notifications') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <NotificationsProvider staffId="t-ali">
        <nav aria-label="Technician">
          <NotificationBell className={() => 'tab'} />
        </nav>
        <Routes>
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/jobs/:orderNo" element={<Where />} />
        </Routes>
      </NotificationsProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  m.fetchUnreadCount.mockResolvedValue(2)
  m.fetchNotifications.mockResolvedValue([
    note(2),
    note(1, { event: 'rework', message: 'ORDER101 was returned for rework: Redo', read_at: '2026-10-26T03:00:00Z' }),
  ])
  m.markNotificationRead.mockResolvedValue()
  m.markAllNotificationsRead.mockResolvedValue(2)
  m.subscribeToNotifications.mockImplementation((_staffId, onChange) => {
    live = onChange
    return stop
  })
})

describe('The bell (PRD Q11)', () => {
  it('shows the unread count and listens live for this technician', async () => {
    renderPortal('/elsewhere')
    expect(await screen.findByRole('link', { name: 'Notifications, 2 unread' })).toBeTruthy()
    expect(m.subscribeToNotifications).toHaveBeenCalledWith('t-ali', expect.any(Function))

    m.fetchUnreadCount.mockResolvedValue(3)
    await act(async () => live())
    expect(await screen.findByRole('link', { name: 'Notifications, 3 unread' })).toBeTruthy()
  })

  it('refreshes when the technician comes back to the app', async () => {
    renderPortal('/elsewhere')
    await screen.findByRole('link', { name: 'Notifications, 2 unread' })
    m.fetchUnreadCount.mockResolvedValue(0)
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(await screen.findByRole('link', { name: 'Notifications' })).toBeTruthy()
  })

  it('stops listening when the portal goes away', async () => {
    const { unmount } = renderPortal('/elsewhere')
    await screen.findByRole('link', { name: /Notifications/ })
    unmount()
    expect(stop).toHaveBeenCalled()
  })
})

describe('The notifications list (AC12)', () => {
  it('lists the technician’s notifications newest first, unread ones marked', async () => {
    renderPortal()
    const items = within(await screen.findByRole('list', { name: 'Notifications' })).getAllByRole('button')
    expect(items.map((b) => b.textContent)).toEqual([
      expect.stringContaining('New jobUnreadORDER102 has been assigned to you'),
      expect.stringContaining('Returned for reworkORDER101 was returned for rework: Redo'),
    ])
    expect(items[1].textContent).not.toContain('Unread')
  })

  it('opens the job and marks the notification read', async () => {
    const user = userEvent.setup()
    renderPortal()
    await user.click(await screen.findByRole('button', { name: /ORDER102 has been assigned/ }))
    expect((await screen.findByTestId('where')).textContent).toBe('/jobs/ORDER102')
    expect(m.markNotificationRead).toHaveBeenCalledWith(2)
    await waitFor(() => expect(m.fetchUnreadCount).toHaveBeenCalledTimes(2))
  })

  it('does not mark an already read notification again', async () => {
    const user = userEvent.setup()
    renderPortal()
    await user.click(await screen.findByRole('button', { name: /returned for rework/ }))
    expect(m.markNotificationRead).not.toHaveBeenCalled()
    expect((await screen.findByTestId('where')).textContent).toBe('/jobs/ORDER101')
  })

  it('explains a job reassigned to someone else instead of opening it', async () => {
    m.fetchNotifications.mockResolvedValue([
      note(3, { event: 'reassigned_away', message: 'ORDER103 has been reassigned to another technician', order_no: null }),
    ])
    const user = userEvent.setup()
    renderPortal()
    await user.click(await screen.findByRole('button', { name: /reassigned to another technician/ }))
    expect(await screen.findByText('This job is no longer assigned to you.')).toBeTruthy()
    expect(screen.queryByTestId('where')).toBeNull()
    expect(m.markNotificationRead).toHaveBeenCalledWith(3)
  })

  it('marks everything read at once', async () => {
    const user = userEvent.setup()
    renderPortal()
    m.fetchUnreadCount.mockResolvedValue(0)
    await user.click(await screen.findByRole('button', { name: 'Mark all as read' }))
    expect(m.markAllNotificationsRead).toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Mark all as read' })).toBeNull())
    expect(m.fetchNotifications).toHaveBeenCalledTimes(2)
  })

  it('says when there is nothing yet', async () => {
    m.fetchNotifications.mockResolvedValue([])
    m.fetchUnreadCount.mockResolvedValue(0)
    renderPortal()
    expect(await screen.findByText('No notifications yet.')).toBeTruthy()
  })
})
