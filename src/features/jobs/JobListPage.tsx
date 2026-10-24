import { Link, useSearchParams } from 'react-router'
import { Notice } from '../../components/Notice'
import { BUTTON, CARD } from '../../components/styles'
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
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">My jobs</h2>
        <button type="button" onClick={reload} className={`${BUTTON.secondary} min-h-11`}>
          Refresh
        </button>
      </div>

      <nav aria-label="Job lists" className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1">
        {JOB_VIEWS.map((v) => (
          <Link
            key={v}
            to={v === 'open' ? '/jobs' : `/jobs?tab=${v}`}
            aria-current={v === view ? 'page' : undefined}
            className={`flex min-h-11 items-center justify-center rounded-md text-sm font-medium focus:outline-none focus:ring-2 focus:ring-sky-300 ${
              v === view ? 'bg-white text-sky-900 shadow-sm' : 'text-slate-700 hover:bg-white/60'
            }`}
          >
            {JOB_VIEW_LABELS[v]}
          </Link>
        ))}
      </nav>

      {state.status === 'loading' ? (
        <p className="text-sm text-slate-600" role="status">
          Loading your jobs…
        </p>
      ) : state.status === 'error' ? (
        <Notice tone="error" title="Could not load your jobs">
          <p>{state.message}</p>
          <button type="button" onClick={reload} className="mt-3 min-h-11 font-medium underline">
            Try again
          </button>
        </Notice>
      ) : state.data.jobs.length === 0 ? (
        <div className={`${CARD} text-center`}>
          <p className="text-sm text-slate-700">{EMPTY[view]}</p>
        </div>
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
            className={`mb-2 text-sm font-semibold uppercase tracking-wide ${group === 'overdue' ? 'text-red-700' : 'text-slate-600'}`}
          >
            {OPEN_JOB_GROUP_LABELS[group]} ({inGroup.length})
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
