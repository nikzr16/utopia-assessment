/**
 * The staff-access server function's logic (0006): the only code that holds
 * the Supabase secret key. Every action first calls a staff RPC as the
 * signed-in person (so the database checks every rule and permission and
 * writes the history), then does the Auth step with the secret key.
 *
 * Plain TypeScript with no Deno or npm imports, so Vitest can test it with
 * fake clients; `index.ts` wires the real ones. Answers carry only fixed
 * sentences or the database's rule messages: never a key, a password, or the
 * raw text of an Auth or database error (those go to the function's log).
 */

export const STAFF_ACCESS_ACTIONS = [
  'create',
  'update',
  'deactivate',
  'reactivate',
  'resend_invite',
  'reset_password',
  'retry_block',
  'retry_unblock',
  'retry_email',
] as const
export type StaffAccessAction = (typeof STAFF_ACCESS_ACTIONS)[number]

/** The step a "Saved, but…" answer offers to run again. */
export type RetryAction = 'resend_invite' | 'reset_password' | 'retry_block' | 'retry_unblock' | 'retry_email'

/** The answer when the function's `APP_URL` secret is missing or not an address. */
export const APP_URL_MISSING =
  'The app address is not set up yet, so no email can be sent. Ask the person who runs the system.'

export interface StaffFields {
  name: string
  email: string
  phone: string
  role: string
  branchId: string
  /** Admins only; leave out to keep the current cover. */
  additionalBranchIds?: string[] | null
}

export interface StaffAccessRequest {
  action: StaffAccessAction
  staffId?: string
  staff?: StaffFields
  /** `<live app>/auth/confirm`: where the email link opens (from `APP_URL`, never the browser). */
  redirectTo: string
}

export type StaffAccessResponse =
  | { ok: true; staffId: string; message: string; warning?: string; retry?: RetryAction }
  | { ok: false; error: string }

/** What the staff RPCs return (`staff_access_target`). */
export interface StaffTarget {
  staff_id: string
  name: string
  email: string
  previous_email: string | null
  auth_user_id: string | null
  active: boolean
  sign_in_state: 'none' | 'invite_pending' | 'ready'
}

/** The database as the signed-in caller (their token, RLS and rules apply). */
export interface CallerDb {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>
}

/** Auth steps with the secret key. Each resolves to Auth's own error text, or null. */
export interface AuthAdmin {
  invite(email: string, redirectTo: string): Promise<{ userId: string } | { error: string }>
  sendPasswordReset(email: string, redirectTo: string): Promise<string | null>
  /** Change a sign-in's email, confirmed (no email is sent). */
  setEmail(userId: string, email: string): Promise<string | null>
  setBlocked(userId: string, blocked: boolean): Promise<string | null>
  /** Remove a sign-in whose invite was never used (to send a fresh one). */
  deleteUser(userId: string): Promise<string | null>
  /** `link_invited_staff` with the secret key. */
  linkInvited(staffId: string, userId: string): Promise<string | null>
}

export interface StaffAccessDeps {
  db: CallerDb
  auth: AuthAdmin
  /** Where raw error details go (the function's log); never the answer. */
  log?: (message: string) => void
}

class RuleError extends Error {}

const GENERIC_ERROR = 'Something went wrong. Try again.'

/** A database error → a sentence for the screen; only rule messages pass as they are. */
function dbProblem(error: { message?: string; code?: string }, log: (m: string) => void): string {
  const message = error.message?.trim() ?? ''
  if (error.code === 'P0001' && message) return message
  log(`database ${error.code ?? '?'}: ${message}`)
  if (error.code === '23505') return 'This phone number or email is already used by someone else. Reload and try again.'
  if (error.code === '42501') return 'You do not have permission to do that.'
  if (error.code === 'PGRST301' || /jwt/i.test(message)) return 'Your sign-in has expired. Sign in again.'
  return GENERIC_ERROR
}

/** An Auth error → a fixed sentence (the raw text goes to the log). */
export function authProblem(raw: string, log: (m: string) => void = () => undefined): string {
  log(`auth: ${raw}`)
  if (/rate limit|too many/i.test(raw)) return 'Too many emails were sent just now. Wait a few minutes, then try again.'
  if (/already (been )?registered|already exists|email_exists|already linked/i.test(raw)) {
    return 'This email cannot be used for a new sign-in. Check it, or ask an Admin.'
  }
  if (/smtp|send|mail/i.test(raw)) return 'The email could not be sent. Check the email service settings, then try again.'
  return 'The sign-in service did not accept this. Try again.'
}

async function call(deps: StaffAccessDeps, fn: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await deps.db.rpc(fn, args)
  if (error) throw new RuleError(dbProblem(error, deps.log ?? (() => undefined)))
  return data
}

const target = async (deps: StaffAccessDeps, fn: string, args: Record<string, unknown>) =>
  (await call(deps, fn, args)) as StaffTarget

/**
 * Request body → a checked request, or the reason it is not one. Email links
 * always open `redirectTo` (the live app, 0010); an address the browser sends
 * is ignored.
 */
export function parseStaffAccessRequest(body: unknown, redirectTo: string): StaffAccessRequest | string {
  if (!body || typeof body !== 'object') return 'Send a JSON body'
  const b = body as Record<string, unknown>
  if (!(STAFF_ACCESS_ACTIONS as readonly unknown[]).includes(b.action)) return 'Unknown staff action'
  const action = b.action as StaffAccessAction
  if (action !== 'create' && (typeof b.staffId !== 'string' || b.staffId === '')) return 'Choose a staff member'
  if (action === 'create' || action === 'update') {
    const s = b.staff as Record<string, unknown> | undefined
    const text = (k: string) => typeof s?.[k] === 'string'
    if (!s || !text('name') || !text('email') || !text('phone') || !text('role') || !text('branchId')) {
      return 'Fill in the staff details'
    }
    const cover = s.additionalBranchIds
    if (cover !== undefined && cover !== null && !(Array.isArray(cover) && cover.every((c) => typeof c === 'string'))) {
      return 'Choose branches to cover'
    }
  }
  return {
    action,
    staffId: b.staffId as string | undefined,
    staff: b.staff as StaffFields | undefined,
    redirectTo,
  }
}

/**
 * The `/auth/confirm` page of the app address in the `APP_URL` secret
 * (0010: every invite and reset link opens the live app, wherever it was
 * made), or null when the setting is missing or not a plain http(s) address.
 */
export function confirmAddressFor(appUrl: string | null | undefined): string | null {
  if (!appUrl?.trim()) return null
  try {
    const u = new URL(appUrl.trim())
    const plain = !u.username && !u.password && !u.search && !u.hash && /^\/*$/.test(u.pathname)
    return (u.protocol === 'https:' || u.protocol === 'http:') && plain ? `${u.origin}/auth/confirm` : null
  } catch {
    return null
  }
}

function staffArgs(s: StaffFields) {
  return {
    p_name: s.name,
    p_email: s.email,
    p_phone: s.phone,
    p_role: s.role,
    p_branch_id: s.branchId,
  }
}

/**
 * Send the invite to the profile's email. An invite that was never used is
 * started over: its sign-in is removed (it has no password) and a fresh one is
 * created and linked, so the link always goes to the current email. Returns a
 * sentence for the screen, or null.
 */
async function sendInvite(deps: StaffAccessDeps, t: StaffTarget, redirectTo: string): Promise<string | null> {
  const log = deps.log
  if (t.auth_user_id && t.sign_in_state === 'invite_pending') {
    const error = await deps.auth.deleteUser(t.auth_user_id)
    if (error) return authProblem(error, log)
  }
  const invited = await deps.auth.invite(t.email, redirectTo)
  if ('error' in invited) return authProblem(invited.error, log)
  const linkError = await deps.auth.linkInvited(t.staff_id, invited.userId)
  if (linkError) return authProblem(linkError, log)
  await call(deps, 'staff_access_event', { p_staff_id: t.staff_id, p_action: 'invite_sent' }).catch(() => null)
  return null
}

async function sendReset(deps: StaffAccessDeps, t: StaffTarget, redirectTo: string): Promise<string | null> {
  const error = await deps.auth.sendPasswordReset(t.email, redirectTo)
  if (error) return authProblem(error, deps.log)
  await call(deps, 'staff_access_event', { p_staff_id: t.staff_id, p_action: 'password_reset' }).catch(() => null)
  return null
}

async function setBlocked(deps: StaffAccessDeps, t: StaffTarget, blocked: boolean): Promise<string | null> {
  if (!t.auth_user_id) return null
  const error = await deps.auth.setBlocked(t.auth_user_id, blocked)
  return error ? authProblem(error, deps.log) : null
}

/** The password email that fits the person's sign-in state. */
async function sendPasswordEmail(deps: StaffAccessDeps, t: StaffTarget, redirectTo: string) {
  if (t.sign_in_state === 'ready') return { error: await sendReset(deps, t, redirectTo), retry: 'reset_password' as const }
  return { error: await sendInvite(deps, t, redirectTo), retry: 'resend_invite' as const }
}

const done = (t: StaffTarget, message: string): StaffAccessResponse => ({ ok: true, staffId: t.staff_id, message })
const partly = (t: StaffTarget, message: string, warning: string, retry: RetryAction): StaffAccessResponse => ({
  ok: true,
  staffId: t.staff_id,
  message,
  warning,
  retry,
})

export async function handleStaffAccess(req: StaffAccessRequest, deps: StaffAccessDeps): Promise<StaffAccessResponse> {
  try {
    return await run(req, deps)
  } catch (e) {
    if (!(e instanceof RuleError)) deps.log?.(`unexpected: ${(e as Error)?.message ?? String(e)}`)
    return { ok: false, error: e instanceof RuleError ? e.message : GENERIC_ERROR }
  }
}

async function run(req: StaffAccessRequest, deps: StaffAccessDeps): Promise<StaffAccessResponse> {
  const id = req.staffId ?? ''
  const check = (action: string) => target(deps, 'staff_access_check', { p_staff_id: id, p_action: action })

  switch (req.action) {
    case 'create': {
      const s = req.staff!
      const t = await target(deps, 'create_staff', {
        ...staffArgs(s),
        p_additional_branch_ids: s.additionalBranchIds ?? [],
      })
      const error = await sendInvite(deps, t, req.redirectTo)
      return error
        ? partly(t, `${t.name} is added.`, `The invite email was not sent: ${error}`, 'resend_invite')
        : done(t, `${t.name} is added. An invite was sent to ${t.email}.`)
    }

    case 'update': {
      const s = req.staff!
      const t = await target(deps, 'update_staff', {
        p_staff_id: id,
        ...staffArgs(s),
        p_additional_branch_ids: s.additionalBranchIds ?? null,
      })
      if (!t.previous_email || t.previous_email === t.email || !t.auth_user_id) return done(t, 'Saved.')
      return syncEmail(deps, t, req.redirectTo, 'Saved.')
    }

    case 'retry_email':
      return syncEmail(deps, await check('email_sync'), req.redirectTo, 'Sign-in email updated.')

    case 'deactivate': {
      const t = await target(deps, 'set_staff_active', { p_staff_id: id, p_active: false })
      const error = await setBlocked(deps, t, true)
      return error
        ? partly(t, `${t.name} is deactivated and can see no data.`, `Their sign-in is not blocked yet: ${error}`, 'retry_block')
        : done(t, `${t.name} is deactivated, signed out, and cannot sign in.`)
    }

    case 'retry_block': {
      const t = await check('block')
      const error = await setBlocked(deps, t, true)
      if (error) throw new RuleError(`Their sign-in is still not blocked: ${error}`)
      return done(t, `${t.name} can no longer sign in.`)
    }

    case 'reactivate': {
      const t = await target(deps, 'set_staff_active', { p_staff_id: id, p_active: true })
      const error = await setBlocked(deps, t, false)
      if (error) return partly(t, `${t.name} is active again.`, `Their sign-in is still blocked: ${error}`, 'retry_unblock')
      const mail = await sendPasswordEmail(deps, t, req.redirectTo)
      return mail.error
        ? partly(t, `${t.name} is active again.`, `The password email was not sent: ${mail.error}`, mail.retry)
        : done(t, `${t.name} is active again. A password email was sent to ${t.email}.`)
    }

    case 'retry_unblock': {
      const t = await check('unblock')
      const error = await setBlocked(deps, t, false)
      if (error) throw new RuleError(`Their sign-in is still blocked: ${error}`)
      const mail = await sendPasswordEmail(deps, t, req.redirectTo)
      return mail.error
        ? partly(t, `${t.name} can sign in again.`, `The password email was not sent: ${mail.error}`, mail.retry)
        : done(t, `${t.name} can sign in again. A password email was sent to ${t.email}.`)
    }

    case 'resend_invite': {
      const t = await check('invite')
      const error = await sendInvite(deps, t, req.redirectTo)
      if (error) throw new RuleError(`The invite email was not sent: ${error}`)
      return done(t, `Invite sent to ${t.email}.`)
    }

    case 'reset_password': {
      const t = await check('password_reset')
      const error = await sendReset(deps, t, req.redirectTo)
      if (error) throw new RuleError(`The password reset email was not sent: ${error}`)
      return done(t, `Password reset email sent to ${t.email}.`)
    }
  }
}

/**
 * Make the sign-in match the profile's email. Someone who set a password
 * keeps their sign-in with the new email; an invite never used is sent again
 * to the new email (a fresh sign-in); an inactive person's unused invite is
 * just removed (reactivating sends a new one).
 */
async function syncEmail(deps: StaffAccessDeps, t: StaffTarget, redirectTo: string, saved: string) {
  if (!t.auth_user_id) return done(t, saved)
  if (t.sign_in_state === 'invite_pending') {
    if (!t.active) {
      const error = await deps.auth.deleteUser(t.auth_user_id)
      return error ? partly(t, saved, `The old invite was not removed: ${authProblem(error, deps.log)}`, 'retry_email') : done(t, saved)
    }
    const inviteError = await sendInvite(deps, t, redirectTo)
    if (inviteError) return partly(t, saved, `The invite to ${t.email} was not sent: ${inviteError}`, 'resend_invite')
    return done(t, `${saved} A new invite was sent to ${t.email}.`)
  }
  const error = await deps.auth.setEmail(t.auth_user_id, t.email)
  if (error) return partly(t, saved, `The sign-in email was not changed: ${authProblem(error, deps.log)}`, 'retry_email')
  return done(t, `${saved} ${t.name} now signs in with ${t.email}.`)
}
