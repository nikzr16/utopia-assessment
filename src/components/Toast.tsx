import { useEffect, type ReactNode } from 'react'
import { CircleCheck, Info, X } from 'lucide-react'

const TONES = {
  success: { box: 'border-success/30', icon: 'text-success', Icon: CircleCheck },
  info: { box: 'border-brand/30', icon: 'text-brand', Icon: Info },
}

/**
 * A short success pop-up (PRD 0011 Q13). Rendered by the page that shows the
 * message (so it works without a provider), fixed above the phone bottom bar
 * and action bars, and gone after a few seconds. Errors never use this.
 */
export function Toast({
  children,
  onDismiss,
  tone = 'success',
  duration = 4500,
}: {
  children: ReactNode
  onDismiss: () => void
  tone?: keyof typeof TONES
  duration?: number
}) {
  useEffect(() => {
    if (!duration) return
    const timer = window.setTimeout(onDismiss, duration)
    return () => window.clearTimeout(timer)
    // Give each message its own `key` to restart the timer; onDismiss is
    // recreated on every render.
  }, [duration])

  const { box, icon, Icon } = TONES[tone]
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--nav-h)+var(--action-h,0px)+4.75rem)] z-50 flex justify-center px-4 md:inset-x-auto md:right-6 md:bottom-[calc(var(--action-h,0px)+5.5rem)] md:justify-end">
      <div
        role="status"
        className={`pointer-events-auto flex w-full max-w-sm animate-toast-in items-start gap-3 rounded-xl border bg-raised px-4 py-3 text-sm text-ink shadow-pop ${box}`}
      >
        <Icon className={`mt-0.5 size-5 shrink-0 ${icon}`} aria-hidden="true" />
        <div className="min-w-0 flex-1">{children}</div>
        <button
          type="button"
          onClick={onDismiss}
          className="-mr-1 -mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-ink-faint hover:bg-sunken hover:text-ink"
        >
          <X className="size-4" aria-hidden="true" />
          <span className="sr-only">Dismiss</span>
        </button>
      </div>
    </div>
  )
}
