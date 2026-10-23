# Project Context

This file is the project-specific context layer for this repository.

The reusable harness policy lives in `CLAUDE.md`; keep this file focused on the
actual product, codebase, team conventions, and commands for the project created
from the harness.

When guidance conflicts:
- Project behavior, domain rules, architecture, and commands in this file take
  precedence for project work.
- Harness routing, capability placement, and validation rules in `CLAUDE.md`
  still apply.

## Project Overview

A programmer assessment: an internal operations system for Sejuk Sejuk Service
Sdn Bhd (fictional), an air-conditioner installation, servicing, and repair
company with 5 branches and 40+ field technician teams. It digitises the
service workflow: Order → Assignment → Service Completion → Manager / Finance
Review. Admins use desktop, technicians use mobile, and managers get an AI
assistant that answers operational questions from controlled queries.

Source brief: `docs/prd/0000-programmer-assessment-brief.docx`. Feature
numbers follow the build order: 0000 foundation, 0001–0003 brief Modules 1–3,
0004 review and close screens, 0005 customer feedback, 0006 staff
management, 0007 KPI dashboard, 0008 AI operations query, 0009 optional AI
challenges, 0010 production deployment (see `docs/product-roadmap.md`;
renumbered in decisions 0009 and 0010; 0010 added in decision 0012).

## Tech Stack

- **Frontend:** React 19 + TypeScript, Vite 7, Tailwind CSS 4, React Router 7 (library mode)
- **Backend:** Supabase Postgres; business rules live in SQL functions (RPCs); Supabase Auth (email + password) with row-level security; Supabase Realtime for in-app notifications
- **Storage:** Supabase Postgres and Supabase Storage (private `job-files` bucket for job photos / videos / PDFs and payment receipts)
- **Packaging:** npm with `package-lock.json`; Node 23 (Vitest pinned to 3.x and jsdom to 26 until Node ≥ 24)
- **Deployment:** Vercel (`main` = production, `dev` = integration); `vercel.json` rewrites all paths to the SPA

## Repository Layout

Full structural reference: `docs/reference/folder-structure.md` (keep it current
when structure, routes, schemas, or config change).

- **`src/`** — React app: `domain/` (pure rules mirrored from the DB),
  `features/` (per-feature UI: `auth`, `orders` (Admin), `jobs` (Technician),
  `attachments` (job files), `notifications`, `customer-messages` (0003),
  `payments` (shared payment form), `order-review` (Manager / Finance order
  page and queues), `review` (Manager), `finance` (Finance) (0004),
  `feedback` (public feedback page and staff feedback card, 0005)),
  `components/` (shared UI),
  `lib/` (Supabase client, shared API plumbing, hooks, drafts)
- **`supabase/`** — `migrations/` (ordered SQL) and `seed.sql`
- **`scripts/`** — Node scripts run locally with the secret key (staff login provisioning)
- **`tests/`** — `domain/`, `auth/`, `scripts/` unit tests; `db/` PGlite database tests;
  `ui/` component tests (jsdom; `src/features/*/api.ts` replaced by test doubles)
- **`docs/`** — docs-first source of truth: `docs/product-roadmap.md`,
  `docs/prd/`, `docs/plan/`, `docs/reference/`, `docs/decisions/`. `docs/draft/` is the
  user's personal scratch space — never read or act on it unless explicitly referenced.

## Commands

| Purpose | Command | Notes |
|---------|---------|-------|
| Install deps | `npm install` | |
| Run locally | `npm run dev` | Needs `.env.local` (see Environment And Secrets) |
| Build | `npm run build` | `tsc -b` then `vite build` |
| Typecheck | `npm run typecheck` | |
| Test | `npm test` | Vitest; DB tests run on PGlite, UI tests on jsdom; no Docker or Supabase needed |
| Create staff logins | `npm run auth:create-staff-logins` | Needs `SUPABASE_SECRET_KEY` + `STAFF_DEMO_PASSWORD` in `.env.local`; `-- --reset-passwords` to update |

## Code Conventions

1. **Docs-first:** Read `docs/product-roadmap.md` and the relevant PRD/plan before feature
   work; follow `docs/documentation-standard.md` for doc maintenance and the session-close
   checklist.
2. **Doc numbering:** a feature's PRD, plan, and workflow doc share one four-digit feature
   number (`docs/prd/0001-[feature]-prd.md` ↔ `docs/plan/0001-[feature]-plan.md`). The PRD
   claims the next unused number; the plan reuses it. `0000` is the system foundation.
   Full rules: "Naming Convention" in `docs/documentation-standard.md`.
3. **Database is the rule authority:** all writes go through RPCs; the actor is
   always the signed-in user (`auth.uid()` → `_require_actor()`), never a parameter.
   Never write tables directly from the UI. Every new table needs RLS and explicit grants. A rule change means a new
   migration, an update to the `src/domain/` mirror, and a passing `tests/db/parity.test.ts`.
4. **Migrations are append-only** once committed: add a new timestamped file in
   `supabase/migrations/` instead of editing an old one. Supabase-only statements
   (roles, RLS, grants) stay guarded so migrations still run in PGlite.
5. **Git:** feature branches `feature/NNNN-<slug>` off `dev`; Conventional Commits.
   Do not push, merge, or squash unless the user asks.
6. **Build the real thing:** where the brief allows a mock or shortcut (e.g. mock
   login), implement the production-grade version.

## Domain Rules

1. Order lifecycle, roles, and permissions: `docs/prd/0000-system-foundation-prd.md`
   and current behavior in `docs/0000-system-foundation-workflow.md`.
2. Final amount = quoted price + extra charges; payment status is derived from
   payments (never stored).
3. Malaysia time (UTC+8), weeks Monday–Sunday, currency MYR.
4. AI features read data only through controlled, whitelisted queries.
5. Phone numbers are Malaysian mobile or landline, stored as digits with the
   country code (`60123456789`); quoted price is RM 0 – 100,000 with 2 decimals.
   Admin portal behavior: `docs/0001-admin-order-portal-workflow.md`.
6. Technician portal behavior: `docs/0002-technician-job-portal-workflow.md`.
   Job files (max 6 per order; photo 10 MB, video 50 MB, PDF 10 MB) are
   uploaded to Storage, then registered by RPC; they change only while the job
   is In Progress. Extra charges follow the money rule and need remarks;
   non-cash payments need a receipt; payments carry a one-time client key.
7. Customer WhatsApp message: `docs/0003-whatsapp-notification-workflow.md`.
   A database trigger prepares it whenever an order reaches Job Done (English,
   Malaysia time); it is sent by `wa.me` deep link and confirmed by a person.
   Editable until confirmed; a confirmed message never changes and messages
   are never deleted (cleanup must disable `customer_messages_guard_trg`).
8. Review and close: `docs/0004-review-and-close-workflow.md`. A Manager
   covers their home branch plus `staff.additional_branch_ids` and sees and
   acts only on those branches; every branch needs an active covering
   Manager before it has other staff or orders (checked at commit). Approve
   needs the customer told; Close needs full payment and every non-cash
   payment verified by Finance. Staff and branch cover change by SQL until
   0006 `staff-management`.
9. Customer feedback: `docs/0005-customer-feedback-workflow.md`. Each WhatsApp
   Job Done message gets a random token; the text sent ends with a fixed
   `Leave feedback: <address>/f/<token>` line. The public page at `/f/:token`
   needs no sign-in; signed-out visitors may call only `feedback_form` and
   `submit_feedback`. One feedback per visit, link valid 7 days; 1–2 stars or
   "not working" alerts covering Managers; landline ratings are recorded by an
   Admin or covering Manager. The link address is
   `app_settings.feedback_link_base` (local until 0010). Feedback rows are
   never changed or deleted (cleanup must disable `customer_feedback_guard_trg`).

## Environment And Secrets

- `.env.local` (git-ignored); template in `.env.example`.
  - Browser: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (publishable or legacy
    anon key). Without them the app shows a setup notice.
  - Script only: `SUPABASE_SECRET_KEY` (`sb_secret_…`) and `STAFF_DEMO_PASSWORD`.
    Never prefix these with `VITE_`; never read or print them in agent output.

## Testing And Definition Of Done

- `npm test`, `npm run typecheck`, and `npm run build` must pass for touched code.
- Treat tests as part of implementation, not a follow-up task.
- Never rewrite intent docs (PRDs/plans) during coding — record divergences in
  `docs/decisions/` instead.
- After a coding task, run the session-close checklist in `docs/documentation-standard.md`
  and keep `docs/reference/` in sync with structural changes.
- Mark a roadmap item `shipped` only when its deliverables and acceptance criteria are
  fully implemented and passing.

## Operational Notes

- Hosted Supabase project (Singapore). Public sign-up must stay OFF; staff accounts
  are created only by `npm run auth:create-staff-logins`.
- Demo staff emails are `<name>@sejuk.example.com` (see `supabase/seed.sql`).
- `docs/draft/` is local-only and partly ignored via `.git/info/exclude`.
- Storage files cannot be deleted with SQL (Supabase blocks it); remove test
  files in the dashboard (Storage → `job-files`). Hosted SQL for each feature
  lives in `docs/draft/NNNN-supabase-update.sql`.
