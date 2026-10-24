# 0010 - Production Deployment Implementation Plan

> **Type:** Plan | **Must stay current:** No -- record divergences in decision log, rewrite only during re-planning

<!-- AI Context
Role: This document describes *how* to build the feature, not *what* or *why*.
Read the corresponding PRD first for intent and constraints, then use this plan
to guide implementation order, component boundaries, and technical decisions.
Do not rewrite this document during coding. If the implementation diverges from
this plan, add an entry to the decision log instead. Only rewrite during a
deliberate re-planning session.
-->

## Overview

The app is already a static Vite build with an SPA rewrite, so deploying
is mostly set-up the user does in the Vercel, Supabase and GitHub
dashboards, one step at a time. The code and config work is small:

1. `staff-access` builds email links from its own setting (the live
   address) instead of the browser's address (PRD Q13).
2. `vercel.json`: only `main` and `dev` build; no search-engine indexing.
3. GitHub Actions: checks (`ci`), a robot visit after each live deploy
   (`live-check`), a daily wake-up visit (`keep-awake`).
4. Demo staff emails renamed to `name.role.branch@sejuk.example.com`
   (seed, tests, hosted); 7 demo technicians; a demo data script kept in
   `docs/draft/` (not in git).
5. The full project README; the harness text moves to `docs/harness.md`.

The big check runs on production with today's `dev` (0009) code (PRD Q6),
then the 0010 commit is released by a second pull request and re-checked.

## Technical Approach

### Release flow (PRD Q5, Q6)

```text
feature/0010 ──(one commit, user approves)──▶ dev ──(pull request, user merges)──▶ main
                                               │                                   │
                              GitHub ci: test + typecheck + build      GitHub ci on the pull request
                              Vercel: dev preview (Vercel sign-in)     Vercel: production sejuk-sejuk.vercel.app
                                                                         └─▶ GitHub live-check (robot visit)
```

- First release (before the big check): a `dev` → `main` pull request
  with today's `dev` (0009). `main` is an ancestor of `dev`, so it merges
  cleanly. The user opens and merges it on GitHub.
- Second release (after the 0010 commit is squash-merged into `dev`): a
  second pull request; this one carries the GitHub Actions files.
- GitHub runs `deployment_status` and `schedule` workflows only from the
  default branch (`main`), so the robot and the daily visit start after
  the second release. Before the commit, the robot script is run from
  this computer against the live address (see Testing Strategy).

### Vercel

- Project `sejuk-sejuk` imported from `nikzr16/utopia-assessment`
  (Framework: Vite; build `npm run build`; output `dist`). Production
  branch `main`. If the name is taken, the closest free name (PRD Q1)
  and every address below changes with it.
- `vercel.json`:
  - `ignoreCommand` skips any branch other than `main` and `dev` (PRD Q3).
  - Headers on every path: `X-Robots-Tag: noindex, nofollow` (PRD Q13),
    `X-Content-Type-Options: nosniff`, `Referrer-Policy:
    strict-origin-when-cross-origin`, `X-Frame-Options: DENY`.
  - The SPA rewrite stays as is.
- `public/robots.txt`: `Disallow: /`.
- Environment variables (user types them): `VITE_SUPABASE_URL`,
  `VITE_SUPABASE_ANON_KEY`, the same values for Production and Preview
  (PRD Q2).
- Deployment Protection: Vercel Authentication on previews only (PRD Q4).

### Supabase settings (user, dashboard)

- Auth → URL Configuration: Site URL `https://sejuk-sejuk.vercel.app`;
  Redirect URLs only `https://sejuk-sejuk.vercel.app/auth/confirm` (local
  ones removed, PRD Q13).
- Edge Functions → Secrets: `APP_URL` = `https://sejuk-sejuk.vercel.app`
  for `staff-access` (Q-P1); the old `APP_ORIGINS` is no longer read; then
  `staff-access` redeployed.
- Hosted SQL (`docs/draft/0010-supabase-update.sql`):
  `feedback_link_base` = `https://sejuk-sejuk.vercel.app`; the email
  rename of the 12 staff (Q-P2: staff rows, sign-ins and one
  `staff_history` line each, read back by me) and the 7 demo technicians
  with sign-ins (Q-P5).

### Email links (PRD Q13)

- Today the browser sends `redirectTo = <its own address>/auth/confirm`
  and `staff-access` checks it against `DEFAULT_APP_ORIGINS` (local) +
  `APP_ORIGINS`.
- 0010 (Q-P1): `staff-access` ignores the browser's address
  and always uses `<APP_URL>/auth/confirm` from its secret. The local list
  goes. The browser stops sending `redirectTo` (an old browser that still
  sends it is ignored, so the 0009 app on `main` keeps working while the
  new function is deployed). Without the secret the function answers
  "The app address is not set up yet." and sends no email.

### GitHub Actions (PRD Q5, Q11)

| Workflow | Runs when | Does |
|---|---|---|
| `.github/workflows/ci.yml` | push to `dev` or `main`; pull request into `main` | Node 23, `npm ci`, `npm test`, `npm run typecheck`, `npm run build` |
| `.github/workflows/live-check.yml` | Vercel reports a successful Production deployment (`deployment_status`); also by hand | Runs the robot visit against the live address |
| `.github/workflows/keep-awake.yml` | Daily at 03:00 Malaysia time; also by hand | One public read from Supabase so the free project counts as active |

- Repository variables (not secrets; the anon key is public by design),
  typed by the user: `LIVE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`.
- The robot visit (`scripts/live-check.ts`, a headless Chromium through
  Playwright, Q-P3) checks: the home
  page shows the sign-in form; `/f/<made-up token>` opens the feedback
  page and shows its "link not found" state (proves the SPA rewrite, the
  build's Supabase values and the database answering); `/auth/confirm`
  loads; the no-index header is present. Red on any failure.
- The wake-up visit calls the public `feedback_form` function with a
  made-up token (the only signed-out read there is).

### Demo staff emails (PRD Q8)

- New shape `<first name>.<role>.<branch>@sejuk.example.com`; roles
  `admin`, `manager`, `tech`, `finance`; branches `kl`, `sa`, `pg`, `jb`,
  `kk`. The name part stays as today (the name people use: `aisyah`,
  `weiming`, `meiling`).

| Today | 0010 |
|---|---|
| `aisyah@` | `aisyah.admin.kl@` |
| `farid@` | `farid.admin.sa@` |
| `ali@` | `ali.tech.sa@` |
| `john@` | `john.tech.kl@` |
| `bala@` | `bala.tech.sa@` |
| `yusoff@` | `yusoff.tech.sa@` |
| `nurul@` | `nurul.manager.sa@` |
| `weiming@` | `weiming.manager.kl@` |
| `meiling@` | `meiling.manager.pg@` |
| `hafiz@` | `hafiz.manager.jb@` |
| `grace@` | `grace.manager.kk@` |
| `siti@` | `siti.finance.kl@` |

- `supabase/seed.sql` and every test that uses a seed email change with
  it; made-up test emails (`una@`, `bird@`) stay.
- Hosted: one SQL script (Q-P2). History and jobs stay with the same
  staff rows (the staff id never changes).
- 7 demo technicians (Q-P5) in the same shape: two each in Penang, Johor
  Bahru and Kota Kinabalu, one more in Kuala Lumpur; added to
  `supabase/seed.sql` and, on the hosted project, by the update script;
  sign-ins with the demo password by `npm run auth:create-staff-logins`
  (the user runs it; it reads `.env.local`, which I never read).

### Demo data (PRD Q7)

- A script `docs/draft/0010-demo-data.sql` (git-excluded, Q-P4) run
  once on the hosted project after the check's clean-up, around
  submission. Dates count back from the day it runs (about 6 weeks, plus
  a few booked jobs ahead); later weeks stay empty, as in real life
  (Q-P6). Every branch, every status, payments (cash and receipts),
  extra charges, reschedules, a few returns for rework, WhatsApp messages
  and ratings (some poor).
- Rows go in through the normal tables with the normal database
  triggers, so rule warnings, messages and KPI numbers come out as they
  would in real use. The AI job check is off while it loads and then
  runs for the 5 newest Job Done demo jobs only (Q-P7), so a Manager
  sees some "AI" warnings and the AI log has those 5 calls.
- Demo orders carry a marker (an order-number range) so they can be told
  apart from real test data and removed by hand if needed.

### README (PRD Q9, Q12, Q13)

Sections: what was built (modules 1–3 + the extra features), live URL,
reviewer sign-ins (emails; "the password comes with the submission"),
tech stack, architecture (diagram: browser → Supabase RPC / RLS / Edge
Functions → OpenAI), architecture decisions, challenges and assumptions,
the existing AI section (how it works, supported queries, limitations,
three advanced challenges, privacy), limitations of the whole system,
local set-up, deployment and CI/CD. The harness text moves to
`docs/harness.md`.

## System Components

| Component | Responsibility |
|---|---|
| `vercel.json`, `public/robots.txt` | Which branches build, SPA rewrite, headers, no indexing |
| `.github/workflows/ci.yml` | Test, typecheck and build on `dev` / `main` / pull requests |
| `.github/workflows/live-check.yml`, `scripts/live-check.ts` | Robot visit after each production deploy |
| `.github/workflows/keep-awake.yml` | Daily visit to the Supabase project |
| `supabase/functions/staff-access/` | Email links always to the live `/auth/confirm` |
| `src/features/staff/api.ts` | Stops sending the browser's address |
| `supabase/seed.sql` | New email shape; 7 demo technicians (Q-P5) |
| `docs/draft/0010-demo-data.sql` | Demo set for the hosted project (git-excluded, Q-P4) |
| `README.md`, `docs/harness.md` | Project README; harness text |
| `docs/draft/0010-supabase-update.sql` | Hosted settings, rename, technicians (git-excluded) |
| `docs/draft/0010-cleanup-test-orders.sql` | Removes the check's test data (git-excluded) |

## Processing Flow

1. Code and config on the feature branch until `npm test`,
   `npm run typecheck`, `npm run build` and `validate_config.py` pass.
2. Set-up, one step at a time: first release pull request (0009) →
   Vercel project, variables, protection → Supabase Auth URLs →
   `staff-access` secret and redeploy → hosted SQL → GitHub variables.
3. Big check on `https://sejuk-sejuk.vercel.app` (test data approved
   first): every role, technician and Manager on the user's phone, the
   feedback link from a real phone, invite email.
4. Clean-up SQL (user presses Run), Storage files, then the demo set.
5. Robot script run from this computer against the live address.
6. Docs, decision 0018, roadmap; commit message; one commit.
7. When asked: push, squash into `dev`, push `dev`; second pull request;
   the user merges; robot visit and wake-up checked on GitHub; quick
   re-check on live.

## Dependencies

| Dependency | Purpose |
|---|---|
| Vercel (Hobby), GitHub integration | Hosting, preview / production builds |
| GitHub Actions (free minutes, private repository) | CI, robot visit, wake-up |
| `playwright` (dev dependency, Chromium in CI) | Robot visit in a real browser (Q-P3) |
| Supabase CLI (`npx supabase`) | Redeploy `staff-access` |
| The user's phone with WhatsApp | Technician, Manager and customer checks |

## Implementation Phases

### Phase 1: Code and config

`staff-access` live address + tests; `vercel.json`, `robots.txt`; the
three workflows and `scripts/live-check.ts`; email rename in seed and
tests; demo technicians; README and `docs/harness.md`; the draft SQL
files (update, demo data, clean-up).

### Phase 2: Set-up

The user does each dashboard step; I give one step at a time and read
the result in the browser pane where I can (Vercel deployment page,
Supabase SQL results).

### Phase 3: Big check on live

The approved test flow, run by me in the browser pane at desktop size
and by the user on the phone; hosted SQL read by me.

### Phase 4: Clean-up, demo data, finish

Clean-up, demo set, robot script run locally, docs, one commit; release
and GitHub checks when the user asks.

## Testing Strategy

- `tests/functions/staff-access.test.ts`: links use the configured live
  address; the browser's `redirectTo` is ignored; no address set → the
  set-up message, no email.
- Seed and auth tests follow the new emails (`tests/db/seed.test.ts`
  checks every email has the `name.role.branch` shape and matches the
  role and branch).
- The demo script is tried on PGlite from this computer before the user
  runs it (it is not in git, so there is no repository test); on the
  hosted project I read back the order counts per branch and status and
  the KPI numbers.
- `tests/scripts/live-check.test.ts`: the robot's checks against a fake
  page (pass and each fail case).
- Workflow files: a test that parses each YAML and checks the triggers
  and the Node version.
- The robot script is run from this computer against
  `https://sejuk-sejuk.vercel.app` before the commit (proves it on the
  real site); its GitHub trigger is checked after the second release.

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| `sejuk-sejuk` taken on Vercel | Addresses differ | Pick the closest free name at set-up; every setting uses that one |
| Test data on the shared database seen by reviewers | Confusing data | Check before reviewers are invited; clean-up script read back by me |
| Removing local addresses breaks local invite tests | Can't test invites locally | Chosen in PRD Q13; invites are tested on live |
| Robot and wake-up only run from `main` | Their GitHub trigger is checked after the commit | Script proven locally first; a fix goes as a small follow-up commit through `dev` → `main` |
| Free plan pause before the wake-up starts | Errors for reviewers | Wake-up lands with the second release, before reviewers are invited |
| Renaming emails while someone is signed in | That person is signed out / must use the new email | Rename before the check; everyone signs in fresh |
| No branch protection on a private free repository | A red pull request could be merged | The user merges only when green (PRD constraint) |

## Roadmap Phase

**Phase:** 5 – Production

## Related Documents

| Document | Type | Relationship |
|---|---|---|
| `docs/product-roadmap.md` | Roadmap | Phase assignment and sequencing for this plan |
| `docs/prd/0010-production-deployment-prd.md` | Intent | Product goals and constraints this plan implements |
| `docs/0010-production-deployment-workflow.md` | Workflow | Runtime behavior derived from this plan |
| `docs/reference/folder-structure.md` | Reference | Structural placement of planned components |
| `docs/decisions/NNNN-*.md` | Decision log | Divergences from this plan |

## Open Questions

All answered on 2026-10-24.

- [x] **Q-P1. Email link address.** The server decides: `staff-access`
  uses its `APP_URL` secret; the browser's address is ignored.
- [x] **Q-P2. Hosted email rename.** One hosted SQL script the user runs.
- [x] **Q-P3. Robot visit.** A real headless browser (Playwright).
- [x] **Q-P4. Demo script.** Only in `docs/draft/` (not in git).
- [x] **Q-P5. Technicians.** 7 demo technicians (2 each in Penang, Johor
  Bahru, Kota Kinabalu; 1 more in Kuala Lumpur).
- [x] **Q-P6. Demo dates.** Counted back from the day it runs; run once
  around submission; later weeks stay empty, like real data.
- [x] **Q-P7. Demo AI.** The AI checks the 5 newest Job Done demo jobs.
