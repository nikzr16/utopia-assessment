import { Link } from 'react-router'
import { formatSignedInAs, useAuth } from '../features/auth'

export function AppHeader() {
  const { status, profile, signOut } = useAuth()
  const ready = status === 'signed-in' && profile.status === 'ready'

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold">Sejuk Sejuk Service</h1>
          <p className="break-words text-sm text-slate-600" aria-live="polite">
            {ready ? formatSignedInAs(profile.profile) : 'Service order management'}
          </p>
        </div>
        {ready ? (
          <div className="flex shrink-0 gap-2">
            <Link
              to="/account/password"
              className="flex-1 rounded-md px-3 py-2 text-center text-sm font-medium text-sky-800 hover:bg-sky-50 focus:outline-none focus:ring-2 focus:ring-sky-300 sm:flex-none"
            >
              Change password
            </Link>
            <button
              type="button"
              onClick={() => void signOut()}
              className="flex-1 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-300 sm:flex-none"
            >
              Sign out
            </button>
          </div>
        ) : null}
      </div>
    </header>
  )
}
