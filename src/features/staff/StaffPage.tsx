import { useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { Dialog } from '../../components/Dialog'
import { Notice } from '../../components/Notice'
import { StatusBadge } from '../../components/StatusBadge'
import { BUTTON, CARD, LINK } from '../../components/styles'
import {
  ROLE_LABELS,
  SIGN_IN_STATE_LABELS,
  STAFF_HISTORY_LABELS,
  describeStaffChanges,
  formatMalaysiaDate,
  formatMalaysiaDateTime,
  formatMyPhone,
  staffLabel,
} from '../../domain'
import { useInactiveStaff } from '../../lib/staffStatus'
import { useLoad } from '../../lib/useLoad'
import { fetchStaffDetail, staffAccess, type RetryAction, type StaffAccessAction, type StaffDetail } from './api'
import type { StaffFlash } from './StaffFormPage'

const RETRY_LABELS: Record<RetryAction, string> = {
  resend_invite: 'Send the invite again',
  reset_password: 'Send the password email again',
  retry_block: 'Block their sign-in again',
  retry_unblock: 'Unblock their sign-in again',
  retry_email: 'Change the sign-in email again',
}

type Confirm = 'deactivate' | 'reactivate' | 'resend_invite' | 'reset_password' | null

/**
 * One staff member (0006): details, sign-in state, what the signed-in person
 * may do (decided by the database), open jobs, and the history of changes.
 */
export function StaffPage({ orderPath }: { orderPath: (orderNo: string) => string }) {
  const { staffId = '' } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const [state, reload] = useLoad(() => fetchStaffDetail(staffId), staffId)
  const [flash, setFlash] = useState<StaffFlash | null>(
    () => ((location.state as { flash?: StaffFlash } | null)?.flash ?? null),
  )
  const [confirm, setConfirm] = useState<Confirm>(null)
  // The flash came with the page; drop it from history so a reload does not show it again.
  useEffect(() => {
    if ((location.state as { flash?: StaffFlash } | null)?.flash) navigate('.', { replace: true, state: null })
  }, [location.state, navigate])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inactive = useInactiveStaff()

  const act = async (action: StaffAccessAction) => {
    setBusy(true)
    setError(null)
    try {
      const res = await staffAccess(action, { staffId })
      setFlash({ message: res.message, warning: res.warning, retry: res.retry })
      setConfirm(null)
      reload()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (state.status === 'loading') return <p role="status" className="text-sm text-slate-600">Loading…</p>
  if (state.status === 'error') {
    return (
      <Notice tone="error" title="Could not load this staff member">
        <p>{state.message}</p>
        <Link to="/staff" className={`${LINK} mt-2 inline-block`}>
          Back to staff
        </Link>
      </Notice>
    )
  }

  const d: StaffDetail = state.data
  const s = d.staff
  const p = d.permissions
  const anyAction = p.can_edit || p.can_deactivate || p.can_reactivate || p.can_send_invite || p.can_reset_password

  return (
    <div className="space-y-4">
      <Link to="/staff" className={`${LINK} text-sm`}>
        ← Back to staff
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-semibold">{s.name}</h2>
        {s.active ? (
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">Active</span>
        ) : (
          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700">Inactive</span>
        )}
      </div>

      {flash ? <FlashBanner flash={flash} busy={busy} onRetry={(a) => void act(a)} /> : null}
      {error && !confirm ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <section className={`${CARD} lg:col-span-2`} aria-labelledby="staff-details-title">
          <h3 id="staff-details-title" className="font-semibold">
            Details
          </h3>
          <dl className="mt-3 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <Item label="Role">{ROLE_LABELS[s.role]}</Item>
            <Item label="Home branch">{s.branch_name}</Item>
            {s.role === 'manager' ? (
              <Item label="Also covers">{s.additional_branch_names.length ? s.additional_branch_names.join(', ') : 'No other branches'}</Item>
            ) : null}
            <Item label="Email">
              <span className="break-words">{s.email}</span>
            </Item>
            <Item label="Phone">{formatMyPhone(s.phone)}</Item>
            <Item label="Joined">{formatMalaysiaDate(s.joined_at)}</Item>
            {s.left_at ? <Item label="Left">{formatMalaysiaDate(s.left_at)}</Item> : null}
            <Item label="Sign-in">{s.active ? SIGN_IN_STATE_LABELS[s.sign_in_state] : 'Blocked (inactive)'}</Item>
          </dl>
        </section>

        {anyAction ? (
          <section className={`${CARD} space-y-2`} aria-labelledby="staff-actions-title">
            <h3 id="staff-actions-title" className="font-semibold">
              Actions
            </h3>
            {p.can_edit ? (
              <Link to={`/staff/${s.id}/edit`} className={`${BUTTON.secondary} w-full`}>
                Edit details
              </Link>
            ) : null}
            {p.can_send_invite ? (
              <button type="button" className={`${BUTTON.secondary} w-full`} onClick={() => setConfirm('resend_invite')}>
                {s.sign_in_state === 'none' ? 'Send invite' : 'Send invite again'}
              </button>
            ) : null}
            {p.can_reset_password ? (
              <button type="button" className={`${BUTTON.secondary} w-full`} onClick={() => setConfirm('reset_password')}>
                Send password reset
              </button>
            ) : null}
            {p.can_deactivate ? (
              <button type="button" className={`${BUTTON.danger} w-full`} onClick={() => setConfirm('deactivate')}>
                Deactivate
              </button>
            ) : null}
            {p.can_reactivate ? (
              <button type="button" className={`${BUTTON.primary} w-full`} onClick={() => setConfirm('reactivate')}>
                Reactivate
              </button>
            ) : null}
          </section>
        ) : null}
      </div>

      {d.open_jobs.length > 0 ? (
        <section className={CARD} aria-labelledby="open-jobs-title">
          <h3 id="open-jobs-title" className="font-semibold">
            Open jobs ({d.open_jobs.length})
          </h3>
          <ul className="mt-2 divide-y divide-slate-100 text-sm">
            {d.open_jobs.map((j) => (
              <li key={j.order_id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <Link to={orderPath(j.order_no)} className={LINK}>
                  {j.order_no}
                </Link>
                <span className="text-slate-600">{j.branch_name}</span>
                <StatusBadge status={j.status} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className={CARD} aria-labelledby="staff-history-title">
        <h3 id="staff-history-title" className="font-semibold">
          History
        </h3>
        <ol className="mt-2 divide-y divide-slate-100 text-sm">
          {d.history.map((h) => (
            <li key={h.id} className="py-2">
              <p>
                <span className="font-medium">{STAFF_HISTORY_LABELS[h.action]}</span>
                <span className="text-slate-600">
                  {' '}
                  · {formatMalaysiaDateTime(h.created_at)} ·{' '}
                  {h.actor_name ? `by ${staffLabel(h.actor_name, !(h.actor_id && inactive.has(h.actor_id)))}` : 'by set-up'}
                </span>
              </p>
              {h.action !== 'invite_sent' && h.action !== 'password_reset' ? (
                <ul className="mt-0.5 text-slate-700">
                  {describeStaffChanges(h.changes, formatMyPhone).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-slate-700">To {String(h.changes.email?.to ?? '')}</p>
              )}
            </li>
          ))}
        </ol>
      </section>

      {confirm ? (
        <ConfirmDialog
          kind={confirm}
          detail={d}
          orderPath={orderPath}
          busy={busy}
          error={error}
          onCancel={() => {
            setConfirm(null)
            setError(null)
          }}
          onConfirm={() => void act(confirm)}
        />
      ) : null}
    </div>
  )
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  )
}

function FlashBanner({ flash, busy, onRetry }: { flash: StaffFlash; busy: boolean; onRetry: (a: RetryAction) => void }) {
  const retry = flash.retry as RetryAction | undefined
  return (
    <div
      role="status"
      className={`rounded-md border px-3 py-2 text-sm ${flash.warning ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-green-300 bg-green-50 text-green-900'}`}
    >
      <p>{flash.message}</p>
      {flash.warning ? <p className="mt-1 font-medium">{flash.warning}</p> : null}
      {retry && RETRY_LABELS[retry] ? (
        <button type="button" className={`${BUTTON.secondary} mt-2`} disabled={busy} onClick={() => onRetry(retry)}>
          {busy ? 'Working…' : RETRY_LABELS[retry]}
        </button>
      ) : null}
    </div>
  )
}

function ConfirmDialog({
  kind,
  detail,
  orderPath,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  kind: Exclude<Confirm, null>
  detail: StaffDetail
  orderPath: (orderNo: string) => string
  busy: boolean
  error: string | null
  onCancel: () => void
  onConfirm: () => void
}) {
  const s = detail.staff
  const blocker = kind === 'deactivate' ? detail.permissions.deactivate_blocker : null
  const text: Record<Exclude<Confirm, null>, { title: string; body: ReactNode; button: string; danger?: boolean }> = {
    deactivate: {
      title: `Deactivate ${s.name}?`,
      body: (
        <p>
          They are signed out at once and cannot sign in again. Their past jobs, payments and ratings stay as they are.
        </p>
      ),
      button: 'Deactivate',
      danger: true,
    },
    reactivate: {
      title: `Reactivate ${s.name}?`,
      body: <p>They can work again and get an email at {s.email} to set a new password.</p>,
      button: 'Reactivate',
    },
    resend_invite: {
      title: `Send an invite to ${s.name}?`,
      body: <p>They get an email at {s.email} with a link to choose their password. The link works for 24 hours.</p>,
      button: 'Send invite',
    },
    reset_password: {
      title: `Send ${s.name} a password reset?`,
      body: <p>They get an email at {s.email} with a link to choose a new password. The link works for 24 hours.</p>,
      button: 'Send reset email',
    },
  }
  const t = text[kind]
  return (
    <Dialog title={t.title} onClose={onCancel}>
      <div className="space-y-3 text-sm">
        {blocker ? (
          <>
            <p role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-red-900">
              {blocker}
            </p>
            {detail.open_jobs.length > 0 ? (
              <ul className="space-y-1">
                {detail.open_jobs.map((j) => (
                  <li key={j.order_id}>
                    <Link to={orderPath(j.order_no)} className={LINK}>
                      {j.order_no}
                    </Link>{' '}
                    <span className="text-slate-600">({j.branch_name})</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : (
          t.body
        )}
        {error ? (
          <p role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-red-900">
            {error}
          </p>
        ) : null}
        <div className="flex flex-col gap-2 pt-1 sm:flex-row-reverse">
          {!blocker ? (
            <button type="button" className={t.danger ? BUTTON.danger : BUTTON.primary} disabled={busy} onClick={onConfirm}>
              {busy ? 'Working…' : t.button}
            </button>
          ) : null}
          <button type="button" className={BUTTON.secondary} onClick={onCancel}>
            {blocker ? 'Close' : 'Cancel'}
          </button>
        </div>
      </div>
    </Dialog>
  )
}
