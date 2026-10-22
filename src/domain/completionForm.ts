import { finalAmount } from './money'
import { parseExtraCharges } from './price'

/**
 * The technician's completion form: raw field values, validation, and the
 * clean values sent to `submit_completion`. Messages match the database's
 * (`supabase/migrations/20261022000006_technician_job_portal.sql`).
 */
export interface CompletionFormValues {
  workDone: string
  /** As typed; '' = RM 0. */
  extraCharges: string
  remarks: string
}

export type CompletionFormField = keyof CompletionFormValues
export type CompletionFormErrors = Partial<Record<CompletionFormField, string>>

export interface CompletionInput {
  workDone: string
  extraCharges: number
  remarks: string | null
}

export type CompletionFormResult =
  | { ok: true; input: CompletionInput }
  | { ok: false; errors: CompletionFormErrors }

export const WORK_DONE_REQUIRED_MESSAGE = 'Describe the work done before submitting'
export const EXTRA_REMARKS_REQUIRED_MESSAGE = 'Explain the extra charges in the remarks'

export const EMPTY_COMPLETION_FORM: CompletionFormValues = { workDone: '', extraCharges: '', remarks: '' }

/** Field order, used to focus the first field with an error. */
export const COMPLETION_FORM_FIELDS: readonly CompletionFormField[] = ['workDone', 'extraCharges', 'remarks']

export function validateCompletionForm(values: CompletionFormValues): CompletionFormResult {
  const errors: CompletionFormErrors = {}

  const workDone = values.workDone.trim()
  if (!workDone) errors.workDone = WORK_DONE_REQUIRED_MESSAGE

  let extraCharges = 0
  const extra = parseExtraCharges(values.extraCharges)
  if (extra.ok) extraCharges = extra.value
  else errors.extraCharges = extra.error

  const remarks = values.remarks.trim()
  if (extraCharges > 0 && !remarks) errors.remarks = EXTRA_REMARKS_REQUIRED_MESSAGE

  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return { ok: true, input: { workDone, extraCharges, remarks: remarks || null } }
}

/**
 * The final amount shown live as the technician types: quoted price plus
 * extra charges, or null while the extra charges are not a valid amount.
 */
export function completionFinalAmount(quotedPrice: number, extraChargesInput: string): number | null {
  const extra = parseExtraCharges(extraChargesInput)
  return extra.ok ? finalAmount(quotedPrice, extra.value) : null
}

/** Form values from a submitted completion record (a job returned for rework). */
export function completionToFormValues(completion: {
  work_done: string
  extra_charges: number | string
  remarks: string | null
}): CompletionFormValues {
  const extra = Number(completion.extra_charges)
  return {
    workDone: completion.work_done,
    extraCharges: extra > 0 ? extra.toFixed(2) : '',
    remarks: completion.remarks ?? '',
  }
}
