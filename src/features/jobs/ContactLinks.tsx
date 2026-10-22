import { BUTTON } from '../../components/styles'
import { customerGreeting, mapsUrl, telUrl, whatsAppUrl } from '../../domain'
import type { OrderSummary } from './api'

const TAP = 'min-h-11 flex-1'

/** Call or WhatsApp the customer, or open the address in a map app (PRD Q2). */
export function ContactLinks({ job }: { job: OrderSummary }) {
  const tel = telUrl(job.customer_phone)
  const wa = whatsAppUrl(
    job.customer_phone,
    customerGreeting(job.customer_name, job.technician_name, job.order_no),
  )
  const maps = mapsUrl(job.customer_address)
  return (
    <div className="flex flex-wrap gap-2">
      {tel ? (
        <a href={tel} className={`${BUTTON.primary} ${TAP}`}>
          Call
        </a>
      ) : null}
      {wa ? (
        <a href={wa} target="_blank" rel="noopener noreferrer" className={`${BUTTON.whatsapp} ${TAP}`}>
          WhatsApp
        </a>
      ) : null}
      {maps ? (
        <a href={maps} target="_blank" rel="noopener noreferrer" className={`${BUTTON.secondary} ${TAP}`}>
          Open in Maps
        </a>
      ) : null}
    </div>
  )
}
