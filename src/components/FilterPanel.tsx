import { useEffect, useId, useState, type ReactNode } from 'react'
import { SlidersHorizontal, X } from 'lucide-react'
import { BUTTON, CARD } from './styles'

export interface FilterChip {
  key: string
  label: string
  onRemove: () => void
}

/**
 * Filters that fold away on a phone (PRD 0011 Q12): on a desktop the
 * controls show inline in a card; on a phone a "Filters" button opens them
 * as a bottom sheet, and the chosen ones show as removable chips. The
 * controls are rendered once, so labels and tests stay the same.
 */
export function FilterPanel({
  children,
  chips = [],
  search,
  label = 'Filters',
}: {
  children: ReactNode
  chips?: FilterChip[]
  /** The search row, always visible above the filters. */
  search?: ReactNode
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const titleId = useId()

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <div className={`${CARD} space-y-3 max-md:border-0 max-md:bg-transparent max-md:p-0 max-md:shadow-none`}>
      <div className="flex gap-2">
        {search ? <div className="min-w-0 flex-1">{search}</div> : null}
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={open}
          className={`${BUTTON.secondary} shrink-0 md:hidden ${search ? '' : 'w-full'}`}
        >
          <SlidersHorizontal aria-hidden="true" />
          {label}
          {chips.length > 0 ? (
            <span className="rounded-full bg-brand px-1.5 text-xs text-on-brand tabular">{chips.length}</span>
          ) : null}
        </button>
      </div>

      {chips.length > 0 ? (
        <ul className="flex flex-wrap gap-2 md:hidden" aria-label="Active filters">
          {chips.map((chip) => (
            <li key={chip.key}>
              <button
                type="button"
                onClick={chip.onRemove}
                className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-brand/30 bg-brand-soft pl-3 pr-2 text-xs font-medium text-brand-ink"
              >
                {chip.label}
                <X className="size-3.5" aria-hidden="true" />
                <span className="sr-only">Remove filter</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {open ? <div className="fixed inset-0 z-[55] bg-scrim md:hidden" aria-hidden="true" onClick={() => setOpen(false)} /> : null}
      <div
        role={open ? 'dialog' : undefined}
        aria-modal={open ? true : undefined}
        aria-labelledby={open ? titleId : undefined}
        className={
          open
            ? 'max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-[56] max-md:max-h-[85dvh] max-md:animate-sheet-in max-md:overflow-y-auto max-md:rounded-t-2xl max-md:border-t max-md:border-line max-md:bg-raised max-md:p-5 max-md:pb-[calc(env(safe-area-inset-bottom)+1.25rem)] max-md:shadow-pop'
            : 'max-md:hidden'
        }
      >
        <div className="mb-4 flex items-center justify-between md:hidden">
          <h2 id={titleId} className="text-lg font-semibold">
            {label}
          </h2>
          <button type="button" onClick={() => setOpen(false)} className={BUTTON.primary}>
            Done
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
