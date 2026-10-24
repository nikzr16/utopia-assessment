import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router'
import { CalendarClock, ClipboardList, Save, TriangleAlert, UserRound, Wrench, type LucideIcon } from 'lucide-react'
import { ActionBar } from '../../components/ActionBar'
import { Field, ReadOnlyField } from '../../components/Field'
import { BUTTON, CARD, INPUT, LINK } from '../../components/styles'
import {
  ORDER_FORM_FIELDS,
  formatMalaysiaDateTime,
  formatMyPhone,
  normalizeMyPhone,
  validateOrderForm,
  type OrderFormField,
  type OrderFormValues,
  type OrderInput,
} from '../../domain'
import type { ReferenceData } from './api'
import { TechnicianSelect } from './TechnicianSelect'

const fieldId = (field: OrderFormField) => `order-${field}`

/** One titled group of fields, with an icon and a short line under the title. */
function FormSection({
  id,
  title,
  description,
  icon: Icon,
  children,
}: {
  id: string
  title: string
  description: string
  icon: LucideIcon
  children: ReactNode
}) {
  return (
    <section className={CARD} aria-labelledby={id}>
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand"
        >
          <Icon className="size-4.5" />
        </span>
        <div className="min-w-0">
          <h3 id={id} className="text-base font-semibold text-ink">
            {title}
          </h3>
          <p className="text-sm text-ink-muted">{description}</p>
        </div>
      </div>
      <div className="mt-4 grid gap-4 border-t border-line pt-4 sm:grid-cols-2">{children}</div>
    </section>
  )
}

export interface OrderFormProps {
  mode: 'create' | 'edit'
  /** Edit: the order's number (read-only). */
  orderNo?: string
  initial: OrderFormValues
  reference: ReferenceData
  /** Edit: the assigned technician's name, shown read-only. */
  technicianName?: string | null
  /** Edit: the date the order already has; shown read-only (PRD Q9, plan P6). */
  lockedScheduledAt?: string | null
  /** Edit: where "Change date" goes (the Reschedule dialog). */
  rescheduleHref?: string
  submitLabel: string
  /** Saves the order; resolves to an error message, or null on success. */
  onSubmit: (input: OrderInput) => Promise<string | null>
  onCancel: () => void
  /** 0009: values read from a paper form; applied each time `key` changes. */
  fill?: { values: Partial<OrderFormValues>; key: number }
}

/** The Admin's order form, shared by New order and Edit order. */
export function OrderForm({
  mode,
  orderNo,
  initial,
  reference,
  technicianName,
  lockedScheduledAt,
  rescheduleHref,
  submitLabel,
  onSubmit,
  onCancel,
  fill,
}: OrderFormProps) {
  const [values, setValues] = useState<OrderFormValues>(initial)
  const fillKey = fill?.key ?? 0
  useEffect(() => {
    if (fill && fillKey > 0) setValues((v) => ({ ...v, ...fill.values }))
    // Only a new reading (a new key) fills the form again.
  }, [fillKey])
  const [touched, setTouched] = useState<Partial<Record<OrderFormField, boolean>>>({})
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  // A ref, not state: a second click in the same tick must see it at once.
  const inFlight = useRef(false)

  const validation = validateOrderForm(values)
  const errors = validation.ok ? {} : validation.errors
  const errorFor = (field: OrderFormField) => (submitted || touched[field] ? errors[field] : undefined)

  const set = (field: OrderFormField) => (value: string) => setValues((v) => ({ ...v, [field]: value }))
  const touch = (field: OrderFormField) => () => setTouched((t) => ({ ...t, [field]: true }))

  const serviceTypes = reference.serviceTypes.filter((s) => s.active || s.id === initial.serviceTypeId)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (inFlight.current) return
    setSubmitted(true)
    setServerError(null)
    if (!validation.ok) {
      const first = ORDER_FORM_FIELDS.find((f) => validation.errors[f])
      if (first) document.getElementById(fieldId(first))?.focus()
      return
    }
    inFlight.current = true
    setSaving(true)
    try {
      const error = await onSubmit(validation.input)
      if (error) setServerError(error)
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }

  const errorCount = Object.keys(errors).length

  return (
    <form noValidate onSubmit={handleSubmit} className="space-y-5" aria-label={mode === 'create' ? 'New order' : 'Edit order'}>
      {serverError ? (
        <section role="alert" className="flex gap-3 rounded-xl border border-danger/35 bg-danger-soft p-4 text-danger-ink">
          <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <h3 className="font-semibold">The order was not saved</h3>
            <p className="mt-1 text-sm">{serverError}</p>
          </div>
        </section>
      ) : submitted && errorCount > 0 ? (
        <p role="alert" className="flex items-center gap-2.5 rounded-xl border border-danger/35 bg-danger-soft px-4 py-3 text-sm text-danger-ink">
          <TriangleAlert className="size-4.5 shrink-0" aria-hidden="true" />
          Check the {errorCount === 1 ? 'highlighted field' : `${errorCount} highlighted fields`} below.
        </p>
      ) : null}

      <FormSection id="order-section-order" title="Order" icon={ClipboardList} description="Where the job is booked.">
        <ReadOnlyField label="Order No">
          {orderNo ?? <span className="text-ink-faint">Generated on save</span>}
        </ReadOnlyField>
        <Field id={fieldId('branchId')} label="Branch" error={errorFor('branchId')}>
          {(control) => (
            <select
              {...control}
              value={values.branchId}
              onChange={(e) => set('branchId')(e.target.value)}
              onBlur={touch('branchId')}
              className={INPUT}
            >
              <option value="">Select a branch</option>
              {reference.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          )}
        </Field>
      </FormSection>

      <FormSection id="order-section-customer" title="Customer" icon={UserRound} description="Who to call and where to go.">
        <Field id={fieldId('customerName')} label="Customer name" error={errorFor('customerName')}>
          {(control) => (
            <input
              {...control}
              type="text"
              autoComplete="off"
              maxLength={120}
              value={values.customerName}
              onChange={(e) => set('customerName')(e.target.value)}
              onBlur={touch('customerName')}
              className={INPUT}
            />
          )}
        </Field>
        <Field
          id={fieldId('customerPhone')}
          label="Phone"
          hint="Malaysian mobile or landline, e.g. 012-345 6789 or 03-1234 5678"
          error={errorFor('customerPhone')}
        >
          {(control) => (
            <input
              {...control}
              type="tel"
              inputMode="tel"
              autoComplete="off"
              maxLength={20}
              value={values.customerPhone}
              onChange={(e) => set('customerPhone')(e.target.value)}
              onBlur={() => {
                touch('customerPhone')()
                // Show a valid number in one standard format so the Admin can read it back.
                const phone = normalizeMyPhone(values.customerPhone)
                if (phone.ok) set('customerPhone')(formatMyPhone(phone.value))
              }}
              className={INPUT}
            />
          )}
        </Field>
        <div className="sm:col-span-2">
          <Field id={fieldId('customerAddress')} label="Address" error={errorFor('customerAddress')}>
            {(control) => (
              <textarea
                {...control}
                rows={2}
                maxLength={500}
                value={values.customerAddress}
                onChange={(e) => set('customerAddress')(e.target.value)}
                onBlur={touch('customerAddress')}
                className={INPUT}
              />
            )}
          </Field>
        </div>
      </FormSection>

      <FormSection id="order-section-job" title="Job" icon={Wrench} description="What needs doing and the agreed price.">
        <div className="sm:col-span-2">
          <Field id={fieldId('problemDescription')} label="Problem description" error={errorFor('problemDescription')}>
            {(control) => (
              <textarea
                {...control}
                rows={3}
                maxLength={2000}
                value={values.problemDescription}
                onChange={(e) => set('problemDescription')(e.target.value)}
                onBlur={touch('problemDescription')}
                className={INPUT}
              />
            )}
          </Field>
        </div>
        <Field id={fieldId('serviceTypeId')} label="Service type" error={errorFor('serviceTypeId')}>
          {(control) => (
            <select
              {...control}
              value={values.serviceTypeId}
              onChange={(e) => set('serviceTypeId')(e.target.value)}
              onBlur={touch('serviceTypeId')}
              className={INPUT}
            >
              <option value="">Select a service type</option>
              {serviceTypes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.active ? '' : ' (no longer offered)'}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field
          id={fieldId('quotedPrice')}
          label="Quoted price (RM)"
          hint="RM 0.00 to RM 100,000.00"
          error={errorFor('quotedPrice')}
        >
          {(control) => (
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-ink-faint">
                RM
              </span>
              <input
                {...control}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0.00"
                value={values.quotedPrice}
                onChange={(e) => set('quotedPrice')(e.target.value)}
                onBlur={touch('quotedPrice')}
                className={`${INPUT} pl-11`}
              />
            </div>
          )}
        </Field>
      </FormSection>

      <FormSection id="order-section-assignment" title="Assignment and schedule" icon={CalendarClock} description="Who goes, when, and notes for them.">
        {mode === 'create' ? (
          <Field
            id={fieldId('technicianId')}
            label="Assigned technician"
            optional
            hint="Leave empty to save the order as New and assign later."
            error={errorFor('technicianId')}
          >
            {(control) => (
              <TechnicianSelect
                control={control}
                value={values.technicianId}
                onChange={set('technicianId')}
                onBlur={touch('technicianId')}
                technicians={reference.technicians}
                branches={reference.branches}
                orderBranchId={values.branchId}
                emptyLabel="No technician yet (save as New)"
              />
            )}
          </Field>
        ) : (
          <ReadOnlyField label="Assigned technician">
            {technicianName ?? 'None yet'}
            <span className="mt-1 block text-xs text-ink-faint">Change it with Assign / Reassign on the order page.</span>
          </ReadOnlyField>
        )}

        {lockedScheduledAt ? (
          <ReadOnlyField label="Scheduled">
            {formatMalaysiaDateTime(lockedScheduledAt)}
            {rescheduleHref ? (
              <Link to={rescheduleHref} className={`${LINK} mt-1 block text-xs`}>
                Change date (Reschedule)
              </Link>
            ) : null}
          </ReadOnlyField>
        ) : (
          <Field
            id={fieldId('scheduledAt')}
            label="Scheduled date and time"
            optional
            hint="Malaysia time"
            error={errorFor('scheduledAt')}
          >
            {(control) => (
              <input
                {...control}
                type="datetime-local"
                value={values.scheduledAt}
                onChange={(e) => set('scheduledAt')(e.target.value)}
                onBlur={touch('scheduledAt')}
                className={INPUT}
              />
            )}
          </Field>
        )}

        <div className="sm:col-span-2">
          <Field id={fieldId('adminNotes')} label="Admin notes" optional error={errorFor('adminNotes')}>
            {(control) => (
              <textarea
                {...control}
                rows={2}
                maxLength={2000}
                value={values.adminNotes}
                onChange={(e) => set('adminNotes')(e.target.value)}
                onBlur={touch('adminNotes')}
                className={INPUT}
              />
            )}
          </Field>
        </div>
      </FormSection>

      <ActionBar>
        <div className="flex gap-2 md:justify-end">
          <button type="button" onClick={onCancel} className={`${BUTTON.secondary} min-h-11 flex-1 md:flex-none`} disabled={saving}>
            Cancel
          </button>
          <button
            type="submit"
            className={`${BUTTON.primary} min-h-11 flex-[2] md:flex-none`}
            disabled={saving}
            aria-disabled={saving}
          >
            <Save aria-hidden="true" />
            {saving ? 'Saving…' : submitLabel}
          </button>
        </div>
      </ActionBar>
    </form>
  )
}
