import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useRefreshOnReturn } from '../../lib/useRefreshOnReturn'
import { fetchUnreadCount, subscribeToNotifications } from './api'

interface NotificationsState {
  /** Unread notifications, or null until first loaded. */
  unread: number | null
  /** Changes whenever notifications may have changed; lists reload on it. */
  version: number
  /** Re-read the count and tell lists to reload. */
  refresh: () => void
}

const NotificationsContext = createContext<NotificationsState>({ unread: null, version: 0, refresh: () => {} })

/**
 * Keeps the signed-in staff member's unread count current (PRD Q11): live
 * through Supabase Realtime, and again whenever they come back to the app or
 * the connection returns (in case a live update was missed).
 */
export function NotificationsProvider({ staffId, children }: { staffId: string; children: ReactNode }) {
  const [unread, setUnread] = useState<number | null>(null)
  const [version, setVersion] = useState(0)

  const loadCount = useCallback(() => {
    fetchUnreadCount().then(setUnread, () => {
      // Keep the last count; the next refresh tries again.
    })
  }, [])

  const refresh = useCallback(() => {
    setVersion((v) => v + 1)
    loadCount()
  }, [loadCount])

  useEffect(() => {
    // Lists load themselves on open; only the count is needed here.
    loadCount()
    let stop = () => {}
    try {
      stop = subscribeToNotifications(staffId, refresh)
    } catch {
      // Not connected: the count still refreshes on return.
    }
    return () => stop()
  }, [staffId, refresh, loadCount])

  useRefreshOnReturn(refresh)

  const value = useMemo(() => ({ unread, version, refresh }), [unread, version, refresh])
  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>
}

export function useNotifications(): NotificationsState {
  return useContext(NotificationsContext)
}
