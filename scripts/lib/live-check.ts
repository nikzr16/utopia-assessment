/**
 * The robot visit's checks (0010), for scripts/live-check.ts. The page is
 * passed in (Playwright in the script, a fake in tests), so the checks are
 * unit-testable. Only erasable TypeScript syntax: Node runs the script by
 * stripping types. No keys are needed: the robot only opens public pages.
 */

/** A made-up feedback token in the real shape, so the page asks the database. */
export const LIVE_CHECK_TOKEN = 'liveCheck0000000000000'

/** The feedback page's answer for an unknown link (src/domain/feedback.ts `not_found`). */
export const FEEDBACK_NOT_FOUND = 'This feedback link is not valid. Check that you opened the full link from our message'

/** What /auth/confirm shows when opened without the email's token. */
export const CONFIRM_INCOMPLETE = 'This link is not complete. Open the full link from your email.'

/** Text of the notice a build without the Supabase settings shows. */
export const SETUP_NOTICE = 'VITE_SUPABASE_URL'

export interface Opened {
  status: number
  headers: Record<string, string>
}

export interface LivePage {
  /** Open the address and wait for it to load; null when nothing answered. */
  open(url: string): Promise<Opened | null>
  /** True when the text shows on the page within the time. */
  sees(text: string, timeoutMs: number): Promise<boolean>
  /** Uncaught errors the page has thrown so far. */
  errors(): string[]
}

export type FetchText = (url: string) => Promise<{ status: number; text: string }>

export interface CheckResult {
  name: string
  ok: boolean
  detail: string
}

export type LiveEnv = { ok: true; baseUrl: string } | { ok: false; problem: string }

/** LIVE_URL → the app's address without a trailing slash. */
export function readLiveEnv(source: Record<string, string | undefined>): LiveEnv {
  const raw = source.LIVE_URL?.trim()
  if (!raw) return { ok: false, problem: 'LIVE_URL is not set (the live app address, e.g. https://sejuk-sejuk-utopia.vercel.app)' }
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('not http')
    return { ok: true, baseUrl: u.origin }
  } catch {
    return { ok: false, problem: 'LIVE_URL is not a web address' }
  }
}

const WAIT_MS = 20_000

const pass = (name: string, detail: string): CheckResult => ({ name, ok: true, detail })
const fail = (name: string, detail: string): CheckResult => ({ name, ok: false, detail })

async function openOk(page: LivePage, url: string): Promise<Opened | string> {
  try {
    const opened = await page.open(url)
    if (!opened) return 'no answer'
    return opened.status === 200 ? opened : `answered ${opened.status}`
  } catch (e) {
    return `could not open: ${(e as Error)?.message ?? String(e)}`
  }
}

/** Every check, in order; one failing check does not stop the others. */
export async function runLiveCheck(page: LivePage, baseUrl: string, fetchText: FetchText): Promise<CheckResult[]> {
  const results: CheckResult[] = []

  const home = await openOk(page, `${baseUrl}/`)
  if (typeof home === 'string') {
    results.push(fail('Home page shows the sign-in form', home))
    results.push(fail('Search engines are told not to index', 'home page did not open'))
  } else {
    if (await page.sees(SETUP_NOTICE, 1_000)) {
      results.push(fail('Home page shows the sign-in form', 'the build has no Supabase settings (set-up notice shows)'))
    } else {
      const seen = await page.sees('Sign in', WAIT_MS)
      results.push(seen ? pass('Home page shows the sign-in form', 'seen') : fail('Home page shows the sign-in form', 'not seen (blank page?)'))
    }
    const robots = home.headers['x-robots-tag'] ?? ''
    results.push(
      robots.includes('noindex')
        ? pass('Search engines are told not to index', robots)
        : fail('Search engines are told not to index', 'no X-Robots-Tag noindex header'),
    )
  }

  const feedback = await openOk(page, `${baseUrl}/f/${LIVE_CHECK_TOKEN}`)
  if (typeof feedback === 'string') {
    results.push(fail('Feedback link opens and the database answers', feedback))
  } else {
    const seen = await page.sees(FEEDBACK_NOT_FOUND, WAIT_MS)
    results.push(
      seen
        ? pass('Feedback link opens and the database answers', 'unknown link page seen')
        : fail('Feedback link opens and the database answers', 'the unknown-link answer did not show'),
    )
  }

  const confirm = await openOk(page, `${baseUrl}/auth/confirm`)
  if (typeof confirm === 'string') {
    results.push(fail('Email link page opens', confirm))
  } else {
    const seen = await page.sees(CONFIRM_INCOMPLETE, WAIT_MS)
    results.push(seen ? pass('Email link page opens', 'seen') : fail('Email link page opens', 'its message did not show'))
  }

  try {
    const robotsTxt = await fetchText(`${baseUrl}/robots.txt`)
    results.push(
      robotsTxt.status === 200 && /Disallow:\s*\/\s*$/m.test(robotsTxt.text)
        ? pass('robots.txt blocks indexing', 'Disallow: /')
        : fail('robots.txt blocks indexing', `answered ${robotsTxt.status} without Disallow: /`),
    )
  } catch (e) {
    results.push(fail('robots.txt blocks indexing', `could not open: ${(e as Error)?.message ?? String(e)}`))
  }

  const errors = page.errors()
  results.push(errors.length === 0 ? pass('No page errors', 'none') : fail('No page errors', errors.slice(0, 3).join(' | ')))

  return results
}

/** A short table for the log: one line per check. */
export function formatResults(results: readonly CheckResult[]): string {
  const width = Math.max(...results.map((r) => r.name.length))
  return results.map((r) => `${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(width)}  ${r.detail}`).join('\n')
}
