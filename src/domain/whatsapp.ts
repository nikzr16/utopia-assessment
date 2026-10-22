import { formatMalaysiaDateTime } from './malaysiaTime'
import { formatMYR } from './money'
import { formatMyPhone } from './phone'

/**
 * WhatsApp deep links (`wa.me`). A link only opens WhatsApp with the message
 * filled in; the Admin taps Send. Nothing is recorded, because the app cannot
 * know whether the message was sent.
 */
export type TechnicianMessageKind = 'assigned' | 'reassigned' | 'updated'

export interface TechnicianJob {
  orderNo: string
  serviceType: string
  customerName: string
  /** Stored form, `60123456789`. */
  customerPhone: string
  address: string
  problem: string
  scheduledAt: string | null
  quotedPrice: number
  adminNotes: string | null
  technicianName: string
  /** Link to the order in the app, when known. */
  orderUrl?: string
}

const OPENERS: Record<TechnicianMessageKind, (job: TechnicianJob) => string> = {
  assigned: (j) => `Hi ${j.technicianName}, a new job has been assigned to you.`,
  reassigned: (j) => `Hi ${j.technicianName}, a job has been reassigned to you.`,
  updated: (j) => `Hi ${j.technicianName}, job ${j.orderNo} has been updated. Latest details:`,
}

/** The job message for the technician (full details, PRD Q8). */
export function technicianJobMessage(job: TechnicianJob, kind: TechnicianMessageKind = 'assigned'): string {
  const lines = [
    OPENERS[kind](job),
    '',
    `*${job.orderNo}* – ${job.serviceType}`,
    `Customer: ${job.customerName}`,
    `Phone: ${formatMyPhone(job.customerPhone)}`,
    `Address: ${job.address}`,
    `Problem: ${job.problem}`,
    `Scheduled: ${job.scheduledAt ? formatMalaysiaDateTime(job.scheduledAt) : 'Not scheduled yet'}`,
    `Quoted price: ${formatMYR(job.quotedPrice)}`,
  ]
  if (job.adminNotes?.trim()) lines.push(`Notes: ${job.adminNotes.trim()}`)
  if (job.orderUrl) lines.push('', `Open in the app: ${job.orderUrl}`)
  return lines.join('\n')
}

/** `https://wa.me/<digits>?text=<message>`; null when the phone has no digits. */
export function whatsAppUrl(phone: string, text: string): string | null {
  const digits = phone.replace(/\D/g, '')
  if (!digits) return null
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`
}
