import { describe, expect, it } from 'vitest'
import {
  FILE_EMPTY_MESSAGE,
  FILE_TOO_LARGE_MESSAGES,
  FILE_TYPE_MESSAGE,
  JOB_FILE_ACCEPT,
  RECEIPT_ACCEPT,
  RECEIPT_TYPE_MESSAGE,
  canAddReceipt,
  canChangeJobFiles,
  canResizePhoto,
  checkJobFile,
  fileMimeType,
  fitWithin,
  formatFileSize,
  jobFileOrder,
  jobFilePath,
} from '../../src/domain'

const MB = 1024 * 1024
const ORDER = '0b6f3c1e-8a2d-4c5e-9f10-1a2b3c4d5e6f'
const FILE = '7d9e8f00-1111-4222-8333-444455556666'

describe('checkJobFile', () => {
  it('accepts photos, videos and PDFs within their size limits', () => {
    expect(checkJobFile('image/jpeg', 10 * MB)).toEqual({ ok: true, kind: 'photo' })
    expect(checkJobFile('IMAGE/HEIC', 1)).toEqual({ ok: true, kind: 'photo' })
    expect(checkJobFile('video/quicktime', 50 * MB)).toEqual({ ok: true, kind: 'video' })
    expect(checkJobFile('application/pdf; charset=binary', 2 * MB)).toEqual({ ok: true, kind: 'pdf' })
  })

  it('explains what is wrong', () => {
    expect(checkJobFile('image/gif', 100)).toEqual({ ok: false, error: FILE_TYPE_MESSAGE })
    expect(checkJobFile('', 100)).toEqual({ ok: false, error: FILE_TYPE_MESSAGE })
    expect(checkJobFile('image/png', 0)).toEqual({ ok: false, error: FILE_EMPTY_MESSAGE })
    expect(checkJobFile('image/png', 10 * MB + 1)).toEqual({ ok: false, error: FILE_TOO_LARGE_MESSAGES.photo })
    expect(checkJobFile('video/mp4', 50 * MB + 1)).toEqual({ ok: false, error: FILE_TOO_LARGE_MESSAGES.video })
    expect(checkJobFile('application/pdf', 10 * MB + 1)).toEqual({ ok: false, error: FILE_TOO_LARGE_MESSAGES.pdf })
  })

  it('takes only photos and PDFs as receipts', () => {
    expect(checkJobFile('video/mp4', 100, { receipt: true })).toEqual({ ok: false, error: RECEIPT_TYPE_MESSAGE })
    expect(checkJobFile('image/webp', 100, { receipt: true })).toEqual({ ok: true, kind: 'photo' })
    expect(RECEIPT_ACCEPT).not.toContain('video')
    expect(JOB_FILE_ACCEPT).toContain('video/mp4')
  })
})

describe('fileMimeType', () => {
  it('uses the type the phone reports, or the extension when it reports none', () => {
    expect(fileMimeType({ name: 'a.jpg', type: 'image/jpeg' })).toBe('image/jpeg')
    expect(fileMimeType({ name: 'IMG_0001.HEIC', type: '' })).toBe('image/heic')
    expect(fileMimeType({ name: 'clip.mov', type: 'application/octet-stream' })).toBe('video/quicktime')
    expect(fileMimeType({ name: 'notes.txt', type: '' })).toBe('')
  })
})

describe('job file paths', () => {
  it('builds <order>/<file>.<ext> and <order>/receipts/<file>.<ext>', () => {
    expect(jobFilePath(ORDER, FILE, 'image/jpeg')).toBe(`${ORDER}/${FILE}.jpg`)
    expect(jobFilePath(ORDER, FILE, 'video/quicktime')).toBe(`${ORDER}/${FILE}.mov`)
    expect(jobFilePath(ORDER, FILE, 'application/pdf', { receipt: true })).toBe(`${ORDER}/receipts/${FILE}.pdf`)
  })

  it('reads the order back from a well-formed path only', () => {
    expect(jobFileOrder(`${ORDER}/${FILE}.jpg`)).toBe(ORDER)
    expect(jobFileOrder(`${ORDER}/receipts/${FILE}.pdf`)).toBe(ORDER)
    expect(jobFileOrder(`${ORDER}/photo.jpg`)).toBeNull()
    expect(jobFileOrder(`${ORDER}/other/${FILE}.jpg`)).toBeNull()
    expect(jobFileOrder(`x/${ORDER}/${FILE}.jpg`)).toBeNull()
  })
})

describe('who may change files', () => {
  it('job files: the assigned technician or an Admin, while In Progress', () => {
    expect(canChangeJobFiles('in_progress', 'technician', true)).toBe(true)
    expect(canChangeJobFiles('in_progress', 'admin', false)).toBe(true)
    expect(canChangeJobFiles('in_progress', 'technician', false)).toBe(false)
    expect(canChangeJobFiles('in_progress', 'manager', false)).toBe(false)
    expect(canChangeJobFiles('in_progress', 'finance', false)).toBe(false)
    expect(canChangeJobFiles('job_done', 'technician', true)).toBe(false)
    expect(canChangeJobFiles('acknowledged', 'admin', false)).toBe(false)
  })

  it('receipts: the assigned technician or Finance, while In Progress, Job Done or Reviewed', () => {
    expect(canAddReceipt('job_done', 'technician', true)).toBe(true)
    expect(canAddReceipt('reviewed', 'finance', false)).toBe(true)
    expect(canAddReceipt('in_progress', 'admin', false)).toBe(false)
    expect(canAddReceipt('closed', 'finance', false)).toBe(false)
  })
})

describe('photo resizing', () => {
  it('shrinks JPEG, PNG and WebP only', () => {
    expect(canResizePhoto('image/jpeg')).toBe(true)
    expect(canResizePhoto('image/webp')).toBe(true)
    expect(canResizePhoto('image/heic')).toBe(false)
    expect(canResizePhoto('video/mp4')).toBe(false)
  })

  it('fits the long side within 2048 px, keeping the shape, never enlarging', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 2048, height: 1536 })
    expect(fitWithin(3024, 4032)).toEqual({ width: 1536, height: 2048 })
    expect(fitWithin(1200, 800)).toEqual({ width: 1200, height: 800 })
    expect(fitWithin(10000, 3)).toEqual({ width: 2048, height: 1 })
  })
})

describe('formatFileSize', () => {
  it('reads like a person would say it', () => {
    expect(formatFileSize(500)).toBe('500 B')
    expect(formatFileSize(850 * 1024)).toBe('850 KB')
    expect(formatFileSize(12.4 * MB)).toBe('12.4 MB')
  })
})
