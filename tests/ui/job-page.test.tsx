// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as filesApi from '../../src/features/attachments/api'
import * as messagesApi from '../../src/features/customer-messages/api'
import * as api from '../../src/features/jobs/api'
import { JobPage } from '../../src/features/jobs/JobPage'
import { CUSTOMER_MESSAGE_TEXT, makeCustomerMessage, makeOrder } from './fixtures'

vi.mock('../../src/features/jobs/api', async (importOriginal) => {
  const actual = await importOriginal<typeof api>()
  return { ...actual, fetchJob: vi.fn(), acceptJob: vi.fn(), startJob: vi.fn(), rescheduleJob: vi.fn() }
})

vi.mock('../../src/features/attachments/api', async (importOriginal) => {
  const actual = await importOriginal<typeof filesApi>()
  return { ...actual, fetchJobFiles: vi.fn(), signedUrls: vi.fn() }
})

vi.mock('../../src/features/customer-messages/api', async (importOriginal) => {
  const actual = await importOriginal<typeof messagesApi>()
  return { ...actual, fetchLatestCustomerMessage: vi.fn(), confirmCustomerMessage: vi.fn(), editCustomerMessage: vi.fn() }
})

const m = vi.mocked(api)

function detail(overrides: Partial<api.JobDetail> = {}, order: Parameters<typeof makeOrder>[0] = {}): api.JobDetail {
  return { job: makeOrder(order), completion: null, payments: [], rework: null, ...overrides }
}

function renderJob(orderNo = 'ORDER1001') {
  render(
    <MemoryRouter initialEntries={[`/jobs/${orderNo}`]}>
      <Routes>
        <Route path="/jobs/:orderNo" element={<JobPage />} />
        <Route path="/jobs" element={<p>Job list</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

const actionBar = () => screen.queryByRole('button', { name: 'Reschedule' })?.parentElement ?? null

beforeEach(() => {
  vi.resetAllMocks()
  m.fetchJob.mockResolvedValue(detail())
  m.acceptJob.mockResolvedValue()
  m.startJob.mockResolvedValue()
  m.rescheduleJob.mockResolvedValue()
  vi.mocked(filesApi.fetchJobFiles).mockResolvedValue([])
  vi.mocked(filesApi.signedUrls).mockResolvedValue({})
  vi.mocked(messagesApi.fetchLatestCustomerMessage).mockResolvedValue(null)
})

describe('Job details and contact (AC3)', () => {
  it('shows the job, the customer and the money', async () => {
    m.fetchJob.mockResolvedValue(
      detail(
        {},
        {
          order_no: 'ORDER1234',
          customer_name: 'Ahmad',
          customer_address: 'No. 12, Jalan Sejuk, Shah Alam',
          service_type_name: 'Aircond cleaning',
          quoted_price: 180,
          final_amount: 180,
          balance: 180,
        },
      ),
    )
    renderJob('ORDER1234')
    expect(await screen.findByRole('heading', { name: /ORDER1234/ })).toBeTruthy()
    expect(m.fetchJob).toHaveBeenCalledWith('ORDER1234')
    const customer = within(screen.getByRole('region', { name: 'Customer' }))
    expect(customer.getByText('Ahmad')).toBeTruthy()
    expect(customer.getByText('+60 12-345 6789')).toBeTruthy()
    const details = within(screen.getByRole('region', { name: 'Job details' }))
    expect(details.getByText('Water dripping from indoor unit')).toBeTruthy()
    expect(details.getByText('Gate code 1234')).toBeTruthy()
    const money = within(screen.getByRole('region', { name: 'Money' }))
    expect(money.getByText('To collect')).toBeTruthy()
    expect(money.getAllByText('RM 180.00').length).toBeGreaterThan(0)
  })

  it('offers call, WhatsApp and maps links', async () => {
    renderJob()
    const customer = within(await screen.findByRole('region', { name: 'Customer' }))
    expect(customer.getByRole('link', { name: 'Call' }).getAttribute('href')).toBe('tel:+60123456789')
    const wa = customer.getByRole('link', { name: 'WhatsApp' }).getAttribute('href') ?? ''
    expect(wa.startsWith('https://wa.me/60123456789?text=')).toBe(true)
    expect(decodeURIComponent(wa.split('text=')[1])).toBe(
      'Hi Puan Lim, this is Ali from Sejuk Sejuk Service about your aircond job ORDER1001.',
    )
    expect(customer.getByRole('link', { name: 'Open in Maps' }).getAttribute('href')).toBe(
      'https://www.google.com/maps/search/?api=1&query=8%20Jalan%20Kenanga%2C%20Shah%20Alam',
    )
  })

  it('lists recorded payments', async () => {
    m.fetchJob.mockResolvedValue(
      detail(
        {
          payments: [
            {
              id: 'p1',
              amount: 100,
              method: 'ewallet',
              note: 'Deposit',
              recorded_at: '2026-10-26T03:00:00Z',
              recorded_by_name: 'Ali',
              receipt: null,
            },
          ],
        },
        { status: 'in_progress', amount_paid: 100, balance: 80, payment_status: 'partial' },
      ),
    )
    renderJob()
    const payments = within(await screen.findByRole('list', { name: 'Payments' }))
    expect(payments.getByText(/RM 100\.00 · E-wallet · Mon 26 Oct 2026, 11:00 AM · Ali/)).toBeTruthy()
    expect(payments.getByText('Deposit')).toBeTruthy()
  })

  it('says when the job is not (or no longer) the technician’s', async () => {
    m.fetchJob.mockResolvedValue(null)
    renderJob('ORDER9999')
    expect(await screen.findByText('Job not found')).toBeTruthy()
    expect(screen.getByText(/ORDER9999 is not in your jobs/)).toBeTruthy()
  })
})

describe('Accept and start (AC4)', () => {
  it('accepts an Assigned job with one tap', async () => {
    const user = userEvent.setup()
    renderJob()
    await user.click(await screen.findByRole('button', { name: 'Accept job' }))
    expect(m.acceptJob).toHaveBeenCalledWith('o-1')
    expect(await screen.findByText('Job accepted.')).toBeTruthy()
    expect(m.fetchJob).toHaveBeenCalledTimes(2)
  })

  it('asks before starting, and does nothing on "Not yet"', async () => {
    const user = userEvent.setup()
    renderJob()
    await user.click(await screen.findByRole('button', { name: 'Start job' }))
    const dialog = within(screen.getByRole('dialog', { name: 'Start ORDER1001 now?' }))
    await user.click(dialog.getByRole('button', { name: 'Not yet' }))
    expect(m.startJob).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Start job' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Start job' }))
    expect(m.startJob).toHaveBeenCalledWith('o-1')
    expect(await screen.findByText('Job started.')).toBeTruthy()
  })

  it('shows the database message when an action fails', async () => {
    m.acceptJob.mockRejectedValue(new api.ApiError('Only the assigned technician can acknowledge a job'))
    const user = userEvent.setup()
    renderJob()
    await user.click(await screen.findByRole('button', { name: 'Accept job' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Only the assigned technician can acknowledge a job')
  })

  it.each([
    ['assigned', ['Accept job', 'Start job', 'Reschedule']],
    ['acknowledged', ['Start job', 'Reschedule']],
    ['in_progress', ['Reschedule']],
  ] as const)('offers the right actions while %s', async (status, buttons) => {
    m.fetchJob.mockResolvedValue(detail({}, { status }))
    renderJob()
    await screen.findByRole('heading', { name: /ORDER1001/ })
    const bar = within(actionBar()!)
    expect(bar.getAllByRole('button').map((b) => b.textContent)).toEqual(buttons)
  })

  it.each(['job_done', 'reviewed', 'closed', 'cancelled'] as const)('offers no actions while %s', async (status) => {
    m.fetchJob.mockResolvedValue(detail({}, { status }))
    renderJob()
    await screen.findByRole('heading', { name: /ORDER1001/ })
    for (const name of ['Accept job', 'Start job', 'Reschedule']) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }
  })
})

describe('Reschedule (AC11)', () => {
  it('saves a postponement with a reason through reschedule_order', async () => {
    const user = userEvent.setup()
    renderJob()
    await user.click(await screen.findByRole('button', { name: 'Reschedule' }))
    const dialog = within(screen.getByRole('dialog', { name: 'Reschedule ORDER1001' }))
    await user.click(dialog.getByLabelText('Postpone, no new date yet'))
    await user.selectOptions(dialog.getByLabelText('Reason'), 'customer_not_home')
    await user.selectOptions(dialog.getByLabelText('Requested by'), 'technician')
    await user.click(dialog.getByRole('button', { name: 'Save new date' }))
    expect(m.rescheduleJob).toHaveBeenCalledWith('o-1', null, 'customer_not_home', 'technician', null)
    expect(await screen.findByText('New date saved.')).toBeTruthy()
  })
})

describe('Rework, submitted and cancelled jobs (AC9)', () => {
  const completion: api.Completion = {
    work_done: 'Cleaned filters',
    extra_charges: 40,
    remarks: 'New filter',
    completed_at: '2026-10-26T05:00:00Z',
    technician_name: 'Ali',
  }

  it('shows the manager’s note and the previous record on a returned job', async () => {
    m.fetchJob.mockResolvedValue(
      detail(
        { completion, rework: { note: 'Photo of the outdoor unit missing', by: 'Nurul Huda', at: '2026-10-26T07:00:00Z' } },
        { status: 'in_progress' },
      ),
    )
    renderJob()
    const banner = within(await screen.findByRole('note', { name: 'Returned for rework' }))
    expect(banner.getByText('Photo of the outdoor unit missing')).toBeTruthy()
    expect(banner.getByText('Nurul Huda, Mon 26 Oct 2026, 3:00 PM')).toBeTruthy()
    const record = within(screen.getByRole('region', { name: 'Previous completion record' }))
    expect(record.getByText('Cleaned filters')).toBeTruthy()
  })

  it('shows the submitted record without a rework banner once submitted', async () => {
    m.fetchJob.mockResolvedValue(
      detail({ completion, rework: { note: 'Old note', by: 'Nurul Huda', at: '2026-10-25T07:00:00Z' } }, { status: 'job_done' }),
    )
    renderJob()
    const record = within(await screen.findByRole('region', { name: 'Completion record' }))
    expect(record.getByText('New filter')).toBeTruthy()
    expect(record.getByText('Ali, Mon 26 Oct 2026, 1:00 PM')).toBeTruthy()
    expect(screen.queryByRole('note', { name: 'Returned for rework' })).toBeNull()
  })

  it('marks a cancelled job and hides the contact links', async () => {
    m.fetchJob.mockResolvedValue(detail({}, { status: 'cancelled', balance: 180 }))
    renderJob()
    expect(await screen.findByText('This job was cancelled. Nothing more to do.')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Call' })).toBeNull()
    await waitFor(() => expect(screen.queryByText('To collect')).toBeNull())
  })
})

describe('Photos and files on the job page', () => {
  it.each([
    ['assigned', false, false],
    ['in_progress', true, true],
    ['job_done', true, false],
  ] as const)('while %s: shown %s, can add %s', async (status, shown, canAdd) => {
    m.fetchJob.mockResolvedValue(detail({}, { status }))
    renderJob()
    await screen.findByRole('heading', { name: /ORDER1001/ })
    const section = screen.queryByRole('region', { name: 'Photos and files' })
    expect(Boolean(section)).toBe(shown)
    if (section) {
      await within(section).findByText('No files yet.')
      expect(Boolean(within(section).queryByRole('button', { name: 'Add photos, videos or PDFs' }))).toBe(canAdd)
    }
  })
})

describe('Complete and pay from the job page', () => {
  function renderAt(url: string) {
    render(
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/jobs/:orderNo" element={<JobPage />} />
        </Routes>
      </MemoryRouter>,
    )
  }

  it('links to the completion and payment forms while In Progress', async () => {
    m.fetchJob.mockResolvedValue(detail({}, { status: 'in_progress' }))
    renderJob()
    expect((await screen.findByRole('link', { name: 'Complete job' })).getAttribute('href')).toBe('/jobs/ORDER1001/complete')
    expect(screen.getByRole('link', { name: 'Record payment' }).getAttribute('href')).toBe('/jobs/ORDER1001/payment')
  })

  it('calls it "Fix and resubmit" on a returned job', async () => {
    m.fetchJob.mockResolvedValue(
      detail(
        {
          completion: { work_done: 'x', extra_charges: 0, remarks: null, completed_at: '2026-10-26T05:00:00Z', technician_name: 'Ali' },
          rework: { note: 'Redo', by: 'Nurul Huda', at: '2026-10-26T07:00:00Z' },
        },
        { status: 'in_progress' },
      ),
    )
    renderJob()
    expect(await screen.findByRole('link', { name: 'Fix and resubmit' })).toBeTruthy()
  })

  it('offers only Record payment once the job is submitted', async () => {
    m.fetchJob.mockResolvedValue(detail({}, { status: 'job_done' }))
    renderJob()
    expect(await screen.findByRole('link', { name: 'Record payment' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Complete job' })).toBeNull()
  })

  it('confirms a submission and offers to record the payment', async () => {
    m.fetchJob.mockResolvedValue(detail({}, { status: 'job_done', balance: 180 }))
    renderAt('/jobs/ORDER1001?submitted=1')
    const status = await screen.findByText(/Job submitted\. Your manager has been told/)
    expect(within(status).getByRole('link', { name: 'Record the payment (RM 180.00)' }).getAttribute('href')).toBe(
      '/jobs/ORDER1001/payment',
    )
  })

  it('confirms a recorded payment and links its receipt', async () => {
    vi.mocked(filesApi.signedUrls).mockResolvedValue({ 'o-1/receipts/r.jpg': 'https://signed/r.jpg' })
    m.fetchJob.mockResolvedValue(
      detail(
        {
          payments: [
            {
              id: 'p1',
              amount: 180,
              method: 'bank_transfer',
              note: null,
              recorded_at: '2026-10-26T03:00:00Z',
              recorded_by_name: 'Ali',
              receipt: { id: 'a1', kind: 'photo', storage_path: 'o-1/receipts/r.jpg', file_name: 'slip.jpg' },
            },
          ],
        },
        { status: 'job_done', amount_paid: 180, balance: 0, payment_status: 'paid' },
      ),
    )
    renderAt('/jobs/ORDER1001?paid=1')
    expect(await screen.findByText('Payment recorded. Finance has been told.')).toBeTruthy()
    const payments = within(screen.getByRole('list', { name: 'Payments' }))
    expect((await payments.findByRole('link', { name: 'Receipt' })).getAttribute('href')).toBe('https://signed/r.jpg')
  })
})

describe('Customer message (0003)', () => {
  it('shows the message, the badge and Send above the customer once the job is done', async () => {
    vi.mocked(messagesApi.fetchLatestCustomerMessage).mockResolvedValue(makeCustomerMessage())
    m.fetchJob.mockResolvedValue(detail({}, { status: 'job_done' }))
    renderJob()
    const panel = within(await screen.findByRole('region', { name: 'Customer message' }))
    expect(panel.getByText(CUSTOMER_MESSAGE_TEXT)).toBeTruthy()
    expect(panel.getByText('Customer not told yet')).toBeTruthy()
    expect(panel.getByRole('link', { name: /Send to customer on WhatsApp/ })).toBeTruthy()
    expect(panel.getByRole('button', { name: 'Edit message' })).toBeTruthy()
    expect(messagesApi.fetchLatestCustomerMessage).toHaveBeenCalledWith('o-1')
  })

  it('shows no message while the job is being reworked, even though an older one exists', async () => {
    vi.mocked(messagesApi.fetchLatestCustomerMessage).mockResolvedValue(makeCustomerMessage())
    m.fetchJob.mockResolvedValue(detail({}, { status: 'in_progress' }))
    renderJob()
    await screen.findByRole('heading', { name: /ORDER1001/ })
    expect(screen.queryByRole('region', { name: 'Customer message' })).toBeNull()
    expect(messagesApi.fetchLatestCustomerMessage).not.toHaveBeenCalled()
  })

  it('confirms from the job page and shows who sent it', async () => {
    const user = userEvent.setup()
    let latest = makeCustomerMessage()
    vi.mocked(messagesApi.fetchLatestCustomerMessage).mockImplementation(async () => latest)
    vi.mocked(messagesApi.confirmCustomerMessage).mockImplementation(async () => {
      latest = makeCustomerMessage({
        status: 'sent',
        confirmed_by: 't-ali',
        confirmed_by_name: 'Ali',
        confirmed_at: '2026-10-22T07:20:00Z',
      })
    })
    m.fetchJob.mockResolvedValue(detail({}, { status: 'job_done' }))
    renderJob()
    const panel = within(await screen.findByRole('region', { name: 'Customer message' }))
    await user.click(panel.getByRole('link', { name: /Send to customer on WhatsApp/ }))
    await user.click(await screen.findByRole('button', { name: 'Yes, I sent it' }))
    expect(await panel.findByText('Sent by Ali at Thu 22 Oct 2026, 3:20 PM')).toBeTruthy()
    expect(panel.queryByText('Customer not told yet')).toBeNull()
  })
})
