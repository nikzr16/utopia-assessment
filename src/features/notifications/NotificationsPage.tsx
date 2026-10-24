import { useState } from 'react'
import { useNavigate } from 'react-router'
import {
  BadgeCheck,
  Ban,
  Banknote,
  Bell,
  BellOff,
  CheckCheck,
  CircleCheckBig,
  ClipboardPlus,
  Lock,
  PencilLine,
  RotateCcw,
  Star,
  UserRoundX,
  type LucideIcon,
} from 'lucide-react'
import { BUTTON } from '../../components/styles'
import { EmptyState, ErrorState, LoadingState, PageHeader } from '../../components/ui'
import { NOTIFICATION_EVENT_LABELS, formatMalaysiaDateTime, notificationOpensJob, type NotificationEvent } from '../../domain'
import { useLoad } from '../../lib/useLoad'
import {
  NOTIFICATION_LIMIT,
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type AppNotification,
} from './api'
import { useNotifications } from './NotificationsProvider'

const EVENT_ICONS: Record<NotificationEvent, LucideIcon> = {
  assigned: ClipboardPlus,
  job_done: CircleCheckBig,
  rework: RotateCcw,
  reviewed: BadgeCheck,
  order_updated: PencilLine,
  cancelled: Ban,
  reassigned_away: UserRoundX,
  payment_recorded: Banknote,
  job_approved: BadgeCheck,
  job_closed: Lock,
  low_feedback: Star,
}

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
    <div className="max-w-3xl space-y-4">
      <PageHeader
        row
        title="Notifications"
        actions={
          (unread ?? 0) > 0 ? (
            <button type="button" onClick={() => void markAll()} disabled={markingAll} className={BUTTON.secondary}>
              <CheckCheck aria-hidden="true" />
              {markingAll ? 'Marking…' : 'Mark all as read'}
            </button>
          ) : null
        }
      />

      {error ? (
        <p role="alert" className="rounded-xl border border-danger/35 bg-danger-soft px-3 py-2 text-sm text-danger-ink">
          {error}
        </p>
      ) : null}

      {state.status === 'loading' ? (
        <LoadingState variant="rows" count={5} label="Loading notifications…" />
      ) : state.status === 'error' ? (
        <ErrorState title="Could not load notifications" onRetry={reload}>
          <p>{state.message}</p>
        </ErrorState>
      ) : state.data.length === 0 ? (
        <EmptyState title="No notifications yet." icon={<BellOff className="size-5" />}>
          New jobs, reviews and payments will show up here.
        </EmptyState>
      ) : (
        <>
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface shadow-card" aria-label="Notifications">
            {state.data.map((n) => {
              const Icon = EVENT_ICONS[n.event] ?? Bell
              const unreadItem = !n.read_at
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => open(n)}
                    className={`group relative flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-sunken sm:items-center sm:py-2.5 ${unreadItem ? 'bg-brand-soft/50' : ''}`}
                  >
                    {unreadItem ? <span aria-hidden="true" className="absolute left-1.5 top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-brand" /> : null}
                    <span
                      aria-hidden="true"
                      className={`inline-flex size-8 shrink-0 items-center justify-center rounded-full ${
                        n.event === 'low_feedback' || n.event === 'rework' || n.event === 'cancelled'
                          ? 'bg-warning-soft text-warning'
                          : 'bg-brand-soft text-brand'
                      }`}
                    >
                      <Icon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-3">
                      <span className="block shrink-0 text-[11px] font-medium uppercase tracking-wide text-ink-faint sm:w-32 sm:truncate">
                        {NOTIFICATION_EVENT_LABELS[n.event] ?? n.event}
                        {unreadItem ? <span className="sr-only">Unread</span> : null}
                      </span>
                      <span
                        title={n.message}
                        className={`block break-words text-sm sm:min-w-0 sm:flex-1 sm:truncate ${unreadItem ? 'font-semibold text-ink' : 'text-ink-muted'}`}
                      >
                        {n.message}
                      </span>
                      <span className="mt-0.5 block shrink-0 whitespace-nowrap text-xs text-ink-faint tabular sm:mt-0">
                        {formatMalaysiaDateTime(n.created_at)}
                      </span>
                      {gone === n.id ? (
                        <span role="status" className="mt-1 block text-sm text-warning-ink sm:mt-0">
                          {goneMessage}
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
          {state.data.length >= NOTIFICATION_LIMIT ? (
            <p className="text-center text-xs text-ink-faint">Showing the latest {NOTIFICATION_LIMIT}.</p>
          ) : null}
        </>
      )}
    </div>
  )
}
