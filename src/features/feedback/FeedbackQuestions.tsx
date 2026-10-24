import { useId } from 'react'
import { Star, ThumbsDown, ThumbsUp } from 'lucide-react'
import { Field } from '../../components/Field'
import { INPUT } from '../../components/styles'
import {
  FEEDBACK_COMMENT_MAX_LENGTH,
  FEEDBACK_RATING_MAX,
  type FeedbackFormErrors,
  type FeedbackFormValues,
} from '../../domain'
import { FEEDBACK_TEXT, type FeedbackText } from './i18n'

const CHOICE =
  'flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border px-3 py-2 text-center text-sm font-medium transition-colors focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus'
const CHOICE_ON = 'border-brand bg-brand text-on-brand shadow-card'
const CHOICE_OFF = 'border-line-strong bg-surface text-ink hover:bg-sunken'

/**
 * The three questions (PRD Q1): 1-5 stars, "Is your aircon working well
 * now?" Yes / No, and an optional comment. Used by the customer page (in
 * English or Malay, 0011 Q19) and by staff recording a rating taken by phone
 * (`byPhone` words the questions about the customer, always English).
 */
export function FeedbackQuestions({
  values,
  errors,
  disabled,
  onChange,
  onAnswered,
  byPhone = false,
  text = FEEDBACK_TEXT.en,
}: {
  values: FeedbackFormValues
  errors: FeedbackFormErrors
  disabled?: boolean
  onChange: (values: FeedbackFormValues) => void
  /** A question was answered: its error message can go. */
  onAnswered?: (field: keyof FeedbackFormValues) => void
  /** Staff asking on the phone: "the customer's aircon". */
  byPhone?: boolean
  text?: FeedbackText
}) {
  const id = useId()
  const ratingError = `${id}-rating-error`
  const workingError = `${id}-working-error`
  const set = (patch: Partial<FeedbackFormValues>) => {
    onChange({ ...values, ...patch })
    for (const field of Object.keys(patch) as Array<keyof FeedbackFormValues>) onAnswered?.(field)
  }
  const commentLength = [...values.comment.trim()].length
  const locale = text === FEEDBACK_TEXT.ms ? 'ms-MY' : 'en-US'

  return (
    <div className="space-y-6">
      <fieldset aria-describedby={errors.rating ? ratingError : undefined}>
        <legend className="text-base font-semibold text-ink">
          {byPhone ? 'How did the customer rate the job?' : text.ratingQuestion}
        </legend>
        <div className="mt-3 flex justify-between gap-1 sm:justify-start sm:gap-2">
          {Array.from({ length: FEEDBACK_RATING_MAX }, (_, i) => i + 1).map((n) => {
            const on = values.rating === n
            const lit = values.rating !== null && n <= values.rating
            return (
              <label
                key={n}
                className="group flex min-h-14 min-w-12 flex-1 cursor-pointer flex-col items-center justify-center rounded-xl focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus sm:flex-none sm:px-1"
              >
                <input
                  type="radio"
                  name={`${id}-rating`}
                  value={n}
                  checked={on}
                  disabled={disabled}
                  onChange={() => set({ rating: n })}
                  className="sr-only"
                />
                <Star
                  aria-hidden="true"
                  strokeWidth={1.6}
                  className={`size-10 transition-transform group-active:scale-90 ${
                    lit ? 'fill-warning text-warning' : 'text-line-strong group-hover:text-warning'
                  }`}
                />
                <span className="sr-only">
                  {n} – {text.ratingLabels[n]}
                </span>
              </label>
            )
          })}
        </div>
        <p className="mt-1.5 min-h-5 text-sm font-medium text-ink-muted" aria-hidden="true">
          {values.rating !== null ? `${values.rating} – ${text.ratingLabels[values.rating]}` : text.tapAStar}
        </p>
        {errors.rating ? (
          <p id={ratingError} className="mt-1 text-sm text-danger">
            {text.ratingRequired}
          </p>
        ) : null}
      </fieldset>

      <fieldset aria-describedby={errors.workingWell ? workingError : undefined}>
        <legend className="text-base font-semibold text-ink">
          {byPhone ? "Is the customer's aircon working well now?" : text.workingQuestion}
        </legend>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {[
            [true, text.yes, ThumbsUp],
            [false, text.no, ThumbsDown],
          ].map(([value, label, Icon]) => {
            const on = values.workingWell === value
            const IconComponent = Icon as typeof ThumbsUp
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
                <IconComponent className="size-4.5" aria-hidden="true" />
                {label as string}
              </label>
            )
          })}
        </div>
        {errors.workingWell ? (
          <p id={workingError} className="mt-1 text-sm text-danger">
            {text.workingRequired}
          </p>
        ) : null}
      </fieldset>

      <Field
        id={`${id}-comment`}
        label={byPhone ? 'What the customer said' : text.comment}
        optional
        optionalText={text.optional}
        hint={text.characters(commentLength.toLocaleString(locale), FEEDBACK_COMMENT_MAX_LENGTH.toLocaleString(locale))}
        error={errors.comment ? text.commentTooLong : undefined}
      >
        {(control) => (
          <textarea
            {...control}
            rows={4}
            value={values.comment}
            disabled={disabled}
            onChange={(e) => set({ comment: e.target.value })}
            className={`${INPUT} max-md:text-base`}
          />
        )}
      </Field>
    </div>
  )
}
