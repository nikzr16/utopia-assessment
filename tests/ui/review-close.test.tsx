// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as filesApi from '../../src/features/attachments/api'
import type { PhotoCodec } from '../../src/features/attachments/resize'
import * as messagesApi from '../../src/features/customer-messages/api'
import { FinancePaymentPage } from '../../src/features/finance/FinancePaymentPage'
import { FinanceQueuePage } from '../../src/features/finance/FinanceQueuePage'
import * as notificationsApi from '../../src/features/notifications/api'
import { NotificationsPage, NotificationsProvider } from '../../src/features/notifications'
import { OrderReviewPage, ReviewOutcome } from '../../src/features/order-review'
import * as api from '../../src/features/order-review/api'
import type { OrderReview } from '../../src/features/order-review/api'
import * as ordersApi from '../../src/features/orders/api'
import * as supervisorApi from '../../src/features/supervisor/api'
import type { OrderWarning } from '../../src/features/supervisor/api'
import { OrderHistory } from '../../src/features/orders/OrderHistory'
import { ReviewQueuePage } from '../../src/features/review/ReviewQueuePage'
import type { Payment } from '../../src/lib/orderRecords'
import { makeCustomerMessage, makeOrder } from './fixtures'

vi.mock('../../src/features/order-review/api', async (importOriginal) => {
  const actual = await importOriginal<typeof api>()
  return {
    ...actual,
    fetchOrderReview: vi.fn(),
    fetchOrderHistory: vi.fn(),
    fetchReviewFacts: vi.fn(),
    fetchManagerOrders: vi.fn(),
    fetchFinanceOrders: vi.fn(),
    fetchCoveredBranches: vi.fn(),
    fetchBranches: vi.fn(),
    approveOrder: vi.fn(),
    returnForRework: vi.fn(),
    closeOrder: vi.fn(),
    verifyPayment: vi.fn(),
    unverifyPayment: vi.fn(),
    recordPayment: vi.fn(),
  }
})
// 0009: the order page's Warnings box and the queue's warning counts.
vi.mock('../../src/features/supervisor/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/features/supervisor/api')>()),
  fetchOrderWarnings: vi.fn(async () => ({ warnings: [], run: null })),
  fetchOpenWarningCounts: vi.fn(async () => ({})),
  subscribeToWarnings: vi.fn(() => () => {}),
  checkWarning: vi.fn(),
  recheckOrder: vi.fn(),
}))
vi.mock('../../src/features/orders/api', async (importOriginal) => {
  const actual = await importOriginal<typeof ordersApi>()
  return { ...actual, fetchOrderRecords: vi.fn() }
})
vi.mock('../../src/features/attachments/api', async (importOriginal) => {
  const actual = await importOriginal<typeof filesApi>()
  return { ...actual, fetchJobFiles: vi.fn(), signedUrls: vi.fn(), uploadFile: vi.fn(), deleteStoredFile: vi.fn() }
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
vi.mock('../../src/features/notifications/api', async (importOriginal) => {
  const actual = await importOriginal<typeof notificationsApi>()
  return {
    ...actual,
    fetchNotifications: vi.fn(),
    fetchUnreadCount: vi.fn(),
    subscribeToNotifications: vi.fn(),
    markNotificationRead: vi.fn(),
  }
})

const m = vi.mocked(api)
const messages = vi.mocked(messagesApi)
const sup = vi.mocked(supervisorApi)

function makeReview(overrides: Partial<OrderReview> = {}): OrderReview {
  return {
    ...makeOrder({ status: 'job_done', final_amount: 180, balance: 180 }),
    completed_at: '2026-10-22T07:15:00Z',
    completion_technician_name: 'Ali',
    return_count: 0,
    last_returned_at: null,
    last_return_note: null,
    latest_message_id: 'm-1',
    latest_message_channel: 'whatsapp',
    latest_message_status: 'not_sent',
    payment_count: 0,
    unverified_count: 0,
    reviewed_at: null,
    reviewed_by_name: null,
    review_note: null,
    closed_at: null,
    closed_by_name: null,
    latest_rating: null,
    latest_working_well: null,
    ...overrides,
  }
}

function payment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: 'p-1',
    amount: 180,
    method: 'bank_transfer',
    note: null,
    recorded_at: '2026-10-22T07:30:00Z',
    recorded_by_name: 'Ali',
    receipt: null,
    verified_at: null,
    verified_by_name: null,
    ...overrides,
  }
}

function Where() {
  const l = useLocation()
  return <p data-testid="where">{l.pathname + l.search}</p>
}

function renderPage(role: 'manager' | 'finance', url?: string) {
  const base = role === 'manager' ? '/review' : '/finance'
  render(
    <MemoryRouter initialEntries={[url ?? `${base}/ORDER1001`]}>
      <Routes>
        <Route path={`${base}/:orderNo`} element={<OrderReviewPage role={role} basePath={base} staffName="Nurul Huda" />} />
        <Route path={`${base}/:orderNo/payment`} element={<Where />} />
        <Route path={base} element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
  return screen.findByRole('heading', { level: 2, name: /^ORDER1001/ })
}

beforeEach(() => {
  vi.resetAllMocks()
  window.localStorage.clear()
  m.fetchOrderReview.mockResolvedValue(makeReview())
  m.fetchOrderHistory.mockResolvedValue([])
  m.fetchCoveredBranches.mockResolvedValue([{ id: 'b-sa', name: 'Shah Alam' }])
  m.fetchBranches.mockResolvedValue([
    { id: 'b-kl', name: 'Kuala Lumpur' },
    { id: 'b-sa', name: 'Shah Alam' },
  ])
  m.fetchManagerOrders.mockResolvedValue([])
  m.fetchFinanceOrders.mockResolvedValue([])
  m.approveOrder.mockResolvedValue()
  m.returnForRework.mockResolvedValue()
  m.closeOrder.mockResolvedValue()
  m.verifyPayment.mockResolvedValue()
  m.unverifyPayment.mockResolvedValue()
  m.recordPayment.mockResolvedValue()
  vi.mocked(ordersApi.fetchOrderRecords).mockResolvedValue({ completion: null, payments: [], rework: null })
  vi.mocked(filesApi.fetchJobFiles).mockResolvedValue([])
  vi.mocked(filesApi.signedUrls).mockResolvedValue({})
  messages.fetchLatestCustomerMessage.mockResolvedValue(makeCustomerMessage())
  messages.confirmCustomerMessage.mockResolvedValue()
})

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------
describe('Manager review queue (AC5)', () => {
  it('shows To review with flags, switches tabs, and filters by covered branch', async () => {
    m.fetchCoveredBranches.mockResolvedValue([
      { id: 'b-sa', name: 'Shah Alam' },
      { id: 'b-pg', name: 'Penang' },
    ])
    m.fetchManagerOrders.mockResolvedValue([makeReview({ return_count: 3 })])
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/review']}>
        <Routes>
          <Route path="/review" element={<ReviewQueuePage />} />
        </Routes>
      </MemoryRouter>,
    )
    const table = await screen.findByRole('table', { name: 'To review' })
    expect(within(table).getByRole('link', { name: 'ORDER1001' }).getAttribute('href')).toBe('/review/ORDER1001')
    expect(within(table).getByText('Needs attention')).toBeTruthy()
    expect(within(table).getByText('Returned 3×')).toBeTruthy()
    expect(within(table).getByText('Not told yet')).toBeTruthy()
    expect(m.fetchManagerOrders).toHaveBeenCalledWith('to_review', null)

    await user.click(within(screen.getByRole('navigation', { name: 'Review queue' })).getByRole('link', { name: 'Returned' }))
    await waitFor(() => expect(m.fetchManagerOrders).toHaveBeenCalledWith('returned', null))

    await user.selectOptions(screen.getByLabelText('Branch'), 'Penang')
    await waitFor(() => expect(m.fetchManagerOrders).toHaveBeenCalledWith('returned', 'b-pg'))
  })

  it('shows the latest customer rating in the Reviewed tab, poor ones marked (0005)', async () => {
    m.fetchManagerOrders.mockResolvedValue([
      makeReview({ status: 'reviewed', reviewed_at: '2026-10-22T08:00:00Z', latest_rating: 2, latest_working_well: false }),
      makeReview({ id: 'o-2', order_no: 'ORDER1002', status: 'reviewed', reviewed_at: '2026-10-22T08:00:00Z' }),
    ])
    render(
      <MemoryRouter initialEntries={['/review?tab=reviewed']}>
        <Routes>
          <Route path="/review" element={<ReviewQueuePage />} />
        </Routes>
      </MemoryRouter>,
    )
    const table = await screen.findByRole('table', { name: 'Reviewed' })
    expect(within(table).getByRole('columnheader', { name: 'Customer rating' })).toBeTruthy()
    const [first, second] = within(table).getAllByRole('row').slice(1)
    expect(within(first).getByRole('img', { name: '2 out of 5 stars' })).toBeTruthy()
    expect(first.textContent).toContain('Not working')
    expect(within(second).queryByRole('img')).toBeNull()
  })

  it('hides the branch filter for a Manager of one branch', async () => {
    render(
      <MemoryRouter initialEntries={['/review']}>
        <Routes>
          <Route path="/review" element={<ReviewQueuePage />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByText('No jobs waiting for review.')).toBeTruthy()
    expect(screen.queryByLabelText('Branch')).toBeNull()
  })
})

describe('Manager review page (AC6–AC9)', () => {
  it('blocks Approve until the customer is told, and offers the on-behalf message without Edit', async () => {
    await renderPage('manager')
    const approve = screen.getByRole('button', { name: 'Approve job' }) as HTMLButtonElement
    expect(approve.disabled).toBe(true)
    expect(screen.getByText(/Tell the customer the job is done before approving/)).toBeTruthy()

    const panel = await screen.findByRole('region', { name: 'Customer message' })
    const expected =
      'Hi Puan Lim, this is Nurul Huda, Manager at Sejuk Sejuk Service Shah Alam, on behalf of Technician Ali. ' +
      'Job ORDER1001 was completed at Thu 22 Oct 2026, 3:15 PM. Please check and leave feedback. Thank you!'
    expect(within(panel).getByText(expected)).toBeTruthy()
    expect(within(panel).getByText('Sent in your name, on behalf of the technician.')).toBeTruthy()
    const send = within(panel).getByRole('link', { name: /Send to customer on WhatsApp/ }) as HTMLAnchorElement
    expect(new URL(send.href).searchParams.get('text')).toBe(expected)
    expect(within(panel).queryByRole('button', { name: 'Edit message' })).toBeNull()
  })

  it('approves with an optional note once the customer was told', async () => {
    m.fetchOrderReview.mockResolvedValue(makeReview({ latest_message_status: 'sent' }))
    messages.fetchLatestCustomerMessage.mockResolvedValue(
      makeCustomerMessage({ status: 'sent', confirmed_by_name: 'Ali', confirmed_at: '2026-10-22T07:20:00Z' }),
    )
    const user = userEvent.setup()
    await renderPage('manager')
    await user.click(screen.getByRole('button', { name: 'Approve job' }))
    const dialog = screen.getByRole('dialog', { name: 'Approve ORDER1001' })
    await user.click(within(dialog).getByRole('button', { name: 'Approve job' }))
    expect(m.approveOrder).toHaveBeenCalledWith('o-1', null)
    expect((await screen.findByText('Approved. Finance and the technician have been told.')).textContent).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Approve job' }))
    await user.type(screen.getByLabelText(/Note for Finance/), 'Receipt by email please')
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve job' }))
    expect(m.approveOrder).toHaveBeenLastCalledWith('o-1', 'Receipt by email please')
  })

  it('needs a note to return a job for rework', async () => {
    const user = userEvent.setup()
    await renderPage('manager')
    await user.click(screen.getByRole('button', { name: 'Return for rework' }))
    const dialog = screen.getByRole('dialog', { name: 'Return ORDER1001 for rework' })
    await user.click(within(dialog).getByRole('button', { name: 'Return for rework' }))
    expect(within(dialog).getByText('A review note is required to return a job for rework')).toBeTruthy()
    expect(m.returnForRework).not.toHaveBeenCalled()
    await user.type(within(dialog).getByLabelText('What needs fixing'), 'Drain still leaking')
    await user.click(within(dialog).getByRole('button', { name: 'Return for rework' }))
    expect(m.returnForRework).toHaveBeenCalledWith('o-1', 'Drain still leaking')
  })

  it('shows the return count and every earlier note, flagged after 3', async () => {
    m.fetchOrderReview.mockResolvedValue(makeReview({ return_count: 3 }))
    m.fetchOrderHistory.mockResolvedValue(
      ['Gas low', 'Still leaking', 'Noise'].map((note, i) => ({
        id: 10 + i,
        action: 'returned_for_rework',
        actor_role: 'manager' as const,
        actor_name: 'Nurul Huda',
        from_status: 'job_done' as const,
        to_status: 'in_progress' as const,
        note,
        details: {},
        created_at: '2026-10-22T08:00:00Z',
      })),
    )
    await renderPage('manager')
    const returns = screen.getByRole('region', { name: 'Returned 3 times' })
    for (const note of ['Gas low', 'Still leaking', 'Noise']) expect(within(returns).getByText(note)).toBeTruthy()
    expect(within(returns).getByText(/Needs attention/)).toBeTruthy()
  })

  it('says so when the order is not in the branches the Manager covers', async () => {
    m.fetchOrderReview.mockResolvedValue(null)
    render(
      <MemoryRouter initialEntries={['/review/ORDER9999']}>
        <Routes>
          <Route path="/review/:orderNo" element={<OrderReviewPage role="manager" basePath="/review" staffName="Nurul" />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByText('There is no order ORDER9999 in the branches you cover.')).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// 0009 Workflow Supervisor
// ---------------------------------------------------------------------------
function warning(overrides: Partial<OrderWarning> = {}): OrderWarning {
  return {
    id: 'w-1',
    order_id: 'o-1',
    seq: 1,
    rule: 'over_quote',
    source: 'rule',
    message: 'Final amount RM 980.00 is 180% above the quoted RM 350.00.',
    status: 'open',
    opened_at: '2026-10-22T07:15:00Z',
    checked_by: null,
    checked_by_name: null,
    checked_at: null,
    check_note: null,
    ...overrides,
  }
}
const AI_WARNING = warning({
  id: 'w-2',
  seq: 2,
  rule: 'ai_text',
  source: 'ai',
  message: 'Work done describes a compressor replacement, but the service is Cleaning with no extra charge.',
})

describe('Supervisor warnings (0009)', () => {
  beforeEach(() => {
    m.fetchOrderReview.mockResolvedValue(makeReview({ latest_message_status: 'sent' }))
    messages.fetchLatestCustomerMessage.mockResolvedValue(
      makeCustomerMessage({ status: 'sent', confirmed_by_name: 'Ali', confirmed_at: '2026-10-22T07:20:00Z' }),
    )
  })

  it('holds Approve until each warning is checked with a note, then lets the Manager approve', async () => {
    let checked = false
    sup.fetchOrderWarnings.mockImplementation(async () => ({
      warnings: [
        checked
          ? warning({
              status: 'checked',
              checked_by: 's-nurul',
              checked_by_name: 'Nurul Huda',
              checked_at: '2026-10-22T08:00:00Z',
              check_note: 'Customer agreed to the new part',
            })
          : warning(),
      ],
      run: { id: 'r-1', status: 'done', trigger: 'job_done', created_at: '2026-10-22T07:15:00Z', finished_at: '2026-10-22T07:15:05Z' },
    }))
    sup.checkWarning.mockImplementation(async () => {
      checked = true
    })
    const user = userEvent.setup()
    await renderPage('manager')
    const box = await screen.findByRole('region', { name: /Warnings/ })
    expect(within(box).getByText('Final amount RM 980.00 is 180% above the quoted RM 350.00.')).toBeTruthy()
    expect(within(box).getByText('1 to check')).toBeTruthy()
    await waitFor(() => expect((screen.getByRole('button', { name: 'Approve job' }) as HTMLButtonElement).disabled).toBe(true))
    expect(screen.getByText(/Check every warning before approving \(1 open\)/)).toBeTruthy()

    await user.click(within(box).getByRole('button', { name: 'Mark as checked' }))
    await user.type(within(box).getByLabelText('What did you check?'), 'ok')
    await user.click(within(box).getByRole('button', { name: 'Save check' }))
    expect(within(box).getByText('Write a short note (at least 3 characters)')).toBeTruthy()
    expect(sup.checkWarning).not.toHaveBeenCalled()
    await user.type(within(box).getByLabelText('What did you check?'), ' - customer agreed to the new part')
    await user.click(within(box).getByRole('button', { name: 'Save check' }))
    expect(sup.checkWarning).toHaveBeenCalledWith('w-1', 'ok - customer agreed to the new part')
    expect(await within(box).findByText(/Checked by Nurul Huda/)).toBeTruthy()
    await waitFor(() => expect((screen.getByRole('button', { name: 'Approve job' }) as HTMLButtonElement).disabled).toBe(false))
  })

  it('labels AI warnings, says when the AI check did not run, and re-checks', async () => {
    sup.fetchOrderWarnings.mockResolvedValue({
      warnings: [AI_WARNING],
      run: { id: 'r-1', status: 'failed', trigger: 'job_done', created_at: '2026-10-22T07:15:00Z', finished_at: null },
    })
    sup.recheckOrder.mockResolvedValue()
    const user = userEvent.setup()
    await renderPage('manager')
    const box = await screen.findByRole('region', { name: /Warnings/ })
    expect(within(box).getByText('AI')).toBeTruthy()
    expect(within(box).getByText("AI check didn't run. Press Re-check to try again.")).toBeTruthy()
    await user.click(within(box).getByRole('button', { name: 'Re-check with AI' }))
    expect(sup.recheckOrder).toHaveBeenCalledWith('o-1')
  })

  it('says the AI check is running and disables Re-check meanwhile', async () => {
    sup.fetchOrderWarnings.mockResolvedValue({
      warnings: [],
      run: { id: 'r-2', status: 'running', trigger: 'recheck', created_at: '2026-10-22T07:16:00Z', finished_at: null },
    })
    await renderPage('manager')
    const box = await screen.findByRole('region', { name: /Warnings/ })
    expect(await within(box).findByText('AI check running…')).toBeTruthy()
    expect((within(box).getByRole('button', { name: 'Re-check with AI' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows Finance the warnings and who checked them, without buttons', async () => {
    m.fetchOrderReview.mockResolvedValue(makeReview({ status: 'reviewed', reviewed_at: '2026-10-22T09:00:00Z' }))
    sup.fetchOrderWarnings.mockResolvedValue({
      warnings: [
        warning({
          status: 'checked',
          checked_by: 's-nurul',
          checked_by_name: 'Nurul Huda',
          checked_at: '2026-10-22T08:00:00Z',
          check_note: 'Agreed by phone',
        }),
      ],
      run: null,
    })
    await renderPage('finance')
    const box = await screen.findByRole('region', { name: /Warnings/ })
    expect(await within(box).findByText(/Agreed by phone/)).toBeTruthy()
    expect(within(box).queryByRole('button')).toBeNull()
  })

  it('counts open warnings in the To review list and filters to them', async () => {
    m.fetchManagerOrders.mockResolvedValue([makeReview(), makeReview({ id: 'o-2', order_no: 'ORDER1002' })])
    sup.fetchOpenWarningCounts.mockResolvedValue({ 'o-1': 2 })
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/review']}>
        <Routes>
          <Route path="/review" element={<ReviewQueuePage />} />
        </Routes>
      </MemoryRouter>,
    )
    const table = await screen.findByRole('table', { name: 'To review' })
    expect(await within(table).findByText('2 warnings')).toBeTruthy()
    expect(within(table).getByRole('link', { name: 'ORDER1002' })).toBeTruthy()
    await user.click(screen.getByRole('link', { name: 'Only jobs with warnings' }))
    await waitFor(() =>
      expect(within(screen.getByRole('table', { name: 'To review' })).queryByRole('link', { name: 'ORDER1002' })).toBeNull(),
    )
    expect(sup.fetchOpenWarningCounts).toHaveBeenCalledWith(['o-1', 'o-2'])
  })
})

// ---------------------------------------------------------------------------
// Finance
// ---------------------------------------------------------------------------
describe('Finance queue (AC10)', () => {
  it('opens on Ready to close for every branch, with money columns and a branch filter', async () => {
    m.fetchFinanceOrders.mockResolvedValue([
      makeReview({ status: 'reviewed', amount_paid: 180, balance: 0, payment_status: 'paid', unverified_count: 1 }),
    ])
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/finance']}>
        <Routes>
          <Route path="/finance" element={<FinanceQueuePage />} />
        </Routes>
      </MemoryRouter>,
    )
    const table = await screen.findByRole('table', { name: 'Ready to close' })
    expect(within(table).getByRole('link', { name: 'ORDER1001' }).getAttribute('href')).toBe('/finance/ORDER1001')
    expect(within(table).getByText('Receipts to verify')).toBeTruthy()
    expect(m.fetchFinanceOrders).toHaveBeenCalledWith('ready', null)
    const tabs = screen.getByRole('navigation', { name: 'Finance queue' })
    for (const name of ['Not yet reviewed', 'Ready to close', 'Payment outstanding', 'Closed']) {
      expect(within(tabs).getByRole('link', { name })).toBeTruthy()
    }
    await user.selectOptions(await screen.findByLabelText('Branch'), 'Kuala Lumpur')
    await waitFor(() => expect(m.fetchFinanceOrders).toHaveBeenCalledWith('ready', 'b-kl'))
  })
})

describe('Finance order page (AC11–AC13)', () => {
  const reviewed = (overrides: Partial<OrderReview> = {}) =>
    makeReview({
      status: 'reviewed',
      latest_message_status: 'sent',
      amount_paid: 180,
      balance: 0,
      payment_status: 'paid',
      payment_count: 1,
      reviewed_at: '2026-10-22T07:40:00Z',
      reviewed_by_name: 'Nurul Huda',
      review_note: 'Receipt by email',
      ...overrides,
    })

  it('verifies a receipt, then closes; the message panel is read-only', async () => {
    m.fetchOrderReview.mockResolvedValue(reviewed({ unverified_count: 1 }))
    vi.mocked(ordersApi.fetchOrderRecords).mockResolvedValue({ completion: null, payments: [payment()], rework: null })
    messages.fetchLatestCustomerMessage.mockResolvedValue(
      makeCustomerMessage({ status: 'sent', confirmed_by_name: 'Ali', confirmed_at: '2026-10-22T07:20:00Z' }),
    )
    const user = userEvent.setup()
    await renderPage('finance')
    expect(screen.getByText('Approved by Nurul Huda at Thu 22 Oct 2026, 3:40 PM')).toBeTruthy()
    expect(screen.getByText('Note: Receipt by email')).toBeTruthy()
    const close = screen.getByRole('button', { name: 'Close order' }) as HTMLButtonElement
    expect(close.disabled).toBe(true)
    expect(screen.getByText('Verify every receipt before closing (1 not verified yet)')).toBeTruthy()

    // After the tick the database reports the receipt verified.
    m.verifyPayment.mockImplementation(async () => {
      m.fetchOrderReview.mockResolvedValue(reviewed())
      vi.mocked(ordersApi.fetchOrderRecords).mockResolvedValue({
        completion: null,
        payments: [payment({ verified_at: '2026-10-22T08:05:00Z', verified_by_name: 'Siti Aminah' })],
        rework: null,
      })
    })
    await user.click(await screen.findByRole('button', { name: 'Mark verified (RM 180.00)' }))
    expect(m.verifyPayment).toHaveBeenCalledWith('p-1')
    await waitFor(() => expect((screen.getByRole('button', { name: 'Close order' }) as HTMLButtonElement).disabled).toBe(false))
    expect(await screen.findByText(/Verified by Siti Aminah at Thu 22 Oct 2026, 4:05 PM/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Close order' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Close ORDER1001' })).getByRole('button', { name: 'Close order' }))
    expect(m.closeOrder).toHaveBeenCalledWith('o-1')

    const panel = screen.getByRole('region', { name: 'Customer message' })
    expect(within(panel).queryByRole('link', { name: /Send to customer/ })).toBeNull()
  })

  it('undoes a tick', async () => {
    m.fetchOrderReview.mockResolvedValue(reviewed())
    vi.mocked(ordersApi.fetchOrderRecords).mockResolvedValue({
      completion: null,
      payments: [payment({ verified_at: '2026-10-22T08:05:00Z', verified_by_name: 'Siti Aminah' })],
      rework: null,
    })
    const user = userEvent.setup()
    await renderPage('finance')
    await user.click(await screen.findByRole('button', { name: 'Undo verified (RM 180.00)' }))
    expect(m.unverifyPayment).toHaveBeenCalledWith('p-1')
  })

  it('explains an unpaid order and links to Record payment', async () => {
    m.fetchOrderReview.mockResolvedValue(reviewed({ amount_paid: 100, balance: 80, payment_status: 'partial' }))
    const user = userEvent.setup()
    await renderPage('finance')
    expect(screen.getByText('Order must be fully paid before closing (outstanding balance RM 80.00)')).toBeTruthy()
    await user.click(screen.getByRole('link', { name: 'Record payment' }))
    expect(screen.getByTestId('where').textContent).toBe('/finance/ORDER1001/payment')
  })

  it('has no verify buttons for cash payments or Managers', async () => {
    vi.mocked(ordersApi.fetchOrderRecords).mockResolvedValue({
      completion: null,
      payments: [payment({ id: 'p-cash', method: 'cash' }), payment()],
      rework: null,
    })
    await renderPage('manager')
    await screen.findByText('Not verified yet')
    expect(screen.queryByRole('button', { name: /Mark verified/ })).toBeNull()
  })
})

describe('Finance records a payment (AC12)', () => {
  it('records an office bank transfer with the shared form and goes back to the order', async () => {
    m.fetchOrderReview.mockResolvedValue(makeReview({ status: 'reviewed', balance: 50, final_amount: 180, amount_paid: 130 }))
    vi.mocked(filesApi.uploadFile).mockResolvedValue()
    const keepAsIs: PhotoCodec = { decode: async () => null, encode: async () => null }
    let ids = 0
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/finance/ORDER1001/payment']}>
        <Routes>
          <Route
            path="/finance/:orderNo/payment"
            element={<FinancePaymentPage codec={keepAsIs} newId={() => `id-${++ids}`} />}
          />
          <Route path="/finance/:orderNo" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    )
    const amount = (await screen.findByLabelText('Amount received (RM)')) as HTMLInputElement
    expect(amount.value).toBe('50.00')
    await user.click(screen.getByLabelText('Bank transfer'))
    const file = new File(['%PDF'], 'slip.pdf', { type: 'application/pdf' })
    await user.upload(document.getElementById('payment-receipt-file') as HTMLInputElement, file)
    await screen.findByText(/slip\.pdf/)
    await user.click(screen.getByRole('button', { name: 'Record payment' }))
    expect(m.recordPayment).toHaveBeenCalledWith(
      'o-1',
      { amount: 50, method: 'bank_transfer', note: null },
      'id-1',
      { path: expect.stringMatching(/^o-1\/receipts\/id-2\.pdf$/), fileName: 'slip.pdf' },
    )
    expect((await screen.findByTestId('where')).textContent).toBe('/finance/ORDER1001?paid=1')
  })

  it('refuses a Closed order', async () => {
    m.fetchOrderReview.mockResolvedValue(makeReview({ status: 'closed' }))
    render(
      <MemoryRouter initialEntries={['/finance/ORDER1001/payment']}>
        <Routes>
          <Route path="/finance/:orderNo/payment" element={<FinancePaymentPage />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByText('Payments cannot be recorded now')).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// Notifications and the outcome lines
// ---------------------------------------------------------------------------
describe('Notifications open the order in the portal (AC14)', () => {
  it('a Manager tapping Job done lands on the review page', async () => {
    vi.mocked(notificationsApi.fetchNotifications).mockResolvedValue([
      {
        id: 1,
        event: 'job_done',
        message: 'ORDER1001 is done and awaiting your review',
        read_at: null,
        created_at: '2026-10-22T07:15:00Z',
        order_no: 'ORDER1001',
      },
    ])
    vi.mocked(notificationsApi.fetchUnreadCount).mockResolvedValue(1)
    vi.mocked(notificationsApi.subscribeToNotifications).mockReturnValue(() => {})
    vi.mocked(notificationsApi.markNotificationRead).mockResolvedValue()
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/notifications']}>
        <NotificationsProvider staffId="s-nurul">
          <Routes>
            <Route path="/notifications" element={<NotificationsPage jobPath={(no) => `/review/${no}`} />} />
            <Route path="/review/:orderNo" element={<Where />} />
          </Routes>
        </NotificationsProvider>
      </MemoryRouter>,
    )
    await user.click(await screen.findByRole('button', { name: /ORDER1001 is done/ }))
    expect(screen.getByTestId('where').textContent).toBe('/review/ORDER1001')
  })
})

describe('Approved by / Closed by on other screens (AC15)', () => {
  it('shows both lines once the order is reviewed and closed; nothing before', async () => {
    m.fetchReviewFacts.mockResolvedValue({
      reviewed_at: '2026-10-22T07:40:00Z',
      reviewed_by_name: 'Nurul Huda',
      review_note: null,
      closed_at: '2026-10-22T08:05:00Z',
      closed_by_name: 'Siti Aminah',
    })
    const { rerender } = render(<ReviewOutcome orderId="o-1" status="job_done" />)
    expect(m.fetchReviewFacts).not.toHaveBeenCalled()
    rerender(<ReviewOutcome orderId="o-1" status="closed" />)
    expect(await screen.findByText('Approved by Nurul Huda at Thu 22 Oct 2026, 3:40 PM')).toBeTruthy()
    expect(screen.getByText('Closed by Siti Aminah at Thu 22 Oct 2026, 4:05 PM')).toBeTruthy()
  })
})

describe('History of payment verification', () => {
  it('names the verify and undo entries with the amount and method', () => {
    const entry = (id: number, action: string) => ({
      id,
      action,
      actor_role: 'finance' as const,
      actor_name: 'Siti Aminah',
      from_status: null,
      to_status: null,
      note: null,
      details: { payment_id: 'p-1', amount: 50, method: 'bank_transfer', status: 'reviewed' },
      created_at: '2026-10-22T08:05:00Z',
    })
    render(<OrderHistory entries={[entry(2, 'payment_unverified'), entry(1, 'payment_verified')]} />)
    expect(screen.getByText('Verified a payment')).toBeTruthy()
    expect(screen.getByText('Undid a payment verification')).toBeTruthy()
    expect(screen.getAllByText('RM 50.00 by Bank transfer')).toHaveLength(2)
  })
})
