/**
 * The robot visit (0010): opens the live app in a headless Chromium and
 * checks what a person would see. Run by GitHub Actions after each production
 * deploy (.github/workflows/live-check.yml), or by hand:
 *
 *   LIVE_URL=https://sejuk-sejuk-utopia.vercel.app npm run live-check
 *
 * Needs the Chromium build once: `npx playwright install chromium`. Exits 1
 * when any check fails. No keys: it only opens public pages.
 *
 * Only erasable TypeScript syntax is used so Node can run this file directly.
 */
import { chromium } from 'playwright'
import { formatResults, readLiveEnv, runLiveCheck, type LivePage } from './lib/live-check.ts'

const env = readLiveEnv(process.env)
if (!env.ok) {
  console.error(`Cannot run the live check: ${env.problem}`)
  process.exit(1)
}

const browser = await chromium.launch()
try {
  // Phone size: technicians and customers use the app on a phone.
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const tab = await context.newPage()
  const errors: string[] = []
  tab.on('pageerror', (e) => errors.push(e.message))

  const page: LivePage = {
    async open(url) {
      const response = await tab.goto(url, { waitUntil: 'load', timeout: 30_000 })
      return response ? { status: response.status(), headers: response.headers() } : null
    },
    async sees(text, timeoutMs) {
      try {
        await tab.getByText(text).first().waitFor({ state: 'visible', timeout: timeoutMs })
        return true
      } catch {
        return false
      }
    },
    errors: () => [...errors],
  }

  const results = await runLiveCheck(page, env.baseUrl, async (url) => {
    const response = await fetch(url)
    return { status: response.status, text: await response.text() }
  })
  console.log(`Live check of ${env.baseUrl}\n${formatResults(results)}`)
  if (results.some((r) => !r.ok)) process.exitCode = 1
} finally {
  await browser.close()
}
