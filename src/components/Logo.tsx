import { Snowflake } from 'lucide-react'

/**
 * The brand mark (PRD 0011 Q3, Q4): a snowflake in a rounded cyan square
 * plus the name. "Sejuk Sejuk" in the app shell, "Sejuk Sejuk Service" where
 * people outside the company see it.
 */
export function Logo({
  full = false,
  size = 'md',
  showName = true,
  className = '',
}: {
  full?: boolean
  size?: 'sm' | 'md' | 'lg'
  showName?: boolean
  className?: string
}) {
  const box = size === 'lg' ? 'size-11 rounded-xl' : size === 'sm' ? 'size-8 rounded-lg' : 'size-9 rounded-lg'
  const icon = size === 'lg' ? 'size-6' : size === 'sm' ? 'size-4.5' : 'size-5'
  const text = size === 'lg' ? 'text-xl' : 'text-base'
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <span className={`inline-flex shrink-0 items-center justify-center bg-brand text-on-brand shadow-card ${box}`} aria-hidden="true">
        <Snowflake className={icon} strokeWidth={2.2} />
      </span>
      {showName ? (
        <span className={`font-semibold leading-tight tracking-tight text-ink ${text}`}>
          {full ? 'Sejuk Sejuk Service' : 'Sejuk Sejuk'}
        </span>
      ) : (
        <span className="sr-only">{full ? 'Sejuk Sejuk Service' : 'Sejuk Sejuk'}</span>
      )}
    </span>
  )
}
