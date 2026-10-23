// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrderStatus } from '../../src/domain'
import * as filesApi from '../../src/features/attachments/api'
import * as messagesApi from '../../src/features/customer-messages/api'
import * as api from '../../src/features/orders/api'
import { OrderDetailPage } from '../../src/features/orders/OrderDetailPage'
import { CUSTOMER_MESSAGE_TEXT, TECH, history, makeCustomerMessage, makeOrder, reference } from './fixtures'

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
    fetchOrderRecords: vi.fn(),
  }
})
vi.mock('../../src/features/attachments/api', async (importOriginal) => {
  const actual = await importOriginal<typeof filesApi>()
  return { ...actual, fetchJobFiles: vi.fn(), signedUrls: vi.fn() }
})

// 0005: the order pages show the customer feedback card; no feedback here.
vi.mock('../../src/features/feedback/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/features/feedback/api')>()),
  fetchOrderFeedback: async () => [],
}))
vi.mock('../../src/features/customer-messages/api', async (importOriginal) => {
  const actual = await importOriginal<typeof messagesApi>()
  return { ...actual, fetchLatestCustomerMessage: vi.fn(), confirmCustomerMessage: vi.fn(), editCustomerMessage: vi.fn() }
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
  m.fetchOrderRecords.mockResolvedValue({ completion: null, payments: [], rework: null })
  vi.mocked(filesApi.fetchJobFiles).mockResolvedValue([])
  vi.mocked(filesApi.signedUrls).mockResolvedValue({})
  vi.mocked(messagesApi.fetchLatestCustomerMessage).mockResolvedValue(null)
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

describe('Completion section (0002 AC15)', () => {
  it.each([
    ['assigned', false],
    ['in_progress', true],
    ['job_done', true],
    ['cancelled', false],
  ] as const)('is shown while %s: %s', async (status, shown) => {
    m.fetchOrder.mockResolvedValue({ order: makeOrder({ status }), technicianPhone: '60120000011' })
    await renderDetail()
    expect(Boolean(screen.queryByRole('region', { name: 'Completion' }))).toBe(shown)
  })

  it('lets an Admin add files while the job is In Progress, not after', async () => {
    m.fetchOrder.mockResolvedValue({ order: makeOrder({ status: 'in_progress' }), technicianPhone: '60120000011' })
    await renderDetail()
    const section = within(screen.getByRole('region', { name: 'Completion' }))
    expect(await section.findByText('Not submitted yet.')).toBeTruthy()
    expect(section.getByRole('button', { name: 'Add photos, videos or PDFs' })).toBeTruthy()
    expect(section.getByText('No payments recorded yet.')).toBeTruthy()
  })

  it('shows the submitted record, the returned note, and payments with receipts', async () => {
    m.fetchOrder.mockResolvedValue({
      order: makeOrder({ status: 'in_progress', extra_charges: 40, final_amount: 220 }),
      technicianPhone: '60120000011',
    })
    m.fetchOrderRecords.mockResolvedValue({
      completion: {
        work_done: 'Cleaned filters',
        extra_charges: 40,
        remarks: 'New filter',
        completed_at: '2026-10-26T05:00:00Z',
        technician_name: 'Ali',
      },
      payments: [
        {
          id: 'p1',
          amount: 220,
          method: 'card',
          note: null,
          recorded_at: '2026-10-26T06:00:00Z',
          recorded_by_name: 'Ali',
          receipt: { id: 'a1', kind: 'photo', storage_path: 'o-1/receipts/r.jpg', file_name: 'slip.jpg' },
        },
      ],
      rework: { note: 'Photo missing', by: 'Nurul Huda', at: '2026-10-26T07:00:00Z' },
    })
    vi.mocked(filesApi.signedUrls).mockResolvedValue({ 'o-1/receipts/r.jpg': 'https://signed/r.jpg' })
    await renderDetail()
    const section = within(screen.getByRole('region', { name: 'Completion' }))
    expect(await section.findByText('Cleaned filters')).toBeTruthy()
    expect(section.getByText('RM 220.00')).toBeTruthy()
    expect(section.getByText('Ali, Mon 26 Oct 2026, 1:00 PM')).toBeTruthy()
    expect(section.getByText('Returned for rework by Nurul Huda: Photo missing')).toBeTruthy()
    const payments = within(section.getByRole('list', { name: 'Payments' }))
    expect(payments.getByText(/RM 220\.00 · Card/)).toBeTruthy()
    expect((await payments.findByRole('link', { name: 'Receipt' })).getAttribute('href')).toBe('https://signed/r.jpg')
  })

  it('makes the files read-only once the job is submitted', async () => {
    m.fetchOrder.mockResolvedValue({ order: makeOrder({ status: 'job_done' }), technicianPhone: '60120000011' })
    await renderDetail()
    const section = within(screen.getByRole('region', { name: 'Completion' }))
    await section.findByText('No files yet.')
    expect(section.queryByRole('button', { name: 'Add photos, videos or PDFs' })).toBeNull()
  })
})

describe('History of 0002 events', () => {
  it('names payment methods, receipts and files in plain words', async () => {
    m.fetchOrder.mockResolvedValue({ order: makeOrder({ status: 'in_progress' }), technicianPhone: '60120000011' })
    m.fetchOrderHistory.mockResolvedValue([
      {
        id: 3,
        action: 'payment_recorded',
        actor_role: 'technician',
        actor_name: 'Ali',
        from_status: null,
        to_status: null,
        note: null,
        details: { amount: 150, method: 'bank_transfer', receipt: true },
        created_at: '2026-10-26T04:00:00Z',
      },
      {
        id: 2,
        action: 'file_added',
        actor_role: 'technician',
        actor_name: 'Ali',
        from_status: null,
        to_status: null,
        note: null,
        details: { kind: 'photo', file_name: 'unit.jpg' },
        created_at: '2026-10-26T03:00:00Z',
      },
    ])
    await renderDetail()
    const historyList = within(screen.getByRole('region', { name: 'History' }))
    expect(historyList.getByText('Recorded a payment')).toBeTruthy()
    expect(historyList.getByText('RM 150.00 by Bank transfer, with receipt')).toBeTruthy()
    expect(historyList.getByText('Added a file')).toBeTruthy()
    expect(historyList.getByText('unit.jpg')).toBeTruthy()
  })
})

describe('Customer message (0003)', () => {
  it('shows the Admin the message, the badge and Send on a finished order', async () => {
    m.fetchOrder.mockResolvedValue({ order: makeOrder({ status: 'job_done' }), technicianPhone: '60120000011' })
    vi.mocked(messagesApi.fetchLatestCustomerMessage).mockResolvedValue(makeCustomerMessage())
    await renderDetail()
    const panel = within(await screen.findByRole('region', { name: 'Customer message' }))
    expect(panel.getByText(CUSTOMER_MESSAGE_TEXT)).toBeTruthy()
    expect(panel.getByText('Customer not told yet')).toBeTruthy()
    expect(panel.getByRole('link', { name: /Send to customer on WhatsApp/ })).toBeTruthy()
    expect(panel.getByRole('button', { name: 'Edit message' })).toBeTruthy()
  })

  it('shows "Sent by X" with Send disabled when someone already sent it', async () => {
    m.fetchOrder.mockResolvedValue({ order: makeOrder({ status: 'reviewed' }), technicianPhone: '60120000011' })
    vi.mocked(messagesApi.fetchLatestCustomerMessage).mockResolvedValue(
      makeCustomerMessage({
        status: 'sent',
        confirmed_by: 't-ali',
        confirmed_by_name: 'Ali',
        confirmed_at: '2026-10-22T07:20:00Z',
      }),
    )
    await renderDetail()
    const panel = within(await screen.findByRole('region', { name: 'Customer message' }))
    expect(panel.getByText('Sent by Ali at Thu 22 Oct 2026, 3:20 PM')).toBeTruthy()
    expect((panel.getByRole('button', { name: 'Send to customer on WhatsApp' }) as HTMLButtonElement).disabled).toBe(true)
    expect(panel.queryByText('Customer not told yet')).toBeNull()
  })

  it('reloads the history after the Admin confirms it was sent', async () => {
    const user = userEvent.setup()
    m.fetchOrder.mockResolvedValue({ order: makeOrder({ status: 'job_done' }), technicianPhone: '60120000011' })
    vi.mocked(messagesApi.fetchLatestCustomerMessage).mockResolvedValue(makeCustomerMessage())
    vi.mocked(messagesApi.confirmCustomerMessage).mockResolvedValue()
    await renderDetail()
    const panel = within(await screen.findByRole('region', { name: 'Customer message' }))
    const historyCalls = m.fetchOrderHistory.mock.calls.length
    await user.click(panel.getByRole('link', { name: /Send to customer on WhatsApp/ }))
    await user.click(await screen.findByRole('button', { name: 'Yes, I sent it' }))
    await waitFor(() => expect(m.fetchOrderHistory.mock.calls.length).toBeGreaterThan(historyCalls))
  })

  it('shows nothing before the job is done', async () => {
    m.fetchOrder.mockResolvedValue({ order: makeOrder({ status: 'in_progress' }), technicianPhone: '60120000011' })
    await renderDetail()
    expect(screen.queryByRole('region', { name: 'Customer message' })).toBeNull()
    expect(messagesApi.fetchLatestCustomerMessage).not.toHaveBeenCalled()
  })

  it('names the three customer message events in the history, with what changed', async () => {
    m.fetchOrder.mockResolvedValue({ order: makeOrder({ status: 'job_done' }), technicianPhone: '60120000011' })
    const entry = (id: number, action: string, details: Record<string, unknown>) => ({
      id,
      action,
      actor_role: 'technician' as const,
      actor_name: 'Ali',
      from_status: null,
      to_status: null,
      note: null,
      details,
      created_at: '2026-10-22T07:20:00Z',
    })
    m.fetchOrderHistory.mockResolvedValue([
      entry(3, 'customer_called', { message_id: 'm-2', channel: 'phone', phone: '60312345678', status: 'job_done' }),
      entry(2, 'customer_messaged', {
        message_id: 'm-1',
        channel: 'whatsapp',
        phone: '60123456789',
        body: 'Hello again',
        edited: true,
        status: 'job_done',
      }),
      entry(1, 'customer_message_edited', {
        message_id: 'm-1',
        previous_body: 'Hello',
        new_body: 'Hello again',
        status: 'job_done',
      }),
    ])
    await renderDetail()
    const historyList = within(screen.getByRole('region', { name: 'History' }))
    expect(historyList.getByText('Edited the customer message')).toBeTruthy()
    expect(historyList.getByText('From: Hello')).toBeTruthy()
    expect(historyList.getByText('To: Hello again')).toBeTruthy()
    expect(historyList.getByText('Sent the customer message on WhatsApp')).toBeTruthy()
    expect(historyList.getByText('To +60 12-345 6789 (text was edited)')).toBeTruthy()
    expect(historyList.getByText('Message: Hello again')).toBeTruthy()
    expect(historyList.getByText('Told the customer by phone')).toBeTruthy()
    expect(historyList.getByText('Called +60 3-1234 5678')).toBeTruthy()
  })
})
