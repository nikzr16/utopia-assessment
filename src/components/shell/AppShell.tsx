import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router'
import { Ellipsis, PanelLeftClose, PanelLeftOpen, type LucideIcon } from 'lucide-react'
import { useNotifications } from '../../features/notifications'
import { Logo } from '../Logo'
import { UserMenu } from './UserMenu'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  /** Shorter text under the icon in the phone bottom bar. */
  shortLabel?: string
  /** Only an exact match marks it active. */
  end?: boolean
  /** Paths under `to` that belong to another item (e.g. "/orders/new"). */
  exclude?: string[]
  /** Phone: a bottom tab (default) or inside "More". */
  phone?: 'tab' | 'more'
  /** Shows the unread count and says it in the link name. */
  notifications?: boolean
}

export const SIDEBAR_STORAGE_KEY = 'sejuk.sidebar'

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'collapsed'
  } catch {
    return false
  }
}

function CountBadge({ count, floating }: { count: number; floating: boolean }) {
  if (count <= 0) return null
  return (
    <span
      aria-hidden="true"
      className={`inline-flex min-w-5 items-center justify-center rounded-full bg-danger px-1.5 text-[11px] font-semibold leading-5 text-on-danger ${
        floating ? 'absolute -right-2.5 -top-1.5 ring-2 ring-surface' : 'ml-auto'
      }`}
    >
      {count > 99 ? '99+' : count}
    </span>
  )
}

function ShellLink({ item, collapsed, onNavigate }: { item: NavItem; collapsed: boolean; onNavigate?: () => void }) {
  const { unread } = useNotifications()
  const { pathname } = useLocation()
  const excluded = item.exclude?.some((p) => pathname === p || pathname.startsWith(`${p}/`)) ?? false
  const count = item.notifications ? (unread ?? 0) : 0
  const Icon = item.icon
  const name = item.notifications ? (count > 0 ? `${item.label}, ${count} unread` : item.label) : undefined
  // The phone and desktop texts are both in the DOM; the name is said once.
  const ariaLabel = name ?? item.label
  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      aria-label={ariaLabel}
      title={collapsed ? item.label : undefined}
      className={({ isActive: matched }) => {
        const isActive = matched && !excluded
        return [
          'group relative flex items-center rounded-xl text-sm font-medium transition-colors',
          // Phone bottom tab: icon above a short label.
          'max-md:min-h-14 max-md:flex-1 max-md:flex-col max-md:justify-center max-md:gap-1 max-md:px-1 max-md:text-[11px]',
          // Tablet / desktop sidebar row.
          'md:min-h-10 md:gap-3 md:px-3 md:max-lg:justify-center md:max-lg:px-0',
          collapsed ? 'md:justify-center md:px-0' : '',
          item.phone === 'more' ? 'max-md:hidden' : '',
          isActive
            ? 'text-brand md:bg-brand-soft md:text-brand-ink'
            : 'text-ink-muted hover:text-ink md:hover:bg-sunken',
        ].join(' ')
      }}
      aria-current={excluded ? 'false' : 'page'}
    >
      {({ isActive: matched }) => {
        const isActive = matched && !excluded
        return (
        <>
          <span className="relative inline-flex">
            <Icon className="size-5 shrink-0" strokeWidth={isActive ? 2.25 : 1.9} aria-hidden="true" />
            {count > 0 ? (
              <span className="md:hidden">
                <CountBadge count={count} floating />
              </span>
            ) : null}
          </span>
          <span className={`md:hidden ${isActive ? 'font-semibold' : ''}`}>{item.shortLabel ?? item.label}</span>
          <span className={`max-md:hidden ${collapsed ? 'sr-only' : 'truncate md:max-lg:sr-only'}`}>{item.label}</span>
          {count > 0 && !collapsed ? (
            <span className="max-lg:hidden">
              <CountBadge count={count} floating={false} />
            </span>
          ) : null}
          {count > 0 ? (
            <span
              className={`absolute right-2 top-1.5 size-2 rounded-full bg-danger max-md:hidden ${collapsed ? '' : 'lg:hidden'}`}
              aria-hidden="true"
            />
          ) : null}
        </>
        )
      }}
    </NavLink>
  )
}

/** "More" in the phone bottom bar: the items that do not fit as tabs. */
function MoreMenu({ items }: { items: NavItem[] }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const id = useId()
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  if (items.length === 0) return null
  return (
    <div ref={box} className="relative flex flex-1 md:hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-14 flex-1 flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-medium text-ink-muted"
      >
        <Ellipsis className="size-5" aria-hidden="true" />
        More
      </button>
      {open ? (
        <div id={id} className="absolute bottom-full right-1 mb-2 w-56 animate-toast-in rounded-xl border border-line bg-raised p-1.5 shadow-pop">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium ${isActive ? 'bg-brand-soft text-brand-ink' : 'text-ink hover:bg-sunken'}`
              }
            >
              <item.icon className="size-5" aria-hidden="true" />
              {item.label}
            </NavLink>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/**
 * The signed-in frame for every role (PRD 0011 Q8, Q9; plan P4, P8). One
 * `nav` for every size: a left sidebar on a desktop (collapsible, remembered
 * on the device), icons only on a tablet, a bottom tab bar on a phone.
 */
export function AppShell({
  navLabel,
  items,
  width = 'wide',
  children,
}: {
  navLabel: string
  items: NavItem[]
  /** `narrow` for phone-first portals (technician). */
  width?: 'wide' | 'narrow'
  children: ReactNode
}) {
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const toggle = () => {
    setCollapsed((c) => {
      try {
        window.localStorage.setItem(SIDEBAR_STORAGE_KEY, c ? 'open' : 'collapsed')
      } catch {
        // Storage blocked: the choice lasts until reload.
      }
      return !c
    })
  }
  const more = items.filter((i) => i.phone === 'more')

  return (
    <div
      className="min-h-dvh max-md:[--nav-h:calc(4.125rem+env(safe-area-inset-bottom))]"
      data-shell={collapsed ? 'collapsed' : 'open'}
    >
      <a
        href="#main"
        className="sr-only z-[70] rounded-md bg-surface px-3 py-2 text-sm font-medium focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to content
      </a>

      {/* Phone top bar: the logo; the account menu sits on top of it (below). */}
      <header className="sticky top-0 z-30 flex h-14 items-center border-b border-line bg-surface/90 px-4 backdrop-blur md:hidden">
        <Logo size="sm" />
      </header>

      <aside
        className={`fixed z-40 flex border-line bg-surface max-md:inset-x-0 max-md:bottom-0 max-md:border-t max-md:pb-[env(safe-area-inset-bottom)] md:inset-y-0 md:left-0 md:w-[4.5rem] md:flex-col md:border-r ${
          collapsed ? '' : 'lg:w-60'
        }`}
      >
        <div className={`flex h-16 shrink-0 items-center px-4 max-md:hidden ${collapsed ? '' : 'lg:px-5'}`}>
          <span className={collapsed ? '' : 'lg:hidden'}>
            <Logo showName={false} />
          </span>
          {collapsed ? null : (
            <span className="max-lg:hidden">
              <Logo />
            </span>
          )}
        </div>

        <nav
          aria-label={navLabel}
          data-bottom-nav
          className="flex flex-1 max-md:items-stretch max-md:px-1.5 max-md:py-1 md:flex-col md:gap-1 md:overflow-y-auto md:overflow-x-hidden md:px-3 md:py-2"
        >
          {items.map((item) => (
            <ShellLink key={item.to} item={item} collapsed={collapsed} />
          ))}
          <MoreMenu items={more} />
        </nav>

        <div className="max-md:fixed max-md:right-3 max-md:top-2.5 max-md:z-50 md:border-t md:border-line md:p-3">
          <UserMenu compact={collapsed} />
          <button
            type="button"
            onClick={toggle}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="mt-1 hidden min-h-9 w-full items-center gap-3 rounded-lg px-3 text-xs font-medium text-ink-faint hover:bg-sunken hover:text-ink lg:flex"
          >
            {collapsed ? <PanelLeftOpen className="mx-auto size-4" aria-hidden="true" /> : <PanelLeftClose className="size-4" aria-hidden="true" />}
            {collapsed ? null : 'Collapse'}
          </button>
        </div>
      </aside>

      <main
        id="main"
        tabIndex={-1}
        className={`pb-[calc(5.5rem+env(safe-area-inset-bottom))] focus:outline-none md:pb-10 md:pl-[4.5rem] ${collapsed ? '' : 'lg:pl-60'}`}
      >
        <div className={`mx-auto px-4 pt-5 sm:px-6 md:pt-8 lg:px-8 ${width === 'narrow' ? 'max-w-2xl' : 'max-w-7xl'}`}>{children}</div>
      </main>
    </div>
  )
}
