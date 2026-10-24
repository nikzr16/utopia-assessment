// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { JobFilesStatus } from '../../src/features/attachments'
import * as api from '../../src/features/jobs/api'
import { CompletionPage } from '../../src/features/jobs/CompletionPage'
import { NETWORK_ERROR_MESSAGE } from '../../src/lib/api'
import { makeOrder } from './fixtures'

// The file uploader has its own tests (job-files.test.tsx); here it only
// reports a status the test controls.
let filesStatus: JobFilesStatus = { count: 1, busy: false, failed: 0 }
vi.mock('../../src/features/attachments', () => ({
  JobFiles: ({ onStatus }: { onStatus?: (s: JobFilesStatus) => void }) => {
    useEffect(() => onStatus?.(filesStatus), [onStatus])
    return <p>Files go here</p>
  },
}))
vi.mock('../../src/features/jobs/api', async (importOriginal) => {
  const actual = await importOriginal<typeof api>()
  return { ...actual, fetchJob: vi.fn(), submitCompletion: vi.fn() }
})

const m = vi.mocked(api)
const DRAFT = 'sejuk-draft:completion:o-1'

function detail(overrides: Partial<api.JobDetail> = {}, order: Parameters<typeof makeOrder>[0] = {}): api.JobDetail {
  return {
    job: makeOrder({ status: 'in_progress', quoted_price: 180, ...order }),
    completion: null,
    payments: [],
    rework: null,
    ...overrides,
  }
}

function Where() {
  const l = useLocation()
  return <p data-testid="where">{l.pathname + l.search}</p>
}

function renderForm() {
  return render(
    <MemoryRouter initialEntries={['/jobs/ORDER1001/complete']}>
      <Routes>
        <Route path="/jobs/:orderNo/complete" element={<CompletionPage />} />
        <Route path="/jobs/:orderNo" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
}

const form = () => within(screen.getByRole('form', { name: 'Complete job' }))

beforeEach(() => {
  vi.resetAllMocks()
  window.localStorage.clear()
  filesStatus = { count: 1, busy: false, failed: 0 }
  m.fetchJob.mockResolvedValue(detail())
  m.submitCompletion.mockResolvedValue()
})

describe('The brief’s completion form (AC5)', () => {
  it('has every field, with Order ID, technician and timestamp read-only', async () => {
    renderForm()
    await screen.findByRole('heading', { name: 'Complete job' })
    const f = form()
    expect(f.getByText('Order ID').nextElementSibling?.textContent).toBe('ORDER1001')
    expect(f.getByLabelText('Work done')).toBeTruthy()
    expect(f.getByLabelText(/Extra charges/).getAttribute('inputmode')).toBe('decimal')
    expect(f.getByText('Files go here')).toBeTruthy()
    expect(f.getByLabelText(/Remarks/)).toBeTruthy()
    expect(f.getByText('Technician').nextElementSibling?.textContent).toBe('Ali')
    expect(f.getByText('Timestamp').nextElementSibling?.textContent).toBe('Recorded when you submit')
  })

  it('works out the final amount as the technician types', async () => {
    const user = userEvent.setup()
    renderForm()
    const extra = await screen.findByLabelText(/Extra charges/)
    const output = () => document.querySelector('output')!
    expect(output().textContent).toBe('RM 180.00')
    await user.type(extra, '45.5')
    expect(output().textContent).toBe('RM 225.50')
    await user.type(extra, 'x')
    expect(output().textContent).toBe('—')
  })
})

describe('Checking before submitting (AC6)', () => {
  it('needs the work done, and remarks with extra charges', async () => {
    const user = userEvent.setup()
    renderForm()
    await user.type(await screen.findByLabelText(/Extra charges/), '50')
    await user.click(screen.getByRole('button', { name: 'Submit job' }))
    expect(screen.getByText('Describe the work done before submitting')).toBeTruthy()
    expect(screen.getByText('Explain the extra charges in the remarks')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByLabelText('Work done'))
    expect(m.submitCompletion).not.toHaveBeenCalled()
  })

  it.each([
    [{ count: 1, busy: true, failed: 0 }, 'Wait for the files to finish uploading.'],
    [{ count: 1, busy: false, failed: 1 }, 'Retry or remove the files that did not upload.'],
  ])('waits for files: %j', async (status, message) => {
    filesStatus = status
    const user = userEvent.setup()
    renderForm()
    await user.type(await screen.findByLabelText('Work done'), 'Cleaned')
    await user.click(screen.getByRole('button', { name: 'Submit job' }))
    expect((await screen.findByRole('alert')).textContent).toBe(message)
    expect(m.submitCompletion).not.toHaveBeenCalled()
  })
})

describe('Submitting (AC8)', () => {
  it('submits through submit_completion and goes back to the job', async () => {
    const user = userEvent.setup()
    renderForm()
    await user.type(await screen.findByLabelText('Work done'), 'Cleaned filters')
    await user.type(screen.getByLabelText(/Extra charges/), '40')
    await user.type(screen.getByLabelText(/Remarks/), 'New filter')
    await user.click(screen.getByRole('button', { name: 'Submit job' }))
    expect(m.submitCompletion).toHaveBeenCalledWith('o-1', {
      workDone: 'Cleaned filters',
      extraCharges: 40,
      remarks: 'New filter',
    })
    expect((await screen.findByTestId('where')).textContent).toBe('/jobs/ORDER1001?submitted=1')
    expect(window.localStorage.getItem(DRAFT)).toBeNull()
  })

  it('asks before submitting without photos (PRD Q6)', async () => {
    filesStatus = { count: 0, busy: false, failed: 0 }
    const user = userEvent.setup()
    renderForm()
    await user.type(await screen.findByLabelText('Work done'), 'Cleaned')
    await user.click(screen.getByRole('button', { name: 'Submit job' }))
    const dialog = within(screen.getByRole('dialog', { name: 'Submit without photos?' }))
    await user.click(dialog.getByRole('button', { name: 'Add photos' }))
    expect(m.submitCompletion).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Submit job' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Submit without photos' }))
    expect(m.submitCompletion).toHaveBeenCalledTimes(1)
  })

  it('submits once, however often Submit is tapped (AC13)', async () => {
    let finish: () => void = () => {}
    m.submitCompletion.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)))
    const user = userEvent.setup()
    renderForm()
    await user.type(await screen.findByLabelText('Work done'), 'Cleaned')
    const button = screen.getByRole('button', { name: 'Submit job' })
    await user.click(button)
    await user.click(button)
    expect(m.submitCompletion).toHaveBeenCalledTimes(1)
    finish()
    await screen.findByTestId('where')
  })

  it('treats a lost answer as success when the job did become Job Done', async () => {
    m.submitCompletion.mockRejectedValue(new api.ApiError(NETWORK_ERROR_MESSAGE))
    m.fetchJob.mockResolvedValueOnce(detail()).mockResolvedValue(detail({}, { status: 'job_done' }))
    const user = userEvent.setup()
    renderForm()
    await user.type(await screen.findByLabelText('Work done'), 'Cleaned')
    await user.click(screen.getByRole('button', { name: 'Submit job' }))
    expect((await screen.findByTestId('where')).textContent).toBe('/jobs/ORDER1001?submitted=1')
  })

  it('keeps everything and says so when the connection fails', async () => {
    m.submitCompletion.mockRejectedValue(new api.ApiError(NETWORK_ERROR_MESSAGE))
    const user = userEvent.setup()
    renderForm()
    await user.type(await screen.findByLabelText('Work done'), 'Cleaned')
    await user.click(screen.getByRole('button', { name: 'Submit job' }))
    expect((await screen.findByRole('alert')).textContent).toBe(NETWORK_ERROR_MESSAGE)
    expect((screen.getByLabelText('Work done') as HTMLTextAreaElement).value).toBe('Cleaned')
  })
})

describe('Drafts and rework (PRD Q15, Q16)', () => {
  it('keeps typed text on the phone and restores it', async () => {
    const user = userEvent.setup()
    const first = renderForm()
    await user.type(await screen.findByLabelText('Work done'), 'Half typed')
    expect(JSON.parse(window.localStorage.getItem(DRAFT)!).workDone).toBe('Half typed')
    first.unmount()

    renderForm()
    expect(((await screen.findByLabelText('Work done')) as HTMLTextAreaElement).value).toBe('Half typed')
    expect(screen.getByText('Restored what you typed earlier on this phone.')).toBeTruthy()
  })

  it('pre-fills a returned job with the previous record', async () => {
    m.fetchJob.mockResolvedValue(
      detail({
        completion: {
          work_done: 'Cleaned filters',
          extra_charges: 40,
          remarks: 'New filter',
          completed_at: '2026-10-26T05:00:00Z',
          technician_name: 'Ali',
        },
        rework: { note: 'Redo', by: 'Nurul Huda', at: '2026-10-26T07:00:00Z' },
      }),
    )
    renderForm()
    expect(((await screen.findByLabelText('Work done')) as HTMLTextAreaElement).value).toBe('Cleaned filters')
    expect((screen.getByLabelText(/Extra charges/) as HTMLInputElement).value).toBe('40.00')
    expect((screen.getByLabelText(/Remarks/) as HTMLTextAreaElement).value).toBe('New filter')
  })

  it('refuses a job that is not In Progress', async () => {
    m.fetchJob.mockResolvedValue(detail({}, { status: 'job_done' }))
    renderForm()
    expect(await screen.findByText('Already submitted')).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole('form')).toBeNull())
  })
})
