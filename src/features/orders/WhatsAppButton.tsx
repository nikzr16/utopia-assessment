import { BUTTON } from '../../components/styles'
import { isMyMobile, technicianJobMessage, whatsAppUrl, type TechnicianMessageKind } from '../../domain'
import type { OrderSummary } from './api'

/** The order's page in this app, for the link inside the WhatsApp message. */
export function orderUrl(orderNo: string): string {
  return `${window.location.origin}/orders/${encodeURIComponent(orderNo)}`
}

/**
 * Opens WhatsApp with the job filled in for the assigned technician (PRD
 * bonus, Q8). The Admin taps Send in WhatsApp; nothing is recorded here.
 */
export function WhatsAppButton({
  order,
  technicianPhone,
  kind,
  emphasis = false,
}: {
  order: OrderSummary
  technicianPhone: string | null
  kind: TechnicianMessageKind
  /** Draw attention right after an assign, reassign, edit, or create. */
  emphasis?: boolean
}) {
  if (!order.technician_name) return null
  if (!technicianPhone || !isMyMobile(technicianPhone)) {
    return (
      <p className="text-sm text-slate-600">
        No WhatsApp number on file for {order.technician_name}. Contact them another way.
      </p>
    )
  }
  const text = technicianJobMessage(
    {
      orderNo: order.order_no,
      serviceType: order.service_type_name,
      customerName: order.customer_name,
      customerPhone: order.customer_phone,
      address: order.customer_address,
      problem: order.problem_description,
      scheduledAt: order.scheduled_at,
      quotedPrice: order.quoted_price,
      adminNotes: order.admin_notes,
      technicianName: order.technician_name,
      orderUrl: orderUrl(order.order_no),
    },
    kind,
  )
  const href = whatsAppUrl(technicianPhone, text)
  if (!href) return null
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`${BUTTON.whatsapp} w-full sm:w-auto ${emphasis ? 'ring-2 ring-green-300 ring-offset-2' : ''}`}
    >
      Send job to {order.technician_name} on WhatsApp
      <span className="sr-only"> (opens WhatsApp in a new tab)</span>
    </a>
  )
}
