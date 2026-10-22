// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as filesApi from '../../src/features/attachments/api'
import type { PhotoCodec } from '../../src/features/attachments/resize'
import * as api from '../../src/features/jobs/api'
import { PaymentPage } from '../../src/features/jobs/PaymentPage'
import { NETWORK_ERROR_MESSAGE } from '../../src/lib/api'
import { makeOrder } from './fixtures'

vi.mock('../../src/features/attachments/api', async (importOriginal) => {
  const actual = await importOriginal<typeof filesApi>()
  return { ...actual, uploadFile: vi.fn(), deleteStoredFile: vi.fn() }
})
vi.mock('../../src/features/jobs/api', async (importOriginal) => {
  const actual = await importOriginal<typeof api>()
  return { ...actual, fetchJob: vi.fn(), recordPayment: vi.fn() }
})

const m = vi.mocked(api)
const files = vi.mocked(filesApi)
const DRAFT = 'sejuk-draft:payment:o-1'
const keepAsIs: PhotoCodec = { decode: async () => null, encode: async () => null }

function detail(order: Parameters<typeof makeOrder>[0] = {}): api.JobDetail {
  return {
    job: makeOrder({ status: 'job_done', final_amount: 180, balance: 180, ...order }),
    completion: null,
    payments: [],
    rework: null,
  }
}

function Where() {
  const l = useLocation()
  return <p data-testid="where">{l.pathname + l.search}</p>
}

let ids = 0
function renderForm() {
  return render(
    <MemoryRouter initialEntries={['/jobs/ORDER1001/payment']}>
      <Routes>
        <Route
          path="/jobs/:orderNo/payment"
          element={<PaymentPage codec={keepAsIs} newId={() => `id-${++ids}`} />}
        />
        <Route path="/jobs/:orderNo" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
}

const receiptInput = () => document.getElementById('payment-receipt-file') as HTMLInputElement

beforeEach(() => {
  vi.resetAllMocks()
  window.localStorage.clear()
  ids = 0
  m.fetchJob.mockResolvedValue(detail())
  m.recordPayment.mockResolvedValue()
  files.uploadFile.mockResolvedValue()
  files.deleteStoredFile.mockResolvedValue()
})

describe('Recording a payment (AC10)', () => {
  it('pre-fills the balance and records a cash payment without a receipt', async () => {
    const user = userEvent.setup()
    renderForm()
    const amount = (await screen.findByLabelText('Amount received (RM)')) as HTMLInputElement
    expect(amount.value).toBe('180.00')
    expect(amount.getAttribute('inputmode')).toBe('decimal')
    await user.click(screen.getByLabelText('Cash'))
    await user.click(screen.getByRole('button', { name: 'Record payment' }))
    expect(m.recordPayment).toHaveBeenCalledWith('o-1', { amount: 180, method: 'cash', note: null }, 'id-1', null)
    expect((await screen.findByTestId('where')).textContent).toBe('/jobs/ORDER1001?paid=1')
    expect(window.localStorage.getItem(DRAFT)).toBeNull()
  })

  it('needs a method, and a receipt for bank transfer, card or e-wallet', async () => {
    const user = userEvent.setup()
    renderForm()
    await user.click(await screen.findByRole('button', { name: 'Record payment' }))
    expect(screen.getByText('Select a payment method')).toBeTruthy()
    await user.click(screen.getByLabelText('E-wallet'))
    await user.click(screen.getByRole('button', { name: 'Record payment' }))
    expect(screen.getByText('Attach a receipt for bank transfer, card or e-wallet payments')).toBeTruthy()
    expect(m.recordPayment).not.toHaveBeenCalled()
  })

  it('uploads the receipt under receipts/ and saves it with the payment', async () => {
    const user = userEvent.setup()
    renderForm()
    await user.click(await screen.findByLabelText('Bank transfer'))
    await user.upload(receiptInput(), new File(['slip'], 'slip.jpg', { type: 'image/jpeg' }))
    expect(await screen.findByText(/✓ slip\.jpg/)).toBeTruthy()
    expect(files.uploadFile).toHaveBeenCalledWith('o-1/receipts/id-2.jpg', expect.any(File), 'image/jpeg')
    await user.click(screen.getByRole('button', { name: 'Record payment' }))
    expect(m.recordPayment).toHaveBeenCalledWith(
      'o-1',
      { amount: 180, method: 'bank_transfer', note: null },
      'id-1',
      { path: 'o-1/receipts/id-2.jpg', fileName: 'slip.jpg' },
    )
  })

  it('refuses a video as a receipt', async () => {
    const user = userEvent.setup({ applyAccept: false })
    renderForm()
    await screen.findByLabelText('Card')
    await user.upload(receiptInput(), new File(['v'], 'clip.mp4', { type: 'video/mp4' }))
    expect((await screen.findByRole('alert')).textContent).toContain('A receipt must be a photo or a PDF')
    expect(files.uploadFile).not.toHaveBeenCalled()
  })

  it('deletes a replaced receipt that was never saved', async () => {
    const user = userEvent.setup()
    renderForm()
    await screen.findByLabelText('Card')
    await user.upload(receiptInput(), new File(['a'], 'a.jpg', { type: 'image/jpeg' }))
    await screen.findByText(/✓ a\.jpg/)
    await user.click(screen.getByRole('button', { name: 'Remove receipt' }))
    expect(files.deleteStoredFile).toHaveBeenCalledWith('o-1/receipts/id-2.jpg')
    expect(screen.getByRole('button', { name: 'Add receipt' })).toBeTruthy()
  })

  it('retries a receipt upload that failed for lack of signal', async () => {
    files.uploadFile.mockRejectedValueOnce(new filesApi.ApiError(NETWORK_ERROR_MESSAGE))
    const user = userEvent.setup()
    renderForm()
    await screen.findByLabelText('Card')
    await user.upload(receiptInput(), new File(['a'], 'a.jpg', { type: 'image/jpeg' }))
    await user.click(await screen.findByRole('button', { name: 'Retry' }))
    expect(await screen.findByText(/✓ a\.jpg/)).toBeTruthy()
    expect(files.uploadFile).toHaveBeenCalledTimes(2)
  })
})

describe('More than the balance (PRD Q10)', () => {
  it('asks before recording an amount above the balance', async () => {
    const user = userEvent.setup()
    renderForm()
    const amount = await screen.findByLabelText('Amount received (RM)')
    await user.clear(amount)
    await user.type(amount, '200')
    await user.click(screen.getByLabelText('Cash'))
    await user.click(screen.getByRole('button', { name: 'Record payment' }))
    const dialog = within(screen.getByRole('dialog', { name: 'More than the balance' }))
    expect(dialog.getByText('RM 200.00 is RM 20.00 more than the balance of RM 180.00. Record it anyway?')).toBeTruthy()
    await user.click(dialog.getByRole('button', { name: 'Change amount' }))
    expect(m.recordPayment).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Record payment' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Record anyway' }))
    expect(m.recordPayment).toHaveBeenCalledWith('o-1', { amount: 200, method: 'cash', note: null }, 'id-1', null)
  })
})

describe('Never twice (AC10, AC13)', () => {
  it('reuses the same one-time key after a failure, even after a reload', async () => {
    m.recordPayment.mockRejectedValueOnce(new api.ApiError(NETWORK_ERROR_MESSAGE))
    const user = userEvent.setup()
    const first = renderForm()
    await user.click(await screen.findByLabelText('Cash'))
    await user.click(screen.getByRole('button', { name: 'Record payment' }))
    expect((await screen.findByRole('alert')).textContent).toBe(NETWORK_ERROR_MESSAGE)
    first.unmount()

    renderForm()
    expect(((await screen.findByLabelText('Cash')) as HTMLInputElement).checked).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Record payment' }))
    await waitFor(() => expect(m.recordPayment).toHaveBeenCalledTimes(2))
    expect(m.recordPayment.mock.calls[1][2]).toBe(m.recordPayment.mock.calls[0][2])
  })

  it('records once, however often the button is tapped', async () => {
    let finish: () => void = () => {}
    m.recordPayment.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)))
    const user = userEvent.setup()
    renderForm()
    await user.click(await screen.findByLabelText('Cash'))
    const button = screen.getByRole('button', { name: 'Record payment' })
    await user.click(button)
    await user.click(button)
    expect(m.recordPayment).toHaveBeenCalledTimes(1)
    finish()
    await screen.findByTestId('where')
  })
})

describe('When payments cannot be recorded', () => {
  it('says so before the job is started', async () => {
    m.fetchJob.mockResolvedValue(detail({ status: 'acknowledged' }))
    renderForm()
    expect(await screen.findByText('Payments cannot be recorded now')).toBeTruthy()
  })
})
