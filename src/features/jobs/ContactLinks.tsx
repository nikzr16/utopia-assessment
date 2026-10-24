import { MapPin, MessageCircle, Phone } from 'lucide-react'
import { BUTTON } from '../../components/styles'
import { customerGreeting, mapsUrl, telUrl, whatsAppUrl } from '../../domain'
import type { OrderSummary } from './api'

const TAP = 'min-h-14 flex-col gap-1 px-2 text-xs sm:min-h-11 sm:flex-row sm:gap-2 sm:text-sm [&_svg]:size-5 sm:[&_svg]:size-4'

/** Call or WhatsApp the customer, or open the address in a map app (PRD Q2). */
export function ContactLinks({ job }: { job: OrderSummary }) {
  const tel = telUrl(job.customer_phone)
  const wa = whatsAppUrl(
    job.customer_phone,
    customerGreeting(job.customer_name, job.technician_name, job.order_no),
  )
  const maps = mapsUrl(job.customer_address)
  return (
    <div className="grid grid-cols-3 gap-2">
      {tel ? (
        <a href={tel} className={`${BUTTON.secondary} ${TAP}`}>
          <Phone aria-hidden="true" />
          Call
        </a>
      ) : null}
      {wa ? (
        <a href={wa} target="_blank" rel="noopener noreferrer" className={`${BUTTON.whatsapp} ${TAP}`}>
          <MessageCircle aria-hidden="true" />
          WhatsApp
        </a>
      ) : null}
      {maps ? (
        <a href={maps} target="_blank" rel="noopener noreferrer" aria-label="Open in Maps" className={`${BUTTON.secondary} ${TAP}`}>
          <MapPin aria-hidden="true" />
          Maps
        </a>
      ) : null}
    </div>
  )
}
