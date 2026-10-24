import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { ArrowLeft, Inbox, RotateCw, TriangleAlert } from 'lucide-react'
import { BUTTON, CARD, EYEBROW } from './styles'

/** Shared page building blocks (0011): page header, cards, states, skeletons. */

export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="-ml-1 inline-flex min-h-9 items-center gap-1.5 rounded-md px-1 text-sm font-medium text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-focus"
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      {children}
    </Link>
  )
}

/** Title row: optional eyebrow and description on the left, actions on the right. */
export function PageHeader({
  title,
  eyebrow,
  description,
  badge,
  actions,
  level = 2,
  row = false,
}: {
  /** Keep the actions beside the title on a phone too (one short button). */
  row?: boolean
  title: ReactNode
  eyebrow?: ReactNode
  description?: ReactNode
  badge?: ReactNode
  actions?: ReactNode
  level?: 1 | 2
}) {
  const Heading = level === 1 ? 'h1' : 'h2'
  return (
    <header className={`flex gap-3 ${row ? 'flex-row items-center justify-between' : 'flex-col sm:flex-row sm:items-end sm:justify-between'}`}>
      <div className="min-w-0">
        {eyebrow ? <p className="mb-1 text-sm text-ink-muted">{eyebrow}</p> : null}
        <Heading className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xl font-semibold tracking-tight text-ink">
          {title}
          {badge}
        </Heading>
        {description ? <p className="mt-1 text-sm text-ink-muted">{description}</p> : null}
      </div>
      {actions ? <div className={`flex flex-wrap gap-2 sm:shrink-0 sm:justify-end ${row ? 'shrink-0' : ''}`}>{actions}</div> : null}
    </header>
  )
}

export function Card({
  title,
  description,
  actions,
  children,
  className = '',
  as: Tag = 'section',
  ...rest
}: {
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  className?: string
  as?: 'section' | 'div' | 'article'
  'aria-label'?: string
  'aria-labelledby'?: string
}) {
  return (
    <Tag className={`${CARD} ${className}`} {...rest}>
      {title || actions ? (
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title ? <h3 className="text-base font-semibold text-ink">{title}</h3> : null}
            {description ? <p className="mt-0.5 text-sm text-ink-muted">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </Tag>
  )
}

/** Label / value pairs ("Customer", "Phone", ...). */
export function DetailList({ items, columns = 2 }: { items: Array<{ label: string; value: ReactNode; wide?: boolean }>; columns?: 1 | 2 }) {
  return (
    <dl className={`grid gap-x-6 gap-y-4 ${columns === 2 ? 'sm:grid-cols-2' : ''}`}>
      {items.map((item) => (
        <div key={item.label} className={item.wide && columns === 2 ? 'sm:col-span-2' : ''}>
          <dt className={EYEBROW}>{item.label}</dt>
          <dd className="mt-1 break-words text-sm text-ink">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

type Tone = 'neutral' | 'brand' | 'info' | 'success' | 'warning' | 'danger'

const BADGE_TONES: Record<Tone, string> = {
  neutral: 'bg-sunken text-ink-muted ring-line-strong',
  brand: 'bg-brand-soft text-brand-ink ring-brand/30',
  info: 'bg-info-soft text-info-ink ring-info/30',
  success: 'bg-success-soft text-success-ink ring-success/30',
  warning: 'bg-warning-soft text-warning-ink ring-warning/35',
  danger: 'bg-danger-soft text-danger-ink ring-danger/30',
}

export function Badge({ tone = 'neutral', children, dot = false }: { tone?: Tone; children: ReactNode; dot?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${BADGE_TONES[tone]}`}
    >
      {dot ? <span className="size-1.5 rounded-full bg-current" aria-hidden="true" /> : null}
      {children}
    </span>
  )
}

/** Grey placeholder block that pulses while data loads (PRD 0011 Q14). */
export function Skeleton({ className = '' }: { className?: string }) {
  return <span aria-hidden="true" className={`block animate-skeleton rounded-md bg-line ${className}`} />
}

/**
 * Loading placeholder: grey shapes in the page's layout, plus the old text
 * for screen readers.
 */
export function LoadingState({
  label = 'Loading…',
  variant = 'rows',
  count = 4,
}: {
  label?: ReactNode
  variant?: 'rows' | 'cards' | 'page' | 'tiles'
  count?: number
}) {
  const items = Array.from({ length: count }, (_, i) => i)
  return (
    <div role="status" className="w-full">
      <span className="sr-only">{label}</span>
      {variant === 'rows' ? (
        <div className={`${CARD} space-y-4`}>
          {items.map((i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="hidden h-4 w-20 sm:block" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
          ))}
        </div>
      ) : variant === 'cards' ? (
        <div className="space-y-3">
          {items.map((i) => (
            <div key={i} className={`${CARD} space-y-2.5`}>
              <div className="flex justify-between">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-5 w-20 rounded-full" />
              </div>
              <Skeleton className="h-3.5 w-2/3" />
              <Skeleton className="h-3.5 w-1/2" />
            </div>
          ))}
        </div>
      ) : variant === 'tiles' ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {items.map((i) => (
            <div key={i} className={`${CARD} space-y-3`}>
              <Skeleton className="h-3.5 w-20" />
              <Skeleton className="h-7 w-16" />
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-48" />
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div className={`${CARD} space-y-3`}>
              {items.map((i) => (
                <Skeleton key={i} className="h-4 w-full" />
              ))}
            </div>
            <div className={`${CARD} space-y-3`}>
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-10 w-full" />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** Designed empty state: icon, headline, one line, optional action. */
export function EmptyState({
  title,
  children,
  action,
  icon,
  compact = false,
}: {
  title: ReactNode
  children?: ReactNode
  action?: ReactNode
  icon?: ReactNode
  compact?: boolean
}) {
  return (
    <div className={`flex flex-col items-center rounded-xl border border-dashed border-line-strong bg-surface text-center ${compact ? 'px-4 py-6' : 'px-6 py-10'}`}>
      <span className="mb-3 inline-flex size-11 items-center justify-center rounded-full bg-brand-soft text-brand" aria-hidden="true">
        {icon ?? <Inbox className="size-5" />}
      </span>
      <p className="font-medium text-ink">{title}</p>
      {children ? <div className="mt-1 max-w-md text-sm text-ink-muted">{children}</div> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}

/** Error box with an optional Try again. */
export function ErrorState({
  title,
  children,
  onRetry,
  retryLabel = 'Try again',
}: {
  title: ReactNode
  children?: ReactNode
  onRetry?: () => void
  retryLabel?: string
}) {
  return (
    <section role="alert" className="rounded-xl border border-danger/35 bg-danger-soft p-4 text-danger-ink sm:p-5">
      <div className="flex gap-3">
        <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <h2 className="font-semibold">{title}</h2>
          {children ? <div className="mt-1 text-sm">{children}</div> : null}
          {onRetry ? (
            <button type="button" onClick={onRetry} className={`${BUTTON.secondary} mt-3`}>
              <RotateCw aria-hidden="true" />
              {retryLabel}
            </button>
          ) : null}
        </div>
      </div>
    </section>
  )
}

/**
 * Segmented tabs that are links (job lists, queues). The active one has
 * `aria-current="page"`.
 */
export function SegmentedTabs({
  label,
  items,
}: {
  label: string
  items: Array<{ key: string; to: string; label: ReactNode; active: boolean; count?: number }>
}) {
  return (
    <nav
      aria-label={label}
      className={`flex gap-1 overflow-x-auto rounded-xl bg-sunken p-1 ring-1 ring-inset ring-line ${
        items.length > 3 ? 'max-sm:grid max-sm:grid-cols-2' : ''
      }`}
    >
      {items.map((item) => (
        <Link
          key={item.key}
          to={item.to}
          aria-current={item.active ? 'page' : undefined}
          className={`flex min-h-10 flex-1 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3 text-sm font-medium transition-colors max-md:min-h-11 ${
            item.active ? 'bg-surface text-ink shadow-card ring-1 ring-line' : 'text-ink-muted hover:text-ink'
          }`}
        >
          {item.label}
          {item.count !== undefined ? (
            <span
              className={`rounded-full px-1.5 text-xs tabular ${item.active ? 'bg-brand-soft text-brand-ink' : 'bg-line text-ink-muted'}`}
            >
              {item.count}
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  )
}
