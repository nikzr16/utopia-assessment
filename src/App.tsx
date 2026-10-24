import type { ReactNode } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router'
import { LogOut, RotateCw } from 'lucide-react'
import { Logo } from './components/Logo'
import { SetupNotice } from './components/SetupNotice'
import { BUTTON } from './components/styles'
import { LoadingState } from './components/ui'
import { AuthProvider, ConfirmLinkPage, SignInForm, useAuth } from './features/auth'
import { FeedbackPage } from './features/feedback'
import { FinancePortal } from './features/finance'
import { TechnicianPortal } from './features/jobs'
import { AdminPortal } from './features/orders'
import { ManagerPortal } from './features/review'
import { ThemeProvider } from './lib/theme'

/** Centred, branded frame for the moments before a portal can show. */
function Gate({ title, tone = 'info', children }: { title: string; tone?: 'info' | 'error'; children?: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <Logo size="lg" className="mb-6" />
      <section
        role={tone === 'error' ? 'alert' : 'status'}
        className={`w-full max-w-md rounded-2xl border p-6 shadow-card ${
          tone === 'error' ? 'border-danger/35 bg-surface' : 'border-line bg-surface'
        }`}
      >
        <h2 className={`text-lg font-semibold ${tone === 'error' ? 'text-danger-ink' : 'text-ink'}`}>{title}</h2>
        {children ? <div className="mt-2 space-y-3 text-sm text-ink-muted">{children}</div> : null}
      </section>
    </div>
  )
}

function Main() {
  const { status, email, profile, signOut, reloadProfile } = useAuth()

  if (status === 'not-configured') {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
        <Logo size="lg" className="mb-6" />
        <SetupNotice />
      </div>
    )
  }

  if (status === 'loading') {
    return (
      <Gate title="Loading…">
        <p>Checking your sign-in.</p>
      </Gate>
    )
  }

  if (status === 'signed-out') return <SignInForm />

  if (profile.status === 'loading') {
    return (
      <div className="mx-auto max-w-3xl px-4 pt-10">
        <LoadingState variant="page" label="Loading your profile… Looking up your staff profile." />
      </div>
    )
  }

  if (profile.status === 'error') {
    return (
      <Gate tone="error" title="Could not load your profile">
        <p>{profile.message}</p>
        <div className="flex flex-wrap gap-2 pt-1">
          <button type="button" onClick={reloadProfile} className={BUTTON.primary}>
            <RotateCw aria-hidden="true" />
            Try again
          </button>
          <button type="button" onClick={() => void signOut()} className={BUTTON.secondary}>
            <LogOut aria-hidden="true" />
            Sign out
          </button>
        </div>
      </Gate>
    )
  }

  if (profile.status === 'no-profile') {
    return (
      <Gate tone="error" title="No active staff profile">
        <p className="break-words">
          {email ? `You are signed in as ${email}, but ` : 'You are signed in, but '}
          this account is not linked to an active staff profile, so you cannot see or change any
          data. Ask your administrator to set up your access, or sign in with a different account.
        </p>
        <button type="button" onClick={() => void signOut()} className={BUTTON.primary}>
          <LogOut aria-hidden="true" />
          Sign out
        </button>
      </Gate>
    )
  }

  const { id, name, role, branchName } = profile.profile
  // Each portal brings its own frame (sidebar / bottom bar) and routes,
  // including /account/password.
  if (role === 'admin') return <AdminPortal branchName={branchName} />
  if (role === 'technician') return <TechnicianPortal staffId={id} />
  if (role === 'manager') return <ManagerPortal staffId={id} staffName={name} />
  return <FinancePortal staffId={id} staffName={name} />
}

function StaffApp() {
  return (
    <AuthProvider>
      <Main />
    </AuthProvider>
  )
}

/**
 * The customer feedback page (0005) and the invite / password email link
 * (0006) need no sign-in; everything else is the staff app.
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/f/:token" element={<FeedbackPage />} />
      <Route path="/auth/confirm" element={<ConfirmLinkPage />} />
      <Route path="*" element={<StaffApp />} />
    </Routes>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </ThemeProvider>
  )
}
