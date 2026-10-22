import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { BUTTON } from '../../components/styles'
import {
  JOB_FILE_ACCEPT,
  MAX_JOB_FILES,
  checkJobFile,
  fileMimeType,
  formatFileSize,
  jobFilePath,
} from '../../domain'
import { isNetworkError } from '../../lib/api'
import { useLoad } from '../../lib/useLoad'
import { addAttachment, deleteStoredFile, fetchJobFiles, removeAttachment, uploadFile, type Attachment } from './api'
import { FileGallery } from './FileGallery'
import { preparePhoto, type PhotoCodec } from './resize'

/** What the parent form needs to know: how many files are saved, and whether any are still on their way. */
export interface JobFilesStatus {
  count: number
  /** Files still preparing, uploading or saving. */
  busy: boolean
  /** Files that failed and still need Retry or Remove. */
  failed: number
}

type Step = 'waiting' | 'preparing' | 'uploading' | 'saving' | 'failed'

interface Pending {
  key: string
  file: File
  name: string
  step: Step
  error?: string
  /** False when retrying cannot help (the file breaks a rule). */
  retryable?: boolean
  body?: Blob
  mime?: string
  path?: string
  uploaded?: boolean
}

const STEP_LABELS: Record<Exclude<Step, 'failed'>, string> = {
  waiting: 'Waiting…',
  preparing: 'Preparing…',
  uploading: 'Uploading…',
  saving: 'Saving…',
}

/**
 * The job's photos, videos and PDFs (PRD Q4–Q7): each file is resized if it
 * is a large photo, uploaded as soon as it is chosen, then registered; a
 * dropped connection leaves it with Retry and Remove. Files upload one at a
 * time so a weak signal is not split between them.
 */
export function JobFiles({
  orderId,
  canChange,
  onStatus,
  codec,
  newFileId = () => crypto.randomUUID(),
}: {
  orderId: string
  canChange: boolean
  onStatus?: (status: JobFilesStatus) => void
  /** For tests: the photo decoder / encoder. */
  codec?: PhotoCodec
  /** For tests: the stored file's id. */
  newFileId?: () => string
}) {
  const [saved, reload] = useLoad(() => fetchJobFiles(orderId), orderId)
  const [pending, setPending] = useState<Pending[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const queue = useRef<Promise<void>>(Promise.resolve())
  const input = useRef<HTMLInputElement>(null)

  const files = saved.status === 'ready' ? saved.data : []
  const active = pending.filter((p) => p.step !== 'failed')
  const failed = pending.filter((p) => p.step === 'failed')
  const room = MAX_JOB_FILES - files.length - pending.length

  useEffect(() => {
    onStatus?.({ count: files.length, busy: active.length > 0, failed: failed.length })
  }, [files.length, active.length, failed.length])

  const update = (key: string, changes: Partial<Pending>) =>
    setPending((list) => list.map((p) => (p.key === key ? { ...p, ...changes } : p)))
  const drop = (key: string) => setPending((list) => list.filter((p) => p.key !== key))

  async function process(item: Pending): Promise<void> {
    let { body, mime, path, uploaded } = item
    try {
      if (!body || !mime) {
        update(item.key, { step: 'preparing', error: undefined })
        const prepared = await preparePhoto(item.file, fileMimeType(item.file), codec)
        body = prepared.body
        mime = prepared.mime
        const check = checkJobFile(mime, body.size)
        if (!check.ok) {
          update(item.key, { step: 'failed', error: check.error, retryable: false })
          return
        }
        path = jobFilePath(orderId, newFileId(), mime)
        update(item.key, { body, mime, path })
      }
      if (!uploaded) {
        update(item.key, { step: 'uploading', error: undefined })
        await uploadFile(path!, body, mime)
        uploaded = true
        update(item.key, { uploaded })
      }
      update(item.key, { step: 'saving', error: undefined })
      await addAttachment(orderId, path!, item.name)
      drop(item.key)
      reload()
    } catch (e) {
      const retryable = isNetworkError(e)
      // A rule said no: the stored copy is of no use, so clean it up.
      if (!retryable && uploaded && path) void deleteStoredFile(path)
      update(item.key, { step: 'failed', error: (e as Error).message, retryable, uploaded: retryable && uploaded })
    }
  }

  const enqueue = (item: Pending) => {
    queue.current = queue.current.then(() => process(item))
  }

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(e.target.files ?? [])
    e.target.value = ''
    setNotice(null)
    if (chosen.length === 0) return
    const taken = chosen.slice(0, Math.max(room, 0))
    if (taken.length < chosen.length) {
      setNotice(
        `A job can have at most ${MAX_JOB_FILES} files. ${chosen.length - taken.length} ${
          chosen.length - taken.length === 1 ? 'file was' : 'files were'
        } not added.`,
      )
    }
    const items: Pending[] = []
    for (const file of taken) {
      const item: Pending = { key: newFileId(), file, name: file.name, step: 'waiting' }
      // Wrong type: say so at once (size is checked after resizing).
      const type = checkJobFile(fileMimeType(file), 1)
      if (!type.ok) {
        items.push({ ...item, step: 'failed', error: type.error, retryable: false })
      } else {
        items.push(item)
      }
    }
    setPending((list) => [...list, ...items])
    items.filter((i) => i.step === 'waiting').forEach(enqueue)
  }

  function retry(item: Pending) {
    update(item.key, { step: 'waiting', error: undefined })
    enqueue({ ...item, step: 'waiting' })
  }

  function discard(item: Pending) {
    if (item.uploaded && item.path) void deleteStoredFile(item.path)
    drop(item.key)
  }

  async function remove(file: Attachment) {
    setRemovingId(file.id)
    setRemoveError(null)
    try {
      await removeAttachment(file.id)
      reload()
    } catch (e) {
      setRemoveError((e as Error).message)
    } finally {
      setRemovingId(null)
    }
  }

  return (
    <div className="space-y-3">
      {saved.status === 'loading' ? (
        <p className="text-sm text-slate-600" role="status">
          Loading files…
        </p>
      ) : saved.status === 'error' ? (
        <p role="alert" className="text-sm text-red-800">
          Could not load the files: {saved.message}{' '}
          <button type="button" onClick={reload} className="font-medium underline">
            Try again
          </button>
        </p>
      ) : files.length === 0 && pending.length === 0 ? (
        <p className="text-sm text-slate-600">No files yet.</p>
      ) : null}

      <FileGallery files={files} onRemove={canChange ? (f) => void remove(f) : undefined} removingId={removingId} />
      {removeError ? (
        <p role="alert" className="text-sm text-red-800">
          {removeError}
        </p>
      ) : null}

      {pending.length > 0 ? (
        <ul className="space-y-2" aria-label="Files being added">
          {pending.map((item) => (
            <li
              key={item.key}
              className={`rounded-md border px-3 py-2 text-sm ${
                item.step === 'failed' ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-slate-50'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate font-medium text-slate-800">
                  {item.name}
                  <span className="font-normal text-slate-500"> · {formatFileSize(item.body?.size ?? item.file.size)}</span>
                </span>
                {item.step !== 'failed' ? (
                  <span role="status" className="shrink-0 text-slate-600">
                    {STEP_LABELS[item.step]}
                  </span>
                ) : null}
              </div>
              {item.step === 'failed' ? (
                <>
                  <p role="alert" className="mt-1 text-red-900">
                    {item.error}
                  </p>
                  <div className="mt-2 flex gap-2">
                    {item.retryable ? (
                      <button type="button" onClick={() => retry(item)} className={`${BUTTON.primary} min-h-11 flex-1`}>
                        Retry
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => discard(item)}
                      aria-label={`Remove ${item.name}`}
                      className={`${BUTTON.secondary} min-h-11 flex-1`}
                    >
                      Remove
                    </button>
                  </div>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {notice ? (
        <p role="alert" className="text-sm text-amber-900">
          {notice}
        </p>
      ) : null}

      {canChange ? (
        <div>
          <input
            ref={input}
            id={`job-files-${orderId}`}
            type="file"
            multiple
            accept={JOB_FILE_ACCEPT}
            onChange={onPick}
            className="sr-only"
            disabled={room <= 0 || saved.status !== 'ready'}
          />
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={room <= 0 || saved.status !== 'ready'}
            className={`${BUTTON.secondary} min-h-11 w-full`}
          >
            {room <= 0 ? `${MAX_JOB_FILES} files added (the maximum)` : 'Add photos, videos or PDFs'}
          </button>
          <p className="mt-1 text-xs text-slate-500">
            Up to {MAX_JOB_FILES} files. Photos up to 10 MB (large ones are shrunk), videos up to 50 MB, PDFs up to 10 MB.
          </p>
        </div>
      ) : null}
    </div>
  )
}
