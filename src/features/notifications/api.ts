import type { NotificationEvent } from '../../domain'
import { client, run, toApiError } from '../../lib/api'

export { ApiError } from '../../lib/api'

/**
 * The signed-in staff member's in-app notifications. Row-level security
 * returns only their own; marking read goes through RPCs. New rows arrive
 * live through Supabase Realtime (the table is in the `supabase_realtime`
 * publication), filtered to the recipient.
 */
export interface AppNotification {
  id: number
  event: NotificationEvent
  message: string
  read_at: string | null
  created_at: string
  /** Null when the order can no longer be read (reassigned to someone else). */
  order_no: string | null
}

/** How many notifications the list shows. */
export const NOTIFICATION_LIMIT = 50

export async function fetchNotifications(): Promise<AppNotification[]> {
  const rows = await run(
    client()
      .from('notifications')
      .select('id, event, message, read_at, created_at, order:orders(order_no)')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(NOTIFICATION_LIMIT),
  )
  return (rows as Record<string, unknown>[]).map((r) => {
    const order = Array.isArray(r.order) ? r.order[0] : r.order
    return {
      id: Number(r.id),
      event: r.event as NotificationEvent,
      message: r.message as string,
      read_at: (r.read_at as string | null) ?? null,
      created_at: r.created_at as string,
      order_no: (order as { order_no?: string } | null)?.order_no ?? null,
    }
  })
}

export async function fetchUnreadCount(): Promise<number> {
  let result: { count: number | null; error: { message?: string; code?: string } | null }
  try {
    result = await client().from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null)
  } catch (e) {
    throw toApiError(e as { message?: string })
  }
  if (result.error) throw toApiError(result.error)
  return result.count ?? 0
}

export async function markNotificationRead(id: number): Promise<void> {
  await run(client().rpc('mark_notification_read', { p_notification_id: id }))
}

/** Returns how many were marked. */
export async function markAllNotificationsRead(): Promise<number> {
  return Number(await run(client().rpc('mark_all_notifications_read')))
}

/**
 * Calls `onChange` whenever a notification for `staffId` is added or
 * changed. Returns the function that stops listening.
 */
export function subscribeToNotifications(staffId: string, onChange: () => void): () => void {
  const db = client()
  const channel = db
    .channel(`notifications:${staffId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${staffId}` },
      () => onChange(),
    )
    .subscribe()
  return () => {
    void db.removeChannel(channel)
  }
}
