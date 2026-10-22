// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../../src/features/orders/api'
import { EditOrderPage } from '../../src/features/orders/EditOrderPage'
import { makeOrder, reference } from './fixtures'

vi.mock('../../src/features/orders/api', async (importOriginal) => {
  const actual = await importOriginal<typeof api>()
  return { ...actual, fetchOrder: vi.fn(), fetchReferenceData: vi.fn(), updateOrder: vi.fn() }
})

const m = vi.mocked(api)

function Where() {
  const location = useLocation()
  return <p data-testid="location">{location.pathname + location.search}</p>
}

function renderEdit() {
  render(
    <MemoryRouter initialEntries={['/orders/ORDER1001/edit']}>
      <Routes>
        <Route path="/orders/:orderNo/edit" element={<EditOrderPage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  m.fetchReferenceData.mockResolvedValue(reference)
  m.fetchOrder.mockResolvedValue({ order: makeOrder(), technicianPhone: '60120000011' })
})

describe('Edit order (AC10, Q6, P6, P7)', () => {
  it('prefills the form; technician and an existing date are read-only', async () => {
    renderEdit()
    expect(await screen.findByRole('form', { name: 'Edit order' })).toBeTruthy()
    expect((screen.getByLabelText('Phone') as HTMLInputElement).value).toBe('+60 12-345 6789')
    expect((screen.getByLabelText('Quoted price (RM)') as HTMLInputElement).value).toBe('180.00')
    expect(screen.queryByLabelText(/Assigned technician/)).toBeNull()
    expect(screen.queryByLabelText(/Scheduled date and time/)).toBeNull()
    expect(screen.getByText('Mon 26 Oct 2026, 10:00 AM')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Change date (Reschedule)' }).getAttribute('href')).toBe(
      '/orders/ORDER1001?action=reschedule',
    )
    expect(screen.getByText('Ali will be notified of the changes.')).toBeTruthy()
  })

  it('saves with the version it loaded and the existing date unchanged', async () => {
    m.updateOrder.mockResolvedValue()
    const user = userEvent.setup()
    renderEdit()
    const address = await screen.findByLabelText('Address')
    await user.clear(address)
    await user.type(address, '9 Jalan Melati')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(m.updateOrder).toHaveBeenCalledWith(
      'o-1',
      '2026-10-22T01:00:00.123456+00:00',
      expect.objectContaining({
        customerAddress: '9 Jalan Melati',
        customerPhone: '60123456789',
        quotedPrice: 180,
        scheduledAt: '2026-10-26T02:00:00+00:00',
      }),
    )
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/orders/ORDER1001?updated=1'))
  })

  it('lets the Admin set a date when the order has none', async () => {
    m.fetchOrder.mockResolvedValue({ order: makeOrder({ scheduled_at: null }), technicianPhone: '60120000011' })
    m.updateOrder.mockResolvedValue()
    const user = userEvent.setup()
    renderEdit()
    const date = await screen.findByLabelText('Scheduled date and time (optional)')
    await user.type(date, '2026-11-03T10:00')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(m.updateOrder.mock.lastCall?.[2].scheduledAt).toBe('2026-11-03T02:00:00.000Z')
  })

  it("keeps the Admin's edits when someone else changed the order first", async () => {
    m.updateOrder.mockRejectedValue(
      new api.ApiError('This order was changed by someone else. Reload to see the latest version.'),
    )
    const user = userEvent.setup()
    renderEdit()
    const name = await screen.findByLabelText('Customer name')
    await user.clear(name)
    await user.type(name, 'Puan Lim Mei Ling')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(
      await screen.findByText(
        'This order was changed by someone else. Reload to see the latest version. Your edits are still in the form.',
      ),
    ).toBeTruthy()
    expect((screen.getByLabelText('Customer name') as HTMLInputElement).value).toBe('Puan Lim Mei Ling')
  })

  it('refuses to edit once work has started', async () => {
    m.fetchOrder.mockResolvedValue({ order: makeOrder({ status: 'in_progress' }), technicianPhone: '60120000011' })
    renderEdit()
    expect(await screen.findByText('This order can no longer be edited')).toBeTruthy()
    expect(screen.queryByRole('form')).toBeNull()
  })
})
