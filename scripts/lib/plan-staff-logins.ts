/**
 * Pure planning and reporting logic for scripts/create-staff-logins.ts.
 * No I/O and no secrets are handled here, so it is unit-testable.
 * Only erasable TypeScript syntax: Node runs the script by stripping types.
 */

export const MIN_PASSWORD_LENGTH = 8

export interface ScriptEnv {
  url: string
  secretKey: string
  password: string
}

export type EnvResult = { ok: true; env: ScriptEnv } | { ok: false; problems: string[] }

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Validates the environment the script needs. Problems name the variable only;
 * they never include a value, so they are safe to print.
 */
export function readScriptEnv(source: Record<string, string | undefined>): EnvResult {
  const url = source.VITE_SUPABASE_URL?.trim() ?? ''
  const secretKey = source.SUPABASE_SECRET_KEY?.trim() ?? ''
  const password = source.STAFF_DEMO_PASSWORD ?? ''
  const problems: string[] = []

  if (!url) problems.push('VITE_SUPABASE_URL is missing.')
  else if (url.includes('your-project-ref') || !isHttpUrl(url))
    problems.push('VITE_SUPABASE_URL is not a valid http(s) URL.')

  if (!secretKey) problems.push('SUPABASE_SECRET_KEY is missing.')
  else if (secretKey.startsWith('sb_publishable_') || secretKey.includes('your-secret-key'))
    problems.push('SUPABASE_SECRET_KEY must be the project secret key, not a publishable/anon key.')

  if (!password) problems.push('STAFF_DEMO_PASSWORD is missing.')
  else if (password.length < MIN_PASSWORD_LENGTH)
    problems.push(`STAFF_DEMO_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`)

  if (problems.length > 0) return { ok: false, problems }
  return { ok: true, env: { url, secretKey, password } }
}

export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase()
}

export interface ExistingUser {
  id: string
  email?: string | null
}

export type LoginAction = 'create' | 'reset-password' | 'keep'

export interface PlannedLogin {
  email: string
  action: LoginAction
  /** Auth user id when the account already exists. */
  userId: string | null
}

export interface LoginPlan {
  logins: PlannedLogin[]
  /** Staff rows ignored because their email was blank. */
  skippedBlank: number
}

/**
 * Decides what to do for each active staff email: create a missing account,
 * optionally reset the password of an existing one, or leave it alone.
 * Emails are matched case-insensitively and de-duplicated.
 */
export function planStaffLogins(
  staffEmails: ReadonlyArray<string | null | undefined>,
  existingUsers: readonly ExistingUser[],
  options: { resetPasswords: boolean },
): LoginPlan {
  const byEmail = new Map<string, string>()
  for (const user of existingUsers) {
    const email = normalizeEmail(user.email)
    if (email) byEmail.set(email, user.id)
  }

  const seen = new Set<string>()
  const logins: PlannedLogin[] = []
  let skippedBlank = 0

  for (const raw of staffEmails) {
    const email = normalizeEmail(raw)
    if (!email) {
      skippedBlank += 1
      continue
    }
    if (seen.has(email)) continue
    seen.add(email)

    const userId = byEmail.get(email) ?? null
    const action: LoginAction =
      userId === null ? 'create' : options.resetPasswords ? 'reset-password' : 'keep'
    logins.push({ email, action, userId })
  }

  return { logins, skippedBlank }
}

export type LoginOutcome = 'created' | 'existing' | 'password reset' | 'failed'

export interface ReportRow {
  email: string
  outcome: LoginOutcome
  linked: boolean
  /** Non-secret failure detail when outcome is 'failed'. */
  detail?: string
}

/** Marks which planned logins are linked, given the staff rows read after linking. */
export function buildReportRows(
  outcomes: ReadonlyArray<{ email: string; outcome: LoginOutcome; detail?: string }>,
  staffAfterLink: ReadonlyArray<{ email: string | null; auth_user_id: string | null }>,
): ReportRow[] {
  const linkedEmails = new Set<string>()
  for (const row of staffAfterLink) {
    if (row.auth_user_id) linkedEmails.add(normalizeEmail(row.email))
  }
  return outcomes.map((o) => ({
    email: o.email,
    outcome: o.outcome,
    linked: linkedEmails.has(o.email),
    ...(o.detail ? { detail: o.detail } : {}),
  }))
}

/** True when every row succeeded and is linked (the script's exit-0 condition). */
export function isReportClean(rows: readonly ReportRow[]): boolean {
  return rows.every((r) => r.outcome !== 'failed' && r.linked)
}

/** Fixed-width text table: email, account outcome, linked yes/no. */
export function formatReportTable(rows: readonly ReportRow[]): string {
  const header = ['Email', 'Account', 'Linked']
  const body = rows.map((r) => [
    r.email,
    r.detail ? `${r.outcome}: ${r.detail}` : r.outcome,
    r.linked ? 'yes' : 'no',
  ])
  const all = [header, ...body]
  const widths = header.map((_, col) => Math.max(...all.map((row) => row[col].length)))
  const line = (row: string[]) =>
    row
      .map((cell, i) => cell.padEnd(widths[i]))
      .join('  ')
      .trimEnd()
  const rule = widths.map((w) => '-'.repeat(w)).join('  ')
  return [line(header), rule, ...body.map(line)].join('\n')
}
