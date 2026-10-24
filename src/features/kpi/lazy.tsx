import { Component, Suspense, lazy, type ReactNode } from 'react'
import { ErrorState, LoadingState } from '../../components/ui'
import type { KpiRoutesProps } from './KpiRoutes'

/**
 * The dashboard pages load on demand (PRD Q12, plan P5): Recharts lives in
 * the chunk these imports create, so the other screens do not grow. Only this
 * file may import the pages; everything else goes through these wrappers.
 */
const KpiRoutesChunk = lazy(() => import('./KpiRoutes').then((m) => ({ default: m.KpiRoutes })))
const MyWeekChunk = lazy(() => import('./MyWeekPage').then((m) => ({ default: m.MyWeekPage })))

const FALLBACK = <LoadingState variant="tiles" count={4} label="Loading the dashboard…" />

/** The chunk could not be downloaded (no signal): say so and offer another try, instead of a blank page. */
class ChunkBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <ErrorState title="Could not load the dashboard" onRetry={() => window.location.reload()} retryLabel="Reload the page">
        <p>Check your connection and try again.</p>
      </ErrorState>
    )
  }
}

/** `/dashboard/*` for Admins, Managers and Finance. */
export function DashboardRoutes(props: KpiRoutesProps) {
  return (
    <ChunkBoundary>
      <Suspense fallback={FALLBACK}>
        <KpiRoutesChunk {...props} />
      </Suspense>
    </ChunkBoundary>
  )
}

/** `/my-week` for technicians. */
export function MyWeek({ staffId }: { staffId: string }) {
  return (
    <ChunkBoundary>
      <Suspense fallback={FALLBACK}>
        <MyWeekChunk staffId={staffId} />
      </Suspense>
    </ChunkBoundary>
  )
}
