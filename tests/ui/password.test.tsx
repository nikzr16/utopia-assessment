// @vitest-environment jsdom
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as authApi from '../../src/features/auth/api'
import { checkNewPassword } from '../../src/features/auth/password'
import './fixtures'

// 0006: the invite / reset email link page, "Change my password", and the
// instant sign-out of a deactivated person.

const fake = vi.hoisted(() => {
  type Handler = (payload: { new: Record<string, unknown> }) => void
  const state = {
    handler: null as Handler | null,
    filter: '',
    profileActive: true,
    signOut: null as unknown as ReturnType<typeof import('vitest').vi.fn>,
  }
  return state
})

vi.mock('../../src/lib/supabase', async () => {
  const { vi: v } = await import('vitest')
  fake.signOut = v.fn(async () => ({ error: null }))
  const listeners: ((event: string, session: unknown) => void)[] = []
  const session = { user: { id: 'u-bala', email: 'bala@sejuk.example.com' } }
  const supabase = {
    auth: {
      getSession: async () => ({ data: { session } }),
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        listeners.push(cb)
        return { data: { subscription: { unsubscribe: () => undefined } } }
      },
      signOut: async () => {
        await fake.signOut()
        listeners.forEach((cb) => cb('SIGNED_OUT', null))
        return { error: null }
      },
      signInWithPassword: async () => ({ error: null }),
    },
    rpc: async (fn: string) =>
      fn === 'current_staff' && fake.profileActive
        ? { data: [{ id: 's-bala', name: 'Bala', role: 'technician', branch_name: 'Shah Alam' }], error: null }
        : { data: [], error: null },
    channel: () => {
      const ch = {
        on: (_t: string, opts: { filter: string }, cb: (payload: { new: Record<string, unknown> }) => void) => {
          fake.filter = opts.filter
          fake.handler = cb
          return ch
        },
        subscribe: () => ch,
      }
      return ch
    },
    removeChannel: async () => 'ok',
  }
  return { supabase, isSupabaseConfigured: true }
})

vi.mock('../../src/features/auth/api', async (importOriginal) => {
  const actual = await importOriginal<typeof authApi>()
  return { ...actual, verifyEmailLink: vi.fn(), setNewPassword: vi.fn(), changeOwnPassword: vi.fn() }
})

const m = vi.mocked(authApi)

beforeEach(() => {
  m.verifyEmailLink.mockReset().mockResolvedValue(null)
  m.setNewPassword.mockReset().mockResolvedValue(null)
  m.changeOwnPassword.mockReset().mockResolvedValue(null)
  fake.profileActive = true
  fake.handler = null
})

describe('checkNewPassword', () => {
  it('needs 8–72 characters, typed the same twice', () => {
    expect(checkNewPassword('short', 'short')).toBe('Use at least 8 characters.')
    expect(checkNewPassword('x'.repeat(73), 'x'.repeat(73))).toBe('Use at most 72 characters.')
    expect(checkNewPassword('long enough', 'long enougH')).toBe('The two passwords do not match.')
    expect(checkNewPassword('long enough', 'long enough')).toBeNull()
  })
})

async function renderLink(search: string) {
  const { ConfirmLinkPage } = await import('../../src/features/auth')
  render(
    <MemoryRouter initialEntries={[`/auth/confirm${search}`]}>
      <Routes>
        <Route path="/auth/confirm" element={<ConfirmLinkPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Email link page', () => {
  it('uses the link only on Continue, then saves the chosen password', async () => {
    await renderLink('?token_hash=abc123&type=invite')
    expect(screen.getByRole('heading', { name: 'Set up your sign-in' })).toBeTruthy()
    expect(m.verifyEmailLink).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(m.verifyEmailLink).toHaveBeenCalledWith('abc123', 'invite')

    await userEvent.type(await screen.findByLabelText('New password'), 'sejuk-2026')
    await userEvent.type(screen.getByLabelText('Type the new password again'), 'sejuk-2027')
    await userEvent.click(screen.getByRole('button', { name: 'Save password' }))
    expect(screen.getByRole('alert').textContent).toBe('The two passwords do not match.')
    expect(m.setNewPassword).not.toHaveBeenCalled()

    await userEvent.clear(screen.getByLabelText('Type the new password again'))
    await userEvent.type(screen.getByLabelText('Type the new password again'), 'sejuk-2026')
    await userEvent.click(screen.getByRole('button', { name: 'Save password' }))
    expect(m.setNewPassword).toHaveBeenCalledWith('sejuk-2026')
    expect(await screen.findByText('Your password is saved')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open the app' }).getAttribute('href')).toBe('/')
  })

  it('says when a link has expired or is incomplete', async () => {
    m.verifyEmailLink.mockResolvedValue(authApi.LINK_EXPIRED_MESSAGE)
    await renderLink('?token_hash=old&type=recovery')
    expect(screen.getByRole('heading', { name: 'Choose a new password' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('This link no longer works')).toBeTruthy()
    expect(screen.getByText(authApi.LINK_EXPIRED_MESSAGE)).toBeTruthy()
  })

  it('refuses a link without its token', async () => {
    await renderLink('?type=invite')
    expect(screen.getByText('This link is not complete. Open the full link from your email.')).toBeTruthy()
  })
})

describe('Change my password', () => {
  async function renderChange() {
    const { AuthProvider, ChangePasswordPage } = await import('../../src/features/auth')
    render(
      <AuthProvider>
        <MemoryRouter>
          <ChangePasswordPage />
        </MemoryRouter>
      </AuthProvider>,
    )
  }

  it('asks for the current password and checks it with the new one', async () => {
    m.changeOwnPassword.mockResolvedValueOnce('Your current password is incorrect.').mockResolvedValueOnce(null)
    await renderChange()
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }))
    expect(screen.getByRole('alert').textContent).toBe('Enter your current password.')

    await userEvent.type(screen.getByLabelText('Current password'), 'wrong-one')
    await userEvent.type(screen.getByLabelText('New password'), 'new-pass-1')
    await userEvent.type(screen.getByLabelText('Type the new password again'), 'new-pass-1')
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }))
    await waitFor(() => expect(m.changeOwnPassword).toHaveBeenCalledWith('bala@sejuk.example.com', 'wrong-one', 'new-pass-1'))
    expect((await screen.findByRole('alert')).textContent).toBe('Your current password is incorrect.')

    await userEvent.clear(screen.getByLabelText('Current password'))
    await userEvent.type(screen.getByLabelText('Current password'), 'right-one')
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }))
    expect(await screen.findByText('Your password is changed. Use it the next time you sign in.')).toBeTruthy()
  })
})

describe('Deactivation signs the person out at once', () => {
  async function renderApp() {
    const { AuthProvider, SignInForm, useAuth } = await import('../../src/features/auth')
    function Shell() {
      const { status, profile } = useAuth()
      if (status === 'signed-out') return <SignInForm />
      return <p>{profile.status === 'ready' ? `Hello ${profile.profile.name}` : 'Loading'}</p>
    }
    render(
      <AuthProvider>
        <MemoryRouter>
          <Shell />
        </MemoryRouter>
      </AuthProvider>,
    )
    await screen.findByText('Hello Bala')
  }

  it('on the live update of their own staff row', async () => {
    await renderApp()
    expect(fake.filter).toBe('id=eq.s-bala')
    act(() => fake.handler!({ new: { id: 's-bala', active: false } }))
    expect(await screen.findByText('Your account is no longer active. Ask your administrator if this is a mistake.')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeTruthy()
    expect(fake.signOut).toHaveBeenCalled()
  })

  it('when a refused action or a return to the tab finds no active profile', async () => {
    const { ACCESS_LOST_EVENT } = await import('../../src/lib/api')
    await renderApp()
    act(() => window.dispatchEvent(new Event('focus')))
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.getByText('Hello Bala')).toBeTruthy() // still active: nothing happens

    fake.profileActive = false
    act(() => window.dispatchEvent(new Event(ACCESS_LOST_EVENT)))
    expect(await screen.findByText(/Your account is no longer active/)).toBeTruthy()
  })
})
