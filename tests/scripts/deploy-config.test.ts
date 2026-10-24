import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

// Deployment config (0010): Vercel builds only main and dev, serves deep
// links, and tells search engines not to index; GitHub checks every change,
// visits the live app after each production deploy, and wakes Supabase daily.

const read = (path: string) => readFileSync(path, 'utf8')
const workflow = (name: string): any => parse(read(`.github/workflows/${name}.yml`))

describe('vercel.json', () => {
  const vercel = JSON.parse(read('vercel.json'))

  it('sends every path to the app so deep links open (/f/…, /orders/…, /auth/confirm)', () => {
    expect(vercel.rewrites).toEqual([{ source: '/(.*)', destination: '/index.html' }])
  })

  it('builds only main and dev (the ignore command skips every other branch)', () => {
    expect(vercel.ignoreCommand).toBe('[ "$VERCEL_GIT_COMMIT_REF" != "main" ] && [ "$VERCEL_GIT_COMMIT_REF" != "dev" ]')
  })

  it('sends the no-index and safety headers on every path', () => {
    const headers = Object.fromEntries(vercel.headers[0].headers.map((h: { key: string; value: string }) => [h.key, h.value]))
    expect(vercel.headers[0].source).toBe('/(.*)')
    expect(headers).toEqual({
      'X-Robots-Tag': 'noindex, nofollow',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'DENY',
    })
  })

  it('also blocks indexing in robots.txt and the page itself', () => {
    expect(read('public/robots.txt')).toMatch(/^User-agent: \*\nDisallow: \/$/m)
    expect(read('index.html')).toContain('<meta name="robots" content="noindex, nofollow" />')
  })
})

describe('GitHub Actions', () => {
  it('ci: test, typecheck, build and the harness check on dev / main pushes and pull requests into main', () => {
    const ci = workflow('ci')
    expect(ci.on.push.branches).toEqual(['dev', 'main'])
    expect(ci.on.pull_request.branches).toEqual(['main'])
    const steps = ci.jobs.check.steps
    expect(steps.find((s: { uses?: string }) => s.uses?.startsWith('actions/setup-node')).with['node-version']).toBe(23)
    expect(steps.map((s: { run?: string }) => s.run).filter(Boolean)).toEqual([
      'npm ci',
      'npm test',
      'npm run typecheck',
      'npm run build',
      'python .claude/skills/validate-config/scripts/validate_config.py',
    ])
  })

  it('live-check: runs after a successful Production deployment (or by hand) with LIVE_URL', () => {
    const live = workflow('live-check')
    expect(Object.keys(live.on)).toEqual(['deployment_status', 'workflow_dispatch'])
    expect(live.jobs.visit.if).toContain("github.event.deployment_status.state == 'success'")
    expect(live.jobs.visit.if).toContain("github.event.deployment.environment == 'Production'")
    const run = live.jobs.visit.steps.find((s: { run?: string }) => s.run === 'npm run live-check')
    expect(run.env).toEqual({ LIVE_URL: '${{ vars.LIVE_URL }}' })
    expect(JSON.parse(read('package.json')).scripts['live-check']).toBe('node scripts/live-check.ts')
  })

  it('keep-awake: daily at 03:00 Malaysia time (19:00 UTC) with the public key only', () => {
    const awake = workflow('keep-awake')
    expect(awake.on.schedule).toEqual([{ cron: '0 19 * * *' }])
    expect(awake.on).toHaveProperty('workflow_dispatch')
    const step = awake.jobs.wake.steps[0]
    expect(step.env).toEqual({ SUPABASE_URL: '${{ vars.SUPABASE_URL }}', SUPABASE_ANON_KEY: '${{ vars.SUPABASE_ANON_KEY }}' })
    expect(step.run).toContain('/rest/v1/rpc/feedback_form')
    expect(read('.github/workflows/keep-awake.yml')).not.toMatch(/secrets\./)
  })
})
