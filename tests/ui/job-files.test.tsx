// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../../src/features/attachments/api'
import { JobFiles, type JobFilesStatus } from '../../src/features/attachments/JobFiles'
import type { PhotoCodec } from '../../src/features/attachments/resize'
import { NETWORK_ERROR_MESSAGE } from '../../src/lib/api'
import './fixtures'

vi.mock('../../src/features/attachments/api', async (importOriginal) => {
  const actual = await importOriginal<typeof api>()
  return {
    ...actual,
    fetchJobFiles: vi.fn(),
    signedUrls: vi.fn(),
    uploadFile: vi.fn(),
    addAttachment: vi.fn(),
    deleteStoredFile: vi.fn(),
    removeAttachment: vi.fn(),
  }
})

const m = vi.mocked(api)
const ORDER = '0b6f3c1e-8a2d-4c5e-9f10-1a2b3c4d5e6f'
const MB = 1024 * 1024
const keepAsIs: PhotoCodec = { decode: async () => null, encode: async () => null }

function saved(n: number, overrides: Partial<api.Attachment> = {}): api.Attachment {
  return {
    id: `a-${n}`,
    order_id: ORDER,
    payment_id: null,
    kind: 'photo',
    storage_path: `${ORDER}/file-${n}.jpg`,
    mime_type: 'image/jpeg',
    file_name: `photo-${n}.jpg`,
    size_bytes: 300_000,
    uploaded_by: 't-ali',
    created_at: '2026-10-26T03:00:00Z',
    ...overrides,
  }
}

function file(name: string, type: string, size?: number) {
  const f = new File(['content'], name, { type })
  if (size !== undefined) Object.defineProperty(f, 'size', { value: size })
  return f
}

let ids = 0
function renderFiles(props: { canChange?: boolean; onStatus?: (s: JobFilesStatus) => void } = {}) {
  ids = 0
  const result = render(
    <JobFiles
      orderId={ORDER}
      canChange={props.canChange ?? true}
      onStatus={props.onStatus}
      codec={keepAsIs}
      newFileId={() => `00000000-0000-4000-8000-00000000000${++ids}`}
    />,
  )
  const input = () => result.container.querySelector('input[type="file"]') as HTMLInputElement
  return { ...result, input }
}

beforeEach(() => {
  vi.resetAllMocks()
  m.fetchJobFiles.mockResolvedValue([])
  m.signedUrls.mockImplementation(async (paths) => Object.fromEntries(paths.map((p) => [p, `https://signed/${p}`])))
  m.uploadFile.mockResolvedValue()
  m.addAttachment.mockImplementation(async (_orderId, path, name) => saved(99, { storage_path: path, file_name: name }))
  m.deleteStoredFile.mockResolvedValue()
  m.removeAttachment.mockResolvedValue()
})

describe('Saved files', () => {
  it('shows photos as thumbnails and other files as tiles, each opening a signed link', async () => {
    m.fetchJobFiles.mockResolvedValue([
      saved(1),
      saved(2, { kind: 'video', mime_type: 'video/mp4', file_name: 'clip.mp4', storage_path: `${ORDER}/v.mp4` }),
      saved(3, { kind: 'pdf', mime_type: 'application/pdf', file_name: 'report.pdf', storage_path: `${ORDER}/r.pdf` }),
    ])
    renderFiles({ canChange: false })
    const list = within(await screen.findByRole('list', { name: 'Job files' }))
    expect(m.fetchJobFiles).toHaveBeenCalledWith(ORDER)
    expect((await list.findByRole('img', { name: 'photo-1.jpg' })).getAttribute('src')).toBe(
      `https://signed/${ORDER}/file-1.jpg`,
    )
    expect(list.getByRole('link', { name: 'Open clip.mp4' }).getAttribute('href')).toBe(`https://signed/${ORDER}/v.mp4`)
    expect(list.getByText('PDF')).toBeTruthy()
    expect(list.queryByRole('button', { name: /Remove/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add photos, videos or PDFs' })).toBeNull()
  })

  it('removes a saved file after a confirm step', async () => {
    m.fetchJobFiles.mockResolvedValueOnce([saved(1)]).mockResolvedValue([])
    const user = userEvent.setup()
    renderFiles()
    await user.click(await screen.findByRole('button', { name: 'Remove photo-1.jpg' }))
    expect(m.removeAttachment).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    expect(m.removeAttachment).toHaveBeenCalledWith('a-1')
    expect(await screen.findByText('No files yet.')).toBeTruthy()
  })

  it('shows why a saved file could not be removed', async () => {
    m.fetchJobFiles.mockResolvedValue([saved(1)])
    m.removeAttachment.mockRejectedValue(new api.ApiError('Files can only be changed while the job is In Progress'))
    const user = userEvent.setup()
    renderFiles()
    await user.click(await screen.findByRole('button', { name: 'Remove photo-1.jpg' }))
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Files can only be changed while the job is In Progress')
  })
})

describe('Adding files (PRD Q4)', () => {
  it('uploads a chosen photo, registers it, and shows it', async () => {
    m.fetchJobFiles.mockResolvedValueOnce([]).mockResolvedValue([saved(1, { file_name: 'unit.jpg' })])
    const user = userEvent.setup()
    const { input } = renderFiles()
    await screen.findByText('No files yet.')
    await user.upload(input(), file('unit.jpg', 'image/jpeg'))
    const path = `${ORDER}/00000000-0000-4000-8000-000000000002.jpg`
    await waitFor(() => expect(m.addAttachment).toHaveBeenCalledWith(ORDER, path, 'unit.jpg'))
    expect(m.uploadFile).toHaveBeenCalledWith(path, expect.any(File), 'image/jpeg')
    expect(await screen.findByRole('img', { name: 'unit.jpg' })).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'Files being added' })).toBeNull()
  })

  it('uses the extension when the phone reports no type (HEIC)', async () => {
    const user = userEvent.setup({ applyAccept: false })
    const { input } = renderFiles()
    await screen.findByText('No files yet.')
    await user.upload(input(), file('IMG_0001.HEIC', ''))
    await waitFor(() => expect(m.uploadFile).toHaveBeenCalled())
    expect(m.uploadFile.mock.calls[0][0]).toMatch(/\.heic$/)
    expect(m.uploadFile.mock.calls[0][2]).toBe('image/heic')
  })

  it('refuses a wrong type or a file that is too large, without uploading', async () => {
    const user = userEvent.setup({ applyAccept: false })
    const { input } = renderFiles()
    await screen.findByText('No files yet.')
    await user.upload(input(), [file('notes.txt', 'text/plain'), file('long.mp4', 'video/mp4', 51 * MB)])
    const pending = within(await screen.findByRole('list', { name: 'Files being added' }))
    expect(await pending.findByText(/This file type is not allowed/)).toBeTruthy()
    expect(await pending.findByText('Videos can be at most 50 MB')).toBeTruthy()
    expect(pending.queryByRole('button', { name: 'Retry' })).toBeNull()
    expect(m.uploadFile).not.toHaveBeenCalled()
    await user.click(pending.getByRole('button', { name: 'Remove notes.txt' }))
    expect(screen.queryByText(/This file type is not allowed/)).toBeNull()
  })

  it('takes only as many files as there is room for', async () => {
    m.fetchJobFiles.mockResolvedValue([1, 2, 3, 4, 5].map((n) => saved(n)))
    m.addAttachment.mockImplementation(() => new Promise(() => {})) // stays saving
    const user = userEvent.setup()
    const { input } = renderFiles()
    await screen.findByRole('list', { name: 'Job files' })
    await user.upload(input(), [file('a.jpg', 'image/jpeg'), file('b.jpg', 'image/jpeg'), file('c.jpg', 'image/jpeg')])
    expect(await screen.findByText('A job can have at most 6 files. 2 files were not added.')).toBeTruthy()
    expect(within(screen.getByRole('list', { name: 'Files being added' })).getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByRole('button', { name: '6 files added (the maximum)' }).hasAttribute('disabled')).toBe(true)
  })
})

describe('A bad connection (PRD Q16)', () => {
  it('retries the upload after it failed for lack of signal', async () => {
    m.uploadFile.mockRejectedValueOnce(new api.ApiError(NETWORK_ERROR_MESSAGE))
    const user = userEvent.setup()
    const { input } = renderFiles()
    await screen.findByText('No files yet.')
    await user.upload(input(), file('unit.jpg', 'image/jpeg'))
    expect(await screen.findByText(NETWORK_ERROR_MESSAGE)).toBeTruthy()
    expect(m.addAttachment).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(m.addAttachment).toHaveBeenCalledTimes(1))
    expect(m.uploadFile).toHaveBeenCalledTimes(2)
    expect(m.uploadFile.mock.calls[1][0]).toBe(m.uploadFile.mock.calls[0][0]) // same path
  })

  it('retries only the save when the upload went through', async () => {
    m.addAttachment.mockRejectedValueOnce(new api.ApiError(NETWORK_ERROR_MESSAGE))
    const user = userEvent.setup()
    const { input } = renderFiles()
    await screen.findByText('No files yet.')
    await user.upload(input(), file('unit.jpg', 'image/jpeg'))
    await user.click(await screen.findByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(m.addAttachment).toHaveBeenCalledTimes(2))
    expect(m.uploadFile).toHaveBeenCalledTimes(1)
    expect(m.deleteStoredFile).not.toHaveBeenCalled()
  })

  it('cleans up the stored copy when a rule refuses the file', async () => {
    m.addAttachment.mockRejectedValue(new api.ApiError('Files can only be changed while the job is In Progress (it is currently Job Done)'))
    const user = userEvent.setup()
    const { input } = renderFiles()
    await screen.findByText('No files yet.')
    await user.upload(input(), file('unit.jpg', 'image/jpeg'))
    expect(await screen.findByText(/Files can only be changed while the job is In Progress/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    expect(m.deleteStoredFile).toHaveBeenCalledWith(m.uploadFile.mock.calls[0][0])
  })

  it('deletes an uploaded but unsaved file when the technician removes it', async () => {
    m.addAttachment.mockRejectedValue(new api.ApiError(NETWORK_ERROR_MESSAGE))
    const user = userEvent.setup()
    const { input } = renderFiles()
    await screen.findByText('No files yet.')
    await user.upload(input(), file('unit.jpg', 'image/jpeg'))
    await user.click(await screen.findByRole('button', { name: 'Remove unit.jpg' }))
    expect(m.deleteStoredFile).toHaveBeenCalledWith(m.uploadFile.mock.calls[0][0])
    expect(screen.queryByRole('list', { name: 'Files being added' })).toBeNull()
  })

  it('tells the form when files are on their way, failed, or saved', async () => {
    const statuses: JobFilesStatus[] = []
    let finish: () => void = () => {}
    m.uploadFile.mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)))
    m.fetchJobFiles.mockResolvedValueOnce([]).mockResolvedValue([saved(1)])
    const user = userEvent.setup()
    const { input } = renderFiles({ onStatus: (s) => statuses.push(s) })
    await screen.findByText('No files yet.')
    await user.upload(input(), file('unit.jpg', 'image/jpeg'))
    await waitFor(() => expect(statuses.at(-1)).toEqual({ count: 0, busy: true, failed: 0 }))
    finish()
    await waitFor(() => expect(statuses.at(-1)).toEqual({ count: 1, busy: false, failed: 0 }))
  })
})
