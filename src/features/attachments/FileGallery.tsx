import { useState } from 'react'
import { FileText, Image as ImageIcon, Play, Trash2 } from 'lucide-react'
import { BUTTON } from '../../components/styles'
import { formatFileSize, type AttachmentKind } from '../../domain'
import { useLoad } from '../../lib/useLoad'
import { signedUrls, type Attachment } from './api'

const KIND_LABELS: Record<AttachmentKind, string> = { photo: 'Photo', video: 'Video', pdf: 'PDF' }

/**
 * Job files as tiles: photos as thumbnails, videos and PDFs as labelled
 * tiles. Each opens the file in a new tab through a short-lived signed link.
 * With `onRemove`, each tile gets a Remove button with a confirm step.
 */
export function FileGallery({
  files,
  label = 'Job files',
  onRemove,
  removingId = null,
}: {
  files: Attachment[]
  label?: string
  onRemove?: (file: Attachment) => void
  removingId?: string | null
}) {
  const paths = files.map((f) => f.storage_path)
  const [urls] = useLoad(() => signedUrls(paths), paths.join('|'))
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const linkOf = (path: string) => (urls.status === 'ready' ? urls.data[path] : undefined)

  if (files.length === 0) return null
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label={label}>
      {files.map((file, i) => {
        const name = file.file_name ?? `${KIND_LABELS[file.kind]} ${i + 1}`
        const href = linkOf(file.storage_path)
        return (
          <li key={file.id} className="flex flex-col gap-1">
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open ${name}`}
              className="group block aspect-square overflow-hidden rounded-xl border border-line bg-sunken shadow-xs transition-colors hover:border-brand/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              {file.kind === 'photo' && href ? (
                <Thumbnail src={href} name={name} />
              ) : (
                <Tile kind={file.kind} />
              )}
            </a>
            <p className="truncate text-xs text-ink-muted" title={name}>
              {name}
              {file.size_bytes ? <span className="text-ink-faint"> · {formatFileSize(file.size_bytes)}</span> : null}
            </p>
            {onRemove ? (
              confirmId === file.id ? (
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmId(null)
                      onRemove(file)
                    }}
                    className={`${BUTTON.danger} min-h-11 flex-1 px-2 sm:min-h-9`}
                  >
                    Remove
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmId(null)}
                    className={`${BUTTON.secondary} min-h-11 flex-1 px-2 sm:min-h-9`}
                  >
                    Keep
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={removingId === file.id}
                  onClick={() => setConfirmId(file.id)}
                  aria-label={`Remove ${name}`}
                  className={`${BUTTON.ghost} min-h-11 px-2 text-danger hover:bg-danger-soft hover:text-danger sm:min-h-9`}
                >
                  <Trash2 aria-hidden="true" />
                  {removingId === file.id ? 'Removing…' : 'Remove'}
                </button>
              )
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

function Thumbnail({ src, name }: { src: string; name: string }) {
  const [failed, setFailed] = useState(false)
  // HEIC photos cannot be shown by most browsers: fall back to a tile.
  if (failed) return <Tile kind="photo" />
  return <img src={src} alt={name} loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]" />
}

function Tile({ kind }: { kind: AttachmentKind }) {
  return (
    <span className="flex h-full w-full flex-col items-center justify-center gap-2 text-ink-muted">
      <span
        aria-hidden="true"
        className="inline-flex size-11 items-center justify-center rounded-full bg-surface text-brand shadow-xs ring-1 ring-line"
      >
        {kind === 'video' ? <Play className="size-5" /> : kind === 'pdf' ? <FileText className="size-5" /> : <ImageIcon className="size-5" />}
      </span>
      <span className="text-xs font-medium">{KIND_LABELS[kind]}</span>
    </span>
  )
}
