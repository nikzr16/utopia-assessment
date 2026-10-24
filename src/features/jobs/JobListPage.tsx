import type React from 'react'
import { useSearchParams } from 'react-router'
import { CalendarClock, CircleCheckBig, ClipboardCheck, RotateCw } from 'lucide-react'
import { BUTTON } from '../../components/styles'
import { EmptyState, ErrorState, LoadingState, PageHeader, SegmentedTabs } from '../../components/ui'
import {
  FINISHED_JOB_DAYS,
  JOB_VIEWS,
  JOB_VIEW_LABELS,
  OPEN_JOB_GROUP_LABELS,
  customerNotTold,
  groupOpenJobs,
  type CustomerMessage,
  type JobView,
} from '../../domain'
import { useLoad } from '../../lib/useLoad'
import { useRefreshOnReturn } from '../../lib/useRefreshOnReturn'
import { fetchLatestCustomerMessages } from '../customer-messages'
import { fetchMyJobs, type OrderSummary } from './api'
import { JobCard } from './JobCard'

const EMPTY: Record<JobView, string> = {
  open: 'No open jobs. New jobs assigned to you will show up here.',
  submitted: 'Nothing is waiting for review.',
  finished: `No jobs closed or cancelled in the last ${FINISHED_JOB_DAYS} days.`,
}

const EMPTY_TITLE: Record<JobView, string> = {
  open: 'You are all caught up',
  submitted: 'Nothing waiting',
  finished: 'No finished jobs yet',
}

const EMPTY_ICON: Record<JobView, React.ReactNode> = {
  open: <CalendarClock className="size-5" />,
  submitted: <ClipboardCheck className="size-5" />,
  finished: <CircleCheckBig className="size-5" />,
}

/** The tab's jobs, with the newest customer message of each on the Submitted tab (for the "not told" flag). */
async function loadJobs(view: JobView): Promise<{ jobs: OrderSummary[]; messages: Record<string, CustomerMessage> }> {
  const jobs = await fetchMyJobs(view)
  const messages = view === 'submitted' ? await fetchLatestCustomerMessages(jobs.map((j) => j.id)) : {}
  return { jobs, messages }
}

/** `?tab=` → a job view; anything else is the Open tab. */
export function toJobView(tab: string | null): JobView {
  return JOB_VIEWS.includes(tab as JobView) ? (tab as JobView) : 'open'
}

/** The technician's home: their jobs in three tabs, open ones soonest first (PRD Q1, AC2). */
export function JobListPage() {
  const [params] = useSearchParams()
  const view = toJobView(params.get('tab'))
  const [state, reload] = useLoad(() => loadJobs(view), view)
  useRefreshOnReturn(reload)

  return (
    <div className="space-y-5">
      <PageHeader
        row
        title="My jobs"
        actions={
          <button type="button" onClick={reload} className={BUTTON.secondary}>
            <RotateCw aria-hidden="true" />
            Refresh
          </button>
        }
      />

      <SegmentedTabs
        label="Job lists"
        items={JOB_VIEWS.map((v) => ({
          key: v,
          to: v === 'open' ? '/jobs' : `/jobs?tab=${v}`,
          label: JOB_VIEW_LABELS[v],
          active: v === view,
        }))}
      />

      {state.status === 'loading' ? (
        <LoadingState variant="cards" count={3} label="Loading your jobs…" />
      ) : state.status === 'error' ? (
        <ErrorState title="Could not load your jobs" onRetry={reload}>
          <p>{state.message}</p>
        </ErrorState>
      ) : state.data.jobs.length === 0 ? (
        <EmptyState title={EMPTY_TITLE[view]} icon={EMPTY_ICON[view]}>
          {EMPTY[view]}
        </EmptyState>
      ) : view === 'open' ? (
        <OpenJobs jobs={state.data.jobs} />
      ) : (
        <ul className="space-y-3" aria-label={`${JOB_VIEW_LABELS[view]} jobs`}>
          {state.data.jobs.map((job) => (
            <JobCard key={job.id} job={job} notTold={customerNotTold(state.data.messages[job.id], job.status)} />
          ))}
        </ul>
      )}
    </div>
  )
}

function OpenJobs({ jobs }: { jobs: OrderSummary[] }) {
  return (
    <div className="space-y-5">
      {groupOpenJobs(jobs).map(({ group, jobs: inGroup }) => (
        <section key={group} aria-labelledby={`jobs-${group}`}>
          <h3
            id={`jobs-${group}`}
            className={`mb-2.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider ${group === 'overdue' ? 'text-danger' : 'text-ink-faint'}`}
          >
            {OPEN_JOB_GROUP_LABELS[group]} ({inGroup.length})
            <span className="h-px flex-1 bg-line" aria-hidden="true" />
          </h3>
          <ul className="space-y-3">
            {inGroup.map((job) => (
              <JobCard key={job.id} job={job} overdue={group === 'overdue'} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
