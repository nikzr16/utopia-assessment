import { Notice } from '../../../components/Notice'

/** The dashboard is loading its numbers. */
export function KpiLoading({ what = 'the dashboard' }: { what?: string }) {
  return (
    <p className="text-sm text-slate-600" role="status">
      Loading {what}…
    </p>
  )
}

/** The database said no or could not be reached; its message is already plain language. */
export function KpiError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Notice tone="error" title="Could not load the dashboard">
      <p>{message}</p>
      <button type="button" onClick={onRetry} className="mt-3 font-medium underline">
        Try again
      </button>
    </Notice>
  )
}
