import { useId } from 'react'
import { INPUT } from '../../../components/styles'
import type { KpiBranchOption } from '../api'

/**
 * "All my branches" or one branch, kept in the address. Hidden when there is
 * nothing to choose (a Manager with one branch) and for technicians, who get
 * an empty list.
 */
export function BranchFilter({
  branches,
  value,
  allLabel,
  onChange,
}: {
  branches: readonly KpiBranchOption[]
  value: string | null
  allLabel: string
  onChange: (branchId: string | null) => void
}) {
  const id = useId()
  if (branches.length < 2) return null
  return (
    <div className="w-full sm:w-64">
      <label htmlFor={id} className="block text-xs font-medium text-slate-600">
        Branch
      </label>
      <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} className={`${INPUT} mt-1 min-h-11`}>
        <option value="">{allLabel}</option>
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
    </div>
  )
}
