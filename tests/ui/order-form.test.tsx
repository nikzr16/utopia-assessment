// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../../src/features/orders/api'
import { NewOrderPage } from '../../src/features/orders/NewOrderPage'
import { BRANCH, TECH, reference } from './fixtures'

vi.mock('../../src/features/orders/api', async (importOriginal) => {
  const actual = await importOriginal<typeof api>()
  return { ...actual, fetchReferenceData: vi.fn(), createOrder: vi.fn() }
})

const fetchReferenceData = vi.mocked(api.fetchReferenceData)
const createOrder = vi.mocked(api.createOrder)

function Where() {
  const location = useLocation()
  return <p data-testid="location">{location.pathname + location.search}</p>
}

function renderForm() {
  render(
    <MemoryRouter initialEntries={['/orders/new']}>
      <Routes>
        <Route path="/orders/new" element={<NewOrderPage adminBranchName="Shah Alam" />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
  return screen.findByRole('form', { name: 'New order' })
}

async function fillValid(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Customer name'), 'Puan Lim')
  await user.type(screen.getByLabelText('Phone'), '012-345 6789')
  await user.type(screen.getByLabelText('Address'), '8 Jalan Kenanga, Shah Alam')
  await user.type(screen.getByLabelText('Problem description'), 'Water dripping')
  await user.selectOptions(screen.getByLabelText('Service type'), 'Repair')
  await user.type(screen.getByLabelText('Quoted price (RM)'), '180')
}

beforeEach(() => {
  fetchReferenceData.mockReset().mockResolvedValue(reference)
  createOrder.mockReset()
})

describe('New order form (AC2)', () => {
  it('has every brief field; the order number is generated on save', async () => {
    await renderForm()
    expect(screen.getByText('Generated on save')).toBeTruthy()
    for (const label of [
      'Customer name',
      'Phone',
      'Address',
      'Problem description',
      'Service type',
      'Quoted price (RM)',
      'Assigned technician (optional)',
      'Admin notes (optional)',
      'Branch',
      'Scheduled date and time (optional)',
    ]) {
      expect(screen.getByLabelText(label)).toBeTruthy()
    }
  })

  it("defaults the branch to the Admin's own and lists only active service types", async () => {
    await renderForm()
    expect((screen.getByLabelText('Branch') as HTMLSelectElement).value).toBe(BRANCH.shahAlam)
    const types = within(screen.getByLabelText('Service type')).getAllByRole('option').map((o) => o.textContent)
    expect(types).toEqual(['Select a service type', 'Aircond cleaning', 'Repair'])
  })

  it("lists technicians with the order's branch first and their open jobs (Q3)", async () => {
    await renderForm()
    const select = screen.getByLabelText('Assigned technician (optional)')
    const groups = Array.from(select.querySelectorAll('optgroup')).map((g) => g.label)
    expect(groups).toEqual(['Shah Alam (this branch)', 'Kuala Lumpur'])
    expect(within(select).getByRole('option', { name: 'Ali — 2 open jobs' })).toBeTruthy()
    expect(within(select).getByRole('option', { name: 'Bala — 0 open jobs' })).toBeTruthy()
    expect(within(select).getByRole('option', { name: 'John — 1 open job' })).toBeTruthy()
  })
})

describe('Validation (AC3)', () => {
  it('shows every problem on submit, saves nothing, and focuses the first field', async () => {
    const user = userEvent.setup()
    await renderForm()
    await user.click(screen.getByRole('button', { name: 'Save order' }))
    expect(screen.getByRole('alert').textContent).toContain('Check the 6 highlighted fields below.')
    expect(screen.getByText('Customer name is required')).toBeTruthy()
    expect(screen.getByText('Customer phone is required')).toBeTruthy()
    expect(screen.getByText('Quoted price is required')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByLabelText('Customer name'))
    expect(screen.getByLabelText('Customer name').getAttribute('aria-invalid')).toBe('true')
    expect(createOrder).not.toHaveBeenCalled()
  })

  it('explains a bad phone number on leaving the field, and tidies a good one', async () => {
    const user = userEvent.setup()
    await renderForm()
    const phone = screen.getByLabelText('Phone') as HTMLInputElement
    await user.type(phone, '012-345 67')
    await user.tab()
    expect(screen.getByText(/Enter a valid Malaysian phone number/)).toBeTruthy()
    await user.clear(phone)
    await user.type(phone, '0123456789')
    await user.tab()
    expect(phone.value).toBe('+60 12-345 6789')
    expect(screen.queryByText(/Enter a valid Malaysian phone number/)).toBeNull()
  })

  it('explains a bad quoted price', async () => {
    const user = userEvent.setup()
    await renderForm()
    await user.type(screen.getByLabelText('Quoted price (RM)'), '150000')
    await user.tab()
    expect(screen.getByText('Quoted price cannot be more than RM 100,000.00')).toBeTruthy()
  })
})

describe('Saving (AC5, AC13)', () => {
  it('sends clean values once, even on a double click, then opens the summary', async () => {
    let resolve: (order: { id: string; orderNo: string }) => void = () => {}
    createOrder.mockImplementation(() => new Promise((r) => (resolve = r)))
    const user = userEvent.setup()
    await renderForm()
    await fillValid(user)
    await user.selectOptions(screen.getByLabelText('Assigned technician (optional)'), TECH.bala)

    const save = screen.getByRole('button', { name: 'Save order' })
    await user.dblClick(save)
    await user.click(save)
    expect(createOrder).toHaveBeenCalledTimes(1)
    expect(createOrder).toHaveBeenCalledWith({
      branchId: BRANCH.shahAlam,
      customerName: 'Puan Lim',
      customerPhone: '60123456789',
      customerAddress: '8 Jalan Kenanga, Shah Alam',
      problemDescription: 'Water dripping',
      serviceTypeId: 'st-repair',
      quotedPrice: 180,
      technicianId: TECH.bala,
      scheduledAt: null,
      adminNotes: null,
    })
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeTruthy()

    resolve({ id: 'o-1007', orderNo: 'ORDER1007' })
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/orders/ORDER1007?created=1'))
  })

  it('shows a database error in plain language and keeps the form', async () => {
    createOrder.mockRejectedValue(new api.ApiError('Only Admin can create an order'))
    const user = userEvent.setup()
    await renderForm()
    await fillValid(user)
    await user.click(screen.getByRole('button', { name: 'Save order' }))
    expect(await screen.findByText('Only Admin can create an order')).toBeTruthy()
    expect(screen.getByText('The order was not saved')).toBeTruthy()
    expect((screen.getByLabelText('Customer name') as HTMLInputElement).value).toBe('Puan Lim')
    expect(screen.getByRole('button', { name: 'Save order' })).toBeTruthy()
  })
})
