import { NavLink, Navigate, Route, Routes } from 'react-router'
import { NotificationBell, NotificationsPage, NotificationsProvider } from '../notifications'
import { OrderReviewPage } from '../order-review'
import { ReviewQueuePage } from './ReviewQueuePage'

const TAB =
  'inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-sky-300'
const tab = (active: boolean) => `${TAB} ${active ? 'bg-sky-100 text-sky-900' : 'text-slate-700 hover:bg-slate-100'}`

/** The Manager's screens (PRD 0004), desktop first. Other roles never render this. */
export function ManagerPortal({ staffId, staffName }: { staffId: string; staffName: string }) {
  return (
    <NotificationsProvider staffId={staffId}>
      <nav aria-label="Manager" className="mb-5 flex gap-2 border-b border-slate-200 pb-3">
        <NavLink to="/review" className={({ isActive }) => tab(isActive)}>
          Review queue
        </NavLink>
        <NotificationBell className={tab} />
      </nav>
      <Routes>
        <Route path="/review" element={<ReviewQueuePage />} />
        <Route
          path="/review/:orderNo"
          element={<OrderReviewPage role="manager" basePath="/review" staffName={staffName} />}
        />
        <Route
          path="/notifications"
          element={
            <NotificationsPage
              jobPath={(orderNo) => `/review/${encodeURIComponent(orderNo)}`}
              goneMessage="This order is no longer in your branches."
            />
          }
        />
        <Route path="*" element={<Navigate to="/review" replace />} />
      </Routes>
    </NotificationsProvider>
  )
}
