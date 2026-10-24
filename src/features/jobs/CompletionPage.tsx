import { useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Dialog } from '../../components/Dialog'
import { Field, ReadOnlyField } from '../../components/Field'
import { Notice } from '../../components/Notice'
import { BUTTON, CARD, INPUT, LINK } from '../../components/styles'
import {
  COMPLETION_FORM_FIELDS,
  EMPTY_COMPLETION_FORM,
  completionFinalAmount,
  completionToFormValues,
  formatMYR,
  validateCompletionForm,
  type CompletionFormErrors,
  type CompletionFormValues,
  type CompletionInput,
} from '../../domain'
import { isNetworkError } from '../../lib/api'
import { clearDraft, loadDraft, saveDraft } from '../../lib/drafts'
import { useLoad } from '../../lib/useLoad'
import { JobFiles, type JobFilesStatus } from '../attachments'
import { fetchJob, submitCompletion, type JobDetail } from './api'
import { BackLink } from '../../components/ui'
import { SendHorizontal } from 'lucide-react'
import { ActionBar } from '../../components/ActionBar'

const fieldId = (field: keyof CompletionFormValues) => `completion-${field}`

/** Load the job; only an In Progress job can be completed. */
export function CompletionPage() {
  const { orderNo = '' } = useParams()
  const [state, reload] = useLoad(() => fetchJob(orderNo), orderNo)

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
        <p>{orderNo} is not in your jobs.</p>
        <Link to="/jobs" className={`${LINK} mt-3 inline-block`}>
          Back to my jobs
        </Link>
      </Notice>
    )
  }
  if (state.data.job.status !== 'in_progress') {
    return (
      <Notice title={state.data.job.status === 'job_done' ? 'Already submitted' : 'Not in progress'}>
        <p>
          {state.data.job.status === 'job_done'
            ? `${orderNo} has been submitted and is waiting for review.`
            : `Start ${orderNo} before recording the work done.`}
        </p>
        <Link to={`/jobs/${encodeURIComponent(orderNo)}`} className={`${LINK} mt-3 inline-block`}>
          Back to the job
        </Link>
      </Notice>
    )
  }
  return <CompletionForm detail={state.data} />
}

/**
 * The brief's completion form (PRD AC5): Order ID, work done, extra charges,
 * files, final amount (live), remarks, technician and time. Typed text is
 * kept as a draft on the phone until it is submitted.
 */
function CompletionForm({ detail }: { detail: JobDetail }) {
  const { job, completion } = detail
  const navigate = useNavigate()
  const draftKey = `completion:${job.id}`
  const [restored] = useState(() => loadDraft<CompletionFormValues>(draftKey))
  const [values, setValues] = useState<CompletionFormValues>(
    () => restored ?? (completion ? completionToFormValues(completion) : EMPTY_COMPLETION_FORM),
  )
  const [errors, setErrors] = useState<CompletionFormErrors>({})
  const [checked, setChecked] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [files, setFiles] = useState<JobFilesStatus>({ count: 0, busy: false, failed: 0 })
  const [askNoFiles, setAskNoFiles] = useState(false)
  const [saving, setSaving] = useState(false)
  const inFlight = useRef(false)

  const finalAmount = completionFinalAmount(job.quoted_price, values.extraCharges)

  function change(field: keyof CompletionFormValues, value: string) {
    const next = { ...values, [field]: value }
    setValues(next)
    saveDraft(draftKey, next)
    if (checked) {
      const result = validateCompletionForm(next)
      setErrors(result.ok ? {} : result.errors)
    }
  }

  async function save(input: CompletionInput) {
    if (inFlight.current) return
    inFlight.current = true
    setSaving(true)
    setFormError(null)
    try {
      await submitCompletion(job.id, input)
      done()
    } catch (e) {
      // The answer may have been lost after the save went through: check.
      if (isNetworkError(e) || /currently Job Done/.test((e as Error).message)) {
        const fresh = await fetchJob(job.order_no).catch(() => null)
        if (fresh?.job.status === 'job_done') {
          done()
          return
        }
      }
      setFormError((e as Error).message)
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }

  function done() {
    clearDraft(draftKey)
    navigate(`/jobs/${encodeURIComponent(job.order_no)}?submitted=1`)
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (inFlight.current) return
    setChecked(true)
    setFormError(null)
    const result = validateCompletionForm(values)
    if (!result.ok) {
      setErrors(result.errors)
      const first = COMPLETION_FORM_FIELDS.find((f) => result.errors[f])
      if (first) document.getElementById(fieldId(first))?.focus()
      return
    }
    setErrors({})
    if (files.busy) {
      setFormError('Wait for the files to finish uploading.')
      return
    }
    if (files.failed > 0) {
      setFormError('Retry or remove the files that did not upload.')
      return
    }
    if (files.count === 0) {
      setAskNoFiles(true)
      return
    }
    void save(result.input)
  }

  return (
    <form noValidate onSubmit={submit} aria-label="Complete job" className="space-y-4">
      <BackLink to={`/jobs/${encodeURIComponent(job.order_no)}`}>Back to the job</BackLink>
      <h2 className="text-xl font-semibold">Complete job</h2>

      {restored ? (
        <p role="status" className="rounded-md border border-brand/30 bg-brand-soft px-3 py-2 text-sm text-brand-ink">
          Restored what you typed earlier on this phone.
        </p>
      ) : null}
      {formError ? (
        <p role="alert" className="rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger-ink">
          {formError}
        </p>
      ) : null}

      <div className={`${CARD} space-y-4`}>
        <ReadOnlyField label="Order ID">{job.order_no}</ReadOnlyField>
        <Field id={fieldId('workDone')} label="Work done" error={errors.workDone}>
          {(control) => (
            <textarea
              {...control}
              rows={4}
              maxLength={2000}
              value={values.workDone}
              onChange={(e) => change('workDone', e.target.value)}
              className={INPUT}
            />
          )}
        </Field>
        <Field
          id={fieldId('extraCharges')}
          label="Extra charges (RM)"
          hint="Leave empty if none"
          optional
          error={errors.extraCharges}
        >
          {(control) => (
            <input
              {...control}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={values.extraCharges}
              onChange={(e) => change('extraCharges', e.target.value)}
              className={INPUT}
            />
          )}
        </Field>
        <div className="rounded-md bg-sunken px-3 py-2 text-sm">
          <p className="text-ink-muted">
            Quoted price {formatMYR(job.quoted_price)}
            {finalAmount !== null && finalAmount !== job.quoted_price
              ? ` + extra ${formatMYR(finalAmount - job.quoted_price)}`
              : ''}
          </p>
          <p className="mt-0.5 text-base">
            Final amount:{' '}
            <output aria-live="polite" className="font-semibold">
              {finalAmount === null ? '—' : formatMYR(finalAmount)}
            </output>
          </p>
        </div>
      </div>

      <section className={CARD} aria-label="Photos and files">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-muted">Photos, videos and PDFs</h3>
        <JobFiles orderId={job.id} canChange onStatus={setFiles} />
      </section>

      <div className={`${CARD} space-y-4`}>
        <Field
          id={fieldId('remarks')}
          label="Remarks"
          hint="Required when there are extra charges: say what they are for"
          optional={!(finalAmount !== null && finalAmount > job.quoted_price)}
          error={errors.remarks}
        >
          {(control) => (
            <textarea
              {...control}
              rows={3}
              maxLength={1000}
              value={values.remarks}
              onChange={(e) => change('remarks', e.target.value)}
              className={INPUT}
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <ReadOnlyField label="Technician">{job.technician_name ?? '—'}</ReadOnlyField>
          <ReadOnlyField label="Timestamp">Recorded when you submit</ReadOnlyField>
        </div>
      </div>

      <ActionBar label="Submit">
        <button type="submit" disabled={saving} className={`${BUTTON.primary} min-h-12 w-full text-base`}>
          <SendHorizontal aria-hidden="true" />
          {saving ? 'Submitting…' : 'Submit job'}
        </button>
      </ActionBar>

      {askNoFiles ? (
        <Dialog title="Submit without photos?" onClose={() => setAskNoFiles(false)}>
          <p className="text-sm text-ink-muted">
            No photos, videos or PDFs are attached. The manager will review the job without them.
          </p>
          <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={() => setAskNoFiles(false)} className={`${BUTTON.secondary} min-h-11`}>
              Add photos
            </button>
            <button
              type="button"
              onClick={() => {
                setAskNoFiles(false)
                const result = validateCompletionForm(values)
                if (result.ok) void save(result.input)
              }}
              className={`${BUTTON.primary} min-h-11`}
            >
              Submit without photos
            </button>
          </div>
        </Dialog>
      ) : null}
    </form>
  )
}
