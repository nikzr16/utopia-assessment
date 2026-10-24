import type { ReactNode } from 'react'
import { CalendarX2 } from 'lucide-react'
import { CARD } from '../../../components/styles'
import { EmptyState, ErrorState, Skeleton } from '../../../components/ui'
import { tileGridClass } from './SummaryCards'

/**
 * The dashboard is loading its numbers: grey tiles and a chart card in the
 * page's own layout, plus the old text for screen readers.
 */
export function KpiLoading({ what = 'the dashboard', tiles = 6 }: { what?: string; tiles?: number }) {
  return (
    <div role="status" className="space-y-5">
      <span className="sr-only">Loading {what}…</span>
      <div className={tileGridClass(tiles)}>
        {Array.from({ length: tiles }, (_, i) => (
          <div key={i} className={`${CARD} space-y-3 p-3.5`}>
            <div className="flex justify-between gap-2">
              <Skeleton className="h-3.5 w-20" />
              <Skeleton className="size-8 rounded-lg" />
            </div>
            <Skeleton className="h-6 w-16" />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>
      <div className={`${CARD} space-y-3`}>
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-44 w-full rounded-lg" />
      </div>
    </div>
  )
}

/** The database said no or could not be reached; its message is already plain language. */
export function KpiError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <ErrorState title="Could not load the dashboard" onRetry={onRetry}>
      <p>{message}</p>
    </ErrorState>
  )
}

/** Nothing was approved in the period: say so, the zero tiles stay above. */
export function EmptyPeriod({ message, children }: { message: string; children?: ReactNode }) {
  return (
    <div role="status">
      <EmptyState compact title={message} icon={<CalendarX2 className="size-5" />}>
        {children}
      </EmptyState>
    </div>
  )
}
