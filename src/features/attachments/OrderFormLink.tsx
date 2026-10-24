import { useEffect, useState } from 'react'
import { LINK } from '../../components/styles'
import { fetchOrderForm, signedUrls, type Attachment } from './api'

/**
 * A link to the paper order form the Admin read with "Read from photo"
 * (0009), for everyone who can open the order (the technician too, PRD Q19).
 * Shows nothing when the order has none or it cannot be loaded.
 */
export function useOrderForm(orderId: string, refreshKey = 0): { form: Attachment | null; url: string | null } {
  const [state, setState] = useState<{ form: Attachment | null; url: string | null }>({ form: null, url: null })
  useEffect(() => {
    let current = true
    fetchOrderForm(orderId)
      .then(async (form) => {
        const urls = form ? await signedUrls([form.storage_path]) : {}
        if (current) setState({ form, url: form ? (urls[form.storage_path] ?? null) : null })
      })
      .catch(() => {
        if (current) setState({ form: null, url: null })
      })
    return () => {
      current = false
    }
  }, [orderId, refreshKey])
  return state
}

export function OrderFormLink({ orderId, refreshKey }: { orderId: string; refreshKey?: number }) {
  const { form, url } = useOrderForm(orderId, refreshKey)
  if (!form || !url) return null
  return (
    <a href={url} target="_blank" rel="noreferrer" className={`${LINK} inline-flex min-h-11 items-center`}>
      Open the paper order form ({form.kind === 'pdf' ? 'PDF' : 'photo'})
    </a>
  )
}
