import { describe, expect, it } from 'vitest'
import {
  EMPTY_COMPLETION_FORM,
  EXTRA_NEGATIVE_MESSAGE,
  EXTRA_REMARKS_REQUIRED_MESSAGE,
  WORK_DONE_REQUIRED_MESSAGE,
  completionFinalAmount,
  completionToFormValues,
  validateCompletionForm,
} from '../../src/domain'

const form = (values: Partial<typeof EMPTY_COMPLETION_FORM>) => ({ ...EMPTY_COMPLETION_FORM, ...values })

describe('validateCompletionForm', () => {
  it('returns clean values for submit_completion', () => {
    expect(validateCompletionForm(form({ workDone: '  Cleaned filters ', extraCharges: '', remarks: '  ' }))).toEqual({
      ok: true,
      input: { workDone: 'Cleaned filters', extraCharges: 0, remarks: null },
    })
    expect(
      validateCompletionForm(form({ workDone: 'Gas top-up', extraCharges: 'RM 80.50', remarks: 'R32 gas, 1 kg' })),
    ).toEqual({ ok: true, input: { workDone: 'Gas top-up', extraCharges: 80.5, remarks: 'R32 gas, 1 kg' } })
  })

  it('needs the work done', () => {
    expect(validateCompletionForm(form({ workDone: '   ' }))).toEqual({
      ok: false,
      errors: { workDone: WORK_DONE_REQUIRED_MESSAGE },
    })
  })

  it('needs remarks when there are extra charges', () => {
    expect(validateCompletionForm(form({ workDone: 'Repair', extraCharges: '50' }))).toEqual({
      ok: false,
      errors: { remarks: EXTRA_REMARKS_REQUIRED_MESSAGE },
    })
    expect(validateCompletionForm(form({ workDone: 'Repair', extraCharges: '0.00' })).ok).toBe(true)
  })

  it('reports every field at once', () => {
    const result = validateCompletionForm(form({ workDone: '', extraCharges: '-5' }))
    expect(result).toEqual({
      ok: false,
      errors: { workDone: WORK_DONE_REQUIRED_MESSAGE, extraCharges: EXTRA_NEGATIVE_MESSAGE },
    })
  })
})

describe('completionFinalAmount', () => {
  it('adds the extra charges to the quoted price as the technician types', () => {
    expect(completionFinalAmount(250, '')).toBe(250)
    expect(completionFinalAmount(250, '80.5')).toBe(330.5)
    expect(completionFinalAmount(0.1, '0.2')).toBe(0.3)
  })

  it('is null while the extra charges are not a valid amount', () => {
    expect(completionFinalAmount(250, 'abc')).toBeNull()
    expect(completionFinalAmount(250, '1.234')).toBeNull()
  })
})

describe('completionToFormValues', () => {
  it('pre-fills a reworked job from its submitted record', () => {
    expect(completionToFormValues({ work_done: 'Replaced fan', extra_charges: '45', remarks: 'Fan motor' })).toEqual({
      workDone: 'Replaced fan',
      extraCharges: '45.00',
      remarks: 'Fan motor',
    })
    expect(completionToFormValues({ work_done: 'Cleaned', extra_charges: 0, remarks: null })).toEqual({
      workDone: 'Cleaned',
      extraCharges: '',
      remarks: '',
    })
  })
})
