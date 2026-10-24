// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../src/App'
import type { StaffRole } from '../../src/domain'
import type { AuthState } from '../../src/features/auth'
import * as auth from '../../src/features/auth'
import * as api from '../../src/features/ask/api'
import { AskAssistant, QuestionLogPage } from '../../src/features/ask'
import { ASK_TIME_LIMIT_MS } from '../../src/features/ask/AskAssistant'
import { dashboardPath } from '../../src/features/ask/AnswerCard'
import type { AskEvent, AskResult } from '../../src/features/ask/types'
import * as jobsApi from '../../src/features/jobs/api'
import * as notificationsApi from '../../src/features/notifications/api'
import * as reviewApi from '../../src/features/order-review/api'
import { reference } from './fixtures'

vi.mock('../../src/features/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof auth>()
  return { ...actual, AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>, useAuth: vi.fn() }
})
vi.mock('../../src/features/ask/api', async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  askQuestion: vi.fn(),
  fetchChats: vi.fn(),
  fetchChatMessages: vi.fn(),
  renameChat: vi.fn(),
  deleteChat: vi.fn(),
  fetchQuestionLog: vi.fn(),
}))
vi.mock('../../src/features/jobs/api', async (importOriginal) => ({
  ...(await importOriginal<typeof jobsApi>()),
  fetchMyJobs: vi.fn().mockResolvedValue([]),
}))
vi.mock('../../src/features/notifications/api', async (importOriginal) => ({
  ...(await importOriginal<typeof notificationsApi>()),
  fetchUnreadCount: vi.fn().mockResolvedValue(0),
  subscribeToNotifications: vi.fn().mockReturnValue(() => {}),
}))
vi.mock('../../src/features/order-review/api', async (importOriginal) => ({
  ...(await importOriginal<typeof reviewApi>()),
  fetchManagerOrders: vi.fn().mockResolvedValue([]),
  fetchFinanceOrders: vi.fn().mockResolvedValue([]),
  fetchCoveredBranches: vi.fn().mockResolvedValue([]),
  fetchBranches: vi.fn().mockResolvedValue([]),
}))
vi.mock('../../src/features/orders/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/features/orders/api')>()),
  listOrders: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
  fetchReferenceData: vi.fn().mockImplementation(async () => reference),
}))

const m = vi.mocked(api)

const result = (over: Partial<AskResult> = {}): AskResult => ({
  kind: 'answer',
  answer: 'Ali completed 2 jobs last week (12–18 Oct 2026).',
  tables: [
    {
      kind: 'events',
      title: 'Ali — last week (12–18 Oct 2026)',
      total: 2,
      rows: [
        { kind: 'completed', order_no: 'ORDER1234', service_type: 'Aircond cleaning', branch_name: 'Shah Alam', happened_at: '2026-10-13T06:00:00Z', amount: 150, rating: 5 },
        { kind: 'completed', order_no: 'ORDER1237', service_type: 'Repair', branch_name: 'Shah Alam', happened_at: '2026-10-14T06:00:00Z', amount: 300, rating: null },
      ],
    },
  ],
  found: ['Looked up: completed jobs · Ali · all your branches · last week (12–18 Oct 2026) · 2 found'],
  options: [],
  orderNo: null,
  dashboard: { view: 'week', start: '2026-10-12', branchId: null, technicianId: 's-ali' },
  ...over,
})

/** askQuestion answers with these events, in order. */
function answers(...events: AskEvent[]) {
  m.askQuestion.mockImplementation(async (_q, _chat, onEvent) => {
    for (const e of events) onEvent(e)
  })
}

function Where() {
  const location = useLocation()
  return <p data-testid="where">{`${location.pathname}${location.search}`}</p>
}

function open(role: StaffRole = 'manager', orderPath = (no: string) => `/review/${no}`) {
  const user = userEvent.setup()
  render(
    <MemoryRouter initialEntries={['/review']}>
      <Routes>
        <Route path="*" element={<Where />} />
      </Routes>
      <AskAssistant role={role} orderPath={orderPath} />
    </MemoryRouter>,
  )
  return user
}

beforeEach(() => {
  for (const f of Object.values(m)) if (typeof f === 'function' && 'mockReset' in f) (f as ReturnType<typeof vi.fn>).mockReset()
  m.fetchChats.mockResolvedValue([])
})
afterEach(() => vi.useRealTimers())

// ---------------------------------------------------------------------------
describe('The chat bubble on every portal (PRD Q1, Q18)', () => {
  function signedInAs(role: StaffRole) {
    const state: AuthState = {
      status: 'signed-in',
      email: `${role}@sejuk.example.com`,
      profile: { status: 'ready', profile: { id: 's-1', name: 'Staff', role, branchName: 'Shah Alam' } },
      signIn: vi.fn(),
      signOut: vi.fn(),
      reloadProfile: vi.fn(),
      notice: null,
    }
    vi.mocked(auth.useAuth).mockReturnValue(state)
  }

  it.each(['admin', 'manager', 'finance', 'technician'] as const)('shows the Ask bubble to a %s without loading anything', async (role) => {
    signedInAs(role)
    window.history.replaceState(null, '', '/')
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Ask the assistant' })).toBeTruthy()
    expect(m.fetchChats).not.toHaveBeenCalled()
    expect(m.askQuestion).not.toHaveBeenCalled()
    const log = screen.queryByRole('link', { name: 'AI log' })
    expect(Boolean(log)).toBe(role === 'admin')
  })
})

describe('Asking a question (PRD Q3, Q8, Q9, Q15)', () => {
  it('shows example questions for the role, the steps while waiting, then the answer with its records', async () => {
    let finish: () => void = () => {}
    m.askQuestion.mockImplementation(async (_q, _chat, onEvent) => {
      onEvent({ type: 'step', text: 'Looking up completed jobs for Ali, last week (12–18 Oct 2026)…' })
      await new Promise<void>((resolve) => (finish = resolve))
      onEvent({ type: 'result', chatId: 'chat-1', messageId: 1, result: result() })
    })
    const user = open('manager')
    await user.click(screen.getByRole('button', { name: 'Ask the assistant' }))
    const panel = screen.getByRole('dialog', { name: 'Ask the assistant' })
    const examples = within(panel).getByRole('group', { name: 'Example questions' })
    expect(within(examples).getAllByRole('button').map((b) => b.textContent)).toContain('What jobs did Ali complete last week?')

    await user.click(within(examples).getByRole('button', { name: 'What jobs did Ali complete last week?' }))
    expect(m.askQuestion).toHaveBeenCalledWith('What jobs did Ali complete last week?', null, expect.any(Function), expect.any(AbortSignal))
    expect(await screen.findByRole('status')).toHaveProperty('textContent', 'Looking up completed jobs for Ali, last week (12–18 Oct 2026)…')
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true)

    await act(async () => finish())
    expect(await screen.findByText('Ali completed 2 jobs last week (12–18 Oct 2026).')).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
    const records = screen.getByRole('region', { name: 'Ali — last week (12–18 Oct 2026)' })
    const links = within(records).getAllByRole('link', { name: 'ORDER1234' })
    expect(links[0].getAttribute('href')).toBe('/review/ORDER1234')
    expect(within(records).getAllByText('RM 150.00').length).toBeGreaterThan(0)
    expect(screen.getByText('How I found this')).toBeTruthy()
    // Plain words only: no function names, ids or JSON for staff (decision 0016).
    expect(screen.queryByText('Details')).toBeNull()
    expect(screen.getByRole('dialog').textContent).not.toMatch(/kpi_|p_start|\{"/)
    expect(screen.getByRole('link', { name: 'Open in Dashboard' }).getAttribute('href')).toBe(
      '/dashboard/technicians/s-ali?view=week&start=2026-10-12',
    )
  })

  it('sends a follow-up in the same chat', async () => {
    answers({ type: 'result', chatId: 'chat-1', messageId: 1, result: result() })
    const user = open()
    await user.click(screen.getByRole('button', { name: 'Ask the assistant' }))
    await user.type(screen.getByLabelText('Your question'), 'Ali last week{Enter}')
    await screen.findByText('Ali completed 2 jobs last week (12–18 Oct 2026).')
    await user.type(screen.getByLabelText('Your question'), 'and Bala?{Enter}')
    expect(m.askQuestion).toHaveBeenLastCalledWith('and Bala?', 'chat-1', expect.any(Function), expect.any(AbortSignal))
  })

  it('offers "Did you mean…?" buttons that ask again', async () => {
    answers({
      type: 'result', chatId: 'chat-1', messageId: 1,
      result: result({ kind: 'clarify', answer: 'I found more than one technician called "Ali". Which one do you mean?', tables: [], found: [], dashboard: null, options: ['Ali (Shah Alam)', 'Ali Rahman (Kuala Lumpur)'] }),
    })
    const user = open()
    await user.click(screen.getByRole('button', { name: 'Ask the assistant' }))
    await user.type(screen.getByLabelText('Your question'), 'Ali jobs{Enter}')
    const choose = await screen.findByRole('group', { name: 'Choose an answer' })
    await user.click(within(choose).getByRole('button', { name: 'Ali Rahman (Kuala Lumpur)' }))
    expect(m.askQuestion).toHaveBeenLastCalledWith('Ali Rahman (Kuala Lumpur)', 'chat-1', expect.any(Function), expect.any(AbortSignal))
  })

  it('shows example questions under an out-of-scope reply and links the order after a change request', async () => {
    answers({ type: 'result', chatId: 'c', messageId: 1, result: result({ kind: 'out_of_scope', answer: 'I can only answer questions about jobs…', tables: [], found: [], dashboard: null }) })
    const user = open('finance', (no) => `/finance/${no}`)
    await user.click(screen.getByRole('button', { name: 'Ask the assistant' }))
    await user.type(screen.getByLabelText('Your question'), 'Weather?{Enter}')
    const ex = await screen.findAllByRole('group', { name: 'Example questions' })
    expect(within(ex[ex.length - 1]).getByRole('button', { name: 'Which jobs are still unpaid?' })).toBeTruthy()

    answers({ type: 'result', chatId: 'c', messageId: 2, result: result({ kind: 'cannot_change', answer: 'I can only look things up. To change an order, open it: ORDER1234.', orderNo: 'ORDER1234', tables: [], found: [], dashboard: null }) })
    await user.type(screen.getByLabelText('Your question'), 'Close ORDER1234{Enter}')
    expect((await screen.findByRole('link', { name: 'Open ORDER1234' })).getAttribute('href')).toBe('/finance/ORDER1234')
  })

  it('puts the question back in the box when the assistant cannot be reached, with the Dashboard and Try again', async () => {
    answers({ type: 'error', code: 'ai_unavailable', message: "The assistant can't be reached right now. Try again in a minute, or open the Dashboard for the same numbers." })
    const user = open()
    await user.click(screen.getByRole('button', { name: 'Ask the assistant' }))
    await user.type(screen.getByLabelText('Your question'), 'Top technician this week?{Enter}')
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain("can't be reached")
    expect(within(alert).getByRole('link', { name: 'Open the Dashboard' }).getAttribute('href')).toBe('/dashboard')
    expect((screen.getByLabelText('Your question') as HTMLTextAreaElement).value).toBe('Top technician this week?')
    expect(screen.queryByText('Top technician this week?', { selector: 'div' })).toBeNull()

    answers({ type: 'result', chatId: 'c', messageId: 1, result: result() })
    await user.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Ali completed 2 jobs last week (12–18 Oct 2026).')).toBeTruthy()
  })

  it('says "not set up" without a retry, and gives up after 20 seconds', async () => {
    answers({ type: 'error', code: 'not_set_up', message: 'The assistant is not set up yet.' })
    const user = open()
    await user.click(screen.getByRole('button', { name: 'Ask the assistant' }))
    await user.type(screen.getByLabelText('Your question'), 'Hi{Enter}')
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('The assistant is not set up yet.')
    expect(within(alert).queryByRole('button', { name: 'Try again' })).toBeNull()

    vi.useFakeTimers({ shouldAdvanceTime: true })
    m.askQuestion.mockImplementation(
      (_q, _c, _e, signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))),
    )
    fireEvent.change(screen.getByLabelText('Your question'), { target: { value: 'Slow question' } })
    fireEvent.submit(screen.getByLabelText('Your question').closest('form')!)
    await act(async () => {
      vi.advanceTimersByTime(ASK_TIME_LIMIT_MS + 10)
    })
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('This is taking too long. Try again.'))
  })

  it('sends a technician to My week for the same period', () => {
    expect(dashboardPath('technician', { view: 'week', start: '2026-10-19', branchId: 'b-sa', technicianId: 's-ali' })).toBe(
      '/my-week?view=week&start=2026-10-19',
    )
    expect(dashboardPath('admin', { view: 'month', start: '2026-10-01', branchId: 'b-sa', technicianId: null })).toBe(
      '/dashboard?view=month&start=2026-10-01&branch=b-sa',
    )
  })

  it('fills the screen on a phone and shows records as cards there', async () => {
    answers({ type: 'result', chatId: 'c', messageId: 1, result: result() })
    const user = open()
    await user.click(screen.getByRole('button', { name: 'Ask the assistant' }))
    expect(screen.getByRole('dialog').className).toContain('fixed inset-0')
    await user.type(screen.getByLabelText('Your question'), 'Ali{Enter}')
    const records = await screen.findByRole('region', { name: 'Ali — last week (12–18 Oct 2026)' })
    expect(records.querySelector('ul.sm\\:hidden')).toBeTruthy()
    expect(records.querySelector('div.hidden.sm\\:block table')).toBeTruthy()
  })
})

describe('Saved chats (PRD Q12, Q13)', () => {
  it('lists, opens, renames and deletes the person\'s chats', async () => {
    m.fetchChats.mockResolvedValue([
      { id: 'c1', title: 'What jobs did Ali complete last week?', updated_at: '2026-10-24T02:00:00Z' },
      { id: 'c2', title: 'Unpaid jobs', updated_at: '2026-10-23T02:00:00Z' },
    ])
    m.fetchChatMessages.mockResolvedValue([
      { id: 1, role: 'user', body: 'What jobs did Ali complete last week?', result: null, created_at: '2026-10-24T02:00:00Z' },
      { id: 2, role: 'assistant', body: 'Ali completed 2 jobs last week (12–18 Oct 2026).', result: result(), created_at: '2026-10-24T02:00:05Z' },
    ])
    m.renameChat.mockResolvedValue()
    m.deleteChat.mockResolvedValue()
    const user = open()
    await user.click(screen.getByRole('button', { name: 'Ask the assistant' }))
    await user.click(screen.getByRole('button', { name: 'Chats' }))
    const list = await screen.findByRole('navigation', { name: 'Saved chats' })
    await within(list).findByText('Unpaid jobs')

    await user.click(within(list).getByRole('button', { name: /^What jobs did Ali complete last week\?/ }))
    expect(m.fetchChatMessages).toHaveBeenCalledWith('c1')
    expect(await screen.findByText('Ali completed 2 jobs last week (12–18 Oct 2026).')).toBeTruthy()

    answers({ type: 'result', chatId: 'c1', messageId: 3, result: result({ answer: 'Bala completed 1 job.' }) })
    await user.type(screen.getByLabelText('Your question'), 'and Bala?{Enter}')
    expect(m.askQuestion).toHaveBeenLastCalledWith('and Bala?', 'c1', expect.any(Function), expect.any(AbortSignal))

    await user.click(screen.getByRole('button', { name: 'Chats' }))
    const again = await screen.findByRole('navigation', { name: 'Saved chats' })
    await user.click(await within(again).findByRole('button', { name: 'Rename Unpaid jobs' }))
    const name = within(again).getByLabelText('Chat name')
    await user.clear(name)
    await user.type(name, 'Money{Enter}')
    expect(m.renameChat).toHaveBeenCalledWith('c2', 'Money')

    await user.click(within(again).getByRole('button', { name: 'Delete Unpaid jobs' }))
    await user.click(screen.getByRole('button', { name: 'Delete chat' }))
    expect(m.deleteChat).toHaveBeenCalledWith('c2')
  })
})

describe('The Admin AI log (0008 PRD Q13, P8; 0009 plan P6)', () => {
  it('lists every question of the last 7 days with who asked, what was looked up and how it ended', async () => {
    m.fetchQuestionLog.mockResolvedValue([
      {
        id: 2, created_at: '2026-10-24T02:00:00Z', staff_id: 's-nurul', staff_name: 'Nurul Huda', staff_role: 'manager',
        branch_name: 'Shah Alam', staff_active: true, chat_id: 'c1', question: 'What jobs did Ali complete last week?',
        lookups: [{ lookup: 'technician_events', status: 'done', fn: 'kpi_technician_events', rows: 2 }],
        row_count: 2, outcome: 'answered', duration_ms: 4200, input_tokens: 2000, output_tokens: 100,
      },
      {
        id: 1, created_at: '2026-10-24T01:00:00Z', staff_id: 's-ali', staff_name: 'Ali', staff_role: 'technician',
        branch_name: 'Shah Alam', staff_active: false, chat_id: null, question: 'Close all jobs',
        lookups: [{ lookup: 'reply_cannot_change_data', status: 'reply' }], row_count: 0, outcome: 'cannot_change',
        duration_ms: 1500, input_tokens: 900, output_tokens: 20,
      },
    ])
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <QuestionLogPage />
      </MemoryRouter>,
    )
    expect((await screen.findAllByText('What jobs did Ali complete last week?')).length).toBeGreaterThan(0)
    const table = screen.getByRole('table')
    expect(within(table).getByText("a technician's jobs")).toBeTruthy()
    expect(within(table).getByText('4.2 s')).toBeTruthy()
    expect(within(table).getByText('Asked to change data')).toBeTruthy()
    expect(within(table).getByText(/Ali \(inactive\)/)).toBeTruthy()
    expect(screen.getByText('2 entries · 3,020 tokens')).toBeTruthy()

    await user.selectOptions(screen.getByLabelText('Person'), 's-ali')
    expect(screen.getByText('1 entry · 920 tokens')).toBeTruthy()
    expect(within(screen.getByRole('table')).queryByText('What jobs did Ali complete last week?')).toBeNull()
  })

  it('also lists job checks, order forms and insights, filtered by Type (0009)', async () => {
    const base = { staff_active: true, chat_id: null, lookups: [], row_count: null, duration_ms: 3000, input_tokens: 500, output_tokens: 40 }
    m.fetchQuestionLog.mockResolvedValue([
      { ...base, id: 3, created_at: '2026-10-24T03:00:00Z', staff_id: 's-ali', staff_name: 'Ali', staff_role: 'technician', branch_name: 'Shah Alam', question: 'Job check ORDER1042', outcome: 'warnings', feature: 'supervisor', order_no: 'ORDER1042' },
      { ...base, id: 4, created_at: '2026-10-24T04:00:00Z', staff_id: 's-farid', staff_name: 'Farid Hakim', staff_role: 'admin', branch_name: 'Shah Alam', question: 'Read order form (photo, 1.2 MB)', outcome: 'unclear', feature: 'form', order_no: null },
      { ...base, id: 5, created_at: '2026-10-24T05:00:00Z', staff_id: 's-nurul', staff_name: 'Nurul Huda', staff_role: 'manager', branch_name: 'Shah Alam', question: 'Insights · this week · all your branches', outcome: 'worded', feature: 'insights', order_no: null },
    ])
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <QuestionLogPage />
      </MemoryRouter>,
    )
    const table = await screen.findByRole('table')
    expect(within(table).getByText('Job check')).toBeTruthy()
    expect(within(table).getByText('Found warnings')).toBeTruthy()
    expect(within(table).getByText('Form unclear')).toBeTruthy()
    expect(within(table).getByText('Worded')).toBeTruthy()
    await user.selectOptions(screen.getByLabelText('Type'), 'form')
    expect(screen.getByText('1 entry · 540 tokens')).toBeTruthy()
    expect(within(screen.getByRole('table')).queryByText('Job check ORDER1042')).toBeNull()
  })
})
