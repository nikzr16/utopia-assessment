import type { ReactNode } from 'react'

/**
 * A labelled form control with an optional hint and error. The control is
 * rendered by the caller through `children`, which receives the ids it must
 * use so the label, hint, and error are announced together.
 */
export interface FieldControlProps {
  id: string
  'aria-invalid': boolean
  'aria-describedby': string | undefined
}

export function Field({
  id,
  label,
  hint,
  error,
  optional,
  children,
}: {
  id: string
  label: string
  hint?: ReactNode
  error?: string
  optional?: boolean
  children: (control: FieldControlProps) => ReactNode
}) {
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-slate-800">
        {label}
        {optional ? <span className="font-normal text-slate-500"> (optional)</span> : null}
      </label>
      {hint ? (
        <p id={hintId} className="mt-0.5 text-xs text-slate-500">
          {hint}
        </p>
      ) : null}
      <div className="mt-1">
        {children({ id, 'aria-invalid': Boolean(error), 'aria-describedby': describedBy })}
      </div>
      {error ? (
        <p id={errorId} className="mt-1 text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/** A read-only value shown in a form in place of a control. */
export function ReadOnlyField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="block text-sm font-medium text-slate-800">{label}</p>
      <div className="mt-1 rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700">
        {children}
      </div>
    </div>
  )
}
