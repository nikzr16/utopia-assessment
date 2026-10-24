import { useState } from 'react'
import { useNavigate } from 'react-router'
import { Notice } from '../../components/Notice'
import { BUTTON, CARD } from '../../components/styles'
import { NOTIFICATION_EVENT_LABELS, formatMalaysiaDateTime, notificationOpensJob } from '../../domain'
import { useLoad } from '../../lib/useLoad'
import {
  NOTIFICATION_LIMIT,
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type AppNotification,
} from './api'
import { useNotifications } from './NotificationsProvider'

/**
 * The signed-in staff member's notifications, newest first (PRD AC12).
 * Tapping one marks it read and opens its job in the portal's own page
 * (`jobPath`); `goneMessage` explains an order the person can no longer read.
 */
export function NotificationsPage({
  jobPath = (orderNo: string) => `/jobs/${encodeURIComponent(orderNo)}`,
  goneMessage = 'This job is no longer assigned to you.',
}: {
  jobPath?: (orderNo: string) => string
  goneMessage?: string
}) {
  const { version, refresh, unread } = useNotifications()
  const [state, reload] = useLoad(fetchNotifications, `notifications-${version}`)
  const navigate = useNavigate()
  const [gone, setGone] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [markingAll, setMarkingAll] = useState(false)

  function open(n: AppNotification) {
    setError(null)
    if (!n.read_at) {
      // Do not make the technician wait for this on a slow connection.
      markNotificationRead(n.id).then(refresh, () => {})
    }
    if (notificationOpensJob(n.event) && n.order_no) navigate(jobPath(n.order_no))
    else setGone(n.id)
  }

  async function markAll() {
    setMarkingAll(true)
    setError(null)
    try {
      await markAllNotificationsRead()
      refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setMarkingAll(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Notifications</h2>
        {(unread ?? 0) > 0 ? (
          <button type="button" onClick={() => void markAll()} disabled={markingAll} className={`${BUTTON.secondary} min-h-11`}>
            {markingAll ? 'Marking…' : 'Mark all as read'}
          </button>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
          {error}
        </p>
      ) : null}

      {state.status === 'loading' ? (
        <p className="text-sm text-slate-600" role="status">
          Loading notifications…
        </p>
      ) : state.status === 'error' ? (
        <Notice tone="error" title="Could not load notifications">
          <p>{state.message}</p>
          <button type="button" onClick={reload} className="mt-3 min-h-11 font-medium underline">
            Try again
          </button>
        </Notice>
      ) : state.data.length === 0 ? (
        <div className={`${CARD} text-center`}>
          <p className="text-sm text-slate-700">No notifications yet.</p>
        </div>
      ) : (
        <>
          <ul className="space-y-2" aria-label="Notifications">
            {state.data.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => open(n)}
                  className={`block w-full rounded-lg border p-4 text-left shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-300 ${
                    n.read_at ? 'border-slate-200 bg-white' : 'border-sky-300 bg-sky-50'
                  }`}
                >
                  <span className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-semibold uppercase tracking-wide text-slate-600">
                      {NOTIFICATION_EVENT_LABELS[n.event] ?? n.event}
                    </span>
                    {n.read_at ? null : (
                      <span className="inline-flex items-center gap-1 font-semibold text-sky-800">
                        <span aria-hidden="true" className="h-2 w-2 rounded-full bg-sky-600" />
                        Unread
                      </span>
                    )}
                  </span>
                  <span className={`mt-1 block break-words text-sm ${n.read_at ? 'text-slate-800' : 'font-medium text-slate-900'}`}>
                    {n.message}
                  </span>
                  <span className="mt-1 block text-xs text-slate-500">{formatMalaysiaDateTime(n.created_at)}</span>
                  {gone === n.id ? (
                    <span role="status" className="mt-2 block text-sm text-amber-900">
                      {goneMessage}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
          {state.data.length >= NOTIFICATION_LIMIT ? (
            <p className="text-center text-xs text-slate-500">Showing the latest {NOTIFICATION_LIMIT}.</p>
          ) : null}
        </>
      )}
    </div>
  )
}
