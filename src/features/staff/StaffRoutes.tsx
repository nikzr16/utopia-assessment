import { Navigate, Route, Routes } from 'react-router'
import type { StaffRole } from '../../domain'
import { EditStaffPage, NewStaffPage } from './StaffFormPage'
import { StaffListPage } from './StaffListPage'
import { StaffPage } from './StaffPage'

/**
 * The staff screens under `/staff` (0006), for Admins and Managers.
 * `orderPath` opens an order in the person's own portal.
 */
export function StaffRoutes({ actorRole, orderPath }: { actorRole: StaffRole; orderPath: (orderNo: string) => string }) {
  return (
    <Routes>
      <Route index element={<StaffListPage actorRole={actorRole} />} />
      <Route path="new" element={<NewStaffPage actorRole={actorRole} />} />
      <Route path=":staffId" element={<StaffPage orderPath={orderPath} />} />
      <Route path=":staffId/edit" element={<EditStaffPage actorRole={actorRole} />} />
      <Route path="*" element={<Navigate to="/staff" replace />} />
    </Routes>
  )
}
