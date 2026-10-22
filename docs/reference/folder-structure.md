# Folder Structure Reference

> **Type:** Reference | **Must stay current:** Yes -- update when structure, routes, schemas, or config change

<!-- AI Context
Role: This document records structural facts about the codebase: files,
modules, routes, schemas, config, and their relationships.
Treat it as a lookup table. When creating or modifying files, routes, or
schemas, update this document before the coding session ends.
If this document conflicts with a PRD or plan, this document reflects the
current state; record the divergence in the decision log.
-->

## Overview

Where the application, database, tests, and docs live. Covers everything up to
and including feature 0001 (admin order portal).

## Directory Layout

```text
.
├── index.html                  Vite entry HTML
├── package.json                Scripts: dev, build, test, typecheck, auth:create-staff-logins
├── vite.config.ts              Vite + React + Tailwind + Vitest config
├── vercel.json                 SPA rewrite: every path serves index.html (deep links like /orders/ORDER1001)
├── tsconfig*.json              TypeScript project references (app, node + scripts, test incl. src + DOM + JSX)
├── .env.example                Env template → copy to .env.local (browser + script-only vars)
├── src/
│   ├── main.tsx                React root
│   ├── App.tsx                 App shell (BrowserRouter): setup notice → sign-in → Admin portal or role home
│   ├── index.css               Tailwind entry
│   ├── components/             Shared UI: AppHeader, RoleHome, SetupNotice, Notice, Field, Dialog, StatusBadge, styles
│   ├── domain/                 Pure business rules mirrored from the database
│   ├── features/auth/          Supabase Auth: session context, sign-in form, staff profile
│   ├── features/orders/        Admin order portal (0001): routes, pages, dialogs, data access
│   └── lib/                    Supabase client and config detection
├── scripts/
│   ├── create-staff-logins.ts  Creates/links Supabase Auth accounts for staff (secret key)
│   └── lib/                    Pure planning logic for the script
├── supabase/
│   ├── migrations/             Ordered SQL migrations (Supabase CLI layout)
│   └── seed.sql                Reference data and staff (with emails)
├── tests/
│   ├── domain/                 Unit tests for src/domain
│   ├── auth/                   Unit tests for auth helpers
│   ├── scripts/                Unit tests for the login script's planning logic
│   ├── ui/                     Component tests (jsdom + Testing Library; api.ts replaced by test doubles)
│   └── db/                     PGlite database tests (Supabase shim + migrations + seed)
└── docs/                       Roadmap, PRDs, plans, workflows, reference, decisions
```

## Domain (`src/domain/`)

| File | Purpose |
|---|---|
| `statuses.ts` | Order statuses, UI labels, terminal statuses |
| `transitions.ts` | TS mirror of `order_status_transitions` for deciding which actions to show |
| `money.ts` | `finalAmount`, `paymentStatus` |
| `week.ts` | Malaysia-time (UTC+8) Monday–Sunday week range |
| `phone.ts` | Malaysian phone rules: `normalizeMyPhone` (mirror of `_normalize_my_phone`), `formatMyPhone`, `isMyMobile` |
| `price.ts` | Quoted price rules: `parseQuotedPrice` (mirror of `_check_quoted_price`) |
| `orderEditing.ts` | `EDITABLE_STATUSES` / `canEditOrder` (mirror of `update_order`), `RESCHEDULABLE_STATUSES` / `canRescheduleOrder` (mirror of `reschedule_order`) |
| `orderForm.ts` | Order form values, validation, clean RPC input, `orderToFormValues` |
| `malaysiaTime.ts` | `datetime-local` ↔ UTC+8 instants, Malaysia day ranges, display formats |
| `whatsapp.ts` | Technician job message and `wa.me` URL |
| `index.ts` | Barrel export |

## Auth (`src/features/auth/`)

| File | Purpose |
|---|---|
| `AuthContext.ts`, `AuthProvider.tsx`, `useAuth.ts` | Supabase session, staff profile state, sign in / sign out |
| `SignInForm.tsx` | Email + password sign-in screen |
| `profile.ts` | `current_staff()` result → profile state (ready / no profile / error) |
| `errors.ts` | Maps Supabase auth errors to friendly messages |
| `index.ts` | Barrel export |

## Admin Order Portal (`src/features/orders/`)

| File | Purpose |
|---|---|
| `AdminPortal.tsx` | Admin navigation and routes: `/orders`, `/orders/new`, `/orders/:orderNo`, `/orders/:orderNo/edit` (others → `/orders`) |
| `api.ts` | All portal database calls (RPCs and reads), row types, `ApiError` / `toApiError` |
| `useLoad.ts` | Load-on-key hook with reload; ignores stale responses |
| `OrderListPage.tsx` | Search, filters, pagination over `list_orders`; `toListQuery` maps URL params |
| `NewOrderPage.tsx`, `EditOrderPage.tsx` | Create / edit pages around `OrderForm` |
| `OrderForm.tsx`, `TechnicianSelect.tsx` | Shared order form; technician dropdown grouped by branch with open-job counts |
| `OrderDetailPage.tsx` | Summary, WhatsApp, actions, history, banners (`?created`, `?updated`, `?action=reschedule`) |
| `OrderSummaryCard.tsx`, `OrderHistory.tsx`, `WhatsAppButton.tsx` | Detail page parts |
| `actions/AssignDialog.tsx`, `CancelDialog.tsx`, `RescheduleDialog.tsx` | Assign / reassign, cancel, reschedule dialogs |
| `index.ts` | Barrel export |

## Scripts (`scripts/`)

| File | Purpose |
|---|---|
| `create-staff-logins.ts` | `npm run auth:create-staff-logins`: Admin API with `SUPABASE_SECRET_KEY`; creates confirmed accounts for active staff (`--reset-passwords` to update), then `link_staff_accounts()` |
| `lib/plan-staff-logins.ts` | Pure logic: which accounts to create / update / skip |

## Database (`supabase/`)

| File | Purpose |
|---|---|
| `migrations/20261022000001_foundation_schema.sql` | Enums, tables, `order_no` sequence, immutability and attachment-limit triggers, `order_summary` view |
| `migrations/20261022000002_foundation_rules.sql` | `order_status_transitions` + rows, `_require_actor()` (from `auth.uid()`), internal `_` helpers, RPCs, execute lockdown |
| `migrations/20261022000003_auth_link.sql` | `auth.users` trigger and `link_staff_accounts()` linking confirmed accounts to staff by email |
| `migrations/20261022000004_access_policies.sql` | RLS on every table, `authenticated` read policies (technician scoping, own notifications), grants; nothing for `anon` |
| `migrations/20261022000005_admin_order_portal.sql` | 0001: `_normalize_my_phone`, `_check_quoted_price`, `_check_order_details`; `create_order` replaced (same signature); `update_order`; `list_orders`, `technician_options`; `order_updated` notification event; execute grants |
| `seed.sql` | 5 branches, service types, staff with `@sejuk.example.com` emails (incl. Ali, John, Bala, Yusoff); no auth accounts |

### Tables

`branches`, `staff`, `service_types`, `orders`, `order_completions`,
`attachments`, `payments`, `order_reschedules`, `audit_log`, `notifications`,
`order_status_transitions`. View: `order_summary`.

### RPCs

`create_order`, `update_order`, `transition_order`, `submit_completion`,
`record_payment`, `reschedule_order`, `mark_notification_read`,
`technician_jobs`, `current_staff` (no actor parameter; actor = signed-in user).
Read functions (security invoker, RLS applies): `list_orders`,
`technician_options`. Service-role only: `link_staff_accounts`.

Notification events: `assigned`, `job_done`, `rework`, `reviewed`,
`order_updated`.

## Tests (`tests/`)

| File | Covers |
|---|---|
| `db/helpers.ts` | Fresh PGlite database per file: Supabase shim (`auth` schema, `auth.uid()`, roles), migrations in filename order, seed; act-as / signed-out helpers |
| `db/seed.test.ts` | AC1 |
| `db/auth.test.ts` | AC2, AC16, AC17, account linking, `current_staff()` |
| `db/audit.test.ts` | AC2 (actor recorded), AC12 |
| `db/transitions.test.ts` | AC3–AC8 |
| `db/money.test.ts`, `domain/money.test.ts` | AC9, AC10 |
| `db/reschedule.test.ts` | AC11 |
| `db/notifications.test.ts` | AC13 |
| `db/orders.test.ts` | AC14, AC15 |
| `db/parity.test.ts` | TS mirrors equal the database: transitions, enums, phone and price rules (shared case tables), editable and reschedulable statuses |
| `db/admin-orders.test.ts` | 0001 AC4, AC5, AC8, AC10, AC11: phone / price rules, `update_order`, `list_orders`, `technician_options` |
| `ui/*.test.tsx` | 0001 AC1–AC3, AC6, AC7, AC9, AC12, AC13: portal access, form, summary, WhatsApp link, detail actions, list, edit |
| `db/access.test.ts` | RLS and grants under `authenticated` / `anon` (AC15, AC16, AC17) |
| `domain/*.test.ts`, `auth/*.test.ts`, `scripts/*.test.ts` | Unit tests for pure helpers |

## Wiring

- `App.tsx` wraps everything in `BrowserRouter`; an Admin gets `AdminPortal`,
  other roles `RoleHome`. Portal screens call only `src/features/orders/api.ts`.
- The app reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (publishable
  or legacy anon key) in `src/lib/supabaseConfig.ts`. When either is missing,
  `App.tsx` renders `SetupNotice` instead of the app.
- `AuthProvider` wraps the app: it tracks the Supabase session, calls
  `current_staff()` after sign-in, and exposes sign in / sign out. Supabase
  attaches the session token to every RPC, and the database resolves the actor
  from `auth.uid()`.
- `SUPABASE_SECRET_KEY` and `STAFF_DEMO_PASSWORD` are read only by
  `scripts/create-staff-logins.ts` (via `node --env-file=.env.local`); they are
  never `VITE_`-prefixed and never reach the browser bundle.
- The Supabase CLI applies `supabase/migrations/*` in filename order and then
  `supabase/seed.sql`; `tests/db/helpers.ts` does the same in PGlite.

## Related Documents

| Document | Type | Relationship |
|---|---|---|
| `docs/prd/0000-system-foundation-prd.md` | Intent | Product goals behind the structures documented here |
| `docs/plan/0000-system-foundation-plan.md` | Plan | Planned architecture these structures realize |
| `docs/0000-system-foundation-workflow.md` | Workflow | Runtime behavior that uses these structures |
| `docs/prd/0001-admin-order-portal-prd.md` | Intent | Admin order portal goals |
| `docs/0001-admin-order-portal-workflow.md` | Workflow | Admin portal runtime behavior |
| `docs/decisions/0001-*.md` – `0006-*.md` | Decision log | Structural changes that diverged from the plans |
