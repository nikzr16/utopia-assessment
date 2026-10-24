import type { ReactNode } from 'react'
import { ClipboardCheck, Snowflake, Wallet, Wrench } from 'lucide-react'
import { Logo } from '../../components/Logo'

const POINTS = [
  { icon: Wrench, text: 'Technicians see their jobs, photos and payments on site' },
  { icon: ClipboardCheck, text: 'Managers review finished work with AI checks' },
  { icon: Wallet, text: 'Finance verifies payments and closes orders' },
]

/**
 * Frame for the signed-out staff pages (PRD 0011 Q17): on a desktop a cyan
 * brand panel beside the form; on a phone the logo above it.
 */
export function AuthLayout({ children, panel = true }: { children: ReactNode; panel?: boolean }) {
  return (
    <div className="flex min-h-dvh bg-canvas">
      {panel ? (
        <aside className="relative hidden w-[44%] max-w-xl flex-col justify-between overflow-hidden bg-panel p-10 text-on-panel lg:flex xl:p-14">
          <Snowflake
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-24 -right-24 size-[26rem] opacity-[0.08]"
            strokeWidth={1.2}
          />
          <Snowflake aria-hidden="true" className="pointer-events-none absolute right-16 top-24 size-24 opacity-[0.07]" strokeWidth={1.4} />
          <div className="flex items-center gap-3">
            <span className="inline-flex size-11 items-center justify-center rounded-xl bg-on-panel/15 ring-1 ring-on-panel/25" aria-hidden="true">
              <Snowflake className="size-6" strokeWidth={2.2} />
            </span>
            <span className="text-xl font-semibold tracking-tight">Sejuk Sejuk Service</span>
          </div>
          <div className="relative max-w-md">
            <p className="text-3xl font-semibold leading-tight tracking-tight xl:text-4xl">
              Every aircond job, from order to payment, in one place.
            </p>
            <ul className="mt-8 space-y-4">
              {POINTS.map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-start gap-3 text-sm opacity-95">
                  <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-on-panel/15" aria-hidden="true">
                    <Icon className="size-4" />
                  </span>
                  <span className="pt-1.5">{text}</span>
                </li>
              ))}
            </ul>
          </div>
          <p className="relative text-xs opacity-80">Internal operations system · Staff only · 5 branches</p>
        </aside>
      ) : null}

      <main className="flex flex-1 flex-col items-center justify-center px-5 py-10 sm:px-8">
        <div className={`mb-8 ${panel ? 'lg:hidden' : ''}`}>
          <Logo full size="lg" />
        </div>
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  )
}
