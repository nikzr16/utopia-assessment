import { useId } from 'react'
import { Field } from '../../components/Field'
import { INPUT } from '../../components/styles'
import {
  FEEDBACK_COMMENT_MAX_LENGTH,
  FEEDBACK_RATING_LABELS,
  FEEDBACK_RATING_MAX,
  type FeedbackFormErrors,
  type FeedbackFormValues,
} from '../../domain'

const CHOICE =
  'flex min-h-12 cursor-pointer items-center justify-center rounded-md border px-2 py-2 text-center text-sm font-medium focus-within:ring-2 focus-within:ring-sky-300'
const CHOICE_ON = 'border-sky-700 bg-sky-700 text-white'
const CHOICE_OFF = 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50'

/**
 * The three questions (PRD Q1): 1-5 stars, "Is your aircon working well
 * now?" Yes / No, and an optional comment. Used by the customer page and by
 * staff recording a rating taken by phone (`byPhone` words the questions
 * about the customer).
 */
export function FeedbackQuestions({
  values,
  errors,
  disabled,
  onChange,
  onAnswered,
  byPhone = false,
}: {
  values: FeedbackFormValues
  errors: FeedbackFormErrors
  disabled?: boolean
  onChange: (values: FeedbackFormValues) => void
  /** A question was answered: its error message can go. */
  onAnswered?: (field: keyof FeedbackFormValues) => void
  /** Staff asking on the phone: "the customer's aircon". */
  byPhone?: boolean
}) {
  const id = useId()
  const ratingError = `${id}-rating-error`
  const workingError = `${id}-working-error`
  const set = (patch: Partial<FeedbackFormValues>) => {
    onChange({ ...values, ...patch })
    for (const field of Object.keys(patch) as Array<keyof FeedbackFormValues>) onAnswered?.(field)
  }
  const commentLength = [...values.comment.trim()].length

  return (
    <div className="space-y-5">
      <fieldset aria-describedby={errors.rating ? ratingError : undefined}>
        <legend className="text-sm font-medium text-slate-800">
          {byPhone ? 'How did the customer rate the job?' : 'How would you rate the job?'}
        </legend>
        <div className="mt-2 grid grid-cols-5 gap-1.5">
          {Array.from({ length: FEEDBACK_RATING_MAX }, (_, i) => i + 1).map((n) => {
            const on = values.rating === n
            return (
              <label key={n} className={`${CHOICE} flex-col ${on ? CHOICE_ON : CHOICE_OFF}`}>
                <input
                  type="radio"
                  name={`${id}-rating`}
                  value={n}
                  checked={on}
                  disabled={disabled}
                  onChange={() => set({ rating: n })}
                  className="sr-only"
                />
                <span aria-hidden="true" className="text-2xl leading-none">
                  {on || (values.rating !== null && n < values.rating) ? '★' : '☆'}
                </span>
                <span className="mt-1 text-xs leading-tight">
                  {n} – {FEEDBACK_RATING_LABELS[n]}
                </span>
              </label>
            )
          })}
        </div>
        {errors.rating ? (
          <p id={ratingError} className="mt-1 text-sm text-red-700">
            {errors.rating}
          </p>
        ) : null}
      </fieldset>

      <fieldset aria-describedby={errors.workingWell ? workingError : undefined}>
        <legend className="text-sm font-medium text-slate-800">
          {byPhone ? "Is the customer's aircon working well now?" : 'Is your aircon working well now?'}
        </legend>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {[
            [true, 'Yes'],
            [false, 'No'],
          ].map(([value, label]) => {
            const on = values.workingWell === value
            return (
              <label key={String(value)} className={`${CHOICE} ${on ? CHOICE_ON : CHOICE_OFF}`}>
                <input
                  type="radio"
                  name={`${id}-working`}
                  value={String(value)}
                  checked={on}
                  disabled={disabled}
                  onChange={() => set({ workingWell: value as boolean })}
                  className="sr-only"
                />
                {label as string}
              </label>
            )
          })}
        </div>
        {errors.workingWell ? (
          <p id={workingError} className="mt-1 text-sm text-red-700">
            {errors.workingWell}
          </p>
        ) : null}
      </fieldset>

      <Field
        id={`${id}-comment`}
        label={byPhone ? 'What the customer said' : 'Comment'}
        optional
        hint={`${commentLength.toLocaleString('en-US')} / ${FEEDBACK_COMMENT_MAX_LENGTH.toLocaleString('en-US')} characters`}
        error={errors.comment}
      >
        {(control) => (
          <textarea
            {...control}
            rows={4}
            value={values.comment}
            disabled={disabled}
            onChange={(e) => set({ comment: e.target.value })}
            className={INPUT}
          />
        )}
      </Field>
    </div>
  )
}
