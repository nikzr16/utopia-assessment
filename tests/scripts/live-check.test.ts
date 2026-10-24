import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CONFIRM_INCOMPLETE,
  FEEDBACK_NOT_FOUND,
  LIVE_CHECK_TOKEN,
  formatResults,
  readLiveEnv,
  runLiveCheck,
  type FetchText,
  type LivePage,
  type Opened,
} from '../../scripts/lib/live-check'
import { FEEDBACK_STATE_MESSAGES, FEEDBACK_TOKEN_PATTERN } from '../../src/domain/feedback'

// The robot visit after each production deploy (0010): what it checks on the
// live app, and that one broken thing turns it red without hiding the rest.

const BASE = 'https://sejuk-sejuk-utopia.vercel.app'
const OK: Opened = { status: 200, headers: { 'x-robots-tag': 'noindex, nofollow' } }

/** A fake live app: each address answers and shows the given texts. */
function fakeSite(pages: Record<string, { opened?: Opened | null; texts?: string[] }>, errors: string[] = []) {
  let current = ''
  const page: LivePage = {
    async open(url) {
      current = url
      const p = pages[url.slice(BASE.length)]
      if (!p) throw new Error('net::ERR_NAME_NOT_RESOLVED')
      return p.opened === undefined ? OK : p.opened
    },
    async sees(text) {
      return (pages[current.slice(BASE.length)]?.texts ?? []).some((t) => t.includes(text))
    },
    errors: () => errors,
  }
  return page
}

const healthy = () => ({
  '/': { texts: ['Sign in', 'Use your work email and the password you chose.'] },
  [`/f/${LIVE_CHECK_TOKEN}`]: { texts: [FEEDBACK_NOT_FOUND] },
  '/auth/confirm': { texts: [CONFIRM_INCOMPLETE] },
})
const robots: FetchText = async () => ({ status: 200, text: '# Internal staff tool\nUser-agent: *\nDisallow: /\n' })

describe('live check', () => {
  it('passes every check on a healthy live app', async () => {
    const results = await runLiveCheck(fakeSite(healthy()), BASE, robots)
    expect(results.map((r) => [r.name, r.ok])).toEqual([
      ['Home page shows the sign-in form', true],
      ['Search engines are told not to index', true],
      ['Feedback link opens and the database answers', true],
      ['Email link page opens', true],
      ['robots.txt blocks indexing', true],
      ['No page errors', true],
    ])
  })

  it('fails a blank page, a build without Supabase settings, and a missing no-index header', async () => {
    const blank = await runLiveCheck(fakeSite({ ...healthy(), '/': { texts: [] } }), BASE, robots)
    expect(blank.find((r) => !r.ok)).toMatchObject({ name: 'Home page shows the sign-in form', detail: 'not seen (blank page?)' })

    const noSettings = await runLiveCheck(fakeSite({ ...healthy(), '/': { texts: ['Set VITE_SUPABASE_URL and …'] } }), BASE, robots)
    expect(noSettings[0]).toMatchObject({ ok: false, detail: 'the build has no Supabase settings (set-up notice shows)' })

    const indexed = await runLiveCheck(fakeSite({ ...healthy(), '/': { opened: { status: 200, headers: {} }, texts: ['Sign in'] } }), BASE, robots)
    expect(indexed.filter((r) => !r.ok).map((r) => r.name)).toEqual(['Search engines are told not to index'])
  })

  it('fails when a deep link is not served (no SPA rewrite) or the database does not answer', async () => {
    const noRewrite = await runLiveCheck(fakeSite({ ...healthy(), [`/f/${LIVE_CHECK_TOKEN}`]: { opened: { status: 404, headers: {} } } }), BASE, robots)
    expect(noRewrite.find((r) => !r.ok)).toMatchObject({ name: 'Feedback link opens and the database answers', detail: 'answered 404' })

    const asleep = await runLiveCheck(fakeSite({ ...healthy(), [`/f/${LIVE_CHECK_TOKEN}`]: { texts: ['Something went wrong'] } }), BASE, robots)
    expect(asleep.filter((r) => !r.ok).map((r) => r.name)).toEqual(['Feedback link opens and the database answers'])
  })

  it('keeps checking after one failure, and reports page errors and robots.txt', async () => {
    const results = await runLiveCheck(fakeSite({ '/auth/confirm': { texts: [CONFIRM_INCOMPLETE] } }, ['TypeError: x is undefined']), BASE, async () => ({
      status: 404,
      text: '',
    }))
    expect(results.map((r) => r.ok)).toEqual([false, false, false, true, false, false])
    expect(results[0].detail).toMatch(/could not open/)
    expect(results[5].detail).toBe('TypeError: x is undefined')
  })

  it('formats one line per check', () => {
    expect(
      formatResults([
        { name: 'A', ok: true, detail: 'seen' },
        { name: 'Longer', ok: false, detail: 'answered 500' },
      ]),
    ).toBe('PASS  A       seen\nFAIL  Longer  answered 500')
  })

  it('reads LIVE_URL as the app origin', () => {
    expect(readLiveEnv({ LIVE_URL: ' https://sejuk-sejuk-utopia.vercel.app/ ' })).toEqual({ ok: true, baseUrl: BASE })
    expect(readLiveEnv({})).toMatchObject({ ok: false })
    expect(readLiveEnv({ LIVE_URL: 'sejuk-sejuk-utopia.vercel.app' })).toMatchObject({ ok: false, problem: 'LIVE_URL is not a web address' })
  })

  it('looks for the texts the app really shows', () => {
    expect(FEEDBACK_NOT_FOUND).toBe(FEEDBACK_STATE_MESSAGES.not_found)
    expect(LIVE_CHECK_TOKEN).toMatch(FEEDBACK_TOKEN_PATTERN)
    expect(readFileSync('src/features/auth/ConfirmLinkPage.tsx', 'utf8')).toContain(CONFIRM_INCOMPLETE)
    expect(readFileSync('src/features/auth/SignInForm.tsx', 'utf8')).toMatch(/>\s*Sign in\s*</)
  })
})
