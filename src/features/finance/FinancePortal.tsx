import { Navigate, Route, Routes } from 'react-router'
import { Bell, LayoutDashboard, Wallet } from 'lucide-react'
import { AppShell, type NavItem } from '../../components/shell/AppShell'
import { AskAssistant } from '../ask'
import { ChangePasswordPage } from '../auth/ChangePasswordPage'
import { DashboardRoutes } from '../kpi'
import { NotificationsPage, NotificationsProvider } from '../notifications'
import { OrderReviewPage } from '../order-review'
import { FinancePaymentPage } from './FinancePaymentPage'
import { FinanceQueuePage } from './FinanceQueuePage'

const NAV: NavItem[] = [
  { to: '/finance', label: 'Payments and closing', shortLabel: 'Payments', icon: Wallet },
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/notifications', label: 'Notifications', shortLabel: 'Alerts', icon: Bell, notifications: true },
]

/** Finance's screens (PRD 0004), desktop first. Other roles never render this. */
export function FinancePortal({ staffId, staffName }: { staffId: string; staffName: string }) {
  return (
    <NotificationsProvider staffId={staffId}>
      <AppShell navLabel="Finance" items={NAV}>
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
          <Route path="/account/password" element={<ChangePasswordPage />} />
          <Route path="*" element={<Navigate to="/finance" replace />} />
        </Routes>
        <AskAssistant role="finance" orderPath={(orderNo) => `/finance/${encodeURIComponent(orderNo)}`} />
      </AppShell>
    </NotificationsProvider>
  )
}
