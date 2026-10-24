/**
 * Shared class strings so buttons, inputs and cards look the same everywhere
 * (0011 design tokens: named colours only, so light and dark both work).
 */
const BUTTON_BASE =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-55 [&_svg]:size-4 [&_svg]:shrink-0'

export const BUTTON = {
  primary: `${BUTTON_BASE} bg-brand text-on-brand shadow-card hover:bg-brand-strong`,
  secondary: `${BUTTON_BASE} border border-line-strong bg-surface text-ink hover:bg-sunken`,
  ghost: `${BUTTON_BASE} text-ink-muted hover:bg-sunken hover:text-ink`,
  danger: `${BUTTON_BASE} bg-danger text-on-danger shadow-card hover:bg-danger-strong`,
  dangerSoft: `${BUTTON_BASE} border border-line-strong bg-surface text-danger hover:bg-danger-soft`,
  whatsapp: `${BUTTON_BASE} bg-whatsapp text-on-whatsapp shadow-card hover:bg-whatsapp-strong`,
}

export const INPUT =
  'block min-h-10 w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink shadow-xs placeholder:text-ink-faint focus:border-brand focus:outline-none focus:ring-3 focus:ring-brand/20 disabled:bg-sunken disabled:text-ink-muted aria-[invalid=true]:border-danger aria-[invalid=true]:ring-danger/15 max-md:text-base'

export const CARD = 'rounded-xl border border-line bg-surface p-4 shadow-card sm:p-5'

export const LINK =
  'font-medium text-brand underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus rounded-sm'

/** Small uppercase label above a value or a section. */
export const EYEBROW = 'text-xs font-medium uppercase tracking-wide text-ink-faint'

/** Data tables on a desktop (lists become cards on a phone). */
export const TABLE = {
  wrap: 'overflow-hidden rounded-xl border border-line bg-surface shadow-card',
  table: 'w-full text-left text-sm',
  head: 'border-b border-line bg-sunken/70 text-xs font-medium uppercase tracking-wide text-ink-faint',
  th: 'px-3 py-3 font-medium xl:px-4',
  row: 'border-b border-line last:border-0 transition-colors hover:bg-sunken/60',
  td: 'px-3 py-3 align-top text-ink xl:px-4',
}
