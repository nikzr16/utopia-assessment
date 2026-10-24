import { NavLink, Navigate, Route, Routes } from 'react-router'
import { AskAssistant, QuestionLogPage } from '../ask'
import { DashboardRoutes } from '../kpi'
import { StaffRoutes } from '../staff'
import { EditOrderPage } from './EditOrderPage'
import { NewOrderPage } from './NewOrderPage'
import { OrderDetailPage } from './OrderDetailPage'
import { OrderListPage } from './OrderListPage'

const TAB =
  'rounded-md px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-sky-300'

/** The Admin's screens (PRD 0001). Other roles never render this. */
export function AdminPortal({ branchName }: { branchName: string | null }) {
  return (
    <div>
      <nav aria-label="Admin" className="mb-5 flex gap-2 border-b border-slate-200 pb-3">
        <NavLink
          to="/orders"
          end
          className={({ isActive }) => `${TAB} ${isActive ? 'bg-sky-100 text-sky-900' : 'text-slate-700 hover:bg-slate-100'}`}
        >
          Orders
        </NavLink>
        <NavLink
          to="/orders/new"
          className={({ isActive }) => `${TAB} ${isActive ? 'bg-sky-100 text-sky-900' : 'text-slate-700 hover:bg-slate-100'}`}
        >
          New order
        </NavLink>
        <NavLink
          to="/staff"
          className={({ isActive }) => `${TAB} ${isActive ? 'bg-sky-100 text-sky-900' : 'text-slate-700 hover:bg-slate-100'}`}
        >
          Staff
        </NavLink>
        <NavLink
          to="/dashboard"
          className={({ isActive }) => `${TAB} ${isActive ? 'bg-sky-100 text-sky-900' : 'text-slate-700 hover:bg-slate-100'}`}
        >
          Dashboard
        </NavLink>
        <NavLink
          to="/ai-log"
          className={({ isActive }) => `${TAB} ${isActive ? 'bg-sky-100 text-sky-900' : 'text-slate-700 hover:bg-slate-100'}`}
        >
          AI log
        </NavLink>
      </nav>
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
        <Route path="*" element={<Navigate to="/orders" replace />} />
      </Routes>
      <AskAssistant role="admin" orderPath={(orderNo) => `/orders/${encodeURIComponent(orderNo)}`} />
    </div>
  )
}
