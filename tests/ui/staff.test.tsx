// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STAFF_PAGE_SIZE } from '../../src/domain'
import * as api from '../../src/features/staff/api'
import { StaffRoutes } from '../../src/features/staff'
import { toStaffQuery } from '../../src/features/staff/StaffListPage'
import './fixtures'

vi.mock('../../src/features/staff/api', async (importOriginal) => {
  const actual = await importOriginal<typeof api>()
  return {
    ...actual,
    listStaff: vi.fn(),
    fetchStaffDetail: vi.fn(),
    fetchBranchCover: vi.fn(),
    fetchBranchOptions: vi.fn(),
    checkStaffForm: vi.fn(),
    staffAccess: vi.fn(),
  }
})
vi.mock('../../src/lib/staffStatus', () => ({
  useInactiveStaff: () => new Set(['s-old-admin']),
  forgetInactiveStaff: vi.fn(),
}))

const m = vi.mocked(api)

const BRANCHES = [
  { id: 'b-kk', name: 'Kota Kinabalu' },
  { id: 'b-pg', name: 'Penang' },
  { id: 'b-sa', name: 'Shah Alam' },
]

const row = (over: Partial<api.StaffRow> = {}): api.StaffRow => ({
  id: 's-ali',
  name: 'Ali',
  email: 'ali@sejuk.example.com',
  phone: '60120000011',
  role: 'technician',
  branch_id: 'b-sa',
  branch_name: 'Shah Alam',
  additional_branch_ids: [],
  additional_branch_names: [],
  active: true,
  joined_at: '2026-10-21T16:00:00+00:00',
  left_at: null,
  sign_in_state: 'ready',
  can_manage: true,
  ...over,
})

const PERMS: api.StaffPermissions = {
  can_edit: true,
  can_change_role: true,
  can_change_cover: true,
  can_deactivate: true,
  can_reactivate: false,
  can_send_invite: false,
  can_reset_password: true,
  deactivate_blocker: null,
}

const detail = (over: Partial<api.StaffDetail> = {}): api.StaffDetail => {
  const { can_manage: _ignored, ...staff } = row()
  return {
    staff,
    permissions: PERMS,
    open_jobs: [],
    history: [
      {
        id: 2,
        action: 'updated',
        changes: { branch: { from: 'Kuala Lumpur', to: 'Shah Alam' } },
        actor_id: 's-old-admin',
        actor_name: 'Farid Hakim',
        created_at: '2026-10-23T02:14:00+00:00',
      },
      { id: 1, action: 'created', changes: { name: { to: 'Ali' } }, actor_id: null, actor_name: null, created_at: '2026-10-21T16:00:00+00:00' },
    ],
    ...over,
  }
}

function Where() {
  const loc = useLocation()
  return <p data-testid="where">{loc.pathname + loc.search}</p>
}

function renderStaff(url: string, actorRole: 'admin' | 'manager' = 'admin') {
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/staff/*" element={<StaffRoutes actorRole={actorRole} orderPath={(no) => `/orders/${no}`} />} />
        <Route path="*" element={<p>Elsewhere</p>} />
      </Routes>
      <Where />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  m.listStaff.mockReset().mockResolvedValue({ rows: [row(), row({ id: 's-bala', name: 'Bala', active: false, left_at: '2026-10-22T16:00:00+00:00' })], total: 2 })
  m.fetchBranchCover.mockReset().mockResolvedValue([
    { branch_id: 'b-kk', branch_name: 'Kota Kinabalu', managers: [], active_staff: 0, has_manager: false },
    { branch_id: 'b-sa', branch_name: 'Shah Alam', managers: [{ id: 's-n', name: 'Nurul Huda', home: true }, { id: 's-m', name: 'Lim Mei Ling', home: false }], active_staff: 5, has_manager: true },
  ])
  m.fetchBranchOptions.mockReset().mockResolvedValue(BRANCHES)
  m.fetchStaffDetail.mockReset().mockResolvedValue(detail())
  m.checkStaffForm.mockReset().mockResolvedValue([])
  m.staffAccess.mockReset()
})
afterEach(() => vi.useRealTimers())

describe('toStaffQuery', () => {
  it('reads search, role, branch, status and page; defaults to active', () => {
    expect(toStaffQuery(new URLSearchParams('q=ali&role=technician&branch=b1&status=all&page=2'))).toEqual({
      search: 'ali', role: 'technician', branchId: 'b1', status: 'all', limit: STAFF_PAGE_SIZE, offset: STAFF_PAGE_SIZE,
    })
    expect(toStaffQuery(new URLSearchParams('role=boss&status=gone'))).toMatchObject({ role: undefined, status: 'active', offset: 0 })
  })
})

describe('Staff list', () => {
  it('lists staff with role, branch, status, and the branch cover panel (missing Manager opened)', async () => {
    renderStaff('/staff')
    const table = await screen.findByRole('table')
    expect((within(table).getByRole('link', { name: 'Ali' })).getAttribute('href')).toBe('/staff/s-ali')
    expect(within(table).getByText('Inactive')).toBeTruthy()
    expect(within(table).getByText('Left 23 Oct 2026')).toBeTruthy()
    expect(await screen.findByText(/Kota Kinabalu has no Manager/)).toBeTruthy()
    const cover = screen.getByRole('list', { name: 'Branch cover' })
    expect(within(cover).getByText('Nurul Huda, Lim Mei Ling (cover)')).toBeTruthy()
    expect((screen.getByRole('link', { name: 'Add staff' })).getAttribute('href')).toBe('/staff/new')
  })

  it('keeps search and filters in the address and asks for that page', async () => {
    renderStaff('/staff')
    await screen.findByRole('table')
    await userEvent.type(screen.getByLabelText('Search staff'), '0123')
    await userEvent.click(screen.getByRole('button', { name: 'Search' }))
    await userEvent.selectOptions(screen.getByLabelText('Role'), 'technician')
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'inactive')
    expect((screen.getByTestId('where')).textContent).toContain('/staff?q=0123&role=technician&status=inactive')
    await waitFor(() =>
      expect(m.listStaff).toHaveBeenLastCalledWith({
        search: '0123', role: 'technician', branchId: undefined, status: 'inactive', limit: STAFF_PAGE_SIZE, offset: 0,
      }),
    )
  })

  it('pages through 40+ teams', async () => {
    m.listStaff.mockResolvedValue({ rows: [row()], total: 45 })
    renderStaff('/staff')
    await screen.findByText('Showing 1–25 of 45')
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect((screen.getByTestId('where')).textContent).toContain('/staff?page=2')
    await waitFor(() => expect(m.listStaff).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 25 })))
  })

  it('says "Add technician" to a Manager', async () => {
    renderStaff('/staff', 'manager')
    expect(await screen.findByRole('link', { name: 'Add technician' })).toBeTruthy()
  })
})

describe('Adding staff', () => {
  it('checks the form, warns before Save, and saves through the server function', async () => {
    m.checkStaffForm.mockImplementation(async (_id, input) =>
      input.branchId === 'b-kk' ? [{ field: 'branch', message: 'Kota Kinabalu has no Manager. Add a Manager to this branch first.' }] : [],
    )
    m.staffAccess.mockResolvedValue({ staffId: 's-new', message: 'Ravi is added. An invite was sent to ravi@example.com.' })
    renderStaff('/staff/new')
    await screen.findByRole('heading', { name: 'Add staff' })

    await userEvent.click(screen.getByRole('button', { name: 'Add and send invite' }))
    expect(screen.getByText('Name is required')).toBeTruthy()
    expect(document.getElementById('staff-role-error')?.textContent).toBe('Choose a role')
    expect(m.staffAccess).not.toHaveBeenCalled()

    await userEvent.type(screen.getByLabelText('Name'), 'Ravi')
    await userEvent.type(screen.getByLabelText('Email'), 'Ravi@Example.com')
    await userEvent.type(screen.getByLabelText(/^Phone/), '03-5512 3456')
    await userEvent.selectOptions(screen.getByLabelText('Role'), 'technician')
    await userEvent.selectOptions(screen.getByLabelText('Home branch'), 'b-kk')
    expect(await screen.findByText('Kota Kinabalu has no Manager. Add a Manager to this branch first.')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Add and send invite' }))
    expect(screen.getByText(/A technician needs a Malaysian mobile number/)).toBeTruthy()

    await userEvent.clear(screen.getByLabelText(/^Phone/))
    await userEvent.type(screen.getByLabelText(/^Phone/), '012-777 1234')
    await userEvent.selectOptions(screen.getByLabelText('Home branch'), 'b-sa')
    await userEvent.click(screen.getByRole('button', { name: 'Add and send invite' }))
    await waitFor(() =>
      expect(m.staffAccess).toHaveBeenCalledWith('create', {
        staff: {
          name: 'Ravi', email: 'ravi@example.com', phone: '60127771234', role: 'technician', branchId: 'b-sa', additionalBranchIds: [],
        },
      }),
    )
    expect((screen.getByTestId('where')).textContent).toContain('/staff/s-new')
  })

  it('lets an Admin give a Manager extra branches; a Manager sees no role or cover choice', async () => {
    renderStaff('/staff/new')
    await screen.findByRole('heading', { name: 'Add staff' })
    await userEvent.selectOptions(screen.getByLabelText('Role'), 'manager')
    await userEvent.selectOptions(screen.getByLabelText('Home branch'), 'b-sa')
    const cover = screen.getByRole('group', { name: 'Also covers' })
    expect(within(cover).queryByLabelText('Shah Alam')).toBeNull()
    expect(within(cover).getByLabelText('Penang')).toBeTruthy()
  })

  it('a Manager adds technicians only (role fixed)', async () => {
    m.fetchBranchOptions.mockResolvedValue([{ id: 'b-sa', name: 'Shah Alam' }])
    renderStaff('/staff/new', 'manager')
    await screen.findByRole('heading', { name: 'Add technician' })
    expect(((screen.getByLabelText('Role')) as HTMLSelectElement).disabled).toBe(true)
    expect(((screen.getByLabelText('Role')) as HTMLInputElement).value).toBe('technician')
    expect(((screen.getByLabelText('Home branch')) as HTMLInputElement).value).toBe('b-sa')
    expect(m.fetchBranchOptions).toHaveBeenCalledWith('manager')
  })

  it('shows the server function\'s refusal and keeps the form', async () => {
    m.staffAccess.mockRejectedValue(new api.ApiError('This email is already used by Ali'))
    renderStaff('/staff/new')
    await screen.findByRole('heading', { name: 'Add staff' })
    await userEvent.type(screen.getByLabelText('Name'), 'Ravi')
    await userEvent.type(screen.getByLabelText('Email'), 'ali@sejuk.example.com')
    await userEvent.type(screen.getByLabelText(/^Phone/), '0127771234')
    await userEvent.selectOptions(screen.getByLabelText('Role'), 'finance')
    await userEvent.selectOptions(screen.getByLabelText('Home branch'), 'b-sa')
    await userEvent.click(screen.getByRole('button', { name: 'Add and send invite' }))
    expect((await screen.findByRole('alert')).textContent).toContain('This email is already used by Ali')
    expect(((screen.getByLabelText('Name')) as HTMLInputElement).value).toBe('Ravi')
  })
})

describe('Editing staff', () => {
  it('fills the form and keeps cover unchanged unless an Admin sends it', async () => {
    m.staffAccess.mockResolvedValue({ staffId: 's-ali', message: 'Saved.' })
    renderStaff('/staff/s-ali/edit', 'manager')
    await screen.findByRole('heading', { name: 'Edit Ali' })
    expect(((screen.getByLabelText(/^Phone/)) as HTMLInputElement).value).toBe('012-000 0011')
    // 0006 decision: only an Admin changes an email (it is the sign-in).
    expect((screen.getByLabelText('Email') as HTMLInputElement).disabled).toBe(true)
    await userEvent.clear(screen.getByLabelText('Name'))
    await userEvent.type(screen.getByLabelText('Name'), 'Ali Bin Abu')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(m.staffAccess).toHaveBeenCalledWith('update', {
        staffId: 's-ali',
        staff: expect.objectContaining({ name: 'Ali Bin Abu', phone: '60120000011', additionalBranchIds: null }),
      }),
    )
  })

  it('refuses to open for someone the person may not edit', async () => {
    m.fetchStaffDetail.mockResolvedValue(detail({ permissions: { ...PERMS, can_edit: false } }))
    renderStaff('/staff/s-ali/edit', 'manager')
    expect(await screen.findByText('You cannot edit Ali')).toBeTruthy()
  })
})

describe('Staff page', () => {
  it('shows details, history (with inactive tags) and the allowed actions', async () => {
    renderStaff('/staff/s-ali')
    expect(await screen.findByRole('heading', { name: 'Ali' })).toBeTruthy()
    expect(screen.getByText('+60 12-000 0011')).toBeTruthy()
    expect(screen.getByText('Can sign in')).toBeTruthy()
    expect(screen.getByText(/by Farid Hakim \(inactive\)/)).toBeTruthy()
    expect(screen.getByText('Home branch: Kuala Lumpur → Shah Alam')).toBeTruthy()
    expect(screen.getByText(/by set-up/)).toBeTruthy()
    expect((screen.getByRole('link', { name: 'Edit details' })).getAttribute('href')).toBe('/staff/s-ali/edit')
    expect(screen.getByRole('button', { name: 'Send password reset' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Send invite/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reactivate' })).toBeNull()
  })

  it('explains why deactivation is blocked and links the open jobs', async () => {
    m.fetchStaffDetail.mockResolvedValue(
      detail({
        permissions: { ...PERMS, deactivate_blocker: 'Ali has 1 open job. Reassign it first.' },
        open_jobs: [{ order_id: 'o1', order_no: 'ORDER1042', status: 'in_progress', branch_name: 'Shah Alam' }],
      }),
    )
    renderStaff('/staff/s-ali')
    await userEvent.click(await screen.findByRole('button', { name: 'Deactivate' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Ali has 1 open job. Reassign it first.')).toBeTruthy()
    expect((within(dialog).getByRole('link', { name: 'ORDER1042' })).getAttribute('href')).toBe('/orders/ORDER1042')
    expect(within(dialog).queryByRole('button', { name: 'Deactivate' })).toBeNull()
    expect(m.staffAccess).not.toHaveBeenCalled()
  })

  it('deactivates after confirming, then shows a partial failure with a retry', async () => {
    m.staffAccess
      .mockResolvedValueOnce({
        staffId: 's-ali',
        message: 'Ali is deactivated and can see no data.',
        warning: 'Their sign-in is not blocked yet: timeout',
        retry: 'retry_block',
      })
      .mockResolvedValueOnce({ staffId: 's-ali', message: 'Ali can no longer sign in.' })
    renderStaff('/staff/s-ali')
    await userEvent.click(await screen.findByRole('button', { name: 'Deactivate' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Deactivate' }))
    expect(m.staffAccess).toHaveBeenCalledWith('deactivate', { staffId: 's-ali' })
    expect(await screen.findByText('Their sign-in is not blocked yet: timeout')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Block their sign-in again' }))
    expect(m.staffAccess).toHaveBeenLastCalledWith('retry_block', { staffId: 's-ali' })
    expect(await screen.findByText('Ali can no longer sign in.')).toBeTruthy()
  })

  it('sends an invite to someone who has not set a password yet', async () => {
    const { can_manage: _x, ...staff } = row({ sign_in_state: 'invite_pending' })
    m.fetchStaffDetail.mockResolvedValue(
      detail({ staff, permissions: { ...PERMS, can_send_invite: true, can_reset_password: false } }),
    )
    m.staffAccess.mockResolvedValue({ staffId: 's-ali', message: 'Invite sent to ali@sejuk.example.com.' })
    renderStaff('/staff/s-ali')
    await userEvent.click(await screen.findByRole('button', { name: 'Send invite again' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Send invite' }))
    expect(m.staffAccess).toHaveBeenCalledWith('resend_invite', { staffId: 's-ali' })
    expect(await screen.findByText('Invite sent to ali@sejuk.example.com.')).toBeTruthy()
  })

  it('shows a refusal inside the dialog', async () => {
    m.staffAccess.mockRejectedValue(new api.ApiError('Siti Aminah is the last active Finance user. Add another Finance user first.'))
    renderStaff('/staff/s-ali')
    await userEvent.click(await screen.findByRole('button', { name: 'Deactivate' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Deactivate' }))
    expect((await within(screen.getByRole('dialog')).findByRole('alert')).textContent).toContain('last active Finance user')
  })
})
