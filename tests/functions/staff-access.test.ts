import { describe, expect, it } from 'vitest'
import {
  authProblem,
  handleStaffAccess,
  isConfirmAddress,
  parseStaffAccessRequest,
  type AuthAdmin,
  type StaffAccessRequest,
  type StaffTarget,
} from '../../supabase/functions/staff-access/handler'

// The staff-access server function (0006): database step as the caller first,
// then the Auth step with the secret key; partial failures say what to retry;
// answers never carry raw Auth or database text.

const REDIRECT = 'http://localhost:5173/auth/confirm'
const STAFF = { name: 'Ravi', email: 'ravi@example.com', phone: '0127771234', role: 'technician', branchId: 'b1' }

const target = (over: Partial<StaffTarget> = {}): StaffTarget => ({
  staff_id: 's1',
  name: 'Ravi',
  email: 'ravi@example.com',
  previous_email: null,
  auth_user_id: null,
  active: true,
  sign_in_state: 'none',
  ...over,
})

type Call = [string, ...unknown[]]

/** Fake database (as the caller) and Auth admin; every call is recorded in order. */
function fakes(
  opts: {
    rpc?: Record<string, StaffTarget | { error: string; code?: string }>
    auth?: Partial<Record<keyof AuthAdmin, string>>
    userId?: string
  } = {},
) {
  const calls: Call[] = []
  const logged: string[] = []
  const db = {
    rpc(fn: string, args: Record<string, unknown>) {
      calls.push([fn, args])
      const r = opts.rpc?.[fn]
      if (r && 'error' in r) return Promise.resolve({ data: null, error: { message: r.error, code: r.code ?? 'P0001' } })
      return Promise.resolve({ data: r ?? null, error: null })
    },
  }
  const fail = (k: keyof AuthAdmin) => opts.auth?.[k] ?? null
  const auth: AuthAdmin = {
    async invite(email, redirectTo) {
      calls.push(['auth.invite', email, redirectTo])
      return fail('invite') ? { error: fail('invite')! } : { userId: opts.userId ?? 'u1' }
    },
    async sendPasswordReset(email, redirectTo) {
      calls.push(['auth.reset', email, redirectTo])
      return fail('sendPasswordReset')
    },
    async setEmail(userId, email) {
      calls.push(['auth.setEmail', userId, email])
      return fail('setEmail')
    },
    async setBlocked(userId, blocked) {
      calls.push(['auth.setBlocked', userId, blocked])
      return fail('setBlocked')
    },
    async deleteUser(userId) {
      calls.push(['auth.delete', userId])
      return fail('deleteUser')
    },
    async linkInvited(staffId, userId) {
      calls.push(['auth.link', staffId, userId])
      return fail('linkInvited')
    },
  }
  return {
    deps: { db, auth, log: (m: string) => logged.push(m) },
    calls,
    logged,
    names: () => calls.map((c) => c[0]),
  }
}

const req = (r: Partial<StaffAccessRequest>): StaffAccessRequest => ({ action: 'create', redirectTo: REDIRECT, ...r })

describe('parseStaffAccessRequest', () => {
  it('accepts a well-formed request and rejects the rest with a reason', () => {
    expect(parseStaffAccessRequest({ action: 'create', staff: STAFF, redirectTo: REDIRECT })).toMatchObject({ action: 'create' })
    expect(parseStaffAccessRequest({ action: 'deactivate', staffId: 's1', redirectTo: REDIRECT })).toMatchObject({ staffId: 's1' })
    expect(parseStaffAccessRequest(null)).toBe('Send a JSON body')
    expect(parseStaffAccessRequest({ action: 'delete', staffId: 's1', redirectTo: REDIRECT })).toBe('Unknown staff action')
    expect(parseStaffAccessRequest({ action: 'deactivate', redirectTo: REDIRECT })).toBe('Choose a staff member')
    expect(parseStaffAccessRequest({ action: 'create', staff: { ...STAFF, phone: 1 }, redirectTo: REDIRECT })).toBe('Fill in the staff details')
    expect(
      parseStaffAccessRequest({ action: 'update', staffId: 's1', staff: { ...STAFF, additionalBranchIds: [1] }, redirectTo: REDIRECT }),
    ).toBe('Choose branches to cover')
    expect(parseStaffAccessRequest({ action: 'create', staff: STAFF, redirectTo: 'http://evil.example/x' })).toBe('Unknown app address')
    expect(parseStaffAccessRequest({ action: 'create', staff: STAFF, redirectTo: 'https://evil.example/auth/confirm' })).toBe(
      'Unknown app address',
    )
  })

  it("isConfirmAddress: the /auth/confirm page of the app's own addresses only, no query", () => {
    expect(isConfirmAddress('http://localhost:5174/auth/confirm')).toBe(true)
    expect(isConfirmAddress('http://[::1]:5174/auth/confirm')).toBe(false)
    expect(isConfirmAddress('https://app.example.com/auth/confirm')).toBe(false)
    expect(isConfirmAddress('https://app.example.com/auth/confirm', ['https://app.example.com'])).toBe(true)
    expect(isConfirmAddress('javascript:alert(1)//auth/confirm')).toBe(false)
    expect(isConfirmAddress('http://localhost:5173/auth/confirm?next=x')).toBe(false)
    expect(isConfirmAddress('not a url')).toBe(false)
  })
})

describe('create', () => {
  it('saves as the caller, invites, links the sign-in, then records the invite', async () => {
    const f = fakes({ rpc: { create_staff: target() } })
    const res = await handleStaffAccess(req({ staff: { ...STAFF, additionalBranchIds: ['b2'] } }), f.deps)
    expect(res).toEqual({ ok: true, staffId: 's1', message: 'Ravi is added. An invite was sent to ravi@example.com.' })
    expect(f.names()).toEqual(['create_staff', 'auth.invite', 'auth.link', 'staff_access_event'])
    expect(f.calls[0][1]).toEqual({
      p_name: 'Ravi', p_email: 'ravi@example.com', p_phone: '0127771234', p_role: 'technician', p_branch_id: 'b1',
      p_additional_branch_ids: ['b2'],
    })
    expect(f.calls[1]).toEqual(['auth.invite', 'ravi@example.com', REDIRECT])
    expect(f.calls[3][1]).toEqual({ p_staff_id: 's1', p_action: 'invite_sent' })
  })

  it('stops at the database rule and never touches Auth', async () => {
    const f = fakes({ rpc: { create_staff: { error: 'Penang has no Manager. Add a Manager to this branch first.' } } })
    expect(await handleStaffAccess(req({ staff: STAFF }), f.deps)).toEqual({
      ok: false,
      error: 'Penang has no Manager. Add a Manager to this branch first.',
    })
    expect(f.names()).toEqual(['create_staff'])
  })

  it('says "added, but the invite was not sent" and offers to send it again', async () => {
    const f = fakes({ rpc: { create_staff: target() }, auth: { invite: 'Error sending invite email' } })
    expect(await handleStaffAccess(req({ staff: STAFF }), f.deps)).toEqual({
      ok: true,
      staffId: 's1',
      message: 'Ravi is added.',
      warning: 'The invite email was not sent: The email could not be sent. Check the email service settings, then try again.',
      retry: 'resend_invite',
    })
    expect(f.names()).not.toContain('staff_access_event')
    expect(f.logged).toEqual(['auth: Error sending invite email'])
  })

  it('reports a failed link of the fresh sign-in, and deletes nothing', async () => {
    const f = fakes({ rpc: { create_staff: target() }, auth: { linkInvited: 'This staff member is already linked to another sign-in' } })
    expect(await handleStaffAccess(req({ staff: STAFF }), f.deps)).toMatchObject({ ok: true, retry: 'resend_invite' })
    expect(f.names()).not.toContain('auth.delete')
  })
})

describe('update', () => {
  it('saves without Auth when the email did not change', async () => {
    const f = fakes({ rpc: { update_staff: target({ previous_email: 'ravi@example.com', auth_user_id: 'u1', sign_in_state: 'ready' }) } })
    expect(await handleStaffAccess(req({ action: 'update', staffId: 's1', staff: STAFF }), f.deps)).toMatchObject({ ok: true, message: 'Saved.' })
    expect(f.names()).toEqual(['update_staff'])
    expect(f.calls[0][1]).toMatchObject({ p_staff_id: 's1', p_additional_branch_ids: null })
  })

  it('changes the sign-in email of someone with a password', async () => {
    const f = fakes({ rpc: { update_staff: target({ previous_email: 'old@example.com', auth_user_id: 'u1', sign_in_state: 'ready' }) } })
    expect(await handleStaffAccess(req({ action: 'update', staffId: 's1', staff: STAFF }), f.deps)).toMatchObject({
      message: 'Saved. Ravi now signs in with ravi@example.com.',
    })
    expect(f.calls[1]).toEqual(['auth.setEmail', 'u1', 'ravi@example.com'])
  })

  it('starts an unused invite over at the new address (never confirms it)', async () => {
    const pending = fakes({
      rpc: { update_staff: target({ previous_email: 'old@example.com', auth_user_id: 'u1', sign_in_state: 'invite_pending' }) },
      userId: 'u2',
    })
    expect(await handleStaffAccess(req({ action: 'update', staffId: 's1', staff: STAFF }), pending.deps)).toMatchObject({
      message: 'Saved. A new invite was sent to ravi@example.com.',
    })
    expect(pending.calls.slice(1)).toEqual([
      ['auth.delete', 'u1'],
      ['auth.invite', 'ravi@example.com', REDIRECT],
      ['auth.link', 's1', 'u2'],
      ['staff_access_event', { p_staff_id: 's1', p_action: 'invite_sent' }],
    ])

    const inactive = fakes({
      rpc: { update_staff: target({ previous_email: 'old@example.com', auth_user_id: 'u1', sign_in_state: 'invite_pending', active: false }) },
    })
    await handleStaffAccess(req({ action: 'update', staffId: 's1', staff: STAFF }), inactive.deps)
    expect(inactive.names()).toEqual(['update_staff', 'auth.delete'])
  })

  it('offers retry_email when Auth refuses the new email', async () => {
    const f = fakes({
      rpc: { update_staff: target({ previous_email: 'old@example.com', auth_user_id: 'u1', sign_in_state: 'ready' }) },
      auth: { setEmail: 'A user with this email address has already been registered' },
    })
    expect(await handleStaffAccess(req({ action: 'update', staffId: 's1', staff: STAFF }), f.deps)).toMatchObject({
      ok: true,
      warning: 'The sign-in email was not changed: This email cannot be used for a new sign-in. Check it, or ask an Admin.',
      retry: 'retry_email',
    })
  })
})

describe('deactivate and reactivate', () => {
  it('deactivates then blocks the sign-in', async () => {
    const f = fakes({ rpc: { set_staff_active: target({ active: false, auth_user_id: 'u1' }) } })
    expect(await handleStaffAccess(req({ action: 'deactivate', staffId: 's1' }), f.deps)).toMatchObject({
      ok: true,
      message: 'Ravi is deactivated, signed out, and cannot sign in.',
    })
    expect(f.calls).toEqual([
      ['set_staff_active', { p_staff_id: 's1', p_active: false }],
      ['auth.setBlocked', 'u1', true],
    ])
  })

  it('reports a failed block with retry_block, and the retry checks first', async () => {
    const f = fakes({ rpc: { set_staff_active: target({ active: false, auth_user_id: 'u1' }) }, auth: { setBlocked: 'timeout' } })
    expect(await handleStaffAccess(req({ action: 'deactivate', staffId: 's1' }), f.deps)).toMatchObject({
      warning: 'Their sign-in is not blocked yet: The sign-in service did not accept this. Try again.',
      retry: 'retry_block',
    })
    const r = fakes({ rpc: { staff_access_check: target({ active: false, auth_user_id: 'u1' }) } })
    expect(await handleStaffAccess(req({ action: 'retry_block', staffId: 's1' }), r.deps)).toMatchObject({ ok: true })
    expect(r.calls[0]).toEqual(['staff_access_check', { p_staff_id: 's1', p_action: 'block' }])
  })

  it('reactivates, unblocks, and sends the right password email', async () => {
    const ready = fakes({ rpc: { set_staff_active: target({ auth_user_id: 'u1', sign_in_state: 'ready' }) } })
    expect(await handleStaffAccess(req({ action: 'reactivate', staffId: 's1' }), ready.deps)).toMatchObject({
      message: 'Ravi is active again. A password email was sent to ravi@example.com.',
    })
    expect(ready.names()).toEqual(['set_staff_active', 'auth.setBlocked', 'auth.reset', 'staff_access_event'])
    expect(ready.calls[1]).toEqual(['auth.setBlocked', 'u1', false])

    const never = fakes({ rpc: { set_staff_active: target() } })
    await handleStaffAccess(req({ action: 'reactivate', staffId: 's1' }), never.deps)
    expect(never.names()).toEqual(['set_staff_active', 'auth.invite', 'auth.link', 'staff_access_event'])
  })
})

describe('invite and reset', () => {
  it('resend_invite checks first, starts the unused invite over, and records it', async () => {
    const f = fakes({ rpc: { staff_access_check: target({ auth_user_id: 'u1', sign_in_state: 'invite_pending' }) }, userId: 'u2' })
    expect(await handleStaffAccess(req({ action: 'resend_invite', staffId: 's1' }), f.deps)).toMatchObject({
      message: 'Invite sent to ravi@example.com.',
    })
    expect(f.calls).toEqual([
      ['staff_access_check', { p_staff_id: 's1', p_action: 'invite' }],
      ['auth.delete', 'u1'],
      ['auth.invite', 'ravi@example.com', REDIRECT],
      ['auth.link', 's1', 'u2'],
      ['staff_access_event', { p_staff_id: 's1', p_action: 'invite_sent' }],
    ])
  })

  it('reset_password refused by the database never sends an email', async () => {
    const f = fakes({ rpc: { staff_access_check: { error: 'Ravi has not set a password yet. Send the invite again instead.' } } })
    expect(await handleStaffAccess(req({ action: 'reset_password', staffId: 's1' }), f.deps)).toEqual({
      ok: false,
      error: 'Ravi has not set a password yet. Send the invite again instead.',
    })
    expect(f.names()).toEqual(['staff_access_check'])
  })

  it('reset_password failing at the email step says so', async () => {
    const f = fakes({ rpc: { staff_access_check: target({ auth_user_id: 'u1', sign_in_state: 'ready' }) }, auth: { sendPasswordReset: 'rate limit' } })
    expect(await handleStaffAccess(req({ action: 'reset_password', staffId: 's1' }), f.deps)).toEqual({
      ok: false,
      error: 'The password reset email was not sent: Too many emails were sent just now. Wait a few minutes, then try again.',
    })
  })
})

describe('errors never leak raw text', () => {
  it('passes only rule messages (P0001) from the database; others become fixed sentences and go to the log', async () => {
    const race = fakes({
      rpc: { create_staff: { error: 'duplicate key value violates unique constraint "staff_active_phone_key"', code: '23505' } },
    })
    expect(await handleStaffAccess(req({ staff: STAFF }), race.deps)).toEqual({
      ok: false,
      error: 'This phone number or email is already used by someone else. Reload and try again.',
    })
    expect(race.logged[0]).toContain('staff_active_phone_key')

    const junk = fakes({ rpc: { staff_access_check: { error: 'invalid input syntax for type uuid: "x"', code: '22P02' } } })
    expect(await handleStaffAccess(req({ action: 'resend_invite', staffId: 'x' }), junk.deps)).toEqual({
      ok: false,
      error: 'Something went wrong. Try again.',
    })
  })

  it('maps Auth errors to fixed sentences', () => {
    expect(authProblem('Email rate limit exceeded')).toMatch(/Too many emails/)
    expect(authProblem('A user with this email address has already been registered')).toMatch(/cannot be used for a new sign-in/)
    expect(authProblem('Error sending invite email')).toMatch(/could not be sent/)
    expect(authProblem('Database error saving new user')).toBe('The sign-in service did not accept this. Try again.')
  })

  it('never puts an unexpected exception in an answer', async () => {
    const f = fakes({ rpc: { create_staff: target() } })
    const thrower = { ...f.deps, auth: { ...f.deps.auth, invite: () => Promise.reject(new Error('sb_secret_abc leaked')) } }
    expect(await handleStaffAccess(req({ staff: STAFF }), thrower)).toEqual({ ok: false, error: 'Something went wrong. Try again.' })
    expect(f.logged[0]).toContain('unexpected')
  })
})
