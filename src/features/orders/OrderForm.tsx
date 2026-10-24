import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { Field, ReadOnlyField } from '../../components/Field'
import { Notice } from '../../components/Notice'
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
        <Notice tone="error" title="The order was not saved">
          <p>{serverError}</p>
        </Notice>
      ) : submitted && errorCount > 0 ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          Check the {errorCount === 1 ? 'highlighted field' : `${errorCount} highlighted fields`} below.
        </p>
      ) : null}

      <section className={CARD} aria-labelledby="order-section-order">
        <h3 id="order-section-order" className="text-base font-semibold">
          Order
        </h3>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <ReadOnlyField label="Order No">
            {orderNo ?? <span className="italic text-slate-500">Generated on save</span>}
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
        </div>
      </section>

      <section className={CARD} aria-labelledby="order-section-customer">
        <h3 id="order-section-customer" className="text-base font-semibold">
          Customer
        </h3>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
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
        </div>
      </section>

      <section className={CARD} aria-labelledby="order-section-job">
        <h3 id="order-section-job" className="text-base font-semibold">
          Job
        </h3>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
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
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-slate-500">
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
        </div>
      </section>

      <section className={CARD} aria-labelledby="order-section-assignment">
        <h3 id="order-section-assignment" className="text-base font-semibold">
          Assignment and schedule
        </h3>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
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
              <span className="mt-1 block text-xs text-slate-500">Change it with Assign / Reassign on the order page.</span>
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
        </div>
      </section>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" onClick={onCancel} className={BUTTON.secondary} disabled={saving}>
          Cancel
        </button>
        <button type="submit" className={BUTTON.primary} disabled={saving} aria-disabled={saving}>
          {saving ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  )
}
