import { useRef, useState, type ReactNode } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { Dialog } from '../../components/Dialog'
import { Notice } from '../../components/Notice'
import { RescheduleDialog } from '../../components/RescheduleDialog'
import { StatusBadge } from '../../components/StatusBadge'
import { BUTTON, CARD, LINK } from '../../components/styles'
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
import { JobFiles, PaymentList } from '../attachments'
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
    return (
      <Notice title="Loading…">
        <p>Getting job {orderNo}.</p>
      </Notice>
    )
  }
  if (state.status === 'error') {
    return (
      <Notice tone="error" title="Could not load the job">
        <p>{state.message}</p>
        <button type="button" onClick={reload} className="mt-3 min-h-11 font-medium underline">
          Try again
        </button>
      </Notice>
    )
  }
  if (!state.data) {
    return (
      <Notice tone="error" title="Job not found">
        <p>{orderNo} is not in your jobs. It may have been reassigned to another technician.</p>
        <Link to="/jobs" className={`${LINK} mt-3 inline-block`}>
          Back to my jobs
        </Link>
      </Notice>
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
      <Link to="/jobs" className={`${LINK} inline-flex min-h-11 items-center text-sm`}>
        ← My jobs
      </Link>

      {flash ? (
        <div
          role="status"
          className="flex items-start justify-between gap-4 rounded-md border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-900"
        >
          <p>
            {flash}
            {params.get('submitted') && canPay && job.balance > 0 ? (
              <>
                {' '}
                <Link to={`${jobUrl}/payment`} className="font-medium underline">
                  Record the payment ({formatMYR(job.balance)})
                </Link>
              </>
            ) : null}
          </p>
          <button type="button" onClick={() => setFlash(null)} className="font-medium underline">
            Dismiss
          </button>
        </div>
      ) : null}
      {actionError ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          {actionError}
        </p>
      ) : null}

      <header>
        <h2 className="flex flex-wrap items-center gap-3 text-2xl font-semibold">
          {job.order_no} <StatusBadge status={job.status} />
        </h2>
        <p className="mt-1 text-base font-medium text-slate-800">{job.service_type_name}</p>
        <p className="text-sm text-slate-600">
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
        <section role="note" aria-label="Returned for rework" className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <p className="font-semibold">Returned for rework</p>
          <p className="mt-1 whitespace-pre-line break-words">{rework.note}</p>
          <p className="mt-1 text-amber-900">
            {staffName(rework.by, rework.by_id)}, {formatMalaysiaDateTime(rework.at)}
          </p>
        </section>
      ) : null}
      {job.status === 'cancelled' ? (
        <section role="note" className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          This job was cancelled. Nothing more to do.
        </section>
      ) : null}

      <section className={CARD} aria-label="Customer">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-600">Customer</h3>
        <p className="mt-2 text-base font-medium">{job.customer_name}</p>
        <p className="text-sm text-slate-700">{formatMyPhone(job.customer_phone)}</p>
        <p className="mt-1 whitespace-pre-line break-words text-sm text-slate-700">{job.customer_address}</p>
        {job.status !== 'cancelled' ? (
          <div className="mt-3">
            <ContactLinks job={job} />
          </div>
        ) : null}
      </section>

      <section className={CARD} aria-label="Job details">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-600">Job</h3>
        <dl className="mt-2 space-y-2 text-sm">
          <Row label="Problem">{job.problem_description}</Row>
          {job.admin_notes ? <Row label="Notes from the office">{job.admin_notes}</Row> : null}
          <Row label="Branch">{job.branch_name}</Row>
        </dl>
      </section>

      <section className={CARD} aria-label="Money">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-600">Money</h3>
        <dl className="mt-2 space-y-1 text-sm">
          <Row label="Quoted price">{formatMYR(job.quoted_price)}</Row>
          <Row label="Extra charges">{formatMYR(job.extra_charges)}</Row>
          <Row label="Final amount">
            <strong>{formatMYR(job.final_amount)}</strong>
          </Row>
          <Row label="Paid">
            {formatMYR(job.amount_paid)} ({PAYMENT_STATUS_LABELS[job.payment_status]})
          </Row>
          {job.balance > 0 && job.status !== 'cancelled' ? (
            <Row label="To collect">
              <strong>{formatMYR(job.balance)}</strong>
            </Row>
          ) : null}
        </dl>
        <PaymentList payments={payments} className="mt-3 border-t border-slate-100 pt-3" />
      </section>

      {FILE_STATUSES.includes(job.status) ? (
        <section className={CARD} aria-label="Photos and files">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-600">Photos and files</h3>
          <JobFiles orderId={job.id} canChange={canChangeJobFiles(job.status, 'technician', true)} />
        </section>
      ) : null}

      {completion ? (
        <section className={CARD} aria-label={inRework ? 'Previous completion record' : 'Completion record'}>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
            {inRework ? 'Previous completion record' : 'Completion record'}
          </h3>
          <dl className="mt-2 space-y-2 text-sm">
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
        <div className="sticky bottom-0 -mx-4 flex flex-wrap gap-2 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
          {canAccept ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void act(() => acceptJob(job.id), 'Job accepted.')}
              className={`${BUTTON.primary} min-h-11 flex-1`}
            >
              {busy ? 'Saving…' : 'Accept job'}
            </button>
          ) : null}
          {canStart ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => setDialog('start')}
              className={`${canAccept ? BUTTON.secondary : BUTTON.primary} min-h-11 flex-1`}
            >
              Start job
            </button>
          ) : null}
          {canComplete ? (
            <Link to={`${jobUrl}/complete`} className={`${BUTTON.primary} min-h-11 flex-1`}>
              {inRework ? 'Fix and resubmit' : 'Complete job'}
            </Link>
          ) : null}
          {canPay ? (
            <Link to={`${jobUrl}/payment`} className={`${BUTTON.secondary} min-h-11 flex-1`}>
              Record payment
            </Link>
          ) : null}
          {canReschedule ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => setDialog('reschedule')}
              className={`${BUTTON.secondary} min-h-11 flex-1`}
            >
              Reschedule
            </button>
          ) : null}
        </div>
      ) : null}

      {dialog === 'start' ? (
        <Dialog title={`Start ${job.order_no} now?`} onClose={() => setDialog(null)}>
          <p className="text-sm text-slate-700">
            The office will see this job as In Progress. You cannot undo this yourself.
          </p>
          <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
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
    <div className="grid grid-cols-[8rem_1fr] gap-2">
      <dt className="text-slate-600">{label}</dt>
      <dd className="whitespace-pre-line break-words text-slate-900">{children}</dd>
    </div>
  )
}
