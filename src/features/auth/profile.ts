import { ROLE_LABELS, STAFF_ROLES, type StaffRole } from '../../domain'

/** The signed-in user's active staff profile, as returned by the `current_staff()` RPC. */
export interface StaffProfile {
  id: string
  name: string
  role: StaffRole
  /** Null for rows without a branch. */
  branchName: string | null
}

export type ProfileState =
  | { status: 'loading' }
  | { status: 'no-profile' }
  | { status: 'error'; message: string }
  | { status: 'ready'; profile: StaffProfile }

export const BRANCH_FALLBACK_LABEL = 'All branches'
export const PROFILE_LOADING: ProfileState = { status: 'loading' }

function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === 'string' && (STAFF_ROLES as readonly string[]).includes(value)
}

function cleanName(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function readBranchName(row: Record<string, unknown>): string | null {
  const flat = cleanName(row.branch_name)
  if (flat) return flat
  // Tolerate an embedded relation too (object or single-element array).
  const branch = Array.isArray(row.branch) ? row.branch[0] : row.branch
  if (typeof branch === 'string') return cleanName(branch)
  if (branch && typeof branch === 'object' && 'name' in branch) {
    return cleanName((branch as { name: unknown }).name)
  }
  return null
}

/** Maps one `current_staff()` row to a profile; null when malformed or the role is unknown. */
export function toStaffProfile(row: unknown): StaffProfile | null {
  if (!row || typeof row !== 'object') return null
  const r = row as Record<string, unknown>
  const name = cleanName(r.name)
  if (typeof r.id !== 'string' || !name || !isStaffRole(r.role)) return null
  return { id: r.id, name, role: r.role, branchName: readBranchName(r) }
}

/**
 * Derives the profile state from an RPC response. `current_staff()` returns no
 * row when the signed-in account has no active staff profile; that is a normal
 * outcome (not an error) and gets its own state so the UI can explain it.
 */
export function deriveProfileState(
  data: unknown,
  error: { message?: string } | null,
): ProfileState {
  if (error) {
    return { status: 'error', message: error.message?.trim() || 'Could not load your profile.' }
  }
  const row = Array.isArray(data) ? data[0] : data
  if (row === null || row === undefined) return { status: 'no-profile' }
  const profile = toStaffProfile(row)
  // A row we cannot understand must not grant access to a role view.
  return profile ? { status: 'ready', profile } : { status: 'no-profile' }
}

/** Header text, e.g. "Signed in as Ali (Technician, Shah Alam)". */
export function formatSignedInAs(profile: StaffProfile): string {
  const branch = profile.branchName ?? BRANCH_FALLBACK_LABEL
  return `Signed in as ${profile.name} (${ROLE_LABELS[profile.role]}, ${branch})`
}
