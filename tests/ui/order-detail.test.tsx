// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrderStatus } from '../../src/domain'
import * as api from '../../src/features/orders/api'
import { OrderDetailPage } from '../../src/features/orders/OrderDetailPage'
import { TECH, history, makeOrder, reference } from './fixtures'

vi.mock('../../src/features/orders/api', async (importOriginal) => {
  const actual = await importOriginal<typeof api>()
  return {
    ...actual,
    fetchOrder: vi.fn(),
    fetchOrderHistory: vi.fn(),
    fetchReferenceData: vi.fn(),
    assignTechnician: vi.fn(),
    cancelOrder: vi.fn(),
    rescheduleOrder: vi.fn(),
  }
})

const m = vi.mocked(api)

function renderDetail(url = '/orders/ORDER1001') {
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/orders/:orderNo" element={<OrderDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
  return screen.findByRole('heading', { level: 2, name: /^ORDER\d+/ })
}

beforeEach(() => {
  vi.resetAllMocks()
  m.fetchOrder.mockResolvedValue({ order: makeOrder(), technicianPhone: '60120000011' })
  m.fetchOrderHistory.mockResolvedValue(history)
  m.fetchReferenceData.mockResolvedValue(reference)
})

describe('Order summary after submission (AC6)', () => {
  it('shows the number, status, and every saved field', async () => {
    const heading = await renderDetail('/orders/ORDER1001?created=1')
    expect(heading.textContent).toContain('ORDER1001')
    expect(heading.textContent).toContain('Assigned')
    expect(screen.getByText('Order summary')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain('Order saved. Send the job to Ali on WhatsApp below.')
    for (const text of [
      'Puan Lim',
      '+60 12-345 6789',
      '8 Jalan Kenanga, Shah Alam',
      'Water dripping from indoor unit',
      'Repair',
      'Shah Alam',
      'Mon 26 Oct 2026, 10:00 AM',
      'Gate code 1234',
    ]) {
      expect(screen.getAllByText(text).length).toBeGreaterThan(0)
    }
    expect(screen.getAllByText('RM 180.00').length).toBeGreaterThan(0)
  })
})

describe('WhatsApp deep link (AC7)', () => {
  it("opens wa.me for the technician's number with the job filled in", async () => {
    await renderDetail()
    const link = screen.getByRole('link', { name: /Send job to Ali on WhatsApp/ }) as HTMLAnchorElement
    const url = new URL(link.href)
    expect(url.origin + url.pathname).toBe('https://wa.me/60120000011')
    const text = url.searchParams.get('text') ?? ''
    expect(text).toContain('Hi Ali, a new job has been assigned to you.')
    expect(text).toContain('*ORDER1001* – Repair')
    expect(text).toContain('Phone: +60 12-345 6789')
    expect(text).toContain('/orders/ORDER1001')
    expect(link.target).toBe('_blank')
    expect(link.rel).toContain('noopener')
  })

  it('is not offered for an order without a technician', async () => {
    m.fetchOrder.mockResolvedValue({
      order: makeOrder({ status: 'new', assigned_technician_id: null, technician_name: null }),
      technicianPhone: null,
    })
    await renderDetail()
    expect(screen.queryByRole('link', { name: /WhatsApp/ })).toBeNull()
  })

  it('says so when the technician has no mobile number', async () => {
    m.fetchOrder.mockResolvedValue({ order: makeOrder(), technicianPhone: '60312345678' })
    await renderDetail()
    expect(screen.getByText('No WhatsApp number on file for Ali. Contact them another way.')).toBeTruthy()
  })
})

describe('Actions follow the transition table (AC12)', () => {
  const cases: [OrderStatus, string[]][] = [
    ['new', ['Edit', 'Assign technician', 'Reschedule', 'Cancel order']],
    ['assigned', ['Edit', 'Reassign', 'Reschedule', 'Cancel order']],
    ['acknowledged', ['Edit', 'Reassign', 'Reschedule', 'Cancel order']],
    ['in_progress', ['Reschedule']],
    ['job_done', []],
    ['closed', []],
    ['cancelled', []],
  ]
  it.each(cases)('%s → %j', async (status, expected) => {
    const unassigned = status === 'new'
    m.fetchOrder.mockResolvedValue({
      order: makeOrder({
        status,
        assigned_technician_id: unassigned ? null : TECH.ali,
        technician_name: unassigned ? null : 'Ali',
      }),
      technicianPhone: unassigned ? null : '60120000011',
    })
    await renderDetail()
    const header = screen.getByRole('heading', { level: 2 }).closest('header')!
    const actions = within(header)
      .queryAllByRole('link')
      .concat(within(header).queryAllByRole('button'))
      .map((el) => el.textContent)
    expect(actions).toEqual(expected)
  })
})

describe('Assign, reassign, cancel, reschedule (AC12)', () => {
  it('reassigns to another technician and offers WhatsApp again', async () => {
    m.assignTechnician.mockResolvedValue()
    const user = userEvent.setup()
    await renderDetail()
    await user.click(screen.getByRole('button', { name: 'Reassign' }))
    const dialog = await screen.findByRole('dialog', { name: 'Reassign ORDER1001' })
    const select = within(dialog).getByLabelText('Technician')
    // The current technician is not offered.
    expect(within(select).queryByRole('option', { name: /^Ali/ })).toBeNull()
    await user.selectOptions(select, TECH.bala)
    m.fetchOrder.mockResolvedValue({
      order: makeOrder({ assigned_technician_id: TECH.bala, technician_name: 'Bala' }),
      technicianPhone: '60120000013',
    })
    await user.click(within(dialog).getByRole('button', { name: 'Reassign' }))
    expect(m.assignTechnician).toHaveBeenCalledWith('o-1', TECH.bala)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect((await screen.findByRole('status')).textContent).toContain('Reassigned to Bala.')
    const link = (await screen.findByRole('link', { name: /Send job to Bala/ })) as HTMLAnchorElement
    expect(new URL(link.href).searchParams.get('text')).toContain('Hi Bala, a job has been reassigned to you.')
  })

  it('requires a reason to cancel and shows the database answer', async () => {
    m.cancelOrder.mockRejectedValue(new api.ApiError('ORDER1001 is Closed and can no longer be changed'))
    const user = userEvent.setup()
    await renderDetail()
    await user.click(screen.getByRole('button', { name: 'Cancel order' }))
    const dialog = await screen.findByRole('dialog', { name: 'Cancel ORDER1001' })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel order' }))
    expect(within(dialog).getByText('A reason is required to cancel an order')).toBeTruthy()
    expect(m.cancelOrder).not.toHaveBeenCalled()

    await user.type(within(dialog).getByLabelText('Reason'), 'Customer bought a new unit')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel order' }))
    expect(m.cancelOrder).toHaveBeenCalledWith('o-1', 'Customer bought a new unit')
    expect(await within(dialog).findByText('ORDER1001 is Closed and can no longer be changed')).toBeTruthy()
  })

  it('reschedules with a reason, or postpones with no date', async () => {
    m.rescheduleOrder.mockResolvedValue()
    const user = userEvent.setup()
    await renderDetail('/orders/ORDER1001?action=reschedule')
    const dialog = await screen.findByRole('dialog', { name: 'Reschedule ORDER1001' })
    await user.click(within(dialog).getByRole('button', { name: 'Save new date' }))
    expect(within(dialog).getByText('Select a reason for the reschedule')).toBeTruthy()
    expect(m.rescheduleOrder).not.toHaveBeenCalled()

    await user.click(within(dialog).getByLabelText('Postpone, no new date yet'))
    await user.selectOptions(within(dialog).getByLabelText('Reason'), 'weather')
    await user.selectOptions(within(dialog).getByLabelText('Requested by'), 'customer')
    await user.click(within(dialog).getByRole('button', { name: 'Save new date' }))
    expect(m.rescheduleOrder).toHaveBeenCalledWith('o-1', null, 'weather', 'customer', null)
    expect((await screen.findByRole('status')).textContent).toContain('New date saved.')
  })

  it('closes a dialog with Escape', async () => {
    const user = userEvent.setup()
    await renderDetail()
    await user.click(screen.getByRole('button', { name: 'Cancel order' }))
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('History (AC9)', () => {
  it('shows who did what, with the change in plain words', async () => {
    await renderDetail()
    const section = screen.getByRole('region', { name: 'History' })
    expect(within(section).getByText('Edited the order')).toBeTruthy()
    expect(within(section).getByText('Phone: +60 12-345 6780 → +60 12-345 6789')).toBeTruthy()
    expect(within(section).getAllByText(/Farid Hakim \(Admin\)/).length).toBe(2)
    expect(within(section).getByText('Assigned to Ali')).toBeTruthy()
  })

  it('says when the order does not exist', async () => {
    m.fetchOrder.mockResolvedValue(null)
    render(
      <MemoryRouter initialEntries={['/orders/ORDER9999']}>
        <Routes>
          <Route path="/orders/:orderNo" element={<OrderDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByText('There is no order ORDER9999.')).toBeTruthy()
  })
})
