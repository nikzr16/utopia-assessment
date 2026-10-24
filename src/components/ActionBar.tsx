import { useEffect, useRef, type ReactNode } from 'react'

/**
 * The page's main buttons, stuck to the bottom of the screen above the phone
 * bottom bar so the next step is always under the thumb (PRD 0011 Q16).
 * Its height is shared as `--action-h` so the Ask button and toasts sit
 * above it instead of on top of it.
 */
export function ActionBar({
  children,
  label = 'Actions',
  panelOnWide = false,
}: {
  children: ReactNode
  label?: string
  /** From 1024 px the bar sits in a side panel, not at the bottom, so Ask needs no room for it. */
  panelOnWide?: boolean
}) {
  const bar = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = bar.current
    const root = document.documentElement
    if (!el) return
    const wide = panelOnWide && typeof window.matchMedia === 'function' ? window.matchMedia('(min-width: 1024px)') : null
    const set = () => root.style.setProperty('--action-h', wide?.matches ? '0px' : `${el.offsetHeight}px`)
    set()
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(set) : null
    observer?.observe(el)
    wide?.addEventListener('change', set)
    return () => {
      observer?.disconnect()
      wide?.removeEventListener('change', set)
      root.style.removeProperty('--action-h')
    }
  }, [panelOnWide])

  return (
    <div
      ref={bar}
      role="group"
      aria-label={label}
      data-action-bar
      className="sticky bottom-[var(--nav-h)] z-20 -mx-4 space-y-2 border-t border-line bg-surface/95 px-4 py-3 shadow-[0_-6px_16px_-12px_hsl(var(--shadow-color)/0.35)] backdrop-blur sm:-mx-6 sm:px-6 md:mx-0 md:rounded-xl md:border md:px-4"
    >
      {children}
    </div>
  )
}
