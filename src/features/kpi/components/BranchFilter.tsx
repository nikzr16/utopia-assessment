import { useId } from 'react'
import { MapPin } from 'lucide-react'
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
    <div className="w-full sm:w-60">
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-ink-muted">
        Branch
      </label>
      <div className="relative">
        <MapPin className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-faint" aria-hidden="true" />
        <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} className={`${INPUT} pl-9 max-md:min-h-11`}>
          <option value="">{allLabel}</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
