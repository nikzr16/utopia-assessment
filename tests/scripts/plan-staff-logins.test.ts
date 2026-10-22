import { describe, expect, it } from 'vitest'
import {
  buildReportRows,
  formatReportTable,
  isReportClean,
  normalizeEmail,
  planStaffLogins,
  readScriptEnv,
} from '../../scripts/lib/plan-staff-logins'

const GOOD_ENV = {
  VITE_SUPABASE_URL: 'https://abc.supabase.co',
  SUPABASE_SECRET_KEY: 'sb_secret_abc123',
  STAFF_DEMO_PASSWORD: 'demo-pass-1',
}

describe('readScriptEnv', () => {
  it('accepts a complete environment', () => {
    expect(readScriptEnv(GOOD_ENV)).toEqual({
      ok: true,
      env: { url: 'https://abc.supabase.co', secretKey: 'sb_secret_abc123', password: 'demo-pass-1' },
    })
  })

  it('reports every missing variable by name', () => {
    const result = readScriptEnv({})
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.problems.join(' ')).toContain('VITE_SUPABASE_URL')
      expect(result.problems.join(' ')).toContain('SUPABASE_SECRET_KEY')
      expect(result.problems.join(' ')).toContain('STAFF_DEMO_PASSWORD')
    }
  })

  it('rejects a short password and an invalid URL', () => {
    const short = readScriptEnv({ ...GOOD_ENV, STAFF_DEMO_PASSWORD: 'short' })
    expect(short.ok).toBe(false)
    const badUrl = readScriptEnv({ ...GOOD_ENV, VITE_SUPABASE_URL: 'https://your-project-ref.supabase.co' })
    expect(badUrl.ok).toBe(false)
  })

  it('rejects a publishable key in the secret key slot', () => {
    const result = readScriptEnv({ ...GOOD_ENV, SUPABASE_SECRET_KEY: 'sb_publishable_xyz' })
    expect(result.ok).toBe(false)
  })

  it('never includes secret values in problem messages', () => {
    const result = readScriptEnv({
      VITE_SUPABASE_URL: 'not a url',
      SUPABASE_SECRET_KEY: 'sb_publishable_SECRETVALUE',
      STAFF_DEMO_PASSWORD: 'tiny',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      const text = result.problems.join(' ')
      expect(text).not.toContain('SECRETVALUE')
      expect(text).not.toContain('tiny')
      expect(text).not.toContain('not a url')
    }
  })
})

describe('planStaffLogins', () => {
  const existing = [
    { id: 'u1', email: 'Ali@Example.com' },
    { id: 'u2', email: null },
  ]

  it('creates accounts that do not exist and keeps those that do', () => {
    const plan = planStaffLogins(['ali@example.com', 'john@example.com'], existing, {
      resetPasswords: false,
    })
    expect(plan.logins).toEqual([
      { email: 'ali@example.com', action: 'keep', userId: 'u1' },
      { email: 'john@example.com', action: 'create', userId: null },
    ])
  })

  it('resets passwords of existing accounts only when asked', () => {
    const plan = planStaffLogins(['ali@example.com', 'john@example.com'], existing, {
      resetPasswords: true,
    })
    expect(plan.logins.map((l) => l.action)).toEqual(['reset-password', 'create'])
    expect(plan.logins[0].userId).toBe('u1')
  })

  it('is idempotent: once every account exists nothing is created', () => {
    const all = [
      { id: 'u1', email: 'ali@example.com' },
      { id: 'u3', email: 'john@example.com' },
    ]
    const plan = planStaffLogins(['ali@example.com', 'john@example.com'], all, {
      resetPasswords: false,
    })
    expect(plan.logins.every((l) => l.action === 'keep')).toBe(true)
  })

  it('normalises case and whitespace, de-duplicates, and skips blanks', () => {
    const plan = planStaffLogins([' JOHN@example.com ', 'john@example.com', '', null, undefined], [], {
      resetPasswords: false,
    })
    expect(plan.logins).toEqual([{ email: 'john@example.com', action: 'create', userId: null }])
    expect(plan.skippedBlank).toBe(3)
  })

  it('returns an empty plan for no staff', () => {
    expect(planStaffLogins([], existing, { resetPasswords: true })).toEqual({
      logins: [],
      skippedBlank: 0,
    })
  })
})

describe('report', () => {
  const outcomes = [
    { email: 'ali@example.com', outcome: 'created' as const },
    { email: 'john@example.com', outcome: 'existing' as const },
    { email: 'bala@example.com', outcome: 'failed' as const, detail: 'Password too weak' },
  ]
  const staffAfter = [
    { email: 'Ali@example.com', auth_user_id: 'u1' },
    { email: 'john@example.com', auth_user_id: null },
    { email: 'bala@example.com', auth_user_id: null },
  ]

  it('marks linked rows from the staff table after linking', () => {
    const rows = buildReportRows(outcomes, staffAfter)
    expect(rows.map((r) => r.linked)).toEqual([true, false, false])
    expect(rows[2].detail).toBe('Password too weak')
  })

  it('is clean only when nothing failed and everything is linked', () => {
    const ok = buildReportRows(outcomes.slice(0, 1), staffAfter)
    expect(isReportClean(ok)).toBe(true)
    expect(isReportClean(buildReportRows(outcomes, staffAfter))).toBe(false)
  })

  it('formats an aligned table with yes/no', () => {
    const table = formatReportTable(buildReportRows(outcomes, staffAfter))
    const lines = table.split('\n')
    expect(lines[0]).toMatch(/^Email\s+Account\s+Linked$/)
    expect(lines).toHaveLength(5)
    expect(lines[2]).toMatch(/^ali@example\.com\s+created\s+yes$/)
    expect(lines[3]).toMatch(/^john@example\.com\s+existing\s+no$/)
    expect(lines[4]).toContain('failed: Password too weak')
  })
})

describe('normalizeEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeEmail('  A@B.Com ')).toBe('a@b.com')
    expect(normalizeEmail(null)).toBe('')
  })
})
