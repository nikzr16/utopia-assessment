import { NavLink, Navigate, Route, Routes } from 'react-router'
import { DashboardRoutes } from '../kpi'
import { NotificationBell, NotificationsPage, NotificationsProvider } from '../notifications'
import { OrderReviewPage } from '../order-review'
import { FinancePaymentPage } from './FinancePaymentPage'
import { FinanceQueuePage } from './FinanceQueuePage'

const TAB =
  'inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-sky-300'
const tab = (active: boolean) => `${TAB} ${active ? 'bg-sky-100 text-sky-900' : 'text-slate-700 hover:bg-slate-100'}`

/** Finance's screens (PRD 0004), desktop first. Other roles never render this. */
export function FinancePortal({ staffId, staffName }: { staffId: string; staffName: string }) {
  return (
    <NotificationsProvider staffId={staffId}>
      <nav aria-label="Finance" className="mb-5 flex gap-2 border-b border-slate-200 pb-3">
        <NavLink to="/finance" className={({ isActive }) => tab(isActive)}>
          Payments and closing
        </NavLink>
        <NavLink to="/dashboard" className={({ isActive }) => tab(isActive)}>
          Dashboard
        </NavLink>
        <NotificationBell className={tab} />
      </nav>
      <Routes>
        <Route path="/finance" element={<FinanceQueuePage />} />
        <Route
          path="/finance/:orderNo"
          element={<OrderReviewPage role="finance" basePath="/finance" staffName={staffName} />}
        />
        <Route path="/finance/:orderNo/payment" element={<FinancePaymentPage />} />
        <Route
          path="/dashboard/*"
          element={<DashboardRoutes role="finance" orderPath={(orderNo) => `/finance/${encodeURIComponent(orderNo)}`} />}
        />
        <Route
          path="/notifications"
          element={<NotificationsPage jobPath={(orderNo) => `/finance/${encodeURIComponent(orderNo)}`} />}
        />
        <Route path="*" element={<Navigate to="/finance" replace />} />
      </Routes>
    </NotificationsProvider>
  )
}
