import type { CustomerMessage } from '../../domain'
import { client, run } from '../../lib/api'

export { ApiError } from '../../lib/api'

/**
 * Every database call the customer message makes. Reads come from the
 * `latest_customer_messages` view under row-level security (the assigned
 * technician and Admins see a message; everyone else gets nothing); writes go
 * only through the two RPCs. Each function throws an `ApiError` with a message
 * that can be shown as it is ("Already sent by Ali at …").
 */

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** The newest message of an order, or null when it has none (or the person cannot see it). */
export async function fetchLatestCustomerMessage(orderId: string): Promise<CustomerMessage | null> {
  const rows = await run(client().from('latest_customer_messages').select('*').eq('order_id', orderId).limit(1))
  return (rows as CustomerMessage[])[0] ?? null
}

/** The newest message of each of these orders, keyed by order id (orders without one are left out). */
export async function fetchLatestCustomerMessages(orderIds: string[]): Promise<Record<string, CustomerMessage>> {
  if (orderIds.length === 0) return {}
  const rows = await run(client().from('latest_customer_messages').select('*').in('order_id', orderIds))
  return Object.fromEntries((rows as CustomerMessage[]).map((m) => [m.order_id, m]))
}

// ---------------------------------------------------------------------------
// Writes (RPCs)
// ---------------------------------------------------------------------------

/** Change the text that will be sent; the database keeps the original and who edited. */
export async function editCustomerMessage(messageId: string, body: string): Promise<void> {
  await run(client().rpc('edit_customer_message', { p_message_id: messageId, p_body: body }))
}

/** "Yes, I sent it" (WhatsApp) or "Yes, I told them by phone" (landline); the first person to confirm wins. */
export async function confirmCustomerMessage(messageId: string): Promise<void> {
  await run(client().rpc('confirm_customer_message', { p_message_id: messageId }))
}
