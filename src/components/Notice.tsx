import type { ReactNode } from 'react'

type Tone = 'info' | 'error'

const TONES: Record<Tone, string> = {
  info: 'border-brand/30 bg-brand-soft text-brand-ink',
  error: 'border-danger/40 bg-danger-soft text-danger-ink',
}

export function Notice({
  tone = 'info',
  title,
  children,
}: {
  tone?: Tone
  title: string
  children?: ReactNode
}) {
  return (
    <section
      role={tone === 'error' ? 'alert' : 'status'}
      className={`mx-auto max-w-2xl rounded-lg border p-5 ${TONES[tone]}`}
    >
      <h2 className="text-lg font-semibold">{title}</h2>
      {children ? <div className="mt-2 text-sm">{children}</div> : null}
    </section>
  )
}
