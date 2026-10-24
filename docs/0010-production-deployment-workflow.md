# 0010 - Production Deployment Workflow

> **Type:** Workflow | **Must stay current:** Yes -- update when behavior changes

<!-- AI Context
Role: This document describes how the system behaves *today*.
Use it as the authoritative source for current processing flows, stage
sequencing, error handling, and runtime defaults. When writing or modifying
code, the behavior described here is the specification.
This document must be updated before a coding session ends whenever behavior,
flow, or error handling changes. If it conflicts with a PRD or plan, this
document reflects reality; record the divergence in the decision log.
-->

## Purpose

How a change gets from a feature branch to the live app, what GitHub checks
on the way, how the live app is watched and kept awake, and which settings
hold the live address. The live app is
**https://sejuk-sejuk-utopia.vercel.app** (decision 0018).

## Trigger

- A push to `dev` or `main`, or a pull request into `main` (GitHub `ci`).
- A successful Vercel production deployment (GitHub `live-check`).
- Every day at 03:00 Malaysia time (GitHub `keep-awake`).
- Any of the three by hand (`workflow_dispatch`).

## Preconditions

- Vercel project `sejuk-sejuk` (Hobby) linked to `nikzr16/utopia-assessment`:
  Vite preset, production branch `main`, environment variables
  `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (same values for
  Production and Preview: one Supabase project), Deployment Protection
  "Standard Protection" (previews need Vercel sign-in; production is
  public). Domains: `sejuk-sejuk-utopia.vercel.app` (and Vercel's own
  `sejuk-sejuk-theta.vercel.app`), both Production. Settings → Git:
  **`repository_dispatch` Events on** (off by default; without it Vercel
  tells GitHub nothing and `live-check` never starts by itself, decision
  0019); `deployment_status` Events off.
- Supabase Auth → URL Configuration: Site URL
  `https://sejuk-sejuk-utopia.vercel.app`; the only Redirect URL is
  `https://sejuk-sejuk-utopia.vercel.app/auth/confirm`.
- Edge Function secret `APP_URL` = `https://sejuk-sejuk-utopia.vercel.app`
  (`staff-access`); `app_settings.feedback_link_base` = the same address.
- GitHub repository variables (Settings → Secrets and variables → Actions →
  Variables; public values, not secrets): `LIVE_URL`, `SUPABASE_URL`,
  `SUPABASE_ANON_KEY`.

## Stages

### 1. Feature to `dev`

**Input:** a finished feature branch (one commit, squash-merged into `dev`).
**Actions:** pushing `dev` runs `ci` (Node 23: `npm ci`, `npm test`,
`npm run typecheck`, `npm run build`, `validate_config.py`). Vercel builds a
preview of `dev`; `vercel.json` `ignoreCommand` skips every branch other
than `main` and `dev`.
**Output:** a green / red `ci` run; a private preview address.
**On failure:** fix on `dev` (or a new feature branch) before releasing.

### 2. Release: `dev` → `main`

**Input:** a pull request from `dev` into `main`, opened by the user.
**Actions:** `ci` runs on the pull request; the user merges with a merge
commit once it is green (free private repositories have no branch
protection, so this is a habit, not a lock). Vercel builds `main` and moves
the production domains to it.
**Output:** the live app on the new commit.
**On failure:** a red `ci` run on the pull request: do not merge.

### 3. Robot visit (`live-check`)

**Input:** Vercel's `repository_dispatch` event `vercel.deployment.success`
with `client_payload.environment` = `production` (a preview's success is
skipped), or a hand start (decision 0019).
**Actions:** checks out `main`, installs Chromium, runs
`npm run live-check` with `LIVE_URL`: a headless browser at phone size
(390 × 844) opens the home page (sign-in form seen, no set-up notice),
`/f/liveCheck0000000000000` (the feedback page answers "not valid" from the
database), `/auth/confirm` ("This link is not complete"), checks the
`X-Robots-Tag: noindex` header and `robots.txt`, and fails on any uncaught
page error.
**Output:** one PASS / FAIL line per check; the run is red when any fails.
**On failure:** read the failing line; open the live app.

### 4. Wake-up visit (`keep-awake`)

**Input:** the daily schedule (19:00 UTC).
**Actions:** `POST <SUPABASE_URL>/rest/v1/rpc/feedback_form` with a made-up
token and the public key (`apikey` header only).
**Output:** "Supabase answered 200" and the `not_found` answer.
**On failure:** red run (the project is paused or the variables are
missing); restore the project in the Supabase dashboard.

### 5. Email links

**Input:** an Admin or Manager adds, edits, reactivates or resets someone on
the Staff screen.
**Actions:** the browser sends only the action and staff fields;
`staff-access` builds `redirectTo` itself as `<APP_URL>/auth/confirm`, so
every invite and reset link opens the live app wherever the action was
taken (local, preview or live).
**Output:** the email link opens `https://sejuk-sejuk-utopia.vercel.app/auth/confirm`.
**On failure:** no `APP_URL` (or not a plain http(s) address): the function
answers 500 "The app address is not set up yet, so no email can be sent.
Ask the person who runs the system." and sends nothing.

## Error States

| Error | Cause | Handling |
|---|---|---|
| `ci` red | A test, typecheck, build or harness check fails | Do not merge the pull request |
| `live-check` "not seen (blank page?)" | The live page did not render the sign-in form | Red run; check the Vercel build and its variables |
| `live-check` "the build has no Supabase settings" | Vercel variables missing | Red run; set them and redeploy |
| `live-check` "answered 404" on `/f/…` | SPA rewrite missing | Red run; check `vercel.json` |
| `live-check` "the unknown-link answer did not show" | Database paused or unreachable | Red run; restore the project |
| `keep-awake` non-200 | Project paused, wrong variables | Red run |
| "The app address is not set up yet…" | `APP_URL` secret missing | No email sent (500) |

## Defaults

| Setting | Default |
|---|---|
| Live address | `https://sejuk-sejuk-utopia.vercel.app` |
| Branches Vercel builds | `main` (production), `dev` (preview) |
| Response headers (every path) | `X-Robots-Tag: noindex, nofollow`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY` |
| Node in CI | 23 |
| Wake-up time | 03:00 Malaysia time daily |
| Robot viewport | 390 × 844 |
| Robot wait per page | 20 s (30 s to load) |

## Behavioral Constraints

- GitHub runs `repository_dispatch` and `schedule` workflows only from the
  default branch (`main`), so `live-check` and `keep-awake` work once they
  are on `main`. Vercel does not send `deployment_status` events for this
  project.
- Preview and production share one Supabase project: test data made on any
  copy is visible on live and is cleaned up after each check.
- Feedback links always use the live address (`feedback_link_base`), also
  for jobs done on the preview.
- Only public values are in Vercel and GitHub; the secret key and the
  OpenAI key stay in Supabase.
- Demo data on the hosted project: 238 orders over 6 weeks up to 24 Oct
  2026 in every branch, marked by the admin note "Demo data (0010)"; 7 demo
  technicians exist only on the hosted project (decision 0018).

## Related Documents

| Document | Type | Relationship |
|---|---|---|
| `docs/prd/0010-production-deployment-prd.md` | Intent | Product goals this workflow fulfills |
| `docs/plan/0010-production-deployment-plan.md` | Plan | Architecture this workflow implements |
| `docs/0005-customer-feedback-workflow.md` | Workflow | Feedback link address |
| `docs/0006-staff-management-workflow.md` | Workflow | Invite and reset emails |
| `docs/reference/folder-structure.md` | Reference | File locations of workflow components |
| `docs/decisions/0018-production-deployment-implementation-details.md` | Decision log | Deviations from original plan captured here |
| `docs/decisions/0019-live-check-vercel-repository-dispatch.md` | Decision log | The robot visit starts from Vercel's `repository_dispatch` |
