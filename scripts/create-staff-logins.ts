/**
 * Creates a confirmed Supabase Auth account for every active staff member.
 *
 *   npm run auth:create-staff-logins
 *   npm run auth:create-staff-logins -- --reset-passwords
 *
 * Reads VITE_SUPABASE_URL, SUPABASE_SECRET_KEY and STAFF_DEMO_PASSWORD from the
 * environment (.env.local via `node --env-file`). The secret key bypasses row
 * level security: it is used here only, is never printed, and must never be
 * exposed to the browser. Safe to re-run: existing accounts are left alone
 * unless --reset-passwords is given.
 *
 * Only erasable TypeScript syntax is used so Node can run this file directly.
 */
import { createClient } from '@supabase/supabase-js'
import {
  buildReportRows,
  formatReportTable,
  isReportClean,
  planStaffLogins,
  readScriptEnv,
  type ExistingUser,
  type LoginOutcome,
} from './lib/plan-staff-logins.ts'

const PAGE_SIZE = 1000

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

const envResult = readScriptEnv(process.env)
if (!envResult.ok) {
  fail(
    [
      'Cannot create staff logins:',
      ...envResult.problems.map((p) => `  - ${p}`),
      'Set them in .env.local (see .env.example) and run: npm run auth:create-staff-logins',
    ].join('\n'),
  )
}
const { url, secretKey, password } = envResult.env
const resetPasswords = process.argv.slice(2).includes('--reset-passwords')

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function listAllAuthUsers(): Promise<ExistingUser[]> {
  const users: ExistingUser[] = []
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PAGE_SIZE })
    if (error) throw new Error(`Could not list auth users: ${error.message}`)
    users.push(...data.users.map((u) => ({ id: u.id, email: u.email })))
    if (data.users.length < PAGE_SIZE) return users
  }
}

async function main(): Promise<void> {
  const { data: staff, error: staffError } = await admin
    .from('staff')
    .select('email')
    .eq('active', true)
    .order('email')
  if (staffError) throw new Error(`Could not read staff: ${staffError.message}`)

  const existing = await listAllAuthUsers()
  const plan = planStaffLogins(
    (staff ?? []).map((s: { email: string | null }) => s.email),
    existing,
    { resetPasswords },
  )
  if (plan.skippedBlank > 0) {
    console.warn(`Skipped ${plan.skippedBlank} active staff row(s) with no email.`)
  }
  if (plan.logins.length === 0) fail('No active staff emails found. Apply supabase/seed.sql first.')

  const outcomes: Array<{ email: string; outcome: LoginOutcome; detail?: string }> = []
  for (const login of plan.logins) {
    if (login.action === 'create') {
      const { error } = await admin.auth.admin.createUser({
        email: login.email,
        password,
        email_confirm: true,
      })
      outcomes.push(
        error
          ? { email: login.email, outcome: 'failed', detail: error.message }
          : { email: login.email, outcome: 'created' },
      )
    } else if (login.action === 'reset-password' && login.userId) {
      const { error } = await admin.auth.admin.updateUserById(login.userId, { password })
      outcomes.push(
        error
          ? { email: login.email, outcome: 'failed', detail: error.message }
          : { email: login.email, outcome: 'password reset' },
      )
    } else {
      outcomes.push({ email: login.email, outcome: 'existing' })
    }
  }

  const { error: linkError } = await admin.rpc('link_staff_accounts')
  if (linkError) throw new Error(`link_staff_accounts() failed: ${linkError.message}`)

  const { data: after, error: afterError } = await admin
    .from('staff')
    .select('email, auth_user_id')
    .eq('active', true)
  if (afterError) throw new Error(`Could not re-read staff: ${afterError.message}`)

  const rows = buildReportRows(
    outcomes,
    (after ?? []) as Array<{ email: string | null; auth_user_id: string | null }>,
  )
  console.log(formatReportTable(rows))

  if (!isReportClean(rows)) {
    fail('\nSome accounts failed or are not linked to a staff profile. See the table above.')
  }
  console.log(
    `\nDone. ${rows.length} staff account(s) ready.` +
      (resetPasswords ? ' Passwords were reset to STAFF_DEMO_PASSWORD.' : ''),
  )
}

main().catch((err: unknown) => {
  fail(err instanceof Error ? err.message : 'Unexpected error.')
})
