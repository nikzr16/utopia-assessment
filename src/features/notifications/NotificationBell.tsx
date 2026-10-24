import { NavLink } from 'react-router'
import { Bell } from 'lucide-react'
import { useNotifications } from './NotificationsProvider'

/** Link to the notifications list with the unread count (shared by every portal that shows it). */
export function NotificationBell({ className }: { className: (active: boolean) => string }) {
  const { unread } = useNotifications()
  const count = unread ?? 0
  return (
    <NavLink
      to="/notifications"
      aria-label={count > 0 ? `Notifications, ${count} unread` : 'Notifications'}
      className={({ isActive }) => `${className(isActive)} gap-2`}
    >
      <Bell className="size-4" aria-hidden="true" />
      <span>Notifications</span>
      {count > 0 ? (
        <span
          aria-hidden="true"
          className="inline-flex min-w-5 items-center justify-center rounded-full bg-danger px-1.5 text-xs font-semibold text-on-danger"
        >
          {count > 99 ? '99+' : count}
        </span>
      ) : null}
    </NavLink>
  )
}
