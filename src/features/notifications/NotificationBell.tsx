import { NavLink } from 'react-router'
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
      <span aria-hidden="true">🔔</span>
      <span>Notifications</span>
      {count > 0 ? (
        <span
          aria-hidden="true"
          className="inline-flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 text-xs font-semibold text-white"
        >
          {count > 99 ? '99+' : count}
        </span>
      ) : null}
    </NavLink>
  )
}
