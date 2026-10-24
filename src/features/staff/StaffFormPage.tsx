import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Building2, CircleX, Info, Lock, Save, UserPlus, UserRound } from 'lucide-react'
import { Field } from '../../components/Field'
import { BUTTON, CARD, INPUT } from '../../components/styles'
import {
  ROLE_LABELS,
  assignableRoles,
  formatMyPhone,
  validateStaffForm,
  type StaffFormField,
  type StaffFormValues,
  type StaffRole,
} from '../../domain'
import { useLoad } from '../../lib/useLoad'
import {
  checkStaffForm,
  fetchBranchOptions,
  fetchStaffDetail,
  staffAccess,
  type BranchOption,
  type FormProblem,
  type StaffDetail,
  type StaffFormInput,
} from './api'
import { BackLink, EmptyState, ErrorState, LoadingState } from '../../components/ui'

/** Where the staff page shows the result of a save (location state). */
export interface StaffFlash {
  message: string
  warning?: string
  retry?: string
}

/** Add a staff member: `/staff/new`. */
export function NewStaffPage({ actorRole }: { actorRole: StaffRole }) {
  const [branches] = useLoad(() => fetchBranchOptions(actorRole), `branches-${actorRole}`)
  if (branches.status === 'loading') return <FormLoading />
  if (branches.status === 'error') {
    return (
      <ErrorState title="Could not load branches">
        <p>{branches.message}</p>
      </ErrorState>
    )
  }
  return <StaffForm actorRole={actorRole} branches={branches.data} detail={null} />
}

/** Edit a staff member: `/staff/:id/edit`. */
export function EditStaffPage({ actorRole }: { actorRole: StaffRole }) {
  const { staffId = '' } = useParams()
  const [state] = useLoad(
    () => Promise.all([fetchStaffDetail(staffId), fetchBranchOptions(actorRole)]),
    `edit-${staffId}`,
  )
  if (state.status === 'loading') return <FormLoading />
  if (state.status === 'error') {
    return (
      <ErrorState title="Could not load this staff member">
        <p>{state.message}</p>
      </ErrorState>
    )
  }
  const [detail, branches] = state.data
  if (!detail.permissions.can_edit) {
    return (
      <EmptyState
        title={`You cannot edit ${detail.staff.name}`}
        icon={<Lock className="size-5" />}
        action={
          <Link to={`/staff/${staffId}`} className={BUTTON.secondary}>
            Back to {detail.staff.name}
          </Link>
        }
      >
        <p>Only an Admin, or a Manager of their branch for technicians, can change this person.</p>
      </EmptyState>
    )
  }
  // A Manager editing a technician of a branch they cover may keep it even if
  // it is not offered (it always is: covered branches are their options).
  return <StaffForm actorRole={actorRole} branches={branches} detail={detail} />
}

function FormLoading() {
  return (
    <div className="mx-auto max-w-2xl">
      <LoadingState variant="cards" count={2} label="Loading…" />
    </div>
  )
}

/** A titled group of fields inside the form card. */
function FormSection({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="space-y-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
        <span aria-hidden="true" className="inline-flex size-7 items-center justify-center rounded-full bg-brand-soft text-brand">
          {icon}
        </span>
        {title}
      </h3>
      {children}
    </div>
  )
}

const EMPTY: StaffFormValues = { name: '', email: '', phone: '', role: '', branchId: '', additionalBranchIds: [] }

function StaffForm({
  actorRole,
  branches,
  detail,
}: {
  actorRole: StaffRole
  branches: BranchOption[]
  detail: StaffDetail | null
}) {
  const navigate = useNavigate()
  const editing = detail !== null
  const roles = assignableRoles(actorRole)
  const canChangeRole = editing ? detail.permissions.can_change_role : true
  const canChangeEmail = editing ? actorRole === 'admin' : true
  const canChangeCover = actorRole === 'admin'

  const [values, setValues] = useState<StaffFormValues>(() =>
    detail
      ? {
          name: detail.staff.name,
          email: detail.staff.email,
          phone: formatMyPhone(detail.staff.phone).replace(/^\+60 /, '0'),
          role: detail.staff.role,
          branchId: detail.staff.branch_id,
          additionalBranchIds: detail.staff.additional_branch_ids,
        }
      : { ...EMPTY, role: roles.length === 1 ? roles[0] : '', branchId: branches.length === 1 ? branches[0].id : '' },
  )
  const [errors, setErrors] = useState<Partial<Record<StaffFormField, string>>>({})
  const [touched, setTouched] = useState<Set<StaffFormField>>(new Set())
  const [submitted, setSubmitted] = useState(false)
  const [problems, setProblems] = useState<FormProblem[]>([])
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const set = <K extends keyof StaffFormValues>(key: K, value: StaffFormValues[K], field: StaffFormField) => {
    setValues((v) => ({ ...v, [key]: value }))
    setTouched((t) => new Set(t).add(field))
    setErrors((e) => ({ ...e, [field]: undefined }))
  }

  const input = useMemo<StaffFormInput | null>(
    () =>
      values.role
        ? {
            name: values.name,
            email: values.email,
            phone: values.phone,
            role: values.role,
            branchId: values.branchId,
            additionalBranchIds: canChangeCover ? (values.role === 'manager' ? values.additionalBranchIds : []) : null,
          }
        : null,
    [values, canChangeCover],
  )

  // Ask the database what would stop this save (PRD Q6), shortly after typing stops.
  useEffect(() => {
    if (!input || !input.branchId) {
      setProblems([])
      return
    }
    let current = true
    const timer = setTimeout(() => {
      checkStaffForm(detail?.staff.id ?? null, input).then(
        (p) => {
          if (current) setProblems(p)
        },
        () => undefined,
      )
    }, 400)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [input, detail])

  // A database problem shows once its field was touched, or after Save; client errors first.
  const message = (field: StaffFormField): string | undefined => {
    if (errors[field]) return errors[field]
    if (!submitted && !touched.has(field) && !['branch', 'role', 'cover'].includes(field)) return undefined
    return problems.find((p) => p.field === field)?.message
  }
  const formProblems = problems.filter((p) => p.field === 'form' || p.field === 'active')

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSubmitted(true)
    setSaveError(null)
    const result = validateStaffForm(values)
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    setErrors({})
    setSaving(true)
    try {
      const staff: StaffFormInput = {
        ...result.value,
        additionalBranchIds: canChangeCover ? result.value.additionalBranchIds : null,
      }
      const res = editing
        ? await staffAccess('update', { staffId: detail.staff.id, staff })
        : await staffAccess('create', { staff })
      const flash: StaffFlash = { message: res.message, warning: res.warning, retry: res.retry }
      navigate(`/staff/${res.staffId}`, { state: { flash } })
    } catch (err) {
      setSaveError((err as Error).message)
      setSaving(false)
    }
  }

  const title = editing ? `Edit ${detail.staff.name}` : actorRole === 'manager' ? 'Add technician' : 'Add staff'
  const otherBranches = branches.filter((b) => b.id !== values.branchId)

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <BackLink to={editing ? `/staff/${detail.staff.id}` : '/staff'}>{editing ? `Back to ${detail.staff.name}` : 'Back to staff'}</BackLink>
      <form onSubmit={onSubmit} noValidate className="space-y-4" aria-labelledby="staff-form-title">
        <header>
          <h2 id="staff-form-title" className="text-2xl font-semibold tracking-tight text-ink">
            {title}
          </h2>
          {!editing ? (
            <p className="mt-1 flex gap-2 text-sm text-ink-muted">
              <Info className="mt-0.5 size-4 shrink-0 text-ink-faint" aria-hidden="true" />
              <span className="min-w-0">
                They get an email with a link to choose their own password. Use an address they can open.
              </span>
            </p>
          ) : null}
        </header>

        <div className={`${CARD} space-y-6`}>
          <FormSection icon={<UserRound className="size-4" />} title="Person">
            <Field id="staff-name" label="Name" error={message('name')}>
              {(p) => (
                <input {...p} value={values.name} onChange={(e) => set('name', e.target.value, 'name')} autoComplete="off" className={INPUT} />
              )}
            </Field>
            <Field
              id="staff-email"
              label="Email"
              hint={
                !canChangeEmail
                  ? 'Only an Admin can change an email (it is how they sign in).'
                  : editing
                    ? 'Changing it also changes the email they sign in with.'
                    : 'They sign in with this email.'
              }
              error={message('email')}
            >
              {(p) => (
                <input
                  {...p}
                  type="email"
                  inputMode="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={values.email}
                  disabled={!canChangeEmail}
                  onChange={(e) => set('email', e.target.value, 'email')}
                  className={INPUT}
                />
              )}
            </Field>
            <Field
              id="staff-phone"
              label="Phone"
              hint={values.role === 'technician' ? 'A mobile number: the technician gets job details by WhatsApp.' : 'Mobile or landline.'}
              error={message('phone')}
            >
              {(p) => (
                <input
                  {...p}
                  type="tel"
                  inputMode="tel"
                  placeholder="012-345 6789"
                  value={values.phone}
                  onChange={(e) => set('phone', e.target.value, 'phone')}
                  className={INPUT}
                />
              )}
            </Field>
          </FormSection>

          <div className="border-t border-line" aria-hidden="true" />

          <FormSection icon={<Building2 className="size-4" />} title="Role and branch">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                id="staff-role"
                label="Role"
                hint={!canChangeRole && editing ? 'Only an Admin can change a role, and not their own.' : undefined}
                error={message('role')}
              >
                {(p) => (
                  <select
                    {...p}
                    value={values.role}
                    disabled={!canChangeRole || roles.length === 1}
                    onChange={(e) => set('role', e.target.value as StaffRole, 'role')}
                    className={INPUT}
                  >
                    {values.role === '' ? <option value="">Choose a role</option> : null}
                    {(roles.includes(values.role as StaffRole) || values.role === '' ? roles : [values.role as StaffRole, ...roles]).map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field id="staff-branch" label="Home branch" error={message('branch')}>
                {(p) => (
                  <select {...p} value={values.branchId} onChange={(e) => set('branchId', e.target.value, 'branch')} className={INPUT}>
                    {values.branchId === '' ? <option value="">Choose a branch</option> : null}
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            </div>

            {values.role === 'manager' && canChangeCover ? (
              <fieldset>
                <legend className="text-sm font-medium text-ink">Also covers</legend>
                <p className="text-xs text-ink-faint">Branches this Manager reviews besides their home branch (for example while a branch has no Manager).</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {otherBranches.map((b) => (
                    <label
                      key={b.id}
                      className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg border border-line-strong bg-surface px-3 text-sm transition-colors hover:bg-sunken has-[:checked]:border-brand has-[:checked]:bg-brand-soft has-[:checked]:text-brand-ink"
                    >
                      <input
                        type="checkbox"
                        className="size-4 accent-brand"
                        checked={values.additionalBranchIds.includes(b.id)}
                        onChange={(e) =>
                          set(
                            'additionalBranchIds',
                            e.target.checked
                              ? [...values.additionalBranchIds, b.id]
                              : values.additionalBranchIds.filter((id) => id !== b.id),
                            'cover',
                          )
                        }
                      />
                      {b.name}
                    </label>
                  ))}
                </div>
                {message('cover') ? <p className="mt-1 text-sm text-danger-ink">{message('cover')}</p> : null}
              </fieldset>
            ) : null}
          </FormSection>
        </div>

        {formProblems.map((p) => (
          <p key={p.message} role="alert" className="flex gap-2 rounded-xl border border-danger/35 bg-danger-soft px-4 py-3 text-sm text-danger-ink">
            <CircleX className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0">{p.message}</span>
          </p>
        ))}
        {saveError ? (
          <p role="alert" className="flex gap-2 rounded-xl border border-danger/35 bg-danger-soft px-4 py-3 text-sm text-danger-ink">
            <CircleX className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0">{saveError}</span>
          </p>
        ) : null}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Link to={editing ? `/staff/${detail.staff.id}` : '/staff'} className={`${BUTTON.secondary} max-md:min-h-11`}>
            Cancel
          </Link>
          <button type="submit" className={`${BUTTON.primary} max-md:min-h-11`} disabled={saving}>
            {editing ? <Save aria-hidden="true" /> : <UserPlus aria-hidden="true" />}
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Add and send invite'}
          </button>
        </div>
      </form>
    </div>
  )
}
