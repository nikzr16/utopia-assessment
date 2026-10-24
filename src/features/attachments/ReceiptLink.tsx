import { ReceiptText } from 'lucide-react'
import { LINK } from '../../components/styles'
import { useLoad } from '../../lib/useLoad'
import { signedUrls } from './api'

/** "Receipt" link for a payment, through a short-lived signed link. */
export function ReceiptLink({ path, fileName }: { path: string; fileName: string | null }) {
  const [urls] = useLoad(() => signedUrls([path]), path)
  const href = urls.status === 'ready' ? urls.data[path] : undefined
  if (!href) {
    return (
      <span className="inline-flex items-center gap-1 text-ink-faint">
        <ReceiptText className="size-3.5" aria-hidden="true" />
        Receipt
      </span>
    )
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`${LINK} inline-flex items-center gap-1`}
      title={fileName ?? undefined}
    >
      <ReceiptText className="size-3.5" aria-hidden="true" />
      Receipt
    </a>
  )
}
