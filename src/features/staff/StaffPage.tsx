import { useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import {
  Briefcase,
  CircleX,
  History,
  KeyRound,
  Mail,
  PencilLine,
  Phone,
  RotateCw,
  Send,
  TriangleAlert,
  UserCheck,
  UserRound,
  UserX,
} from 'lucide-react'
import { Dialog } from '../../components/Dialog'
import { StatusBadge } from '../../components/StatusBadge'
import { BUTTON, CARD, EYEBROW, LINK } from '../../components/styles'
import { Toast } from '../../components/Toast'
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
import { BackLink, ErrorState, LoadingState } from '../../components/ui'
import { ActiveBadge, RoleBadge, StaffAvatar } from './StaffBits'

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

  if (state.status === 'loading') return <LoadingState variant="page" label="Loading…" />
  if (state.status === 'error') {
    return (
      <div className="space-y-4">
        <BackLink to="/staff">Back to staff</BackLink>
        <ErrorState title="Could not load this staff member" onRetry={reload}>
          <p>{state.message}</p>
        </ErrorState>
      </div>
    )
  }

  const d: StaffDetail = state.data
  const s = d.staff
  const p = d.permissions
  const anyAction = p.can_edit || p.can_deactivate || p.can_reactivate || p.can_send_invite || p.can_reset_password

  // A plain success pops up and goes; one with a warning or a retry stays on the page.
  const sticky = flash !== null && (Boolean(flash.warning) || Boolean(flash.retry))

  return (
    <div className="space-y-5">
      <BackLink to="/staff">Back to staff</BackLink>

      <header className="flex items-center gap-4">
        <StaffAvatar name={s.name} active={s.active} size="lg" />
        <div className="min-w-0">
          <h2 className="break-words text-2xl font-semibold tracking-tight text-ink">{s.name}</h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <RoleBadge role={s.role} />
            <ActiveBadge active={s.active} />
          </div>
        </div>
      </header>

      {flash && !sticky ? (
        <Toast key={flash.message} onDismiss={() => setFlash(null)}>
          {flash.message}
        </Toast>
      ) : null}
      {flash && sticky ? <FlashBanner flash={flash} busy={busy} onRetry={(a) => void act(a)} /> : null}
      {error && !confirm ? (
        <p role="alert" className="flex gap-2 rounded-xl border border-danger/35 bg-danger-soft px-4 py-3 text-sm text-danger-ink">
          <CircleX className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0">{error}</span>
        </p>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="min-w-0 space-y-4">
          <section className={CARD} aria-labelledby="staff-details-title">
            <h3 id="staff-details-title" className="flex items-center gap-2 text-base font-semibold text-ink">
              <UserRound className="size-4.5 text-brand" aria-hidden="true" />
              Details
            </h3>
            <dl className="mt-4 grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
              <Item label="Role">{ROLE_LABELS[s.role]}</Item>
              <Item label="Home branch">{s.branch_name}</Item>
              {s.role === 'manager' ? (
                <Item label="Also covers">{s.additional_branch_names.length ? s.additional_branch_names.join(', ') : 'No other branches'}</Item>
              ) : null}
              <Item label="Email">
                <span className="inline-flex max-w-full items-start gap-1.5">
                  <Mail className="mt-0.5 size-4 shrink-0 text-ink-faint" aria-hidden="true" />
                  <span className="min-w-0 break-all">{s.email}</span>
                </span>
              </Item>
              <Item label="Phone">
                <span className="inline-flex items-center gap-1.5 tabular">
                  <Phone className="size-4 shrink-0 text-ink-faint" aria-hidden="true" />
                  <span>{formatMyPhone(s.phone)}</span>
                </span>
              </Item>
              <Item label="Joined">{formatMalaysiaDate(s.joined_at)}</Item>
              {s.left_at ? <Item label="Left">{formatMalaysiaDate(s.left_at)}</Item> : null}
              <Item label="Sign-in">{s.active ? SIGN_IN_STATE_LABELS[s.sign_in_state] : 'Blocked (inactive)'}</Item>
            </dl>
          </section>

          {d.open_jobs.length > 0 ? (
            <section className={CARD} aria-labelledby="open-jobs-title">
              <h3 id="open-jobs-title" className="flex items-center gap-2 text-base font-semibold text-ink">
                <Briefcase className="size-4.5 text-brand" aria-hidden="true" />
                Open jobs ({d.open_jobs.length})
              </h3>
              <ul className="mt-3 divide-y divide-line text-sm">
                {d.open_jobs.map((j) => (
                  <li key={j.order_id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2.5">
                    <span className="min-w-0">
                      <Link to={orderPath(j.order_no)} className={LINK}>
                        {j.order_no}
                      </Link>
                      <span className="ml-2 text-ink-muted">{j.branch_name}</span>
                    </span>
                    <StatusBadge status={j.status} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className={CARD} aria-labelledby="staff-history-title">
            <h3 id="staff-history-title" className="flex items-center gap-2 text-base font-semibold text-ink">
              <History className="size-4.5 text-brand" aria-hidden="true" />
              History
            </h3>
            <ol className="mt-4 space-y-4 text-sm">
              {d.history.map((h) => (
                <li key={h.id} className="relative pl-5">
                  <span aria-hidden="true" className="absolute left-0 top-1.5 size-2.5 rounded-full bg-brand ring-4 ring-brand-soft" />
                  <p>
                    <span className="font-medium text-ink">{STAFF_HISTORY_LABELS[h.action]}</span>
                    <span className="text-ink-muted">
                      {' '}
                      · {formatMalaysiaDateTime(h.created_at)} ·{' '}
                      {h.actor_name ? `by ${staffLabel(h.actor_name, !(h.actor_id && inactive.has(h.actor_id)))}` : 'by set-up'}
                    </span>
                  </p>
                  {h.action !== 'invite_sent' && h.action !== 'password_reset' ? (
                    <ul className="mt-0.5 text-ink-muted">
                      {describeStaffChanges(h.changes, formatMyPhone).map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-ink-muted">To {String(h.changes.email?.to ?? '')}</p>
                  )}
                </li>
              ))}
            </ol>
          </section>
        </div>

        {anyAction ? (
          <aside className="order-first self-start lg:sticky lg:top-6 lg:order-none">
            <section className={`${CARD} space-y-2`} aria-labelledby="staff-actions-title">
              <h3 id="staff-actions-title" className={`${EYEBROW} mb-3`}>
                Actions
              </h3>
              {p.can_edit ? (
                <Link to={`/staff/${s.id}/edit`} className={`${BUTTON.secondary} w-full max-md:min-h-11`}>
                  <PencilLine aria-hidden="true" />
                  Edit details
                </Link>
              ) : null}
              {p.can_send_invite ? (
                <button
                  type="button"
                  className={`${BUTTON.secondary} w-full max-md:min-h-11`}
                  onClick={() => setConfirm('resend_invite')}
                >
                  <Send aria-hidden="true" />
                  {s.sign_in_state === 'none' ? 'Send invite' : 'Send invite again'}
                </button>
              ) : null}
              {p.can_reset_password ? (
                <button
                  type="button"
                  className={`${BUTTON.secondary} w-full max-md:min-h-11`}
                  onClick={() => setConfirm('reset_password')}
                >
                  <KeyRound aria-hidden="true" />
                  Send password reset
                </button>
              ) : null}
              {p.can_reactivate ? (
                <button
                  type="button"
                  className={`${BUTTON.primary} w-full max-md:min-h-11`}
                  onClick={() => setConfirm('reactivate')}
                >
                  <UserCheck aria-hidden="true" />
                  Reactivate
                </button>
              ) : null}
              {p.can_deactivate ? (
                <div className="border-t border-line pt-3">
                  <button
                    type="button"
                    className={`${BUTTON.dangerSoft} w-full max-md:min-h-11`}
                    onClick={() => setConfirm('deactivate')}
                  >
                    <UserX aria-hidden="true" />
                    Deactivate
                  </button>
                </div>
              ) : null}
            </section>
          </aside>
        ) : null}
      </div>

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
    <div className="min-w-0">
      <dt className={EYEBROW}>{label}</dt>
      <dd className="mt-1 text-ink">{children}</dd>
    </div>
  )
}

function FlashBanner({ flash, busy, onRetry }: { flash: StaffFlash; busy: boolean; onRetry: (a: RetryAction) => void }) {
  const retry = flash.retry as RetryAction | undefined
  return (
    <div
      role="status"
      className={`flex gap-3 rounded-xl border px-4 py-3 text-sm ${flash.warning ? 'border-warning/40 bg-warning-soft text-warning-ink' : 'border-success/35 bg-success-soft text-success-ink'}`}
    >
      <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        <p>{flash.message}</p>
        {flash.warning ? <p className="mt-1 font-medium">{flash.warning}</p> : null}
        {retry && RETRY_LABELS[retry] ? (
          <button type="button" className={`${BUTTON.secondary} mt-2 max-md:min-h-11`} disabled={busy} onClick={() => onRetry(retry)}>
            <RotateCw aria-hidden="true" />
            {busy ? 'Working…' : RETRY_LABELS[retry]}
          </button>
        ) : null}
      </div>
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
            <p role="alert" className="flex gap-2 rounded-lg border border-danger/35 bg-danger-soft px-3 py-2 text-danger-ink">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0">{blocker}</span>
            </p>
            {detail.open_jobs.length > 0 ? (
              <ul className="space-y-1">
                {detail.open_jobs.map((j) => (
                  <li key={j.order_id}>
                    <Link to={orderPath(j.order_no)} className={LINK}>
                      {j.order_no}
                    </Link>{' '}
                    <span className="text-ink-muted">({j.branch_name})</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : (
          t.body
        )}
        {error ? (
          <p role="alert" className="flex gap-2 rounded-lg border border-danger/35 bg-danger-soft px-3 py-2 text-danger-ink">
            <CircleX className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0">{error}</span>
          </p>
        ) : null}
        <div className="flex flex-col gap-2 pt-1 sm:flex-row-reverse">
          {!blocker ? (
            <button
              type="button"
              className={`${t.danger ? BUTTON.danger : BUTTON.primary} min-h-11`}
              disabled={busy}
              onClick={onConfirm}
            >
              {busy ? 'Working…' : t.button}
            </button>
          ) : null}
          <button type="button" className={`${BUTTON.secondary} min-h-11`} onClick={onCancel}>
            {blocker ? 'Close' : 'Cancel'}
          </button>
        </div>
      </div>
    </Dialog>
  )
}
