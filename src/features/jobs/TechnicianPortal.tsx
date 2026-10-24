import { NavLink, Navigate, Route, Routes } from 'react-router'
import { AskAssistant } from '../ask'
import { MyWeek } from '../kpi'
import { NotificationBell, NotificationsPage, NotificationsProvider } from '../notifications'
import { CompletionPage } from './CompletionPage'
import { JobListPage } from './JobListPage'
import { JobPage } from './JobPage'
import { PaymentPage } from './PaymentPage'

const TAB =
  'inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-sky-300'
const tab = (active: boolean) => `${TAB} ${active ? 'bg-sky-100 text-sky-900' : 'text-slate-700 hover:bg-slate-100'}`

/** The Technician's screens (PRD 0002), phone first. Other roles never render this. */
export function TechnicianPortal({ staffId }: { staffId: string }) {
  return (
    <NotificationsProvider staffId={staffId}>
      <div className="mx-auto max-w-2xl">
        <nav aria-label="Technician" className="mb-4 flex gap-2 border-b border-slate-200 pb-3">
          <NavLink to="/jobs" className={({ isActive }) => tab(isActive)}>
            My jobs
          </NavLink>
          <NavLink to="/my-week" className={({ isActive }) => tab(isActive)}>
            My week
          </NavLink>
          <NotificationBell className={tab} />
        </nav>
        <Routes>
          <Route path="/jobs" element={<JobListPage />} />
          <Route path="/jobs/:orderNo" element={<JobPage />} />
          <Route path="/jobs/:orderNo/complete" element={<CompletionPage />} />
          <Route path="/jobs/:orderNo/payment" element={<PaymentPage />} />
          <Route path="/my-week" element={<MyWeek staffId={staffId} />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="*" element={<Navigate to="/jobs" replace />} />
        </Routes>
        <AskAssistant role="technician" orderPath={(orderNo) => `/jobs/${encodeURIComponent(orderNo)}`} />
      </div>
    </NotificationsProvider>
  )
}
