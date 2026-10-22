import { createContext } from 'react'
import type { ProfileState } from './profile'

export type AuthStatus = 'not-configured' | 'loading' | 'signed-out' | 'signed-in'

export interface AuthState {
  status: AuthStatus
  /** Email of the signed-in account (null when signed out). */
  email: string | null
  /** Staff profile lookup state; only meaningful when status is 'signed-in'. */
  profile: ProfileState
  /** Resolves to an error message, or null on success. */
  signIn: (email: string, password: string) => Promise<string | null>
  signOut: () => Promise<void>
  /** Re-run the staff profile lookup (e.g. after a load error). */
  reloadProfile: () => void
}

export const AuthContext = createContext<AuthState | null>(null)
