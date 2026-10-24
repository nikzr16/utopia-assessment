import { Navigate, Route, Routes } from 'react-router'
import { ClipboardList, LayoutDashboard, Plus, Sparkles, Users } from 'lucide-react'
import { AppShell, type NavItem } from '../../components/shell/AppShell'
import { AskAssistant, QuestionLogPage } from '../ask'
import { ChangePasswordPage } from '../auth/ChangePasswordPage'
import { DashboardRoutes } from '../kpi'
import { StaffRoutes } from '../staff'
import { EditOrderPage } from './EditOrderPage'
import { NewOrderPage } from './NewOrderPage'
import { OrderDetailPage } from './OrderDetailPage'
import { OrderListPage } from './OrderListPage'

const NAV: NavItem[] = [
  { to: '/orders', label: 'Orders', icon: ClipboardList, exclude: ['/orders/new'] },
  { to: '/orders/new', label: 'New order', icon: Plus, phone: 'more' },
  { to: '/staff', label: 'Staff', icon: Users },
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/ai-log', label: 'AI log', icon: Sparkles, phone: 'more' },
]

/** The Admin's screens (PRD 0001), desktop first. Other roles never render this. */
export function AdminPortal({ branchName }: { branchName: string | null }) {
  return (
    <AppShell navLabel="Admin" items={NAV}>
      <Routes>
        <Route path="/orders" element={<OrderListPage />} />
        <Route path="/orders/new" element={<NewOrderPage adminBranchName={branchName} />} />
        <Route path="/orders/:orderNo" element={<OrderDetailPage />} />
        <Route path="/orders/:orderNo/edit" element={<EditOrderPage />} />
        <Route
          path="/staff/*"
          element={<StaffRoutes actorRole="admin" orderPath={(orderNo) => `/orders/${encodeURIComponent(orderNo)}`} />}
        />
        <Route
          path="/dashboard/*"
          element={<DashboardRoutes role="admin" orderPath={(orderNo) => `/orders/${encodeURIComponent(orderNo)}`} />}
        />
        <Route path="/ai-log" element={<QuestionLogPage />} />
        {/* 0008's address keeps working. */}
        <Route path="/question-log" element={<Navigate to="/ai-log" replace />} />
        <Route path="/account/password" element={<ChangePasswordPage />} />
        <Route path="*" element={<Navigate to="/orders" replace />} />
      </Routes>
      <AskAssistant role="admin" orderPath={(orderNo) => `/orders/${encodeURIComponent(orderNo)}`} />
    </AppShell>
  )
}
