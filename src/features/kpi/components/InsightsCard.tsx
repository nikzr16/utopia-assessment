import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { ArrowRight, Lightbulb, Sparkles } from 'lucide-react'
import { LINK } from '../../../components/styles'
import { Badge, Skeleton } from '../../../components/ui'
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

const KIND_TONES: Record<InsightFact['kind'], 'brand' | 'neutral' | 'warning' | 'danger'> = {
  busy: 'brand',
  quiet: 'neutral',
  review_backlog: 'warning',
  reschedules_up: 'warning',
  rating_drop: 'danger',
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
  if (facts.status === 'loading')
    body = (
      <div className="space-y-2.5">
        <p className="text-sm text-ink-muted">Looking for what stands out…</p>
        <Skeleton className="h-3.5 w-11/12" />
        <Skeleton className="h-3.5 w-3/4" />
      </div>
    )
  else if (facts.status === 'error') body = <p className="text-sm text-danger">Could not load the insights: {facts.message}</p>
  else if (facts.data.length === 0) body = <p className="text-sm text-ink-muted">{NO_INSIGHTS_MESSAGE}</p>
  else {
    const textFor = (i: number) => wording?.sentences.find((s) => s.fact === i)?.text ?? insightSentence(facts.data[i], phrase)
    body = (
      <>
        <ul className="divide-y divide-line/70">
          {facts.data.map((f, i) => (
            <li key={`${f.kind}-${f.technicianId ?? f.branchId}`} className="flex flex-col items-start gap-1.5 py-2.5 first:pt-0 last:pb-0 sm:flex-row sm:gap-3">
              <span className="sm:w-36 sm:shrink-0 sm:pt-0.5">
                <Badge tone={KIND_TONES[f.kind]}>{KIND_TAGS[f.kind]}</Badge>
              </span>
              <p className="min-w-0 text-sm leading-relaxed text-ink">
                {textFor(i)}{' '}
                {f.technicianId ? (
                  <Link
                    to={`/dashboard/technicians/${encodeURIComponent(f.technicianId)}?${kpiAddress(address)}`}
                    className={`${LINK} inline-flex items-center gap-1 whitespace-nowrap`}
                  >
                    See their numbers
                    <ArrowRight aria-hidden="true" className="size-3.5" />
                  </Link>
                ) : null}
              </p>
            </li>
          ))}
        </ul>
        {wording?.tip ? (
          <div className="flex gap-2.5 rounded-lg border border-brand/25 bg-surface px-3 py-2.5 text-sm text-brand-ink">
            <Lightbulb aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-brand" />
            <p>
              <span className="font-semibold">Tip: </span>
              {wording.tip}
            </p>
          </div>
        ) : null}
        <p className="text-xs text-ink-faint" role="status">
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
    <section
      className="relative overflow-hidden rounded-xl border border-brand/30 bg-linear-to-br from-brand-soft via-surface to-surface p-4 shadow-card sm:p-5"
      aria-labelledby="kpi-insights"
    >
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand text-on-brand shadow-card">
          <Sparkles className="size-4.5" />
        </span>
        <h3 id="kpi-insights" className="text-base font-semibold text-ink">
          Insights
        </h3>
        <Badge tone="brand">AI</Badge>
      </div>
      <div className="mt-4 space-y-3">{body}</div>
    </section>
  )
}
