import { Navigate, Route, Routes } from 'react-router'
import { Bell, CalendarCheck, Wrench } from 'lucide-react'
import { AppShell, type NavItem } from '../../components/shell/AppShell'
import { AskAssistant } from '../ask'
import { ChangePasswordPage } from '../auth/ChangePasswordPage'
import { MyWeek } from '../kpi'
import { NotificationsPage, NotificationsProvider } from '../notifications'
import { CompletionPage } from './CompletionPage'
import { JobListPage } from './JobListPage'
import { JobPage } from './JobPage'
import { PaymentPage } from './PaymentPage'

const NAV: NavItem[] = [
  { to: '/jobs', label: 'My jobs', shortLabel: 'Jobs', icon: Wrench },
  { to: '/my-week', label: 'My week', shortLabel: 'Week', icon: CalendarCheck },
  { to: '/notifications', label: 'Notifications', shortLabel: 'Alerts', icon: Bell, notifications: true },
]

/** The Technician's screens (PRD 0002), phone first. Other roles never render this. */
export function TechnicianPortal({ staffId }: { staffId: string }) {
  return (
    <NotificationsProvider staffId={staffId}>
      <AppShell navLabel="Technician" items={NAV} width="narrow">
        <Routes>
          <Route path="/jobs" element={<JobListPage />} />
          <Route path="/jobs/:orderNo" element={<JobPage />} />
          <Route path="/jobs/:orderNo/complete" element={<CompletionPage />} />
          <Route path="/jobs/:orderNo/payment" element={<PaymentPage />} />
          <Route path="/my-week" element={<MyWeek staffId={staffId} />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/account/password" element={<ChangePasswordPage />} />
          <Route path="*" element={<Navigate to="/jobs" replace />} />
        </Routes>
        <AskAssistant role="technician" orderPath={(orderNo) => `/jobs/${encodeURIComponent(orderNo)}`} />
      </AppShell>
    </NotificationsProvider>
  )
}
