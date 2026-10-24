// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppRoutes } from '../../src/App'
import type { CustomerMessage, FeedbackForm, OrderFeedback } from '../../src/domain'
import * as auth from '../../src/features/auth'
import { CustomerMessagePanel } from '../../src/features/customer-messages'
import * as messagesApi from '../../src/features/customer-messages/api'
import { FeedbackCard } from '../../src/features/feedback'
import * as api from '../../src/features/feedback/api'
import { NETWORK_ERROR_MESSAGE, ApiError } from '../../src/lib/api'
import { makeCustomerMessage } from './fixtures'

vi.mock('../../src/features/feedback/api', async (importOriginal) => {
  const actual = await importOriginal<typeof api>()
  return {
    ...actual,
    fetchFeedbackForm: vi.fn(),
    submitFeedback: vi.fn(),
    fetchOrderFeedback: vi.fn(),
    recordPhoneFeedback: vi.fn(),
  }
})
vi.mock('../../src/features/customer-messages/api', async (importOriginal) => {
  const actual = await importOriginal<typeof messagesApi>()
  return { ...actual, fetchLatestCustomerMessage: vi.fn(), confirmCustomerMessage: vi.fn(), editCustomerMessage: vi.fn() }
})
vi.mock('../../src/features/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof auth>()
  return { ...actual, AuthProvider: vi.fn(() => <p>Staff app</p>) }
})

const m = vi.mocked(api)
const messages = vi.mocked(messagesApi)

const TOKEN = 'q3Z8kP1xVb7nR2mT9wLc4A'
const LINK = `http://localhost:5173/f/${TOKEN}`

const openForm = (overrides: Partial<FeedbackForm> = {}): FeedbackForm => ({
  state: 'open',
  order_no: 'ORDER1042',
  service_type: 'Repair',
  technician_name: 'Ali',
  job_done_at: '2026-10-22T07:15:00Z',
  ...overrides,
})

const closedForm = (state: FeedbackForm['state']): FeedbackForm => ({
  state,
  order_no: null,
  service_type: null,
  technician_name: null,
  job_done_at: null,
})

function feedback(overrides: Partial<OrderFeedback> = {}): OrderFeedback {
  return {
    id: 'f-1',
    message_id: 'm-1',
    order_id: 'o-1',
    technician_id: 't-ali',
    technician_name: 'Ali',
    branch_id: 'b-sa',
    rating: 4,
    working_well: true,
    comment: null,
    source: 'link',
    recorded_by: null,
    recorded_by_name: null,
    created_at: '2026-10-22T09:00:00Z',
    job_done_at: '2026-10-22T07:15:00Z',
    ...overrides,
  }
}

function renderFeedbackPage(path = `/f/${TOKEN}`) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(auth.AuthProvider).mockImplementation(() => <p>Staff app</p>)
})

// ---------------------------------------------------------------------------
// The customer page
// ---------------------------------------------------------------------------
describe('Customer feedback page (PRD AC2–AC5)', () => {
  it('opens at /f/<token> without the staff app or a sign-in, showing only the job facts', async () => {
    m.fetchFeedbackForm.mockResolvedValue(openForm())
    renderFeedbackPage()
    expect(await screen.findByRole('heading', { name: 'How did we do?' })).toBeTruthy()
    expect(m.fetchFeedbackForm).toHaveBeenCalledWith(TOKEN)
    expect(screen.queryByText('Staff app')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull()
    const facts = within(screen.getByRole('region', { name: 'Your job' }))
    expect(facts.getByText('ORDER1042')).toBeTruthy()
    expect(facts.getByText('Repair')).toBeTruthy()
    expect(facts.getByText('Ali')).toBeTruthy()
    expect(facts.getByText('Thu 22 Oct 2026, 3:15 PM')).toBeTruthy()
  })

  it('other paths still go to the staff app', async () => {
    render(
      <MemoryRouter initialEntries={['/orders']}>
        <AppRoutes />
      </MemoryRouter>,
    )
    expect(await screen.findByText('Staff app')).toBeTruthy()
    expect(m.fetchFeedbackForm).not.toHaveBeenCalled()
  })

  it('asks for stars and Yes / No before sending', async () => {
    const user = userEvent.setup()
    m.fetchFeedbackForm.mockResolvedValue(openForm())
    renderFeedbackPage()
    await user.click(await screen.findByRole('button', { name: 'Send feedback' }))
    expect(screen.getByText('Choose a rating from 1 to 5 stars')).toBeTruthy()
    expect(screen.getByText('Tell us whether your aircon is working well now')).toBeTruthy()
    expect(m.submitFeedback).not.toHaveBeenCalled()
    // Each message goes as soon as its question is answered.
    await user.click(screen.getByRole('radio', { name: /4 – Good/ }))
    expect(screen.queryByText('Choose a rating from 1 to 5 stars')).toBeNull()
    expect(screen.getByText('Tell us whether your aircon is working well now')).toBeTruthy()
  })

  it('sends the answers once and says thank you', async () => {
    const user = userEvent.setup()
    m.fetchFeedbackForm.mockResolvedValue(openForm())
    let finish!: () => void
    m.submitFeedback.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)))
    renderFeedbackPage()
    await user.click(await screen.findByRole('radio', { name: /2 – Poor/ }))
    await user.click(screen.getByRole('radio', { name: 'No' }))
    await user.type(screen.getByLabelText(/Comment/), '  Still leaking  ')
    await user.click(screen.getByRole('button', { name: 'Send feedback' }))
    expect((screen.getByRole('button', { name: 'Sending…' }) as HTMLButtonElement).disabled).toBe(true)
    finish()
    expect(await screen.findByRole('heading', { name: 'Thank you!' })).toBeTruthy()
    expect(m.submitFeedback).toHaveBeenCalledTimes(1)
    expect(m.submitFeedback).toHaveBeenCalledWith(TOKEN, { rating: 2, workingWell: false, comment: 'Still leaking' })
  })

  it('keeps the answers when there is no signal, and sends on retry', async () => {
    const user = userEvent.setup()
    m.fetchFeedbackForm.mockResolvedValue(openForm())
    m.submitFeedback.mockRejectedValueOnce(new ApiError(NETWORK_ERROR_MESSAGE)).mockResolvedValueOnce()
    renderFeedbackPage()
    await user.click(await screen.findByRole('radio', { name: /5 – Excellent/ }))
    await user.click(screen.getByRole('radio', { name: 'Yes' }))
    await user.click(screen.getByRole('button', { name: 'Send feedback' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Your answers are kept')
    expect((screen.getByRole('radio', { name: /5 – Excellent/ }) as HTMLInputElement).checked).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Send feedback' }))
    expect(await screen.findByRole('heading', { name: 'Thank you!' })).toBeTruthy()
    expect(m.submitFeedback).toHaveBeenCalledTimes(2)
  })

  it('shows why when the link stopped working meanwhile (someone already sent it)', async () => {
    const user = userEvent.setup()
    m.fetchFeedbackForm.mockResolvedValueOnce(openForm()).mockResolvedValueOnce(openForm({ state: 'submitted' }))
    m.submitFeedback.mockRejectedValue(new ApiError('Thank you, we have already received your feedback for this job'))
    renderFeedbackPage()
    await user.click(await screen.findByRole('radio', { name: /3 – Okay/ }))
    await user.click(screen.getByRole('radio', { name: 'Yes' }))
    await user.click(screen.getByRole('button', { name: 'Send feedback' }))
    expect(await screen.findByRole('heading', { name: 'Feedback received' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Send feedback' })).toBeNull()
  })

  it.each([
    ['submitted', 'Feedback received', 'we have already received your feedback'],
    ['replaced', 'This link cannot be used', 'no longer active'],
    ['expired', 'This link cannot be used', 'has expired'],
    ['not_found', 'This link cannot be used', 'not valid'],
  ] as const)('a %s link shows a clear page and no form', async (state, title, text) => {
    m.fetchFeedbackForm.mockResolvedValue(state === 'submitted' ? openForm({ state }) : closedForm(state))
    renderFeedbackPage()
    const heading = await screen.findByRole('heading', { name: title })
    expect(heading.parentElement?.textContent).toContain(text)
    expect(screen.queryByRole('button', { name: 'Send feedback' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Your job' }) !== null).toBe(state === 'submitted')
  })

  it('offers Try again when the form cannot load', async () => {
    const user = userEvent.setup()
    m.fetchFeedbackForm.mockRejectedValueOnce(new ApiError(NETWORK_ERROR_MESSAGE)).mockResolvedValueOnce(openForm())
    renderFeedbackPage()
    await user.click(await screen.findByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { name: 'How did we do?' })).toBeTruthy()
  })

  it('every control has a visible label', async () => {
    m.fetchFeedbackForm.mockResolvedValue(openForm())
    renderFeedbackPage()
    await screen.findByRole('heading', { name: 'How did we do?' })
    expect(screen.getAllByRole('radio')).toHaveLength(7)
    for (const radio of screen.getAllByRole('radio')) expect(radio.closest('label')?.textContent?.trim()).toBeTruthy()
    expect(screen.getByRole('group', { name: 'How would you rate the job?' })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Is your aircon working well now?' })).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// Staff: the feedback card
// ---------------------------------------------------------------------------
describe('Customer feedback card (PRD AC7, AC9)', () => {
  const landlineTold = (overrides: Partial<CustomerMessage> = {}) =>
    makeCustomerMessage({
      channel: 'phone',
      phone: '60312345678',
      status: 'told_by_phone',
      confirmed_by: 'a-1',
      confirmed_by_name: 'Aisyah',
      confirmed_at: '2026-10-22T07:30:00Z',
      ...overrides,
    })

  const card = async () => within(await screen.findByRole('region', { name: 'Customer feedback' }))

  it('lists every visit, latest first, with stars, answers, comment, source and a poor-rating tag', async () => {
    messages.fetchLatestCustomerMessage.mockResolvedValue(makeCustomerMessage({ id: 'm-2', feedback_url: LINK }))
    m.fetchOrderFeedback.mockResolvedValue([
      feedback({ id: 'f-2', message_id: 'm-2', rating: 5, comment: 'Fixed now', job_done_at: '2026-10-24T07:15:00Z' }),
      feedback({ id: 'f-1', rating: 2, working_well: false, comment: 'Still leaking' }),
    ])
    render(<FeedbackCard orderId="o-1" orderStatus="job_done" role="technician" />)
    const c = await card()
    const items = c.getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(within(items[0]).getByRole('img', { name: '5 out of 5 stars' })).toBeTruthy()
    expect(within(items[0]).queryByText('Poor rating')).toBeNull()
    expect(within(items[1]).getByText('Poor rating')).toBeTruthy()
    expect(within(items[1]).getByText('Still leaking')).toBeTruthy()
    expect(items[1].textContent).toContain('Aircon working well now: No')
    expect(items[1].textContent).toContain('Received from the customer at Thu 22 Oct 2026, 5:00 PM')
    expect(items[1].textContent).toContain('visit done Thu 22 Oct 2026, 3:15 PM')
    expect(c.queryByRole('button', { name: 'Record rating taken by phone' })).toBeNull()
  })

  it('says how long the customer\'s link works while there is no feedback', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-23T00:00:00Z'))
    try {
      messages.fetchLatestCustomerMessage.mockResolvedValue(makeCustomerMessage({ status: 'sent', feedback_url: LINK }))
      m.fetchOrderFeedback.mockResolvedValue([])
      render(<FeedbackCard orderId="o-1" orderStatus="job_done" role="admin" />)
      expect((await card()).getByText("No feedback yet. The customer's link works until Thu 29 Oct 2026, 3:15 PM.")).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows nothing before the first Job Done', async () => {
    m.fetchOrderFeedback.mockResolvedValue([])
    render(<FeedbackCard orderId="o-1" orderStatus="in_progress" role="admin" />)
    await waitFor(() => expect(m.fetchOrderFeedback).toHaveBeenCalled())
    expect(screen.queryByRole('region', { name: 'Customer feedback' })).toBeNull()
    expect(messages.fetchLatestCustomerMessage).not.toHaveBeenCalled()
  })

  it('an Admin records a landline customer\'s rating taken by phone', async () => {
    const user = userEvent.setup()
    messages.fetchLatestCustomerMessage.mockResolvedValue(landlineTold())
    let rows: OrderFeedback[] = []
    m.fetchOrderFeedback.mockImplementation(async () => rows)
    m.recordPhoneFeedback.mockImplementation(async () => {
      rows = [feedback({ source: 'phone', recorded_by: 'a-1', recorded_by_name: 'Aisyah Rahman', rating: 3 })]
    })
    render(<FeedbackCard orderId="o-1" orderStatus="job_done" role="admin" />)
    await user.click((await card()).getByRole('button', { name: 'Record rating taken by phone' }))
    const dialog = within(screen.getByRole('dialog', { name: 'Record rating taken by phone' }))
    expect(dialog.getByRole('group', { name: 'How did the customer rate the job?' })).toBeTruthy()
    await user.click(dialog.getByRole('button', { name: 'Save rating' }))
    expect(dialog.getByText('Choose a rating from 1 to 5 stars')).toBeTruthy()
    await user.click(dialog.getByRole('radio', { name: /3 – Okay/ }))
    await user.click(dialog.getByRole('radio', { name: 'Yes' }))
    await user.click(dialog.getByRole('button', { name: 'Save rating' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(m.recordPhoneFeedback).toHaveBeenCalledWith('m-1', { rating: 3, workingWell: true, comment: null })
    expect((await card()).getByText(/Taken by phone by Aisyah Rahman at/)).toBeTruthy()
    expect((await card()).queryByRole('button', { name: 'Record rating taken by phone' })).toBeNull()
  })

  it('a covering Manager can record it; the technician, Finance, and anyone before the call cannot', async () => {
    messages.fetchLatestCustomerMessage.mockResolvedValue(landlineTold())
    m.fetchOrderFeedback.mockResolvedValue([])
    const { unmount } = render(<FeedbackCard orderId="o-1" orderStatus="reviewed" role="manager" coversBranch />)
    expect((await card()).getByRole('button', { name: 'Record rating taken by phone' })).toBeTruthy()
    unmount()

    for (const role of ['technician', 'finance'] as const) {
      const r = render(<FeedbackCard orderId="o-1" orderStatus="job_done" role={role} />)
      expect((await card()).queryByRole('button', { name: 'Record rating taken by phone' })).toBeNull()
      r.unmount()
    }

    messages.fetchLatestCustomerMessage.mockResolvedValue(landlineTold({ status: 'not_sent', confirmed_by: null, confirmed_by_name: null, confirmed_at: null }))
    render(<FeedbackCard orderId="o-1" orderStatus="job_done" role="admin" />)
    const c = await card()
    expect(c.getByText(/Call the customer first/)).toBeTruthy()
    expect(c.queryByRole('button', { name: 'Record rating taken by phone' })).toBeNull()
  })

  it('shows the database\'s reason when recording is refused', async () => {
    const user = userEvent.setup()
    messages.fetchLatestCustomerMessage.mockResolvedValue(landlineTold())
    m.fetchOrderFeedback.mockResolvedValue([])
    m.recordPhoneFeedback.mockRejectedValue(new ApiError('Already rated 4/5, taken by phone by Nurul Huda at Thu 22 Oct 2026, 5:00 PM'))
    render(<FeedbackCard orderId="o-1" orderStatus="job_done" role="admin" />)
    await user.click((await card()).getByRole('button', { name: 'Record rating taken by phone' }))
    const dialog = within(screen.getByRole('dialog'))
    await user.click(dialog.getByRole('radio', { name: /4 – Good/ }))
    await user.click(dialog.getByRole('radio', { name: 'Yes' }))
    await user.click(dialog.getByRole('button', { name: 'Save rating' }))
    expect((await dialog.findByRole('alert')).textContent).toContain('Already rated 4/5')
  })
})

// ---------------------------------------------------------------------------
// The link line in the customer message
// ---------------------------------------------------------------------------
describe('Feedback link in the customer message panel (PRD AC1, AC13)', () => {
  it('shows the fixed link line and sends it as the last line on WhatsApp', async () => {
    messages.fetchLatestCustomerMessage.mockResolvedValue(makeCustomerMessage({ feedback_url: LINK }))
    render(<CustomerMessagePanel orderId="o-1" orderStatus="job_done" canManage />)
    const panel = within(await screen.findByRole('region', { name: 'Customer message' }))
    expect(panel.getByText(`Leave feedback: ${LINK}`)).toBeTruthy()
    expect(panel.getByText(/Editing the message does not change it/)).toBeTruthy()
    const href = panel.getByRole('link', { name: /Send to customer on WhatsApp/ }).getAttribute('href') ?? ''
    const text = new URL(href).searchParams.get('text') ?? ''
    expect(text.endsWith(`\n\nLeave feedback: ${LINK}`)).toBe(true)
    expect(panel.queryByRole('alert')).toBeNull()
  })

  it('adds the link to the Manager\'s on-behalf text too', async () => {
    messages.fetchLatestCustomerMessage.mockResolvedValue(makeCustomerMessage({ feedback_url: LINK }))
    render(
      <CustomerMessagePanel orderId="o-1" orderStatus="job_done" canManage canEdit={false} onBehalfBody="Hi, this is Nurul." />,
    )
    const panel = within(await screen.findByRole('region', { name: 'Customer message' }))
    const href = panel.getByRole('link', { name: /Send to customer on WhatsApp/ }).getAttribute('href') ?? ''
    expect(new URL(href).searchParams.get('text')).toBe(`Hi, this is Nurul.\n\nLeave feedback: ${LINK}`)
  })

  it('warns when the link address is not set', async () => {
    messages.fetchLatestCustomerMessage.mockResolvedValue(
      makeCustomerMessage({ feedback_url: `https://feedback-address-not-set.invalid/f/${TOKEN}` }),
    )
    render(<CustomerMessagePanel orderId="o-1" orderStatus="job_done" canManage />)
    const panel = within(await screen.findByRole('region', { name: 'Customer message' }))
    expect(panel.getByRole('alert').textContent).toContain('The feedback link address is not set')
  })
})

// Route helper used by the page: /f/:token only.
describe('Feedback route', () => {
  it('matches only /f/<token>', async () => {
    m.fetchFeedbackForm.mockResolvedValue(openForm())
    render(
      <MemoryRouter initialEntries={['/f/abc']}>
        <Routes>
          <Route path="*" element={<AppRoutes />} />
        </Routes>
      </MemoryRouter>,
    )
    await waitFor(() => expect(m.fetchFeedbackForm).toHaveBeenCalledWith('abc'))
  })
})

// ---------------------------------------------------------------------------
// 0011 Q19: English / Malay on the customer page
// ---------------------------------------------------------------------------
describe('Customer feedback page in English or Malay (0011 Q19)', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => window.localStorage.clear())

  it('opens in English and switches every page word to Malay, remembered on the phone', async () => {
    const user = userEvent.setup()
    m.fetchFeedbackForm.mockResolvedValue(openForm())
    const { unmount } = renderFeedbackPage()
    expect(await screen.findByRole('heading', { name: 'How did we do?' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /EN/ }).getAttribute('aria-pressed')).toBe('true')

    await user.click(screen.getByRole('button', { name: /BM/ }))
    expect(screen.getByRole('heading', { name: 'Bagaimana servis kami?' })).toBeTruthy()
    const facts = within(screen.getByRole('region', { name: 'Kerja anda' }))
    expect(facts.getByText('Pesanan')).toBeTruthy()
    expect(facts.getByText('ORDER1042')).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Apakah penilaian anda untuk kerja ini?' })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Adakah aircond anda berfungsi dengan baik sekarang?' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: /4 – Baik/ })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Ya' })).toBeTruthy()
    expect(screen.getByLabelText(/Komen/)).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Hantar maklum balas' }))
    expect(screen.getByText('Pilih penilaian antara 1 hingga 5 bintang')).toBeTruthy()
    expect(screen.getByText('Beritahu kami sama ada aircond anda berfungsi dengan baik sekarang')).toBeTruthy()

    unmount()
    renderFeedbackPage()
    expect(await screen.findByRole('heading', { name: 'Bagaimana servis kami?' })).toBeTruthy()
  })

  it('sends the same answers in Malay as in English', async () => {
    const user = userEvent.setup()
    window.localStorage.setItem('sejuk.feedback.lang', 'ms')
    m.fetchFeedbackForm.mockResolvedValue(openForm())
    m.submitFeedback.mockResolvedValue()
    renderFeedbackPage()
    await user.click(await screen.findByRole('radio', { name: /2 – Lemah/ }))
    await user.click(screen.getByRole('radio', { name: 'Tidak' }))
    await user.type(screen.getByLabelText(/Komen/), '  Masih bocor  ')
    await user.click(screen.getByRole('button', { name: 'Hantar maklum balas' }))
    expect(await screen.findByRole('heading', { name: 'Terima kasih!' })).toBeTruthy()
    expect(m.submitFeedback).toHaveBeenCalledWith(TOKEN, { rating: 2, workingWell: false, comment: 'Masih bocor' })
  })

  it.each([
    ['submitted', 'Maklum balas diterima'],
    ['expired', 'Pautan ini tidak boleh digunakan'],
  ] as const)('shows the %s page in Malay', async (state, title) => {
    window.localStorage.setItem('sejuk.feedback.lang', 'ms')
    m.fetchFeedbackForm.mockResolvedValue(state === 'submitted' ? openForm({ state }) : closedForm(state))
    renderFeedbackPage()
    expect(await screen.findByRole('heading', { name: title })).toBeTruthy()
  })
})
