import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Field } from '../../components/Field'
import { Notice } from '../../components/Notice'
import { BUTTON, CARD, INPUT, LINK } from '../../components/styles'
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

/** Where the staff page shows the result of a save (location state). */
export interface StaffFlash {
  message: string
  warning?: string
  retry?: string
}

/** Add a staff member: `/staff/new`. */
export function NewStaffPage({ actorRole }: { actorRole: StaffRole }) {
  const [branches] = useLoad(() => fetchBranchOptions(actorRole), `branches-${actorRole}`)
  if (branches.status === 'loading') return <p role="status" className="text-sm text-slate-600">Loading…</p>
  if (branches.status === 'error') {
    return (
      <Notice tone="error" title="Could not load branches">
        <p>{branches.message}</p>
      </Notice>
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
  if (state.status === 'loading') return <p role="status" className="text-sm text-slate-600">Loading…</p>
  if (state.status === 'error') {
    return (
      <Notice tone="error" title="Could not load this staff member">
        <p>{state.message}</p>
      </Notice>
    )
  }
  const [detail, branches] = state.data
  if (!detail.permissions.can_edit) {
    return (
      <Notice tone="error" title={`You cannot edit ${detail.staff.name}`}>
        <p>Only an Admin, or a Manager of their branch for technicians, can change this person.</p>
        <Link to={`/staff/${staffId}`} className={`${LINK} mt-2 inline-block`}>
          Back to {detail.staff.name}
        </Link>
      </Notice>
    )
  }
  // A Manager editing a technician of a branch they cover may keep it even if
  // it is not offered (it always is: covered branches are their options).
  return <StaffForm actorRole={actorRole} branches={branches} detail={detail} />
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
      <Link to={editing ? `/staff/${detail.staff.id}` : '/staff'} className={`${LINK} text-sm`}>
        ← {editing ? `Back to ${detail.staff.name}` : 'Back to staff'}
      </Link>
      <form onSubmit={onSubmit} noValidate className={`${CARD} space-y-4`} aria-labelledby="staff-form-title">
        <h2 id="staff-form-title" className="text-xl font-semibold">
          {title}
        </h2>
        {!editing ? (
          <p className="text-sm text-slate-600">
            They get an email with a link to choose their own password. Use an address they can open.
          </p>
        ) : null}

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
            <legend className="text-sm font-medium text-slate-800">Also covers</legend>
            <p className="text-xs text-slate-500">Branches this Manager reviews besides their home branch (for example while a branch has no Manager).</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {otherBranches.map((b) => (
                <label key={b.id} className="flex min-h-11 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm">
                  <input
                    type="checkbox"
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
            {message('cover') ? <p className="mt-1 text-sm text-red-700">{message('cover')}</p> : null}
          </fieldset>
        ) : null}

        {formProblems.map((p) => (
          <p key={p.message} role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
            {p.message}
          </p>
        ))}
        {saveError ? (
          <p role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
            {saveError}
          </p>
        ) : null}

        <div className="flex flex-col gap-2 sm:flex-row">
          <button type="submit" className={BUTTON.primary} disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Add and send invite'}
          </button>
          <Link to={editing ? `/staff/${detail.staff.id}` : '/staff'} className={BUTTON.secondary}>
            Cancel
          </Link>
        </div>
      </form>
    </div>
  )
}
