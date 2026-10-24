import { describe, expect, it } from 'vitest'
import {
  deriveProfileState,
  formatSignedInAs,
  toStaffProfile,
  type StaffProfile,
} from '../../src/features/auth/profile'

const ali: StaffProfile = { id: 'a', name: 'Ali', role: 'technician', branchName: 'Shah Alam' }

describe('toStaffProfile', () => {
  it('maps a current_staff() row with a flat branch_name', () => {
    expect(
      toStaffProfile({ id: '1', name: 'Ali', role: 'technician', branch_name: 'Johor Bahru' }),
    ).toEqual({ id: '1', name: 'Ali', role: 'technician', branchName: 'Johor Bahru' })
  })

  it('tolerates an embedded branch object or array, and a missing branch', () => {
    const base = { id: '1', name: 'A', role: 'admin' }
    expect(toStaffProfile({ ...base, branch: { name: 'KL' } })?.branchName).toBe('KL')
    expect(toStaffProfile({ ...base, branch: [{ name: 'KL' }] })?.branchName).toBe('KL')
    expect(toStaffProfile({ ...base, branch_name: null })?.branchName).toBeNull()
    expect(toStaffProfile(base)?.branchName).toBeNull()
  })

  it('rejects malformed rows and unknown roles', () => {
    expect(toStaffProfile(null)).toBeNull()
    expect(toStaffProfile('x')).toBeNull()
    expect(toStaffProfile({ id: 1, name: 'A', role: 'admin' })).toBeNull()
    expect(toStaffProfile({ id: '1', name: ' ', role: 'admin' })).toBeNull()
    expect(toStaffProfile({ id: '1', name: 'A', role: 'janitor' })).toBeNull()
  })
})

describe('deriveProfileState', () => {
  const row = { id: '1', name: 'Ali', role: 'technician', branch_name: 'Shah Alam' }

  it('is ready when the RPC returns a row (array or single object)', () => {
    const expected = { status: 'ready', profile: { ...ali, id: '1' } }
    expect(deriveProfileState([row], null)).toEqual(expected)
    expect(deriveProfileState(row, null)).toEqual(expected)
  })

  it('is no-profile when the RPC returns no row (AC17: signed in, no active staff profile)', () => {
    expect(deriveProfileState([], null)).toEqual({ status: 'no-profile' })
    expect(deriveProfileState(null, null)).toEqual({ status: 'no-profile' })
    expect(deriveProfileState(undefined, null)).toEqual({ status: 'no-profile' })
  })

  it('never grants a role view for a row it cannot understand', () => {
    expect(deriveProfileState([{ id: '1', name: 'A', role: 'root' }], null)).toEqual({
      status: 'no-profile',
    })
  })

  it('is an error when the RPC fails, even if data is present', () => {
    expect(deriveProfileState(null, { message: 'network down' })).toEqual({
      status: 'error',
      message: 'network down',
    })
    expect(deriveProfileState([row], { message: '  ' })).toEqual({
      status: 'error',
      message: 'Could not load your profile.',
    })
  })
})

describe('formatSignedInAs', () => {
  it('shows name, role and branch', () => {
    expect(formatSignedInAs(ali)).toBe('Signed in as Ali (Technician, Shah Alam)')
  })

  it('falls back to All branches', () => {
    expect(formatSignedInAs({ ...ali, name: 'Aida', role: 'admin', branchName: null })).toBe(
      'Signed in as Aida (Admin, All branches)',
    )
  })
})
