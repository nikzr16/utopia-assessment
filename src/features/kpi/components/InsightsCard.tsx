import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { CARD, LINK } from '../../../components/styles'
import {
  NO_INSIGHTS_MESSAGE,
  insightPeriodPhrase,
  insightSentence,
  kpiAddress,
  periodRange,
  type InsightFact,
  type KpiAddress,
} from '../../../domain'
import { useLoad } from '../../../lib/useLoad'
import { fetchInsightFacts, fetchInsightWording, type InsightWording } from '../api'

const KIND_TAGS: Record<InsightFact['kind'], string> = {
  busy: 'Busy',
  quiet: 'Quiet',
  review_backlog: 'Waiting for review',
  reschedules_up: 'Reschedules up',
  rating_drop: 'Rating drop',
}

/**
 * The Dashboard's Insights card (0009 Operational Insight), for Managers and
 * Admins: what stands out in the period and branches shown. The database finds
 * every fact and number (the same as the dashboard); the facts show at once in
 * fixed sentences, then the AI's wording and tip replace them when they arrive.
 */
export function InsightsCard({ address }: { address: KpiAddress }) {
  const period = periodRange(address.view, address.start)
  const phrase = insightPeriodPhrase(address.view, address.start)
  const key = `${kpiAddress(address)}`
  const [facts] = useLoad(() => fetchInsightFacts(period.start, period.end, address.branch), key)
  const [wording, setWording] = useState<InsightWording | null>(null)
  const [wordingFailed, setWordingFailed] = useState(false)
  const count = facts.status === 'ready' ? facts.data.length : 0

  useEffect(() => {
    setWording(null)
    setWordingFailed(false)
    if (count === 0) return undefined
    let current = true
    fetchInsightWording(period.start, period.end, address.branch, phrase).then(
      (w) => {
        if (current) setWording(w)
      },
      () => {
        if (current) setWordingFailed(true)
      },
    )
    return () => {
      current = false
    }
    // A new period / branch, or new facts, asks again (the server reuses a saved wording).
  }, [key, count])

  let body
  if (facts.status === 'loading') body = <p className="text-sm text-slate-600">Looking for what stands out…</p>
  else if (facts.status === 'error') body = <p className="text-sm text-red-700">Could not load the insights: {facts.message}</p>
  else if (facts.data.length === 0) body = <p className="text-sm text-slate-600">{NO_INSIGHTS_MESSAGE}</p>
  else {
    const textFor = (i: number) => wording?.sentences.find((s) => s.fact === i)?.text ?? insightSentence(facts.data[i], phrase)
    body = (
      <>
        <ul className="space-y-2">
          {facts.data.map((f, i) => (
            <li key={`${f.kind}-${f.technicianId ?? f.branchId}`} className="text-sm text-slate-900">
              <span className="mr-2 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-700">
                {KIND_TAGS[f.kind]}
              </span>
              {textFor(i)}{' '}
              {f.technicianId ? (
                <Link
                  to={`/dashboard/technicians/${encodeURIComponent(f.technicianId)}?${kpiAddress(address)}`}
                  className={`${LINK} whitespace-nowrap`}
                >
                  See their numbers
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
        {wording?.tip ? (
          <p className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-950">
            <span className="font-medium">Tip: </span>
            {wording.tip}
          </p>
        ) : null}
        <p className="text-xs text-slate-500" role="status">
          {wording?.source === 'ai'
            ? 'Worded by AI from the numbers above; the numbers come from the dashboard.'
            : wordingFailed || wording?.source === 'fixed'
              ? 'AI wording is not available right now; these are the plain facts.'
              : 'Asking the AI to word these…'}
        </p>
      </>
    )
  }

  return (
    <section className={CARD} aria-labelledby="kpi-insights">
      <h3 id="kpi-insights" className="text-base font-semibold">
        Insights
      </h3>
      <div className="mt-3 space-y-3">{body}</div>
    </section>
  )
}
