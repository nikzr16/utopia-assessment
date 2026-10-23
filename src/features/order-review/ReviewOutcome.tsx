import { approvedLabel, closedLabel, type OrderStatus } from '../../domain'
import { useLoad } from '../../lib/useLoad'
import { staffName, useInactiveStaff } from '../../lib/staffStatus'
import { fetchReviewFacts, type ReviewFacts } from './api'

/** Statuses that have been approved, so there is something to show. */
const REVIEWED_STATUSES: readonly OrderStatus[] = ['reviewed', 'closed']

/** "Approved by X at T" (with the note) and "Closed by X at T" (0004 PRD Q12). */
export function ReviewOutcomeLines({ facts }: { facts: ReviewFacts }) {
  useInactiveStaff() // re-render with "(inactive)" tags once known
  const approved = approvedLabel({ ...facts, reviewed_by_name: staffName(facts.reviewed_by_name, facts.reviewed_by_id) })
  const closed = closedLabel({ ...facts, closed_by_name: staffName(facts.closed_by_name, facts.closed_by_id) })
  if (!approved && !closed) return null
  return (
    <div role="status" className="space-y-1 rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-900">
      {approved ? (
        <p>
          <span className="font-medium">{approved}</span>
          {facts.review_note ? <span className="block break-words">Note: {facts.review_note}</span> : null}
        </p>
      ) : null}
      {closed ? <p className="font-medium">{closed}</p> : null}
    </div>
  )
}

/**
 * The same lines on the Admin order detail and the technician's job page.
 * Loads them itself; shows nothing before approval or when they cannot be
 * read (the rest of the page does not depend on them).
 */
export function ReviewOutcome({ orderId, status }: { orderId: string; status: OrderStatus }) {
  const shown = REVIEWED_STATUSES.includes(status)
  const [state] = useLoad(() => (shown ? fetchReviewFacts(orderId) : Promise.resolve(null)), `${orderId}:${status}`)
  if (!shown || state.status !== 'ready' || !state.data) return null
  return <ReviewOutcomeLines facts={state.data} />
}
