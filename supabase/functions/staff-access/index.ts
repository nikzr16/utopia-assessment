// staff-access (0006): creates and changes staff sign-ins. Deployed to the
// hosted Supabase project (see docs/0006-staff-management-workflow.md); runs on
// Deno. The secret key comes from the function's own environment and never
// leaves it. The logic lives in handler.ts (tested with Vitest).
//
// Deployed with the built-in JWT check off (--no-verify-jwt) because the
// project uses the new API keys; the caller's token is checked here instead,
// and every action runs its staff RPC as the caller first.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { APP_URL_MISSING, confirmAddressFor, handleStaffAccess, parseStaffAccessRequest, type AuthAdmin } from './handler.ts'

/** A key from the new JSON key lists, else the legacy variable. */
function key(listVar: string, legacyVar: string): string {
  const list = Deno.env.get(listVar)
  if (list) {
    try {
      const parsed = JSON.parse(list) as Record<string, string>
      const first = parsed.default ?? Object.values(parsed)[0]
      if (first) return first
    } catch {
      // fall through to the legacy variable
    }
  }
  return Deno.env.get(legacyVar) ?? ''
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const PUBLIC_KEY = key('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY')
const SECRET_KEY = key('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY')
// Every email link opens the live app's /auth/confirm (0010): the APP_URL
// secret, e.g. https://sejuk-sejuk-utopia.vercel.app. The browser's address is ignored.
const REDIRECT_TO = confirmAddressFor(Deno.env.get('APP_URL'))

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const NO_SESSION = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ ok: false, error: 'Use POST' }, 405)
  if (!SUPABASE_URL || !PUBLIC_KEY || !SECRET_KEY) {
    return json({ ok: false, error: 'The staff-access function is not set up (missing keys).' }, 500)
  }
  if (!REDIRECT_TO) return json({ ok: false, error: APP_URL_MISSING }, 500)

  const authorization = req.headers.get('Authorization') ?? ''
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
  if (!token) return json({ ok: false, error: 'You must be signed in' }, 401)

  const caller = createClient(SUPABASE_URL, PUBLIC_KEY, {
    auth: NO_SESSION,
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data: who, error: whoError } = await caller.auth.getUser(token)
  if (whoError || !who.user) return json({ ok: false, error: 'Your sign-in has expired. Sign in again.' }, 401)

  const parsed = parseStaffAccessRequest(await req.json().catch(() => null), REDIRECT_TO)
  if (typeof parsed === 'string') return json({ ok: false, error: parsed }, 400)

  const admin = createClient(SUPABASE_URL, SECRET_KEY, { auth: NO_SESSION })
  const auth: AuthAdmin = {
    async invite(email, redirectTo) {
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo })
      return error || !data.user ? { error: error?.message ?? 'no sign-in was created' } : { userId: data.user.id }
    },
    async sendPasswordReset(email, redirectTo) {
      const { error } = await admin.auth.resetPasswordForEmail(email, { redirectTo })
      return error?.message ?? null
    },
    async setEmail(userId, email) {
      const { error } = await admin.auth.admin.updateUserById(userId, { email, email_confirm: true })
      return error?.message ?? null
    },
    async setBlocked(userId, blocked) {
      // About 100 years; 'none' lifts it.
      const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: blocked ? '876000h' : 'none' })
      return error?.message ?? null
    },
    async deleteUser(userId) {
      const { error } = await admin.auth.admin.deleteUser(userId)
      return error?.message ?? null
    },
    async linkInvited(staffId, userId) {
      const { error } = await admin.rpc('link_invited_staff', { p_staff_id: staffId, p_auth_user_id: userId })
      return error?.message ?? null
    },
  }

  // Raw Auth / database errors go to the function's log, never to the answer.
  return json(await handleStaffAccess(parsed, { db: caller, auth, log: (m) => console.error(`staff-access: ${m}`) }))
})
