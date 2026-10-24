import { formatMalaysiaDateTime } from './malaysiaTime'
import type { OrderStatus, StaffRole } from './statuses'

/**
 * The customer message sent when a job is Job Done: the WhatsApp text the
 * database prepares, the person's confirmation that it was sent (or that the
 * customer was told by phone), and the "Customer not told yet" flag. Mirrors
 * the rules in `supabase/migrations/20261023000001_whatsapp_notification.sql`
 * (`customer_messages` checks, `_check_customer_message_body`,
 * `_customer_message_error`, redefined in 0004 for Managers);
 * `tests/db/parity.test.ts` checks both.
 */

/** How a message reaches the customer: a WhatsApp mobile, or a call for a landline. */
export const CUSTOMER_MESSAGE_CHANNELS = ['whatsapp', 'phone'] as const
export type CustomerMessageChannel = (typeof CUSTOMER_MESSAGE_CHANNELS)[number]

/** Where a message stands. Values match the `customer_messages.status` check. */
export const CUSTOMER_MESSAGE_STATES = ['not_sent', 'sent', 'told_by_phone'] as const
export type CustomerMessageState = (typeof CUSTOMER_MESSAGE_STATES)[number]

/** The order statuses in which the message can be edited and confirmed. */
export const CUSTOMER_MESSAGE_STATUSES: readonly OrderStatus[] = ['job_done', 'reviewed', 'closed']

/** The text that will be sent is 1 to this many characters, after trimming. */
export const CUSTOMER_MESSAGE_MAX_LENGTH = 1000

export const CUSTOMER_MESSAGE_REQUIRED_MESSAGE = 'Enter the message to send'
export const CUSTOMER_MESSAGE_TOO_LONG_MESSAGE = 'The message can be at most 1,000 characters'

/** Audit log actions written by the edit and confirm RPCs. */
export const CUSTOMER_MESSAGE_AUDIT_ACTIONS = ['customer_message_edited', 'customer_messaged', 'customer_called'] as const
export type CustomerMessageAuditAction = (typeof CUSTOMER_MESSAGE_AUDIT_ACTIONS)[number]

/** A row of `latest_customer_messages`: the newest message of an order. */
export interface CustomerMessage {
  id: string
  order_id: string
  channel: CustomerMessageChannel
  /** The customer's number as stored, `60123456789`. */
  phone: string
  /** The text the database prepared; never changes. */
  prepared_body: string
  /** The text that will be sent (or was sent). */
  body: string
  status: CustomerMessageState
  edited_by: string | null
  edited_by_name: string | null
  edited_at: string | null
  confirmed_by: string | null
  confirmed_by_name: string | null
  confirmed_at: string | null
  created_at: string
  /** 0005: the feedback link of this visit (`<address>/f/<token>`); null for a landline. */
  feedback_url: string | null
  /** 0005: the text that is (or was) sent: `body` plus the fixed feedback link line. */
  full_body: string
}

export type CustomerMessageBodyResult = { ok: true; value: string } | { ok: false; error: string }

/** The edited text: trimmed, 1 to 1,000 characters (an emoji counts as one). */
export function checkCustomerMessageBody(input: string): CustomerMessageBodyResult {
  const value = input.trim()
  if (value === '') return { ok: false, error: CUSTOMER_MESSAGE_REQUIRED_MESSAGE }
  if ([...value].length > CUSTOMER_MESSAGE_MAX_LENGTH) return { ok: false, error: CUSTOMER_MESSAGE_TOO_LONG_MESSAGE }
  return { ok: true, value }
}

/** Whether an order in this status offers the customer message at all. */
export function customerMessageOffered(orderStatus: OrderStatus): boolean {
  return CUSTOMER_MESSAGE_STATUSES.includes(orderStatus)
}

/**
 * Who may edit the message: an Admin, or the order's assigned technician,
 * while the order is Job Done, Reviewed or Closed. (Also true of the message
 * being the latest and not yet confirmed; see `customerNotTold`.)
 */
export function canManageCustomerMessage(orderStatus: OrderStatus, role: StaffRole, assigned: boolean): boolean {
  return customerMessageOffered(orderStatus) && (role === 'admin' || (role === 'technician' && assigned))
}

/**
 * Who may confirm (send) the message: as `canManageCustomerMessage`, plus a
 * Manager covering the order's branch (0004), who sends it on behalf of the
 * technician but cannot edit it. `related`: the technician is assigned, or
 * the Manager covers the branch.
 */
export function canConfirmCustomerMessage(orderStatus: OrderStatus, role: StaffRole, related: boolean): boolean {
  if (role === 'manager') return customerMessageOffered(orderStatus) && related
  return canManageCustomerMessage(orderStatus, role, related)
}

/** The customer has not been told yet: the latest message is still `not_sent`. */
export function customerNotTold(
  latest: Pick<CustomerMessage, 'status'> | null | undefined,
  orderStatus?: OrderStatus,
): boolean {
  if (!latest || latest.status !== 'not_sent') return false
  // After a return for rework the old message is not offered until the job is done again.
  return orderStatus === undefined || customerMessageOffered(orderStatus)
}

/** A WhatsApp message that is not sent yet: shows Send and Edit. */
export function canSendCustomerMessage(message: Pick<CustomerMessage, 'channel' | 'status'>): boolean {
  return message.channel === 'whatsapp' && message.status === 'not_sent'
}

/** The text can be edited only before sending and only for a WhatsApp message. */
export const canEditCustomerMessage = canSendCustomerMessage

/** A landline customer who has not been told yet: shows Call. */
export function canCallCustomer(message: Pick<CustomerMessage, 'channel' | 'status'>): boolean {
  return message.channel === 'phone' && message.status === 'not_sent'
}

/** The text was changed after the database prepared it. */
export function customerMessageEdited(message: Pick<CustomerMessage, 'edited_at'>): boolean {
  return message.edited_at !== null
}

/** `Sent by Ali at Thu 22 Oct 2026, 3:20 PM` / `Told by phone by Ali at …`; null while not sent. */
export function customerMessageStateLabel(
  message: Pick<CustomerMessage, 'status' | 'confirmed_by_name' | 'confirmed_at'>,
): string | null {
  if (message.status === 'not_sent') return null
  const who = message.confirmed_by_name ?? 'someone'
  const when = formatMalaysiaDateTime(message.confirmed_at)
  const what = message.status === 'sent' ? 'Sent by' : 'Told by phone by'
  return when ? `${what} ${who} at ${when}` : `${what} ${who}`
}

/** `Edited by Ali at Thu 22 Oct 2026, 3:18 PM`; null when the text was not edited. */
export function customerMessageEditedLabel(
  message: Pick<CustomerMessage, 'edited_at' | 'edited_by_name'>,
): string | null {
  if (!message.edited_at) return null
  const who = message.edited_by_name ?? 'someone'
  return `Edited by ${who} at ${formatMalaysiaDateTime(message.edited_at)}`
}
