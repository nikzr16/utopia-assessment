import { Navigate, Route, Routes } from 'react-router'
import { Bell, ClipboardCheck, LayoutDashboard, Users } from 'lucide-react'
import { AppShell, type NavItem } from '../../components/shell/AppShell'
import { AskAssistant } from '../ask'
import { ChangePasswordPage } from '../auth/ChangePasswordPage'
import { DashboardRoutes } from '../kpi'
import { NotificationsPage, NotificationsProvider } from '../notifications'
import { OrderReviewPage } from '../order-review'
import { StaffRoutes } from '../staff'
import { ReviewQueuePage } from './ReviewQueuePage'

const NAV: NavItem[] = [
  { to: '/review', label: 'Review queue', shortLabel: 'Review', icon: ClipboardCheck },
  { to: '/staff', label: 'Staff', icon: Users },
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/notifications', label: 'Notifications', shortLabel: 'Alerts', icon: Bell, notifications: true },
]

/** The Manager's screens (PRD 0004), phone first. Other roles never render this. */
export function ManagerPortal({ staffId, staffName }: { staffId: string; staffName: string }) {
  return (
    <NotificationsProvider staffId={staffId}>
      <AppShell navLabel="Manager" items={NAV}>
        <Routes>
          <Route path="/review" element={<ReviewQueuePage />} />
          <Route
            path="/review/:orderNo"
            element={<OrderReviewPage role="manager" basePath="/review" staffName={staffName} />}
          />
          <Route
            path="/staff/*"
            element={<StaffRoutes actorRole="manager" orderPath={(orderNo) => `/review/${encodeURIComponent(orderNo)}`} />}
          />
          <Route
            path="/dashboard/*"
            element={<DashboardRoutes role="manager" orderPath={(orderNo) => `/review/${encodeURIComponent(orderNo)}`} />}
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
          <Route path="/account/password" element={<ChangePasswordPage />} />
          <Route path="*" element={<Navigate to="/review" replace />} />
        </Routes>
        <AskAssistant role="manager" orderPath={(orderNo) => `/review/${encodeURIComponent(orderNo)}`} />
      </AppShell>
    </NotificationsProvider>
  )
}
