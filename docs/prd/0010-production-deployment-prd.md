# 0010 - Production Deployment PRD

> **Type:** Intent | **Must stay current:** No -- record divergences in decision log

<!-- AI Context
Role: This document captures product intent, not implementation detail.
Use it to understand *what* the feature should do and *why*, then consult the
implementation plan and workflow docs for *how*.
Do not rewrite this document during coding. If implementation diverges from
the intent described here, add an entry to the decision log instead.
-->

## Purpose

Features 0000–0009 run only on a developer's computer against the hosted
Supabase project, so reviewers cannot open the app, customers cannot open
the feedback link on their phones, and email links point to `localhost`.
This PRD puts the app on Vercel (`main` = production, `dev` = preview)
with automatic checks on GitHub (CI/CD), points every address-dependent
setting at the live app, renames the demo staff sign-ins to a readable
shape, loads demo data for reviewers, checks every portal end to end on
the live app with real phones, and writes the full project README the
brief's submission guide asks for (decision 0012).

## Goals

- A public production address (`sejuk-sejuk.vercel.app`) serves the app
  from `main`; a private preview address serves `dev`; both build
  automatically when the branch changes.
- GitHub checks every push to `dev` and every `dev` → `main` pull request
  (tests, typecheck, build), and after each live deploy a short robot
  visit checks the live address.
- Every setting that holds an app address uses the live address:
  Supabase Auth site URL and redirect URLs, `APP_ORIGINS` for
  `staff-access`, email links, and `app_settings.feedback_link_base`.
- Every role works on the deployed app: Admin and Finance on a desktop,
  technician and Manager on a real phone; a customer opens the feedback
  link from a real phone.
- Reviewers get a live URL, sign-ins for each role
  (`name.role.branch@sejuk.example.com`), realistic demo data, and a
  README that
  covers what the brief asks (what was built, stack, architecture,
  challenges / assumptions, AI integration, supported AI queries,
  limitations, set-up), with the existing AI section kept.

## Non-Goals

- New product features or rule changes (0010 only deploys and documents
  what 0000–0009 built; bugs found on the deployed app are fixed here).
- Native mobile apps or offline use (the web app at phone width is the
  mobile portal).
- Sending WhatsApp messages automatically (0003: a person sends by
  `wa.me` link and confirms).
- Paid monitoring, analytics or error-tracking services.
- A robot that signs in as each role on the live app (Q5: it would need
  passwords on GitHub and leave test orders reviewers see).
- The brief's optional README self-assessment (Q12).

## Scope

| In Scope | Out of Scope |
|---|---|
| Vercel project linked to the GitHub repository; `main` → production, `dev` → preview | Other hosts (Netlify, Firebase) |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` per Vercel environment, entered by the user | Any secret key in Vercel or the browser bundle |
| `vercel.json` (SPA rewrite already there; only `main` and `dev` build; no search-engine indexing) | Server-side rendering or Vercel serverless functions |
| GitHub Actions: checks on `dev` pushes and `dev` → `main` pull requests, a robot visit after each live deploy, a daily wake-up visit to Supabase | Paid GitHub plans or branch protection that needs one |
| Supabase Auth site URL, redirect URLs (`/auth/confirm`), `APP_ORIGINS` secret; email links always open the live app | Changing the email templates' design |
| `feedback_link_base` = production address (hosted SQL) | Changing links already sent to customers |
| `main` gets the code only by a `dev` → `main` pull request (Q5) | Robot sign-in tests on the live app |
| End-to-end check on the deployed app, every role, real phones, the feedback link | Load or penetration testing |
| Demo staff emails renamed to `name.role.branch@sejuk.example.com` (local seed and hosted); demo data for reviewers (Q7, Q8) | Public sign-up; separate reviewer-only accounts |
| Full project README; harness text moved out of the README into `docs/` | Rewriting PRDs or plans of earlier features; README self-assessment |
| Clean-up of test data on the hosted project | |

## User Stories

1. **As a reviewer**, I want to open one live URL and sign in as each
   role so that I can try the system without installing anything.
2. **As a technician**, I want to open the app on my phone, see my jobs,
   take photos and submit Job Done so that I can work from the site.
3. **As a Manager**, I want to review and approve jobs on my phone so
   that I am not tied to a desk.
4. **As a customer**, I want the feedback link in the WhatsApp message to
   open on my phone so that I can rate the job.
5. **As a new staff member**, I want the invite email link to open the
   live app so that I can set my password and sign in.
6. **As the developer**, I want `dev` to deploy to a preview address and
   GitHub to check every change so that `main` (production) only gets
   work that passes, and I hear at once if the live app breaks.
7. **As a reviewer**, I want a README that explains what was built, how
   the AI works and its limits, and how to run it locally.

## Product Decisions

Decisions already fixed by the brief and 0000–0009:

| Decision | Rationale |
|---|---|
| Host on Vercel; `main` = production, `dev` = integration | Brief tech stack; `CLAUDE.project.md` |
| The app stays a static single-page app; `vercel.json` sends every path to `index.html` so deep links (`/f/:token`, `/orders/…`, `/auth/confirm`) open | 0005, 0006 |
| Only the publishable / anon key is in the browser; the secret key and the OpenAI key stay in Supabase (script / Edge Function secrets) | 0000, 0006, 0008 |
| The user signs in to Vercel, Supabase, GitHub and every role, and types every key; the agent never sees or types passwords or keys | `CLAUDE.project.md`, all earlier features |
| Public sign-up stays off; staff get sign-ins by invite (or the login script) | 0006 |
| The feedback link address is the database setting `feedback_link_base`; messages already prepared keep their old link | 0005, decision 0012 |
| Email links go only to addresses in `APP_ORIGINS` and the Supabase redirect list | 0006 |
| `main` is not touched until the user approves; nothing is pushed until the user asks | User instruction |
| One commit for the feature after every acceptance criterion passes | User instruction |

Decisions made by this PRD (answered 2026-10-24):

| Decision | Rationale |
|---|---|
| Live address `sejuk-sejuk.vercel.app` (a close company-style name, e.g. `sejuk-sejuk-ops`, if taken) (Q1) | Customers see the company name in the feedback link; free |
| One hosted Supabase project for preview and production; both Vercel environments use the same Supabase values (Q2) | Set up once; a test order made on `dev` is also visible on live, so test data is cleaned after each check |
| Only `main` (production) and `dev` (preview) build on Vercel; feature branches never do (Q3) | Two fixed addresses; nothing extra to allow for email links |
| The preview needs the user's Vercel sign-in; production is public (Q4) | Reviewers and customers see only finished work |
| CI/CD on GitHub Actions: every push to `dev` and every `dev` → `main` pull request runs `npm test`, `npm run typecheck`, `npm run build`; after each production deploy a robot visit checks the live address (app loads, `/f/…` deep link opens, sign-in page shows, Supabase answers) and reports red / green (Q5) | The user wants `main` deployed and tested automatically on merge |
| `main` gets work only through a `dev` → `main` pull request on GitHub, merged by the user when the checks are green (merge commit) (Q5) | A recorded, checked release; per-feature commits stay visible |
| The big check runs on production: with the user's OK, `main` first gets today's `dev` (0009) through the first pull request; after the 0010 commit a second pull request releases 0010 and a short re-check follows (Q6) | The customer link test needs the public live address; settings change once |
| A realistic demo set (a few weeks of orders in every branch, payments, ratings) is loaded on the hosted project after the check and kept (Q7) | Reviewers see a working dashboard and Ask answers |
| All 12 demo staff emails become `<name>.<role>.<branch>@sejuk.example.com` (role `admin`, `manager`, `tech`, `finance`; branch `kl`, `sa`, `pg`, `jb`, `kk`), e.g. `aisyah.admin.kl@…`, `ali.tech.sa@…`; reviewers sign in with these (Q8) | Readable sign-ins that say who, what and where |
| Reviewer sign-ins use the user's `STAFF_DEMO_PASSWORD`; the README lists the emails and says the password comes with the submission; the user passes it on (Q9) | No password in the repository |
| The repository stays private; the user invites reviewers on GitHub (Q10) | User choice |
| A daily scheduled GitHub Actions visit keeps the free Supabase project awake (Q11) | Reviewers may look weeks later |
| No README self-assessment (Q12) | User choice |
| Invite and reset email links always open the live app, wherever they were made (local, preview or live); local addresses are removed from the redirect and `APP_ORIGINS` lists (Q13) | One address for every email link |
| Feedback links always use the live address, also for jobs tested on the `dev` copy (Q13) | The `dev` copy needs Vercel sign-in, so a customer could not open it |
| The live app tells search engines not to index it (Q13) | Internal staff tool |
| The README is only about the Sejuk Sejuk app; the harness text moves to `docs/` (Q13) | Reviewers read only the product |

## Constraints

- The browser keys are public by design; row-level security and the
  server functions are the only protection, as today.
- Supabase Auth redirect URLs must match the deployed addresses exactly
  (or by a Supabase wildcard pattern); `APP_ORIGINS` matches exact origins.
- Vercel previews are behind Vercel sign-in (Deployment Protection);
  production is public.
- Private repository on free GitHub: Actions minutes are limited and
  branch protection is not available, so "merge only when green" is the
  user's habit, not a lock.
- Renaming a sign-in email must keep the staff row and the sign-in linked
  (0006: only Admins change emails; `staff_history` records it).
- `wa.me` links open WhatsApp on the device that presses Send; the
  customer side of the check needs a WhatsApp number the user controls.
- Free plans: Vercel Hobby, Supabase free (projects pause after about a
  week with no activity), Gmail SMTP sending limits, OpenAI spend cap.
- The hosted database already has 0000–0009 applied; any database change
  in 0010 is a new timestamped migration plus hosted SQL in
  `docs/draft/0010-supabase-update.sql`.
- `npm test`, `npm run typecheck`, `npm run build` and
  `validate_config.py` pass.

## Acceptance Criteria

| # | Criterion | Verifiable By |
|---|---|---|
| 1 | The production address serves the app built from `main`; the preview address serves `dev`; opening any deep link directly (refresh on `/orders/…`, `/f/:token`, `/auth/confirm`) loads the app | manual check |
| 2 | Both environments have `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`; no secret key or OpenAI key is in the built files | manual check + build check |
| 3 | Supabase Auth site URL is the production address; invite and reset email links open the live `/auth/confirm` wherever they were made, set a password and sign in (Q13) | manual check |
| 4 | `staff-access` accepts only the live address (`APP_ORIGINS`) and rejects any other, local ones included | test + manual check |
| 5 | A new Job Done message carries `Leave feedback: <production address>/f/<token>` | manual check (hosted SQL read) |
| 6 | On a desktop, an Admin creates, assigns and follows an order; Finance records, verifies and closes; Ask and the Admin AI log work | manual check |
| 7 | On a real phone, a technician acknowledges, starts, uploads a camera photo, adds a payment and submits Job Done; notifications arrive live | manual check |
| 8 | On a real phone, a Manager sees the job, checks supervisor warnings, sends the WhatsApp message and approves; the KPI dashboard and Insights show | manual check |
| 9 | From a real phone, the customer opens the feedback link signed out, submits, and the rating shows on the order; the used, expired and replaced-link pages show; a 1–2 star rating alerts the covering Manager | manual check |
| 10 | Read from photo fills the New Order form on the deployed app | manual check |
| 11 | All 12 demo staff sign in with `name.role.branch@sejuk.example.com` and the demo password, locally and on production; their history and jobs are unchanged (Q8, Q9) | test + manual check |
| 12 | After the check, the demo set is on the hosted project and the KPI dashboard, Insights and Ask show its numbers (Q7) | manual check |
| 13 | Pushing to `dev` and opening a `dev` → `main` pull request run the GitHub checks; a failing test turns them red (Q5) | manual check |
| 14 | After a production deploy, the robot visit runs on its own and turns red when the live address is broken (Q5) | manual check |
| 15 | The daily wake-up visit runs on schedule and can be started by hand (Q11) | manual check |
| 16 | The preview address asks for Vercel sign-in; production does not; the live app sends a no-index signal (Q4, Q13) | manual check |
| 17 | The README covers every item in the brief's submission guide, the live URL, reviewer sign-in emails (password sent separately), local set-up and CI/CD, keeps the AI section, and has no harness text (Q9, Q12, Q13) | review |
| 18 | Test orders, ratings, messages, AI log rows and Storage files from the check are removed afterwards | manual check (hosted SQL read) |
| 19 | `npm test`, `npm run typecheck`, `npm run build` and `validate_config.py` pass | test |

## Roadmap Phase

**Phase:** 5 – Production

## Related Documents

| Document | Type | Relationship |
|---|---|---|
| `docs/prd/0000-programmer-assessment-brief.docx` | Source brief | Submission guide: live demo, GitHub repo, README |
| `docs/decisions/0012-add-production-deployment-feature.md` | Decision log | What 0010 must cover |
| `docs/0005-customer-feedback-workflow.md` | Workflow | `feedback_link_base`, public `/f/:token` page |
| `docs/0006-staff-management-workflow.md` | Workflow | `APP_ORIGINS`, redirect URLs, `/auth/confirm` |
| `docs/0008-ai-ops-query-workflow.md` | Workflow | `ask` Edge Function, secrets |
| `docs/0009-ai-advanced-workflow.md` | Workflow | `ai-assist` Edge Function, secrets |
| `docs/product-roadmap.md` | Roadmap | Phase assignment and sequencing for this PRD |
| `docs/plan/0010-production-deployment-plan.md` | Plan | Implementation path for this PRD |
| `docs/0010-production-deployment-workflow.md` | Workflow | Runtime behavior derived from this PRD |
| `docs/reference/folder-structure.md` | Reference | Structural placement of the feature |
| `docs/decisions/NNNN-*.md` | Decision log | Divergences from this PRD |

## Open Questions

All answered on 2026-10-24; decisions are recorded in Product Decisions.

- [x] **Q1. Address.** Company name, `sejuk-sejuk.vercel.app`.
- [x] **Q2. Database.** One shared Supabase project.
- [x] **Q3. Branches.** Only `main` and `dev` deploy.
- [x] **Q4. Preview access.** Only the user (Vercel sign-in).
- [x] **Q5. To `main`.** CI/CD: checks before, a robot visit after each
  live deploy; `dev` → `main` pull request merged by the user.
- [x] **Q6. Big check.** On production: `main` gets today's `dev` first,
  quick re-check after the 0010 release.
- [x] **Q7. Demo data.** Realistic demo set, kept.
- [x] **Q8. Sign-ins.** All demo staff renamed to
  `name.role.branch@sejuk.example.com`; reviewers use them.
- [x] **Q9. Passwords.** The `STAFF_DEMO_PASSWORD`; the user sends it.
- [x] **Q10. Repository.** Stays private; reviewers invited.
- [x] **Q11. Sleep.** Daily wake-up visit.
- [x] **Q12. Self-assessment.** Left out.
- [x] **Q13. Defaults.** Email links open the live app only; both Vercel
  copies get the same Supabase values; feedback links always use the live
  address; no search indexing; harness text moves out of the README.
