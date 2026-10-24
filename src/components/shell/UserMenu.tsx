import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router'
import { ChevronsUpDown, KeyRound, LogOut, Monitor, Moon, Sun } from 'lucide-react'
import { ROLE_LABELS } from '../../domain'
import { formatSignedInAs, useAuth } from '../../features/auth'
import { useTheme, type ThemeChoice } from '../../lib/theme'

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? '?').slice(0, 2)
  return letters.toUpperCase()
}

const THEMES: Array<{ value: ThemeChoice; label: string; Icon: typeof Sun }> = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor },
]

/**
 * Who is signed in, theme, change password and sign out (PRD 0011 Q7, Q8).
 * One menu for every size: at the bottom of the sidebar on a desktop, top
 * right on a phone.
 */
export function UserMenu({ compact }: { compact: boolean }) {
  const { profile, signOut } = useAuth()
  const { choice, setChoice } = useTheme()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (profile.status !== 'ready') return null
  const me = profile.profile
  const where = `${ROLE_LABELS[me.role]} · ${me.branchName ?? 'All branches'}`

  return (
    <div ref={box} className="relative">
      <p className="sr-only" aria-live="polite">
        {formatSignedInAs(me)}
      </p>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`Account menu for ${me.name}`}
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center gap-3 rounded-xl text-left hover:bg-sunken max-lg:justify-center max-lg:p-1 ${compact ? 'justify-center p-1.5' : 'p-2'}`}
      >
        <span
          aria-hidden="true"
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-semibold text-brand-ink ring-1 ring-brand/25"
        >
          {initials(me.name)}
        </span>
        {compact ? null : (
          <span className="min-w-0 flex-1 max-lg:hidden">
            <span className="block truncate text-sm font-medium text-ink">{me.name}</span>
            <span className="block truncate text-xs text-ink-faint">{where}</span>
          </span>
        )}
        {compact ? null : <ChevronsUpDown className="size-4 shrink-0 text-ink-faint max-lg:hidden" aria-hidden="true" />}
      </button>

      {open ? (
        <div
          id={menuId}
          className="absolute z-50 w-72 animate-toast-in rounded-xl border border-line bg-raised p-2 shadow-pop max-md:right-0 max-md:top-full max-md:mt-2 md:bottom-full md:left-0 md:mb-2"
        >
          <div className="px-2.5 pb-2.5 pt-1.5">
            <p className="truncate text-sm font-semibold text-ink">{me.name}</p>
            <p className="truncate text-xs text-ink-faint">{where}</p>
          </div>
          <div className="border-t border-line px-2.5 py-2.5">
            <p id={`${menuId}-theme`} className="mb-1.5 text-xs font-medium text-ink-faint">
              Theme
            </p>
            <div role="radiogroup" aria-labelledby={`${menuId}-theme`} className="grid grid-cols-3 gap-1 rounded-lg bg-sunken p-1">
              {THEMES.map(({ value, label, Icon }) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={choice === value}
                  onClick={() => setChoice(value)}
                  className={`inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md text-xs font-medium ${
                    choice === value ? 'bg-surface text-ink shadow-card' : 'text-ink-muted hover:text-ink'
                  }`}
                >
                  <Icon className="size-3.5" aria-hidden="true" />
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="border-t border-line pt-1.5">
            <Link
              to="/account/password"
              onClick={() => setOpen(false)}
              className="flex min-h-10 items-center gap-2.5 rounded-lg px-2.5 text-sm text-ink hover:bg-sunken"
            >
              <KeyRound className="size-4 text-ink-faint" aria-hidden="true" />
              Change password
            </Link>
            <button
              type="button"
              onClick={() => void signOut()}
              className="flex min-h-10 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm text-danger hover:bg-danger-soft"
            >
              <LogOut className="size-4" aria-hidden="true" />
              Sign out
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
