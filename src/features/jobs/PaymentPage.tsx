import { Link, useNavigate, useParams } from 'react-router'
import { Notice } from '../../components/Notice'
import { LINK } from '../../components/styles'
import { canRecordPayment } from '../../domain'
import { useLoad } from '../../lib/useLoad'
import type { PhotoCodec } from '../attachments/resize'
import { PaymentForm } from '../payments'
import { fetchJob, recordPayment } from './api'

/** Load the job; payments are recorded while In Progress, Job Done or Reviewed. */
export function PaymentPage({ codec, newId }: { codec?: PhotoCodec; newId?: () => string } = {}) {
  const { orderNo = '' } = useParams()
  const navigate = useNavigate()
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
  if (!state.data || !canRecordPayment(state.data.job.status, 'technician', true)) {
    return (
      <Notice tone="error" title={state.data ? 'Payments cannot be recorded now' : 'Job not found'}>
        <p>
          {state.data
            ? 'Payments are recorded while the job is In Progress, Job Done or Reviewed.'
            : `${orderNo} is not in your jobs.`}
        </p>
        <Link to={state.data ? `/jobs/${encodeURIComponent(orderNo)}` : '/jobs'} className={`${LINK} mt-3 inline-block`}>
          {state.data ? 'Back to the job' : 'Back to my jobs'}
        </Link>
      </Notice>
    )
  }
  const jobPath = `/jobs/${encodeURIComponent(state.data.job.order_no)}`
  return (
    <PaymentForm
      order={state.data.job}
      backTo={jobPath}
      backLabel="Back to the job"
      record={recordPayment}
      onDone={() => navigate(`${jobPath}?paid=1`)}
      codec={codec}
      newId={newId ?? (() => crypto.randomUUID())}
    />
  )
}
