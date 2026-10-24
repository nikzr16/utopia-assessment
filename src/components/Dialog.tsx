import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { X } from 'lucide-react'

/**
 * A modal dialog: focus moves into it on open and returns on close, Escape
 * closes it, and Tab stays inside. Rendered inline (no portal) so it works the
 * same in tests.
 */
export function Dialog({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  const titleId = useId()
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const first = panel.current?.querySelector<HTMLElement>(
      'input, select, textarea, button:not([data-dialog-close])',
    )
    ;(first ?? panel.current)?.focus()
    return () => previous?.focus()
  }, [])

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key !== 'Tab' || !panel.current) return
    const focusable = Array.from(
      panel.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
      ),
    )
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-scrim p-0 backdrop-blur-[2px] sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="max-h-[90vh] w-full animate-sheet-in overflow-y-auto rounded-t-2xl border border-line bg-raised p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] shadow-pop focus:outline-none sm:max-w-lg sm:rounded-2xl sm:pb-5"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id={titleId} className="text-lg font-semibold tracking-tight">
            {title}
          </h2>
          <button
            type="button"
            data-dialog-close
            onClick={onClose}
            className="-mr-2 -mt-1 inline-flex size-9 items-center justify-center rounded-lg text-ink-faint hover:bg-sunken hover:text-ink"
          >
            <X className="size-5" aria-hidden="true" />
            <span className="sr-only">Close</span>
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  )
}
