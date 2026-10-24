// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as filesApi from '../../src/features/attachments/api'
import * as api from '../../src/features/orders/api'
import { NewOrderPage } from '../../src/features/orders/NewOrderPage'
import { reference } from './fixtures'

// 0009 Document Understanding: "Read from photo" on the New Order form. The
// ai-assist call is replaced by a test double; the real model is checked in
// the hosted manual check.

vi.mock('../../src/features/orders/api', async (importOriginal) => {
  const actual = await importOriginal<typeof api>()
  return { ...actual, fetchReferenceData: vi.fn(), createOrder: vi.fn(), readOrderFormPhoto: vi.fn() }
})
vi.mock('../../src/features/attachments/api', async (importOriginal) => {
  const actual = await importOriginal<typeof filesApi>()
  return { ...actual, saveOrderForm: vi.fn() }
})

const m = vi.mocked(api)
const files = vi.mocked(filesApi)

function Where() {
  const location = useLocation()
  return <p data-testid="location">{location.pathname + location.search}</p>
}

async function renderPage() {
  render(
    <MemoryRouter initialEntries={['/orders/new']}>
      <Routes>
        <Route path="/orders/new" element={<NewOrderPage adminBranchName="Shah Alam" />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
  await screen.findByRole('form', { name: 'New order' })
}

const photo = () => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])], 'form.jpg', { type: 'image/jpeg' })
const pick = (user: ReturnType<typeof userEvent.setup>, file: File) =>
  user.upload(screen.getByLabelText('Photo or PDF of the order form'), file)

const READ: api.ReadFormFields = {
  customerName: 'Tan Ah Kow',
  serviceTypeId: 'st-repair',
  serviceTypeName: 'Repair',
  problemDescription: 'aircond bocor air',
  quotedPrice: '250.00',
  scheduledDate: '2026-10-28',
  scheduledTime: null,
}

beforeEach(() => {
  vi.resetAllMocks()
  m.fetchReferenceData.mockResolvedValue(reference)
})

describe('Read from photo (0009)', () => {
  it('fills the five fields from a clear form, keeping the text as written, and saves nothing yet', async () => {
    m.readOrderFormPhoto.mockResolvedValue({ ok: true, fields: READ })
    const user = userEvent.setup({ applyAccept: false })
    await renderPage()
    await pick(user, photo())
    expect(await screen.findByText(/Filled from the photo: customer, service type, problem description, quoted price, date/)).toBeTruthy()
    expect(screen.getByText(/No time was on the form: the time is set to 09:00/)).toBeTruthy()
    expect((screen.getByLabelText('Customer name') as HTMLInputElement).value).toBe('Tan Ah Kow')
    expect((screen.getByLabelText('Service type') as HTMLSelectElement).value).toBe('st-repair')
    expect((screen.getByLabelText('Problem description') as HTMLTextAreaElement).value).toBe('aircond bocor air')
    expect((screen.getByLabelText('Quoted price (RM)') as HTMLInputElement).value).toBe('250.00')
    expect((screen.getByLabelText('Scheduled date and time (optional)') as HTMLInputElement).value).toBe('2026-10-28T09:00')
    // Phone and address are typed by the Admin (PRD Q22).
    expect((screen.getByLabelText('Phone') as HTMLInputElement).value).toBe('')
    expect(screen.getByText('“form.jpg” will be saved with the order as its order form.')).toBeTruthy()
    expect(m.createOrder).not.toHaveBeenCalled()
    expect(m.readOrderFormPhoto).toHaveBeenCalledWith(expect.any(Blob), 'image/jpeg', 'form.jpg')
  })

  it('fills nothing when the form is unclear, and says so', async () => {
    m.readOrderFormPhoto.mockResolvedValue({
      ok: false,
      message: "Couldn't read this form clearly. Try a clearer photo or fill the form by hand.",
    })
    const user = userEvent.setup({ applyAccept: false })
    await renderPage()
    await pick(user, photo())
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText("Couldn't read this form clearly. Try a clearer photo or fill the form by hand.")).toBeTruthy()
    expect((screen.getByLabelText('Customer name') as HTMLInputElement).value).toBe('')
  })

  it('refuses other file types before asking the AI', async () => {
    const user = userEvent.setup({ applyAccept: false })
    await renderPage()
    await pick(user, new File(['GIF89a'], 'form.gif', { type: 'image/gif' }))
    expect(await screen.findByText('Use a photo (JPG, PNG or WebP) or a PDF')).toBeTruthy()
    expect(m.readOrderFormPhoto).not.toHaveBeenCalled()
  })

  it('saves the order, then keeps the photo as its order form', async () => {
    m.readOrderFormPhoto.mockResolvedValue({ ok: true, fields: READ })
    m.createOrder.mockResolvedValue({ id: 'o-9', orderNo: 'ORDER1009' })
    files.saveOrderForm.mockResolvedValue({} as filesApi.Attachment)
    const user = userEvent.setup({ applyAccept: false })
    await renderPage()
    await pick(user, photo())
    await screen.findByText(/Filled from the photo/)
    await user.type(screen.getByLabelText('Phone'), '012-345 6789')
    await user.type(screen.getByLabelText('Address'), '8 Jalan Kenanga, Shah Alam')
    await user.click(screen.getByRole('button', { name: 'Save order' }))
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/orders/ORDER1009?created=1'))
    expect(m.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({ customerName: 'Tan Ah Kow', problemDescription: 'aircond bocor air', quotedPrice: 250 }),
    )
    expect(files.saveOrderForm).toHaveBeenCalledWith('o-9', expect.any(Blob), 'image/jpeg', 'form.jpg', null)
  })

  it('keeps the saved order and offers Try again when the photo could not be attached', async () => {
    m.readOrderFormPhoto.mockResolvedValue({ ok: true, fields: READ })
    m.createOrder.mockResolvedValue({ id: 'o-9', orderNo: 'ORDER1009' })
    files.saveOrderForm.mockRejectedValueOnce(new filesApi.ApiError('Could not reach the server.')).mockResolvedValueOnce(
      {} as filesApi.Attachment,
    )
    const user = userEvent.setup({ applyAccept: false })
    await renderPage()
    await pick(user, photo())
    await screen.findByText(/Filled from the photo/)
    await user.type(screen.getByLabelText('Phone'), '012-345 6789')
    await user.type(screen.getByLabelText('Address'), '8 Jalan Kenanga, Shah Alam')
    await user.click(screen.getByRole('button', { name: 'Save order' }))
    expect(await screen.findByText('Order ORDER1009 is saved, but the form photo was not attached')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/orders/ORDER1009?created=1'))
    expect(m.createOrder).toHaveBeenCalledTimes(1)
    expect(files.saveOrderForm).toHaveBeenCalledTimes(2)
  })

  it('saves without a form when the Admin removes the photo', async () => {
    m.readOrderFormPhoto.mockResolvedValue({ ok: true, fields: READ })
    m.createOrder.mockResolvedValue({ id: 'o-9', orderNo: 'ORDER1009' })
    const user = userEvent.setup({ applyAccept: false })
    await renderPage()
    await pick(user, photo())
    await screen.findByText(/Filled from the photo/)
    await user.click(screen.getByRole('button', { name: 'Remove photo' }))
    await user.type(screen.getByLabelText('Phone'), '012-345 6789')
    await user.type(screen.getByLabelText('Address'), '8 Jalan Kenanga, Shah Alam')
    await user.click(screen.getByRole('button', { name: 'Save order' }))
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/orders/ORDER1009?created=1'))
    expect(files.saveOrderForm).not.toHaveBeenCalled()
  })
})
