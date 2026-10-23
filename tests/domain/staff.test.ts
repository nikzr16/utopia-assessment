import { describe, expect, it } from 'vitest'
import {
  BRANCH_REQUIRED_MESSAGE,
  EMAIL_INVALID_MESSAGE,
  NAME_REQUIRED_MESSAGE,
  PHONE_INVALID_MESSAGE,
  ROLE_REQUIRED_MESSAGE,
  TECHNICIAN_MOBILE_MESSAGE,
  assignableRoles,
  describeStaffChanges,
  formatMyPhone,
  openJobsError,
  staffLabel,
  staffManageError,
  validateStaffForm,
  type StaffFormValues,
} from '../../src/domain'

const FORM: StaffFormValues = {
  name: '  Ravi Kumar ',
  email: ' Ravi@Example.com',
  phone: '012-777 1234',
  role: 'technician',
  branchId: 'sa',
  additionalBranchIds: [],
}

describe('validateStaffForm', () => {
  it('returns the values to save: trimmed name, lower-case email, stored phone', () => {
    expect(validateStaffForm(FORM)).toEqual({
      ok: true,
      value: {
        name: 'Ravi Kumar',
        email: 'ravi@example.com',
        phone: '60127771234',
        role: 'technician',
        branchId: 'sa',
        additionalBranchIds: [],
      },
    })
  })

  it('shows every problem at once', () => {
    expect(validateStaffForm({ ...FORM, name: ' ', email: 'ravi@', phone: '12', role: '', branchId: '' })).toEqual({
      ok: false,
      errors: {
        name: NAME_REQUIRED_MESSAGE,
        email: EMAIL_INVALID_MESSAGE,
        phone: PHONE_INVALID_MESSAGE,
        role: ROLE_REQUIRED_MESSAGE,
        branch: BRANCH_REQUIRED_MESSAGE,
      },
    })
  })

  it('needs a mobile for a technician only', () => {
    expect(validateStaffForm({ ...FORM, phone: '03-5512 3456' })).toEqual({ ok: false, errors: { phone: TECHNICIAN_MOBILE_MESSAGE } })
    expect(validateStaffForm({ ...FORM, phone: '03-5512 3456', role: 'finance' }).ok).toBe(true)
  })

  it('keeps additional branches for Managers only, never the home branch', () => {
    const manager = validateStaffForm({ ...FORM, role: 'manager', additionalBranchIds: ['pg', 'sa'] })
    expect(manager.ok && manager.value.additionalBranchIds).toEqual(['pg'])
    const tech = validateStaffForm({ ...FORM, additionalBranchIds: ['pg'] })
    expect(tech.ok && tech.value.additionalBranchIds).toEqual([])
  })
})

describe('staffManageError', () => {
  const name = (id: string) => ({ sa: 'Shah Alam', pg: 'Penang', kl: 'Kuala Lumpur' })[id] ?? id
  const nurul = { role: 'manager' as const, branchId: 'sa', additionalBranchIds: [] }
  const ali = { name: 'Ali', role: 'technician' as const, branchId: 'sa', additionalBranchIds: [] }

  it('lets Admins do anything and Managers handle their own technicians', () => {
    expect(staffManageError({ role: 'admin', branchId: 'kl', additionalBranchIds: [] }, null, { ...ali, role: 'manager' }, name)).toBeNull()
    expect(staffManageError(nurul, ali, ali, name)).toBeNull()
    expect(staffManageError(nurul, null, ali, name)).toBeNull()
  })

  it('names the reason otherwise', () => {
    expect(staffManageError({ ...nurul, role: 'finance' }, null, ali, name)).toBe('Only Admins and Managers can manage staff')
    expect(staffManageError(nurul, { ...ali, role: 'finance' }, ali, name)).toBe('Managers can only manage technicians')
    expect(staffManageError(nurul, { ...ali, branchId: 'kl' }, ali, name)).toBe('Only a Manager of Kuala Lumpur can manage Ali')
    expect(staffManageError(nurul, ali, { ...ali, role: 'manager' }, name)).toBe('Only an Admin can change a role')
    expect(staffManageError(nurul, null, { ...ali, role: 'manager' }, name)).toBe('Managers can only add technicians')
    expect(staffManageError(nurul, ali, { ...ali, additionalBranchIds: ['pg'] }, name)).toBe('Only an Admin can change branch cover')
    expect(staffManageError(nurul, ali, { ...ali, branchId: 'pg' }, name)).toBe('You do not cover Penang. Choose one of your branches.')
    const withEmail = { ...ali, email: 'ali@sejuk.example.com' }
    expect(staffManageError(nurul, withEmail, { ...withEmail, email: 'mine@example.com' }, name)).toBe('Only an Admin can change an email')
    expect(staffManageError(nurul, withEmail, { ...withEmail, email: 'ALI@sejuk.example.com' }, name)).toBeNull()
    expect(
      staffManageError({ role: 'admin', branchId: 'kl', additionalBranchIds: [] }, withEmail, { ...withEmail, email: 'x@example.com' }, name),
    ).toBeNull()
  })
})

describe('labels', () => {
  it('assignableRoles: every role for Admins, technicians for Managers', () => {
    expect(assignableRoles('admin')).toEqual(['admin', 'technician', 'manager', 'finance'])
    expect(assignableRoles('manager')).toEqual(['technician'])
  })

  it('openJobsError counts jobs', () => {
    expect(openJobsError('Ali', 0)).toBeNull()
    expect(openJobsError('Ali', 1)).toBe('Ali has 1 open job. Reassign it first.')
    expect(openJobsError('Ali', 3)).toBe('Ali has 3 open jobs. Reassign them first.')
  })

  it('staffLabel tags inactive staff only', () => {
    expect(staffLabel('Bala', false)).toBe('Bala (inactive)')
    expect(staffLabel('Bala', true)).toBe('Bala')
    expect(staffLabel('Bala', undefined)).toBe('Bala')
  })

  it('describeStaffChanges: one line per field, in form order, with readable values', () => {
    expect(
      describeStaffChanges(
        {
          cover: { from: [], to: ['Penang'] },
          branch: { from: 'Shah Alam', to: 'Kuala Lumpur' },
          role: { from: 'technician', to: 'manager' },
          phone: { from: '60123456789', to: '60127771234' },
        },
        formatMyPhone,
      ),
    ).toEqual([
      'Phone: +60 12-345 6789 → +60 12-777 1234',
      'Role: Technician → Manager',
      'Home branch: Shah Alam → Kuala Lumpur',
      'Also covers: none → Penang',
    ])
    expect(describeStaffChanges({ name: { to: 'Ravi' }, email: { to: 'ravi@example.com' } }, formatMyPhone)).toEqual([
      'Name: Ravi',
      'Email: ravi@example.com',
    ])
  })
})
