import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { isSupabaseConfigured, supabase } from '../../lib/supabase'
import { AuthContext, type AuthState } from './AuthContext'
import { mapAuthError } from './errors'
import { deriveProfileState, PROFILE_LOADING, type ProfileState } from './profile'

interface Identity {
  /** 'loading' until the stored session (if any) has been read. */
  resolved: boolean
  userId: string | null
  email: string | null
}

const INITIAL_IDENTITY: Identity = { resolved: false, userId: null, email: null }

export function AuthProvider({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState<Identity>(INITIAL_IDENTITY)
  // Keyed by user id so a previous user's profile is never shown to the next one.
  const [loaded, setLoaded] = useState<{ userId: string; state: ProfileState } | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  // Track the Supabase session. Token refreshes keep the same user id, so they do not re-render.
  useEffect(() => {
    if (!supabase) return
    let active = true

    const apply = (user: { id: string; email?: string | null } | null | undefined) => {
      if (!active) return
      setIdentity({ resolved: true, userId: user?.id ?? null, email: user?.email ?? null })
    }

    void supabase.auth.getSession().then(({ data }) => apply(data.session?.user))
    // Keep this callback synchronous: calling Supabase from inside it can deadlock the client.
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      apply(session?.user)
    })

    return () => {
      active = false
      subscription.subscription.unsubscribe()
    }
  }, [])

  // Look up the active staff profile whenever the signed-in user changes.
  useEffect(() => {
    if (!supabase || !identity.userId) return
    const userId = identity.userId
    let cancelled = false

    void supabase.rpc('current_staff').then(({ data, error }) => {
      if (!cancelled) setLoaded({ userId, state: deriveProfileState(data, error) })
    })

    return () => {
      cancelled = true
    }
  }, [identity.userId, reloadToken])

  const signIn = useCallback(async (email: string, password: string) => {
    if (!supabase) return 'Supabase is not configured.'
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      return error ? mapAuthError(error) : null
    } catch (err) {
      return mapAuthError(err)
    }
  }, [])

  const signOut = useCallback(async () => {
    if (!supabase) return
    // The local session is cleared even if the network call fails.
    await supabase.auth.signOut()
    setIdentity({ resolved: true, userId: null, email: null })
    setLoaded(null)
  }, [])

  const reloadProfile = useCallback(() => {
    setLoaded(null)
    setReloadToken((n) => n + 1)
  }, [])

  const value = useMemo<AuthState>(() => {
    const status: AuthState['status'] = !isSupabaseConfigured
      ? 'not-configured'
      : !identity.resolved
        ? 'loading'
        : identity.userId
          ? 'signed-in'
          : 'signed-out'
    const profile = loaded && loaded.userId === identity.userId ? loaded.state : PROFILE_LOADING
    return { status, email: identity.email, profile, signIn, signOut, reloadProfile }
  }, [identity, loaded, signIn, signOut, reloadProfile])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
