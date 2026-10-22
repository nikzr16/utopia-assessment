import type { FieldControlProps } from '../../components/Field'
import { INPUT } from '../../components/styles'
import type { Branch, TechnicianOption } from './api'

/**
 * Technician dropdown: the order's branch first, then the other branches, each
 * technician with their open-job count (PRD Q3).
 */
export function TechnicianSelect({
  control,
  value,
  onChange,
  onBlur,
  technicians,
  branches,
  orderBranchId,
  excludeId,
  emptyLabel,
}: {
  control: FieldControlProps
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  technicians: TechnicianOption[]
  branches: Branch[]
  orderBranchId: string
  excludeId?: string | null
  /** Label of the "no technician" option; omit to require a choice. */
  emptyLabel?: string
}) {
  const available = technicians.filter((t) => t.id !== excludeId)
  const branchOrder = [...branches].sort((a, b) =>
    a.id === orderBranchId ? -1 : b.id === orderBranchId ? 1 : a.name.localeCompare(b.name),
  )
  const groups = branchOrder
    .map((b) => ({ branch: b, people: available.filter((t) => t.branch_id === b.id) }))
    .filter((g) => g.people.length > 0)

  return (
    <select
      {...control}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      className={INPUT}
    >
      <option value="">{emptyLabel ?? 'Select a technician'}</option>
      {groups.map(({ branch, people }) => (
        <optgroup key={branch.id} label={branch.id === orderBranchId ? `${branch.name} (this branch)` : branch.name}>
          {people.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} — {t.open_jobs === 1 ? '1 open job' : `${t.open_jobs} open jobs`}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}
