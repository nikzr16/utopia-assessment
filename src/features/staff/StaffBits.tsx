import { initials } from '../../components/shell/UserMenu'
import { Badge } from '../../components/ui'
import { ROLE_LABELS, type StaffRole } from '../../domain'

/** One colour per role, so a list reads at a glance (0011). */
const ROLE_TONES = {
  admin: 'brand',
  manager: 'info',
  finance: 'warning',
  technician: 'neutral',
} as const satisfies Record<StaffRole, Parameters<typeof Badge>[0]['tone']>

export function RoleBadge({ role }: { role: StaffRole }) {
  return <Badge tone={ROLE_TONES[role]}>{ROLE_LABELS[role]}</Badge>
}

export function ActiveBadge({ active }: { active: boolean }) {
  return (
    <Badge tone={active ? 'success' : 'neutral'} dot>
      {active ? 'Active' : 'Inactive'}
    </Badge>
  )
}

/** Initials in a circle; greyed for someone who has left. */
export function StaffAvatar({ name, active = true, size = 'md' }: { name: string; active?: boolean; size?: 'md' | 'lg' }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold ${
        size === 'lg' ? 'size-14 text-lg' : 'size-10 text-sm'
      } ${active ? 'bg-brand-soft text-brand-ink' : 'bg-sunken text-ink-faint ring-1 ring-line'}`}
    >
      {initials(name)}
    </span>
  )
}
