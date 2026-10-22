import { BrowserRouter } from 'react-router'
import { AppHeader } from './components/AppHeader'
import { Notice } from './components/Notice'
import { RoleHome } from './components/RoleHome'
import { SetupNotice } from './components/SetupNotice'
import { AuthProvider, SignInForm, useAuth } from './features/auth'
import { TechnicianPortal } from './features/jobs'
import { AdminPortal } from './features/orders'

const PRIMARY_BUTTON =
  'mt-3 rounded-md bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-800 focus:outline-none focus:ring-2 focus:ring-sky-300'

function Main() {
  const { status, email, profile, signOut, reloadProfile } = useAuth()

  if (status === 'not-configured') return <SetupNotice />

  if (status === 'loading') {
    return (
      <Notice title="Loading…">
        <p>Checking your sign-in.</p>
      </Notice>
    )
  }

  if (status === 'signed-out') return <SignInForm />

  if (profile.status === 'loading') {
    return (
      <Notice title="Loading your profile…">
        <p>Looking up your staff profile.</p>
      </Notice>
    )
  }

  if (profile.status === 'error') {
    return (
      <Notice tone="error" title="Could not load your profile">
        <p>{profile.message}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={reloadProfile} className={PRIMARY_BUTTON}>
            Try again
          </button>
          <button
            type="button"
            onClick={() => void signOut()}
            className="mt-3 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-300"
          >
            Sign out
          </button>
        </div>
      </Notice>
    )
  }

  if (profile.status === 'no-profile') {
    return (
      <Notice tone="error" title="No active staff profile">
        <p className="break-words">
          {email ? `You are signed in as ${email}, but ` : 'You are signed in, but '}
          this account is not linked to an active staff profile, so you cannot see or change any
          data. Ask your administrator to set up your access, or sign in with a different account.
        </p>
        <button type="button" onClick={() => void signOut()} className={PRIMARY_BUTTON}>
          Sign out
        </button>
      </Notice>
    )
  }

  if (profile.profile.role === 'admin') return <AdminPortal branchName={profile.profile.branchName} />
  if (profile.profile.role === 'technician') return <TechnicianPortal staffId={profile.profile.id} />
  return <RoleHome role={profile.profile.role} />
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <div className="min-h-screen bg-slate-50 text-slate-900">
          <AppHeader />
          <main className="mx-auto max-w-6xl px-4 py-6">
            <Main />
          </main>
        </div>
      </AuthProvider>
    </BrowserRouter>
  )
}
