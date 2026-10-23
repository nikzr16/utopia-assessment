import { Navigate, Route, Routes } from 'react-router'
import type { StaffRole } from '../../domain'
import { DashboardPage } from './DashboardPage'
import { TechnicianKpiPage } from './TechnicianKpiPage'

export interface KpiRoutesProps {
  role: StaffRole
  /** Where an order opens in the person's own portal. */
  orderPath: (orderNo: string) => string
}

/**
 * The dashboard screens under `/dashboard` (0007) for Admins, Managers and
 * Finance. Loaded on demand (see `lazy.tsx`) so the chart library only
 * downloads with them.
 */
export function KpiRoutes({ role, orderPath }: KpiRoutesProps) {
  return (
    <Routes>
      <Route index element={<DashboardPage role={role} />} />
      <Route path="technicians/:technicianId" element={<TechnicianKpiPage orderPath={orderPath} />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}
