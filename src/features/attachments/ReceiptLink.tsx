import { LINK } from '../../components/styles'
import { useLoad } from '../../lib/useLoad'
import { signedUrls } from './api'

/** "Receipt" link for a payment, through a short-lived signed link. */
export function ReceiptLink({ path, fileName }: { path: string; fileName: string | null }) {
  const [urls] = useLoad(() => signedUrls([path]), path)
  const href = urls.status === 'ready' ? urls.data[path] : undefined
  if (!href) return <span className="text-slate-500">Receipt</span>
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={LINK} title={fileName ?? undefined}>
      Receipt
    </a>
  )
}
