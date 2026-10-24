// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CustomerMessage, OrderStatus } from '../../src/domain'
import * as api from '../../src/features/customer-messages/api'
import { CustomerMessagePanel, CustomerNotToldBadge } from '../../src/features/customer-messages'
import * as jobsApi from '../../src/features/jobs/api'
import { JobListPage } from '../../src/features/jobs/JobListPage'
import { CUSTOMER_MESSAGE_TEXT, makeCustomerMessage, makeOrder } from './fixtures'

vi.mock('../../src/features/customer-messages/api', async (importOriginal) => {
  const actual = await importOriginal<typeof api>()
  return {
    ...actual,
    fetchLatestCustomerMessage: vi.fn(),
    fetchLatestCustomerMessages: vi.fn(),
    editCustomerMessage: vi.fn(),
    confirmCustomerMessage: vi.fn(),
  }
})
vi.mock('../../src/features/jobs/api', async (importOriginal) => {
  const actual = await importOriginal<typeof jobsApi>()
  return { ...actual, fetchMyJobs: vi.fn() }
})

const m = vi.mocked(api)

const PREPARED = CUSTOMER_MESSAGE_TEXT
const makeMessage = makeCustomerMessage

const sent = (overrides: Partial<CustomerMessage> = {}) =>
  makeMessage({
    status: 'sent',
    confirmed_by: 't-ali',
    confirmed_by_name: 'Ali',
    confirmed_at: '2026-10-22T07:20:00Z',
    ...overrides,
  })

const landline = (overrides: Partial<CustomerMessage> = {}) =>
  makeMessage({ channel: 'phone', phone: '60312345678', ...overrides })

/** The database's copy of the latest message; the panel reloads it after each write. */
let latest: CustomerMessage | null

function renderPanel(props: { orderStatus?: OrderStatus; canManage?: boolean } = {}) {
  return render(
    <CustomerMessagePanel orderId="o-1" orderStatus={props.orderStatus ?? 'job_done'} canManage={props.canManage ?? true} />,
  )
}

const panel = async () => within(await screen.findByRole('region', { name: 'Customer message' }))

beforeEach(() => {
  vi.resetAllMocks()
  latest = makeMessage()
  m.fetchLatestCustomerMessage.mockImplementation(async () => latest)
  m.fetchLatestCustomerMessages.mockResolvedValue({})
  m.editCustomerMessage.mockResolvedValue()
  m.confirmCustomerMessage.mockResolvedValue()
})

describe('WhatsApp message, not sent', () => {
  it('shows the message, the badge, Edit, and a Send link that opens WhatsApp with the text', async () => {
    renderPanel()
    const p = await panel()
    expect(p.getByText(PREPARED)).toBeTruthy()
    expect(p.getByText('Customer not told yet')).toBeTruthy()
    expect(p.queryByText(/^Edited by/)).toBeNull()

    const send = p.getByRole('link', { name: /Send to customer on WhatsApp/ }) as HTMLAnchorElement
    expect(send.getAttribute('target')).toBe('_blank')
    expect(send.getAttribute('rel')).toBe('noopener noreferrer')
    const url = new URL(send.href)
    expect(url.origin + url.pathname).toBe('https://wa.me/60123456789')
    expect(url.searchParams.get('text')).toBe(PREPARED)
    expect((p.getByRole('button', { name: 'Edit message' }) as HTMLButtonElement).disabled).toBe(false)
    expect(m.fetchLatestCustomerMessage).toHaveBeenCalledWith('o-1')
  })

  it('asks "Have you sent it to the customer?" when Send is tapped, and No changes nothing', async () => {
    const user = userEvent.setup()
    renderPanel()
    const p = await panel()
    expect(screen.queryByRole('dialog')).toBeNull()

    await user.click(p.getByRole('link', { name: /Send to customer on WhatsApp/ }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Have you sent it to the customer?' }))
    await user.click(dialog.getByRole('button', { name: 'No, not yet' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(m.confirmCustomerMessage).not.toHaveBeenCalled()
    expect(p.getByText('Customer not told yet')).toBeTruthy()
    expect(p.getByRole('link', { name: /Send to customer on WhatsApp/ })).toBeTruthy()
  })

  it('Yes confirms, shows who and when, and disables Send and Edit for good', async () => {
    const user = userEvent.setup()
    m.confirmCustomerMessage.mockImplementation(async () => {
      latest = sent()
    })
    renderPanel()
    const p = await panel()
    await user.click(p.getByRole('link', { name: /Send to customer on WhatsApp/ }))
    await user.click(await screen.findByRole('button', { name: 'Yes, I sent it' }))

    expect(await p.findByText('Sent by Ali at Thu 22 Oct 2026, 3:20 PM')).toBeTruthy()
    expect(m.confirmCustomerMessage).toHaveBeenCalledWith('m-1')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(p.queryByText('Customer not told yet')).toBeNull()
    expect(p.queryByRole('link', { name: /Send to customer on WhatsApp/ })).toBeNull()
    expect((p.getByRole('button', { name: 'Send to customer on WhatsApp' }) as HTMLButtonElement).disabled).toBe(true)
    expect((p.getByRole('button', { name: 'Edit message' }) as HTMLButtonElement).disabled).toBe(true)
    // The text that was sent stays visible.
    expect(p.getByText(PREPARED)).toBeTruthy()
  })

  it('shows "Already sent by …" when the other person confirmed first, and reloads the sent state', async () => {
    const user = userEvent.setup()
    m.confirmCustomerMessage.mockImplementation(async () => {
      latest = sent({ confirmed_by_name: 'Bala', confirmed_at: '2026-10-22T07:19:00Z' })
      throw new api.ApiError('Already sent by Bala at Thu 22 Oct 2026, 3:19 PM')
    })
    renderPanel()
    const p = await panel()
    await user.click(p.getByRole('link', { name: /Send to customer on WhatsApp/ }))
    await user.click(await screen.findByRole('button', { name: 'Yes, I sent it' }))

    expect((await p.findByRole('alert')).textContent).toBe('Already sent by Bala at Thu 22 Oct 2026, 3:19 PM')
    expect(await p.findByText('Sent by Bala at Thu 22 Oct 2026, 3:19 PM')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect((p.getByRole('button', { name: 'Send to customer on WhatsApp' }) as HTMLButtonElement).disabled).toBe(true)
    expect(m.fetchLatestCustomerMessage).toHaveBeenCalledTimes(2)
  })

  it('keeps the question open when the connection is lost, so Yes can be tried again', async () => {
    const user = userEvent.setup()
    m.confirmCustomerMessage.mockRejectedValueOnce(new api.ApiError('Could not reach the server. Check your connection and try again.'))
    m.confirmCustomerMessage.mockImplementationOnce(async () => {
      latest = sent()
    })
    renderPanel()
    const p = await panel()
    await user.click(p.getByRole('link', { name: /Send to customer on WhatsApp/ }))
    await user.click(await screen.findByRole('button', { name: 'Yes, I sent it' }))

    const dialog = within(await screen.findByRole('dialog'))
    expect((await dialog.findByRole('alert')).textContent).toContain('Could not reach the server')
    await user.click(dialog.getByRole('button', { name: 'Yes, I sent it' }))
    expect(await p.findByText('Sent by Ali at Thu 22 Oct 2026, 3:20 PM')).toBeTruthy()
    expect(m.confirmCustomerMessage).toHaveBeenCalledTimes(2)
  })

  it('does not offer a second tap while the first Yes is being saved', async () => {
    const user = userEvent.setup()
    let finish: () => void = () => undefined
    m.confirmCustomerMessage.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = () => {
            latest = sent()
            resolve()
          }
        }),
    )
    renderPanel()
    const p = await panel()
    await user.click(p.getByRole('link', { name: /Send to customer on WhatsApp/ }))
    await user.click(await screen.findByRole('button', { name: 'Yes, I sent it' }))
    const saving = (await screen.findByRole('button', { name: 'Saving…' })) as HTMLButtonElement
    expect(saving.disabled).toBe(true)
    finish()
    expect(await p.findByText('Sent by Ali at Thu 22 Oct 2026, 3:20 PM')).toBeTruthy()
    expect(m.confirmCustomerMessage).toHaveBeenCalledTimes(1)
  })
})

describe('Editing the message before sending', () => {
  it('opens a labelled box with the current text, and Cancel throws the change away', async () => {
    const user = userEvent.setup()
    renderPanel()
    const p = await panel()
    await user.click(p.getByRole('button', { name: 'Edit message' }))

    const box = p.getByLabelText('Message to send to the customer') as HTMLTextAreaElement
    expect(box.value).toBe(PREPARED)
    await user.clear(box)
    await user.type(box, 'Something else')
    await user.click(p.getByRole('button', { name: 'Cancel' }))

    expect(p.queryByLabelText('Message to send to the customer')).toBeNull()
    expect(p.getByText(PREPARED)).toBeTruthy()
    expect(m.editCustomerMessage).not.toHaveBeenCalled()
  })

  it('saves the trimmed text, then shows "Edited by X at T" and a Show original toggle', async () => {
    const user = userEvent.setup()
    m.editCustomerMessage.mockImplementation(async (_id, body) => {
      latest = makeMessage({
        body,
        edited_by: 't-ali',
        edited_by_name: 'Ali',
        edited_at: '2026-10-22T07:18:00Z',
      })
    })
    renderPanel()
    const p = await panel()
    await user.click(p.getByRole('button', { name: 'Edit message' }))
    const box = p.getByLabelText('Message to send to the customer')
    await user.clear(box)
    await user.type(box, '  Hi Puan Lim, your job is done.  ')
    await user.click(p.getByRole('button', { name: 'Save message' }))

    expect(await p.findByText('Edited by Ali at Thu 22 Oct 2026, 3:18 PM')).toBeTruthy()
    expect(m.editCustomerMessage).toHaveBeenCalledWith('m-1', 'Hi Puan Lim, your job is done.')
    expect(p.getByText('Hi Puan Lim, your job is done.')).toBeTruthy()
    expect(p.queryByLabelText('Message to send to the customer')).toBeNull()
    // The Send link carries the edited text.
    const send = p.getByRole('link', { name: /Send to customer on WhatsApp/ }) as HTMLAnchorElement
    expect(new URL(send.href).searchParams.get('text')).toBe('Hi Puan Lim, your job is done.')

    expect(p.queryByText('Original message')).toBeNull()
    const toggle = p.getByRole('button', { name: 'Show original' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    await user.click(toggle)
    expect(p.getByText('Original message')).toBeTruthy()
    expect(p.getByText(PREPARED)).toBeTruthy()
    await user.click(p.getByRole('button', { name: 'Hide original' }))
    expect(p.queryByText('Original message')).toBeNull()
  })

  it('does not call the database when the text is unchanged', async () => {
    const user = userEvent.setup()
    renderPanel()
    const p = await panel()
    await user.click(p.getByRole('button', { name: 'Edit message' }))
    await user.click(p.getByRole('button', { name: 'Save message' }))
    expect(p.queryByLabelText('Message to send to the customer')).toBeNull()
    expect(m.editCustomerMessage).not.toHaveBeenCalled()
    expect(p.queryByText(/^Edited by/)).toBeNull()
  })

  it('rejects empty and over-long text on the screen', async () => {
    const user = userEvent.setup()
    renderPanel()
    const p = await panel()
    await user.click(p.getByRole('button', { name: 'Edit message' }))
    const box = p.getByLabelText('Message to send to the customer') as HTMLTextAreaElement

    await user.clear(box)
    await user.click(p.getByRole('button', { name: 'Save message' }))
    expect(p.getByText('Enter the message to send')).toBeTruthy()
    expect(box.getAttribute('aria-invalid')).toBe('true')

    await user.click(box)
    await user.paste('a'.repeat(1001))
    await user.click(p.getByRole('button', { name: 'Save message' }))
    expect(p.getByText('The message can be at most 1,000 characters')).toBeTruthy()
    expect(m.editCustomerMessage).not.toHaveBeenCalled()
  })

  it('shows the database error and reloads when the message was sent meanwhile', async () => {
    const user = userEvent.setup()
    m.editCustomerMessage.mockImplementation(async () => {
      latest = sent({ confirmed_by_name: 'Bala', confirmed_at: '2026-10-22T07:19:00Z' })
      throw new api.ApiError('Already sent by Bala at Thu 22 Oct 2026, 3:19 PM')
    })
    renderPanel()
    const p = await panel()
    await user.click(p.getByRole('button', { name: 'Edit message' }))
    const box = p.getByLabelText('Message to send to the customer')
    await user.type(box, ' Thanks!')
    await user.click(p.getByRole('button', { name: 'Save message' }))

    expect(await p.findByText('Sent by Bala at Thu 22 Oct 2026, 3:19 PM')).toBeTruthy()
    expect(p.getByRole('alert').textContent).toBe('Already sent by Bala at Thu 22 Oct 2026, 3:19 PM')
    expect(p.queryByLabelText('Message to send to the customer')).toBeNull()
    expect((p.getByRole('button', { name: 'Edit message' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('keeps the typed text when the connection is lost', async () => {
    const user = userEvent.setup()
    m.editCustomerMessage.mockRejectedValue(new api.ApiError('Could not reach the server. Check your connection and try again.'))
    renderPanel()
    const p = await panel()
    await user.click(p.getByRole('button', { name: 'Edit message' }))
    const box = p.getByLabelText('Message to send to the customer') as HTMLTextAreaElement
    await user.type(box, ' Thanks!')
    await user.click(p.getByRole('button', { name: 'Save message' }))
    expect((await p.findByRole('alert')).textContent).toContain('Could not reach the server')
    expect(box.value).toBe(`${PREPARED} Thanks!`)
  })
})

describe('Landline customer', () => {
  // jsdom cannot open a tel: link; the tap still reaches the panel's own handler.
  const stopNavigation = (e: Event) => e.preventDefault()
  beforeEach(() => {
    latest = landline()
    document.addEventListener('click', stopNavigation)
  })
  afterEach(() => document.removeEventListener('click', stopNavigation))

  it('says to call, offers a Call link, and no Send or Edit', async () => {
    renderPanel()
    const p = await panel()
    expect(p.getByText('No WhatsApp number for this customer (landline). Call them instead.')).toBeTruthy()
    expect(p.getByText('Customer not told yet')).toBeTruthy()
    expect(p.getByRole('link', { name: 'Call the customer' }).getAttribute('href')).toBe('tel:+60312345678')
    expect(p.queryByRole('link', { name: /WhatsApp/ })).toBeNull()
    expect(p.queryByRole('button', { name: 'Edit message' })).toBeNull()
    expect(p.queryByText(PREPARED)).toBeNull()
  })

  it('asks whether the customer picked up; No changes nothing', async () => {
    const user = userEvent.setup()
    renderPanel()
    const p = await panel()
    await user.click(p.getByRole('link', { name: 'Call the customer' }))
    const dialog = within(
      await screen.findByRole('dialog', { name: 'Did the customer pick up, and did you tell them the job is done?' }),
    )
    await user.click(dialog.getByRole('button', { name: 'No, not yet' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(m.confirmCustomerMessage).not.toHaveBeenCalled()
    expect(p.getByText('Customer not told yet')).toBeTruthy()
  })

  it('Yes records "Told by phone by X at T" and disables Call', async () => {
    const user = userEvent.setup()
    m.confirmCustomerMessage.mockImplementation(async () => {
      latest = landline({
        status: 'told_by_phone',
        confirmed_by: 't-ali',
        confirmed_by_name: 'Ali',
        confirmed_at: '2026-10-22T07:20:00Z',
      })
    })
    renderPanel()
    const p = await panel()
    await user.click(p.getByRole('link', { name: 'Call the customer' }))
    await user.click(await screen.findByRole('button', { name: 'Yes, I told them by phone' }))

    expect(await p.findByText('Told by phone by Ali at Thu 22 Oct 2026, 3:20 PM')).toBeTruthy()
    expect(m.confirmCustomerMessage).toHaveBeenCalledWith('m-1')
    expect(p.queryByText('Customer not told yet')).toBeNull()
    expect(p.queryByRole('link', { name: 'Call the customer' })).toBeNull()
    expect((p.getByRole('button', { name: 'Call the customer' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('When the panel shows nothing, or only the state', () => {
  it.each(['new', 'assigned', 'acknowledged', 'in_progress', 'cancelled'] as const)(
    'shows nothing and asks for nothing while the order is %s',
    async (status) => {
      const { container } = renderPanel({ orderStatus: status })
      // Let the load settle.
      await waitFor(() => expect(container.textContent).toBe(''))
      expect(m.fetchLatestCustomerMessage).not.toHaveBeenCalled()
    },
  )

  it.each(['job_done', 'reviewed', 'closed'] as const)('offers the message while the order is %s', async (status) => {
    renderPanel({ orderStatus: status })
    expect((await panel()).getByText(PREPARED)).toBeTruthy()
  })

  it('shows nothing when the order has no message (or the person cannot see it)', async () => {
    latest = null
    const { container } = renderPanel()
    await waitFor(() => expect(m.fetchLatestCustomerMessage).toHaveBeenCalled())
    await waitFor(() => expect(container.textContent).toBe(''))
  })

  it('shows the state without buttons when the person cannot manage the message', async () => {
    latest = sent()
    renderPanel({ canManage: false })
    const p = await panel()
    expect(p.getByText('Sent by Ali at Thu 22 Oct 2026, 3:20 PM')).toBeTruthy()
    expect(p.queryByRole('button')).toBeNull()
    expect(p.queryByRole('link')).toBeNull()
  })

  it('hides the buttons but keeps the badge for a read-only view of an unsent message', async () => {
    renderPanel({ canManage: false })
    const p = await panel()
    expect(p.getByText('Customer not told yet')).toBeTruthy()
    expect(p.queryByRole('button', { name: 'Edit message' })).toBeNull()
    expect(p.queryByRole('link')).toBeNull()
  })

  it('shows the load error and tries again', async () => {
    const user = userEvent.setup()
    m.fetchLatestCustomerMessage.mockRejectedValueOnce(new api.ApiError('Could not reach the server. Check your connection and try again.'))
    renderPanel()
    const p = await panel()
    expect(p.getByRole('alert').textContent).toContain('Could not load the customer message.')
    await user.click(p.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText(PREPARED)).toBeTruthy()
  })

  it('offers the new message after a rework resubmission', async () => {
    const { rerender } = renderPanel()
    expect(await (await panel()).findByText(PREPARED)).toBeTruthy()
    rerender(<CustomerMessagePanel orderId="o-1" orderStatus="in_progress" canManage />)
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Customer message' })).toBeNull())

    const second = makeMessage({ id: 'm-2', body: 'Second message', prepared_body: 'Second message' })
    latest = second
    rerender(<CustomerMessagePanel orderId="o-1" orderStatus="job_done" canManage />)
    expect(await (await panel()).findByText('Second message')).toBeTruthy()
  })
})

describe('Phone-width layout (375 px)', () => {
  it('gives every control in every state a visible label', async () => {
    const user = userEvent.setup()
    renderPanel()
    const p = await panel()
    const everyControlHasText = (scope: ReturnType<typeof within>) => {
      for (const control of [...scope.queryAllByRole('button'), ...scope.queryAllByRole('link')]) {
        expect((control.textContent ?? '').replace(/\s+/g, ' ').trim()).not.toBe('')
      }
    }
    everyControlHasText(p)

    // The question.
    await user.click(p.getByRole('link', { name: /Send to customer on WhatsApp/ }))
    const dialog = within(await screen.findByRole('dialog'))
    everyControlHasText(dialog)
    await user.click(dialog.getByRole('button', { name: 'No, not yet' }))

    // The edit box: a real <label> for the textarea, plus visible Save / Cancel.
    await user.click(p.getByRole('button', { name: 'Edit message' }))
    const box = p.getByLabelText('Message to send to the customer')
    expect(box.tagName).toBe('TEXTAREA')
    expect(document.querySelector(`label[for="${box.id}"]`)?.textContent).toBe('Message to send to the customer')
    everyControlHasText(p)
  })

  it('stacks the buttons on a narrow screen and puts them side by side from sm up', async () => {
    renderPanel()
    const p = await panel()
    const row = p.getByRole('button', { name: 'Edit message' }).parentElement
    expect(row?.className).toContain('flex-col')
    expect(row?.className).toContain('sm:flex-row')
    // Tap targets are at least 44 px tall.
    expect(p.getByRole('button', { name: 'Edit message' }).className).toContain('min-h-11')
    expect(p.getByRole('link', { name: /Send to customer on WhatsApp/ }).className).toContain('min-h-11')
  })
})

describe('Customer not told yet badge', () => {
  it('is a small labelled flag', () => {
    render(<CustomerNotToldBadge />)
    expect(screen.getByText('Customer not told yet')).toBeTruthy()
  })
})

describe('Badge on the Submitted job cards', () => {
  const renderList = (url: string) =>
    render(
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/jobs" element={<JobListPage />} />
        </Routes>
      </MemoryRouter>,
    )

  it('flags a job whose customer is not told and leaves a told one alone, using one query', async () => {
    vi.mocked(jobsApi.fetchMyJobs).mockResolvedValue([
      makeOrder({ id: 'a', order_no: 'ORDER1001', status: 'job_done' }),
      makeOrder({ id: 'b', order_no: 'ORDER1002', status: 'job_done' }),
      makeOrder({ id: 'c', order_no: 'ORDER1003', status: 'reviewed' }),
    ])
    m.fetchLatestCustomerMessages.mockResolvedValue({
      a: makeMessage({ id: 'm-a', order_id: 'a' }),
      b: sent({ id: 'm-b', order_id: 'b' }),
      // Order c has no message at all (not visible, or finished before this feature).
    })
    renderList('/jobs?tab=submitted')

    const flagged = await screen.findByRole('link', { name: /ORDER1001/ })
    expect(within(flagged).getByText('Customer not told yet')).toBeTruthy()
    expect(within(screen.getByRole('link', { name: /ORDER1002/ })).queryByText('Customer not told yet')).toBeNull()
    expect(within(screen.getByRole('link', { name: /ORDER1003/ })).queryByText('Customer not told yet')).toBeNull()
    expect(m.fetchLatestCustomerMessages).toHaveBeenCalledTimes(1)
    expect(m.fetchLatestCustomerMessages).toHaveBeenCalledWith(['a', 'b', 'c'])
  })

  it('does not ask for messages on the Open tab', async () => {
    vi.mocked(jobsApi.fetchMyJobs).mockResolvedValue([makeOrder({ id: 'a', order_no: 'ORDER1001' })])
    renderList('/jobs')
    expect(await screen.findByRole('link', { name: /ORDER1001/ })).toBeTruthy()
    expect(m.fetchLatestCustomerMessages).not.toHaveBeenCalled()
  })

  it('shows the list error when the messages cannot be read', async () => {
    vi.mocked(jobsApi.fetchMyJobs).mockResolvedValue([makeOrder({ id: 'a', status: 'job_done' })])
    m.fetchLatestCustomerMessages.mockRejectedValue(new api.ApiError('Could not reach the server. Check your connection and try again.'))
    renderList('/jobs?tab=submitted')
    expect(await screen.findByText('Could not load your jobs')).toBeTruthy()
  })
})
