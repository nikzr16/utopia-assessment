# 0000 - System Foundation Implementation Plan

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

Build the shared foundation from `docs/prd/0000-system-foundation-prd.md`: a
Postgres schema (Supabase), the order lifecycle enforced inside the database,
real email/password authentication with Supabase Auth, row-level security,
seed data and staff sign-in accounts, a small TypeScript domain module the UI
uses, and a React app shell with a sign-in screen. No module screens
(0001–0009) are built here.

## Resolved PRD Open Questions

| PRD question | Resolution | Reason |
|---|---|---|
| Tech stack | Brief's preferred stack: React + TypeScript (Vite), Tailwind CSS, Supabase (Postgres + Auth + Storage), Vercel | Matches what the assessors asked for |
| Authentication | Real Supabase Auth (email + password). No mock login, no role switcher | A real internal tool must know who is acting; the brief's mock is a floor, not the target |
| Order number format | `ORDER` + sequence starting at `1001` (e.g. `ORDER1001`) | Matches the brief's sample and its AI output examples (`ORDER1234`) |
| Customer table or per order | Customer details stored on each order | The brief's form captures them per order; a customer list is not needed yet |
| Branch visibility | All signed-in non-technician staff see all branches; screens may filter by branch | Simplest; branch-based restriction is out of scope in the PRD |
| Reassign while In Progress | Not allowed; reassign only from Assigned / Acknowledged | Matches the PRD transition table; avoids two technicians on one live job |
| Overpayment | Counts as `paid`; the overpaid amount is visible in the order summary | Finance can still see it; automated flagging belongs to 0009 |
| Finance central or per branch | Central: Finance notifications go to every Finance user | One finance team is typical; branch is still on every order |
| Supabase project | Hosted Supabase project (Singapore region) | Created by the user; local Docker is not required |

## Technical Approach

- **The database is the single authority for rules.** All writes go through
  Postgres functions (RPCs). Each function checks the actor's role, the
  allowed transition, and the conditions, then writes the change, the audit
  entry, and any notifications in one transaction. Screens cannot bypass it.
- **The actor is the signed-in user.** RPCs take no actor parameter. One
  helper, `_require_actor()`, resolves `auth.uid()` to an active `staff` row
  and rejects the call otherwise ("You must be signed in", "Your account has
  no active staff profile"). Nothing the browser sends can change who acts.
- **Staff ↔ sign-in link.** `staff` has a unique `email` and a nullable
  `auth_user_id` referencing `auth.users(id)` (`on delete set null`). A
  trigger on `auth.users` links a new sign-in account to the staff row with
  the same email; the migration also links any accounts that already exist.
- **Row-level security.** Every table has RLS. Only the `authenticated` role
  gets read access, through policies that require an active staff profile.
  Technicians can read only orders assigned to them (and the rows hanging off
  those orders); notifications are readable by their recipient only. `anon`
  gets nothing. No role gets direct write access; all writes go through the
  SECURITY DEFINER RPCs.
- **Rules are data.** Allowed transitions live in `order_status_transitions`.
  The RPC reads it; the UI uses a TypeScript mirror to decide which buttons
  to show; a parity test keeps the two identical.
- **Money is derived in a view.** `order_summary` (security invoker, so RLS
  applies) computes final amount, amount paid, balance, and payment status.
- **Accounts are provisioned, not signed up.** Public sign-up is turned off in
  the Supabase dashboard. A Node script uses the Supabase Admin API with the
  secret key (read from `.env.local`, never bundled) to create a confirmed
  sign-in account for every seeded staff member.
- **Same migrations in Supabase and PGlite.** Tests prepare PGlite with a
  small shim that mirrors what Supabase provides: an `auth` schema with
  `auth.users` and `auth.uid()` (reading `request.jwt.claims` exactly like
  Supabase does) and the `anon` / `authenticated` / `service_role` roles. The
  migrations themselves contain no test-only code.

## System Components

| Component | Location | Responsibility |
|---|---|---|
| Schema migration | `supabase/migrations/20261022000001_foundation_schema.sql` | Enums, tables (incl. `staff.email`, `staff.auth_user_id`), constraints, `order_no` sequence, immutability triggers, `order_summary` view |
| Rules migration | `supabase/migrations/20261022000002_foundation_rules.sql` | Transition table + rows, `_require_actor()` from `auth.uid()`, RPCs, audit and notification writes, execute lockdown |
| Auth link migration | `supabase/migrations/20261022000003_auth_link.sql` | Trigger on `auth.users` linking accounts to staff by email; backfill for existing accounts |
| Access migration | `supabase/migrations/20261022000004_access_policies.sql` | RLS on every table, `authenticated` read policies (technician scoping, own notifications), grants, `EXECUTE` on RPCs; nothing for `anon` |
| Seed | `supabase/seed.sql` | Branches, service types, staff with emails (incl. Ali, John, Bala, Yusoff) |
| Staff login script | `scripts/create-staff-logins.ts` (`npm run auth:create-staff-logins`) | Creates or updates a confirmed Supabase Auth user for each active staff email; idempotent |
| Domain module | `src/domain/` | Status list and labels, transition mirror, `finalAmount`, `paymentStatus`, Malaysia-time week range |
| Supabase client | `src/lib/supabase.ts` | Client from `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`; reports missing config clearly |
| Auth | `src/features/auth/` | Auth session context, sign-in screen, current staff profile lookup, sign out |
| App shell | `src/App.tsx` | Setup notice → sign-in screen → header ("Signed in as …", Sign out) + placeholder home per role |
| Domain tests | `tests/domain/` | Unit tests for the domain module |
| Auth unit tests | `tests/auth/` | Unit tests for auth helpers (profile lookup states, error mapping) |
| Database tests | `tests/db/` | PGlite + Supabase shim; migrations + seed; every RPC rule and RLS policy |

### Data model

Enums: `staff_role` (admin, technician, manager, finance), `order_status`
(new, assigned, acknowledged, in_progress, job_done, reviewed, closed,
cancelled), `payment_method` (cash, bank_transfer, card, ewallet),
`reschedule_reason` (customer_not_home, parts_unavailable, weather,
technician_unavailable, other), `reschedule_party` (customer, technician,
admin), `attachment_kind` (photo, video, pdf).

| Table | Key columns |
|---|---|
| `branches` | `id`, `name` (unique) |
| `staff` | `id`, `name`, `email` (unique, case-insensitive), `phone`, `role`, `branch_id`, `active`, `auth_user_id` (unique, nullable, → `auth.users`) |
| `service_types` | `id`, `name` (unique), `active` |
| `orders` | `id`, `order_no` (unique, default from sequence, immutable), `branch_id`, `customer_name`, `customer_phone`, `customer_address`, `problem_description`, `service_type_id`, `quoted_price` (≥ 0), `assigned_technician_id`, `admin_notes`, `status`, `scheduled_at`, `created_by`, `created_at`, `updated_at` |
| `order_completions` | `order_id` (PK), `work_done`, `extra_charges` (≥ 0), `remarks`, `technician_id`, `completed_at` |
| `attachments` | `id`, `order_id`, `payment_id` (nullable), `kind`, `storage_path`, `mime_type`, `uploaded_by`, `created_at`; max 6 completion attachments per order (trigger) |
| `payments` | `id`, `order_id`, `amount` (> 0), `method`, `note`, `recorded_by`, `recorded_at` |
| `order_reschedules` | `id`, `order_id`, `old_scheduled_at`, `new_scheduled_at` (nullable), `reason`, `reason_note`, `requested_by`, `performed_by`, `created_at` |
| `audit_log` | `id`, `order_id`, `actor_id`, `actor_role`, `action`, `from_status`, `to_status`, `note`, `details` (jsonb), `created_at` |
| `notifications` | `id`, `recipient_id`, `order_id`, `event`, `message`, `read_at`, `created_at` |
| `order_status_transitions` | `from_status`, `to_status`, `actor_role`, `assigned_technician_only`, `note_required`, `paid_required` |

View `order_summary` (security invoker): every order column plus service type
name, technician name, branch name, `extra_charges`, `final_amount` (quoted +
extra), `amount_paid`, `balance`, `payment_status` (`unpaid` / `partial` /
`paid`).

### RPCs

The actor is always `_require_actor()` (the signed-in staff member).

| Function | Who | Effect |
|---|---|---|
| `create_order(…, p_technician_id)` | Admin | Inserts order as `new`, or `assigned` when a technician is given; audit; technician notification |
| `transition_order(p_order_id, p_to_status, p_note, p_technician_id)` | Per transition table | Validates and applies assign, reassign, acknowledge, start, review, return for rework, close, cancel; audit; notifications |
| `submit_completion(p_order_id, p_work_done, p_extra_charges, p_remarks)` | Assigned technician | Upserts the completion record and moves `in_progress` → `job_done` in one transaction |
| `record_payment(p_order_id, p_amount, p_method, p_note)` | Assigned technician or Finance | Adds a payment while the order is `in_progress`, `job_done`, or `reviewed`; audit |
| `reschedule_order(p_order_id, p_new_scheduled_at, p_reason, p_requested_by, p_note)` | Admin or assigned technician | Updates `scheduled_at`, writes a reschedule entry and audit; status unchanged |
| `mark_notification_read(p_notification_id)` | Recipient | Sets `read_at` |
| `technician_jobs()` | Technician | The signed-in technician's `order_summary` rows |
| `current_staff()` | Any signed-in user | The signed-in user's active staff profile with branch name (used by the app after sign-in) |

Rejections raise an exception with a plain-language message (for example
"Only Finance can close an order" or "Order must be fully paid before
closing").

Notifications: `assigned` → technician; `job_done` → managers of the order's
branch; returned for rework → technician; `reviewed` → all Finance users.

## Processing Flow

1. The user opens the app and signs in with email and password
   (`supabase.auth.signInWithPassword`). Supabase keeps the session.
2. The app calls `current_staff()`; no active profile → a clear message and
   sign out.
3. Screens call RPCs; Supabase sends the user's JWT, and `_require_actor()`
   resolves `auth.uid()` to the staff row.
4. The RPC loads the order, looks up the transition rule, and checks role,
   assignment, note, and payment conditions.
5. On success it updates the order, inserts the audit entry and notifications,
   and returns the updated row; on failure it raises a readable error and
   nothing is written.
6. Screens read from `order_summary` and `notifications`, filtered by RLS.

## Dependencies

| Dependency | Purpose |
|---|---|
| React, React DOM | UI |
| Vite + `@vitejs/plugin-react` | Dev server and build |
| TypeScript | Types across app, scripts, and tests |
| Tailwind CSS (`@tailwindcss/vite`) | Styling |
| `@supabase/supabase-js` | Database, Auth, and Admin API client |
| Vitest | Test runner |
| `@electric-sql/pglite` | Real Postgres in Node for database tests, no Docker needed |

## Implementation Phases

### Phase 1: Scaffold

Vite React TypeScript app at the repo root, Tailwind, Vitest, npm scripts
(`dev`, `build`, `test`, `typecheck`, `auth:create-staff-logins`),
`.env.example`.

### Phase 2: Domain module

`src/domain/` with statuses and labels, the transition mirror, money
helpers, and Malaysia-time week range, plus unit tests.

### Phase 3: Database

Four migrations and `supabase/seed.sql` as listed above.

### Phase 4: Database tests

PGlite harness with the Supabase shim that applies migrations and seed to a
fresh database per test file and can act as a given staff member (sets
`request.jwt.claims`) or as signed out. Tests mapped to the PRD acceptance
criteria, RLS tests run under the `authenticated` and `anon` roles, plus the
parity test between `src/domain` and `order_status_transitions`.

### Phase 5: Auth and app shell

Supabase client, auth context, sign-in screen, `current_staff()` lookup,
header with the signed-in staff member and Sign out, placeholder home per
role, clear setup message when env vars are missing, and the staff login
script.

## Testing Strategy

| PRD criterion | Test |
|---|---|
| 1 Seed data | `tests/db/seed.test.ts` |
| 2 Signed-in user is the actor | `tests/db/auth.test.ts`, `tests/db/audit.test.ts`; sign-in screen checked manually |
| 3, 4, 5 Allowed / rejected transitions | `tests/db/transitions.test.ts` |
| 6 Close requires Finance and `paid` | `tests/db/transitions.test.ts` |
| 7 Note / reason required | `tests/db/transitions.test.ts` |
| 8 Reassign behaviour | `tests/db/transitions.test.ts` |
| 9, 10 Final amount and payment status | `tests/domain/money.test.ts`, `tests/db/money.test.ts` |
| 11 Reschedule log | `tests/db/reschedule.test.ts` |
| 12 Audit entries | `tests/db/audit.test.ts` |
| 13 Notifications | `tests/db/notifications.test.ts` |
| 14 Order number | `tests/db/orders.test.ts` |
| 15 Technician reads own jobs only (RLS) | `tests/db/access.test.ts`, `tests/db/orders.test.ts` |
| 16 Signed-out gets nothing | `tests/db/access.test.ts`, `tests/db/auth.test.ts` |
| 17 No active staff profile | `tests/db/auth.test.ts`, `tests/db/access.test.ts` |
| Account ↔ staff linking | `tests/db/auth.test.ts` |
| Rules parity | `tests/db/parity.test.ts` |

`npm test` must pass and `npm run typecheck` / `npm run build` must succeed.

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| PGlite differs from hosted Postgres / Supabase | Tests pass locally but a migration fails on Supabase | Shim mirrors Supabase's `auth.uid()` and roles exactly; verify on the hosted project before shipping |
| Trigger on `auth.users` | Supabase upgrades or permissions could break linking | Trigger function is small and SECURITY DEFINER; the login script also verifies every staff row is linked |
| Secret key misuse | Full database access if exposed | Only read by the Node script from `.env.local` (git-ignored), never `VITE_`-prefixed, never bundled |
| TS transition mirror drifts from the database | UI shows buttons the database rejects | Parity test fails the build on any mismatch |
| Public sign-up left on | Strangers create accounts | They still get no staff profile, so RLS and `_require_actor()` give them nothing; the setup guide turns sign-up off |

## Roadmap Phase

**Phase:** 1 – Foundation

## Related Documents

| Document | Type | Relationship |
|---|---|---|
| `docs/product-roadmap.md` | Roadmap | Phase assignment and sequencing for this plan |
| `docs/prd/0000-system-foundation-prd.md` | Intent | Product goals and constraints this plan implements |
| `docs/0000-system-foundation-workflow.md` | Workflow | Runtime behavior derived from this plan |
| `docs/reference/folder-structure.md` | Reference | Structural placement of planned components |
| `docs/decisions/NNNN-*.md` | Decision log | Divergences from this plan |

## Open Questions

- None.
