import { useRef, useState, type ReactNode } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { Ban, Banknote, CalendarClock, Check, CircleCheckBig, Clock, Play, RotateCcw, SearchX } from 'lucide-react'
import { ActionBar } from '../../components/ActionBar'
import { Dialog } from '../../components/Dialog'
import { RescheduleDialog } from '../../components/RescheduleDialog'
import { StatusBadge } from '../../components/StatusBadge'
import { initials } from '../../components/shell/UserMenu'
import { BUTTON, CARD, EYEBROW } from '../../components/styles'
import { Toast } from '../../components/Toast'
import { BackLink, EmptyState, ErrorState, LoadingState } from '../../components/ui'
import {
  availableTransitions,
  canChangeJobFiles,
  canManageCustomerMessage,
  canRecordPayment,
  canRescheduleOrder,
  formatMalaysiaDateTime,
  formatMYR,
  formatMyPhone,
  type OrderStatus,
} from '../../domain'
import { JobFiles, OrderFormLink, PaymentList } from '../attachments'
import { CustomerMessagePanel } from '../customer-messages'
import { FeedbackCard } from '../feedback'
import { ReviewOutcome } from '../order-review'
import { useLoad } from '../../lib/useLoad'
import { staffName } from '../../lib/staffStatus'
import { useRefreshOnReturn } from '../../lib/useRefreshOnReturn'
import { acceptJob, fetchJob, rescheduleJob, startJob, type JobDetail } from './api'
import { ContactLinks } from './ContactLinks'

type DialogName = 'start' | 'reschedule'

const PAYMENT_STATUS_LABELS = { unpaid: 'Unpaid', partial: 'Partly paid', paid: 'Paid' } as const

/** Statuses in which the job's files are shown (they can only exist once work started). */
const FILE_STATUSES: readonly OrderStatus[] = ['in_progress', 'job_done', 'reviewed', 'closed']

/** One job for the technician: details, contact, accept / start, reschedule (PRD AC3, AC4, AC9, AC11). */
export function JobPage() {
  const { orderNo = '' } = useParams()
  const [state, reload] = useLoad(() => fetchJob(orderNo), orderNo)
  useRefreshOnReturn(reload)
  const [dialog, setDialog] = useState<DialogName | null>(null)
  const [params] = useSearchParams()
  const [flash, setFlash] = useState<string | null>(() => {
    if (params.get('submitted')) return 'Job submitted. Your manager has been told and will review it.'
    if (params.get('paid')) return 'Payment recorded. Finance has been told.'
    return null
  })
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [feedbackKey, setFeedbackKey] = useState(0)
  const inFlight = useRef(false)

  if (state.status === 'loading') {
    return <LoadingState variant="page" label={`Loading… Getting job ${orderNo}.`} />
  }
  if (state.status === 'error') {
    return (
      <ErrorState title="Could not load the job" onRetry={reload}>
        <p>{state.message}</p>
      </ErrorState>
    )
  }
  if (!state.data) {
    return (
      <EmptyState
        title="Job not found"
        icon={<SearchX className="size-5" />}
        action={
          <Link to="/jobs" className={BUTTON.secondary}>
            Back to my jobs
          </Link>
        }
      >
        <p>{orderNo} is not in your jobs. It may have been reassigned to another technician.</p>
      </EmptyState>
    )
  }

  const detail: JobDetail = state.data
  const { job, completion, payments, rework } = detail
  const moves = availableTransitions(job.status, 'technician')
  const canAccept = moves.some((m) => m.to === 'acknowledged')
  const canStart = moves.some((m) => m.to === 'in_progress')
  const canReschedule = canRescheduleOrder(job.status)
  const inRework = job.status === 'in_progress' && completion !== null && rework !== null
  const canComplete = job.status === 'in_progress'
  const canPay = canRecordPayment(job.status, 'technician', true)
  const jobUrl = `/jobs/${encodeURIComponent(job.order_no)}`
  const toCollect = job.balance > 0 && job.status !== 'cancelled'

  async function act(action: () => Promise<void>, done: string) {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setActionError(null)
    try {
      await action()
      setDialog(null)
      setFlash(done)
      reload()
    } catch (e) {
      setDialog(null)
      setActionError((e as Error).message)
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  const hasActions = canAccept || canStart || canComplete || canPay || canReschedule

  return (
    <div className="space-y-4">
      <BackLink to="/jobs">My jobs</BackLink>

      {flash ? (
        <Toast key={flash} onDismiss={() => setFlash(null)}>
          <p>
            {flash}
            {params.get('submitted') && canPay && job.balance > 0 ? (
              <>
                {' '}
                <Link to={`${jobUrl}/payment`} className="font-medium text-brand underline">
                  Record the payment ({formatMYR(job.balance)})
                </Link>
              </>
            ) : null}
          </p>
        </Toast>
      ) : null}
      {actionError ? (
        <p role="alert" className="rounded-xl border border-danger/35 bg-danger-soft px-4 py-3 text-sm text-danger-ink">
          {actionError}
        </p>
      ) : null}

      <header>
        <h2 className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-sm font-medium tracking-wide text-ink-faint">{job.order_no}</span>
          <StatusBadge status={job.status} />
        </h2>
        <p className="mt-1.5 text-2xl font-semibold tracking-tight text-ink">{job.service_type_name}</p>
        <p className="mt-1 flex items-center gap-2 text-sm text-ink-muted">
          <Clock className="size-4 text-ink-faint" aria-hidden="true" />
          {job.scheduled_at ? formatMalaysiaDateTime(job.scheduled_at) : 'No date yet'}
        </p>
      </header>

      <ReviewOutcome orderId={job.id} status={job.status} />

      <CustomerMessagePanel
        orderId={job.id}
        orderStatus={job.status}
        canManage={canManageCustomerMessage(job.status, 'technician', true)}
        onChange={() => setFeedbackKey((k) => k + 1)}
      />

      <FeedbackCard orderId={job.id} orderStatus={job.status} role="technician" refreshKey={feedbackKey} />

      {inRework ? (
        <section
          role="note"
          aria-label="Returned for rework"
          className="flex gap-3 rounded-xl border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-warning-ink"
        >
          <RotateCcw className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-semibold">Returned for rework</p>
            <p className="mt-1 whitespace-pre-line break-words">{rework.note}</p>
            <p className="mt-1 text-xs opacity-90">
              {staffName(rework.by, rework.by_id)}, {formatMalaysiaDateTime(rework.at)}
            </p>
          </div>
        </section>
      ) : null}
      {job.status === 'cancelled' ? (
        <section role="note" className="flex gap-3 rounded-xl border border-danger/35 bg-danger-soft px-4 py-3 text-sm text-danger-ink">
          <Ban className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          This job was cancelled. Nothing more to do.
        </section>
      ) : null}

      <section className={CARD} aria-label="Customer">
        <h3 className={EYEBROW}>Customer</h3>
        <div className="mt-2 flex items-start gap-3">
          <span
            aria-hidden="true"
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-semibold text-brand-ink"
          >
            {initials(job.customer_name)}
          </span>
          <div className="min-w-0">
            <p className="text-base font-semibold">{job.customer_name}</p>
            <p className="text-sm text-ink-muted tabular">{formatMyPhone(job.customer_phone)}</p>
            <p className="mt-1 whitespace-pre-line break-words text-sm text-ink-muted">{job.customer_address}</p>
          </div>
        </div>
        {job.status !== 'cancelled' ? (
          <div className="mt-4">
            <ContactLinks job={job} />
          </div>
        ) : null}
      </section>

      <section className={CARD} aria-label="Job details">
        <h3 className={EYEBROW}>Job</h3>
        <dl className="mt-3 space-y-2.5 text-sm">
          <Row label="Problem">{job.problem_description}</Row>
          {job.admin_notes ? <Row label="Notes from the office">{job.admin_notes}</Row> : null}
          <Row label="Branch">{job.branch_name}</Row>
        </dl>
        <OrderFormLink orderId={job.id} />
      </section>

      <section className={CARD} aria-label="Money">
        <h3 className={EYEBROW}>Money</h3>
        <dl className="mt-3 space-y-1.5 text-sm tabular">
          <Row label="Quoted price">{formatMYR(job.quoted_price)}</Row>
          <Row label="Extra charges">{formatMYR(job.extra_charges)}</Row>
          <Row label="Final amount">
            <strong>{formatMYR(job.final_amount)}</strong>
          </Row>
          <Row label="Paid">
            {formatMYR(job.amount_paid)} ({PAYMENT_STATUS_LABELS[job.payment_status]})
          </Row>
        </dl>
        {toCollect ? (
          <dl className="mt-3 flex items-center justify-between rounded-lg bg-brand-soft px-3 py-2.5 text-brand-ink">
            <dt className="text-sm font-medium">To collect</dt>
            <dd className="text-lg font-semibold tabular">{formatMYR(job.balance)}</dd>
          </dl>
        ) : null}
        <PaymentList payments={payments} className="mt-3 border-t border-line pt-3" />
      </section>

      {FILE_STATUSES.includes(job.status) ? (
        <section className={CARD} aria-label="Photos and files">
          <h3 className={`${EYEBROW} mb-3`}>Photos and files</h3>
          <JobFiles orderId={job.id} canChange={canChangeJobFiles(job.status, 'technician', true)} />
        </section>
      ) : null}

      {completion ? (
        <section className={CARD} aria-label={inRework ? 'Previous completion record' : 'Completion record'}>
          <h3 className={EYEBROW}>{inRework ? 'Previous completion record' : 'Completion record'}</h3>
          <dl className="mt-3 space-y-2.5 text-sm">
            <Row label="Work done">{completion.work_done}</Row>
            <Row label="Extra charges">{formatMYR(completion.extra_charges)}</Row>
            {completion.remarks ? <Row label="Remarks">{completion.remarks}</Row> : null}
            <Row label="Submitted">
              {staffName(completion.technician_name, completion.technician_id)}, {formatMalaysiaDateTime(completion.completed_at)}
            </Row>
          </dl>
        </section>
      ) : null}

      {hasActions ? (
        <ActionBar>
          {canAccept ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void act(() => acceptJob(job.id), 'Job accepted.')}
              className={`${BUTTON.primary} min-h-12 w-full text-base`}
            >
              <Check aria-hidden="true" />
              {busy ? 'Saving…' : 'Accept job'}
            </button>
          ) : null}
          {canStart ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => setDialog('start')}
              className={`${canAccept ? BUTTON.secondary : BUTTON.primary} min-h-12 w-full text-base`}
            >
              <Play aria-hidden="true" />
              Start job
            </button>
          ) : null}
          {canComplete ? (
            <Link to={`${jobUrl}/complete`} className={`${BUTTON.primary} min-h-12 w-full text-base`}>
              <CircleCheckBig aria-hidden="true" />
              {inRework ? 'Fix and resubmit' : 'Complete job'}
            </Link>
          ) : null}
          {canPay || canReschedule ? (
            <div className="flex gap-2">
              {canPay ? (
                <Link to={`${jobUrl}/payment`} className={`${BUTTON.secondary} min-h-11 flex-1 whitespace-nowrap px-3`}>
                  <Banknote aria-hidden="true" />
                  Record payment
                </Link>
              ) : null}
              {canReschedule ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setDialog('reschedule')}
                  className={`${BUTTON.secondary} min-h-11 flex-1 whitespace-nowrap px-3`}
                >
                  <CalendarClock aria-hidden="true" />
                  Reschedule
                </button>
              ) : null}
            </div>
          ) : null}
        </ActionBar>
      ) : null}

      {dialog === 'start' ? (
        <Dialog title={`Start ${job.order_no} now?`} onClose={() => setDialog(null)}>
          <p className="text-sm text-ink-muted">
            The office will see this job as In Progress. You cannot undo this yourself.
          </p>
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={() => setDialog(null)} className={`${BUTTON.secondary} min-h-11`} disabled={busy}>
              Not yet
            </button>
            <button
              type="button"
              onClick={() => void act(() => startJob(job.id), 'Job started.')}
              className={`${BUTTON.primary} min-h-11`}
              disabled={busy}
            >
              {busy ? 'Starting…' : 'Start job'}
            </button>
          </div>
        </Dialog>
      ) : null}
      {dialog === 'reschedule' && canReschedule ? (
        <RescheduleDialog
          order={job}
          save={(newScheduledAt, reason, requestedBy, note) =>
            rescheduleJob(job.id, newScheduledAt, reason, requestedBy, note)
          }
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null)
            setFlash('New date saved.')
            reload()
          }}
        />
      ) : null}
    </div>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(7rem,9rem)_1fr] gap-3">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="whitespace-pre-line break-words text-ink">{children}</dd>
    </div>
  )
}
