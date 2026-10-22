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
and including feature 0003 (WhatsApp notification).

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
│   ├── App.tsx                 App shell (BrowserRouter): setup notice → sign-in → Admin portal, Technician portal, or role home
│   ├── index.css               Tailwind entry
│   ├── components/             Shared UI: AppHeader, RoleHome, SetupNotice, Notice, Field, Dialog, StatusBadge, RescheduleDialog, styles
│   ├── domain/                 Pure business rules mirrored from the database
│   ├── features/auth/          Supabase Auth: session context, sign-in form, staff profile
│   ├── features/orders/        Admin order portal (0001): routes, pages, dialogs, data access; Completion section (0002)
│   ├── features/jobs/          Technician job portal (0002): job list, job page, completion and payment forms
│   ├── features/attachments/   Job files and receipts in Supabase Storage (0002): uploader, gallery, payments list
│   ├── features/notifications/ In-app notifications (0002): live unread count, bell, list
│   ├── features/customer-messages/ Customer WhatsApp message on Job Done (0003): panel, not-told badge, data access
│   └── lib/                    Supabase client and config, shared API plumbing, order records, hooks, drafts
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
| `price.ts` (0002) | Also `parseExtraCharges` (mirror of `_check_extra_charges`); both share one money parser |
| `completionForm.ts` | Completion form values, validation (work done, extra charges, remarks rule), live final amount, rework pre-fill |
| `attachments.ts` | Job-file types, kinds and size limits (mirror of `_job_file_kind`), storage paths (mirror of `_job_file_order`), who may change files / add receipts (mirror of `_job_file_write_error`), photo resize sizing, file sizes |
| `paymentForm.ts` | Payment method labels, receipt rule, form validation, over-balance amount, `canRecordPayment` |
| `customerMessages.ts` | 0003: customer message channels, states and audit actions, `CUSTOMER_MESSAGE_STATUSES` (Job Done / Reviewed / Closed), edited-text rule (mirror of `_check_customer_message_body`), `canManageCustomerMessage`, `customerNotTold`, send / call / edit rules, "Sent by" / "Edited by" labels |
| `jobs.ts` | Job list tabs and statuses (mirror of `my_jobs`), Malaysia-day grouping (Overdue / Today / Upcoming / No date), area, `tel:` / maps links, customer WhatsApp greeting, notification events (mirror of the event check) and labels |
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
| `api.ts` | All portal database calls (RPCs and reads), row types; re-exports `ApiError` / `toApiError` / `OrderSummary` and `fetchOrderRecords` from `src/lib/` |
| `OrderListPage.tsx` | Search, filters, pagination over `list_orders`; `toListQuery` maps URL params |
| `NewOrderPage.tsx`, `EditOrderPage.tsx` | Create / edit pages around `OrderForm` |
| `OrderForm.tsx`, `TechnicianSelect.tsx` | Shared order form; technician dropdown grouped by branch with open-job counts |
| `OrderDetailPage.tsx` | Summary, WhatsApp, actions, history, banners (`?created`, `?updated`, `?action=reschedule`); Customer message panel (0003), which reloads the history |
| `OrderSummaryCard.tsx`, `OrderHistory.tsx`, `WhatsAppButton.tsx` | Detail page parts (history names payment methods, receipts, file events, and 0003 customer message events) |
| `CompletionSection.tsx` | 0002: technician's record, job files (Admin add / remove while In Progress), payments with receipts; `COMPLETION_STATUSES` |
| `actions/AssignDialog.tsx`, `CancelDialog.tsx` | Assign / reassign and cancel dialogs |
| `actions/RescheduleDialog.tsx` | Wraps the shared `components/RescheduleDialog.tsx` with `rescheduleOrder` |
| `index.ts` | Barrel export |

## Technician Job Portal (`src/features/jobs/`)

| File | Purpose |
|---|---|
| `TechnicianPortal.tsx` | Wraps the portal in `NotificationsProvider`; nav (My jobs, Notifications); routes `/jobs`, `/jobs/:orderNo`, `/jobs/:orderNo/complete`, `/jobs/:orderNo/payment`, `/notifications` (others → `/jobs`) |
| `api.ts` | `fetchMyJobs`, `fetchJob` (order + `fetchOrderRecords`), `acceptJob`, `startJob`, `rescheduleJob`, `submitCompletion`, `recordPayment`; `JobDetail` |
| `JobListPage.tsx`, `JobCard.tsx` | Tabs from `?tab=`, Open grouped by Malaysia day, cards; `toJobView`; Submitted cards show "Customer not told yet" (0003) |
| `JobPage.tsx`, `ContactLinks.tsx` | Customer message panel (0003), job details, Call / WhatsApp / Maps, rework and cancelled banners, files, record, payments, sticky actions, start confirmation, banners (`?submitted`, `?paid`) |
| `CompletionPage.tsx` | Brief completion form with live final amount, files, draft, no-photos confirmation, single submit, lost-answer recovery |
| `PaymentPage.tsx` | Payment form: receipt upload, one-time client key in the draft, over-balance confirmation |
| `index.ts` | Barrel export |

## Job Files (`src/features/attachments/`)

| File | Purpose |
|---|---|
| `api.ts` | `fetchJobFiles`, `fetchReceipts`, `signedUrls` (1 hour), `uploadFile` (409 = already uploaded), `deleteStoredFile`, `addAttachment`, `removeAttachment`; `Attachment` |
| `resize.ts` | `preparePhoto`: canvas resize of large JPEG / PNG / WebP to 2048 px JPEG; injectable `PhotoCodec` |
| `JobFiles.tsx` | Uploader: pick → prepare → upload → register, one at a time, Retry / Remove, 6-file room; reports `JobFilesStatus` to the form |
| `FileGallery.tsx` | Tiles with signed links; photo thumbnails, video / PDF tiles; Remove with confirm |
| `ReceiptLink.tsx`, `PaymentList.tsx` | Receipt link via signed URL; payments list used by the job page and the Admin Completion section |
| `index.ts` | Barrel export |

## Notifications (`src/features/notifications/`)

| File | Purpose |
|---|---|
| `api.ts` | `fetchNotifications` (50 latest, with order number), `fetchUnreadCount`, `markNotificationRead`, `markAllNotificationsRead`, `subscribeToNotifications` (Realtime, filtered to the recipient) |
| `NotificationsProvider.tsx` | Unread count and a version for lists; live updates and refresh on return; `useNotifications` |
| `NotificationBell.tsx` | Nav link with unread badge (reusable by other portals) |
| `NotificationsPage.tsx` | List, open job and mark read, Mark all as read |
| `index.ts` | Barrel export |

## Customer Messages (`src/features/customer-messages/`)

| File | Purpose |
|---|---|
| `api.ts` | `fetchLatestCustomerMessage`, `fetchLatestCustomerMessages` (from `latest_customer_messages`), `editCustomerMessage`, `confirmCustomerMessage` |
| `CustomerMessagePanel.tsx` | Panel for the job page and Admin order detail: message, Show original, edit form, Send on WhatsApp / Call, "Have you sent it?" question, "Sent by" state; `onChange` after writes; `CustomerNotToldBadge` |
| `index.ts` | Barrel export |

## Shared Plumbing (`src/lib/`)

| File | Purpose |
|---|---|
| `supabase.ts`, `supabaseConfig.ts` | Supabase client and config detection |
| `api.ts` | `ApiError`, `toApiError`, `NETWORK_ERROR_MESSAGE` / `isNetworkError`, `client`, `run`, `OrderSummary` / `toOrderSummary` |
| `orderRecords.ts` | `fetchOrderRecords`: completion record, payments with receipts, latest rework note |
| `useLoad.ts` | Load-on-key hook with reload; ignores stale responses (moved from `features/orders/`) |
| `useRefreshOnReturn.ts` | Calls a refresh when the page becomes visible or the connection returns |
| `drafts.ts` | Form drafts in `localStorage` (`sejuk-draft:` prefix); `clearAllDrafts` on sign-out |

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
| `migrations/20261022000006_technician_job_portal.sql` | 0002: `attachments.file_name` / `size_bytes` / unique `storage_path`, `payments.client_key` (unique); `_check_extra_charges`, `_job_file_order`, `_job_file_is_receipt`, `_job_file_write_error`, `_job_file_kind`, `_job_file_object`, `_can_access_job_file` (storage policy helper), `_payment_method_label`; `add_attachment`, `remove_attachment`; `record_payment` recreated (client key, receipt); `submit_completion` and `transition_order` replaced (same signatures); `mark_all_notifications_read`, `my_jobs`; notification events `cancelled`, `reassigned_away`, `payment_recorded`; guarded: `job-files` bucket + `storage.objects` policies, `supabase_realtime` publication |
| `migrations/20261023000001_whatsapp_notification.sql` | 0003: `_is_my_mobile`, `_malaysia_date_time`, `_customer_job_done_message`, `_check_customer_message_body`; `customer_messages` table with checks and `customer_messages_guard_trg` (no deletes, confirmed rows frozen); `orders_customer_message_trg` (Job Done → message); backfill for orders already Job Done / Reviewed / Closed; `edit_customer_message`, `confirm_customer_message`; `latest_customer_messages` view; RLS (assigned technician, Admins); grants |
| `seed.sql` | 5 branches, service types, staff with `@sejuk.example.com` emails (incl. Ali, John, Bala, Yusoff); no auth accounts |

### Tables

`branches`, `staff`, `service_types`, `orders`, `order_completions`,
`attachments`, `payments`, `order_reschedules`, `audit_log`, `notifications`,
`order_status_transitions`, `customer_messages` (0003). Views: `order_summary`,
`latest_customer_messages` (0003).

### RPCs

`create_order`, `update_order`, `transition_order`, `submit_completion`,
`record_payment`, `reschedule_order`, `mark_notification_read`,
`mark_all_notifications_read`, `add_attachment`, `remove_attachment`,
`technician_jobs`, `my_jobs`, `current_staff`, `edit_customer_message`,
`confirm_customer_message` (no actor parameter; actor =
signed-in user). Read functions (security invoker, RLS applies):
`list_orders`, `technician_options`. Storage policy helper for
`authenticated`: `_can_access_job_file`. Service-role only:
`link_staff_accounts`.

Triggers on `orders` (0003): `orders_customer_message_trg` prepares the
customer message when the status becomes `job_done`.

Notification events: `assigned`, `job_done`, `rework`, `reviewed`,
`order_updated`, `cancelled`, `reassigned_away`, `payment_recorded`.

### Storage

Private bucket `job-files` (50 MB per file; JPEG, PNG, WebP, HEIC/HEIF, MP4,
MOV, WebM, PDF). Paths: `<order_id>/<uuid>.<ext>` (job files) and
`<order_id>/receipts/<uuid>.<ext>` (receipts). Policies `job_files_read`,
`job_files_upload`, `job_files_delete` on `storage.objects` call
`_can_access_job_file(name, 'read' | 'upload' | 'delete')`.

## Tests (`tests/`)

| File | Covers |
|---|---|
| `db/helpers.ts` | Fresh PGlite database per file: Supabase shim (`auth` schema, `auth.uid()`, roles, `storage.buckets` / `storage.objects` with RLS and the delete guard), migrations in filename order, seed; act-as / signed-out helpers; upload / Storage-API delete helpers; `holdBackMigrations` / `applyMigration` to seed data before a migration runs (0003 backfill) |
| `db/seed.test.ts` | AC1 |
| `db/auth.test.ts` | AC2, AC16, AC17, account linking, `current_staff()` |
| `db/audit.test.ts` | AC2 (actor recorded), AC12 |
| `db/transitions.test.ts` | AC3–AC8 |
| `db/money.test.ts`, `domain/money.test.ts` | AC9, AC10 |
| `db/reschedule.test.ts` | AC11 |
| `db/notifications.test.ts` | AC13 |
| `db/orders.test.ts` | AC14, AC15 |
| `db/parity.test.ts` | TS mirrors equal the database: transitions, enums, phone and price rules (shared case tables), editable and reschedulable statuses; 0002: extra charges, completion form, file types / sizes / paths, who may change files, payment methods / labels / receipt rule / statuses, job list tabs, notification events; 0003: `isMyMobile` = `_is_my_mobile`, Malaysia time format, edited-text rule, customer message states and statuses |
| `db/storage.test.ts` | 0002 AC7: `job-files` bucket and the read / upload / delete policies by role, status and path |
| `db/technician-jobs.test.ts` | 0002 AC6, AC8, AC10, AC16: `add_attachment`, `remove_attachment`, `record_payment` (client key, receipt), extra charges, cancel / reassign / payment notifications, `mark_all_notifications_read`, `my_jobs`, Realtime publication |
| `db/customer-messages.test.ts` | 0003 AC1, AC2, AC5–AC7, AC9: Job Done trigger and wording, rework, backfill, `edit_customer_message`, `confirm_customer_message` (who, when, newest only, first wins), guard trigger, RLS |
| `ui/customer-message.test.tsx` | 0003 AC3–AC8, AC10: panel states, edit, Send / Call questions, errors, badge on Submitted cards, phone-width classes |
| `db/admin-orders.test.ts` | 0001 AC4, AC5, AC8, AC10, AC11: phone / price rules, `update_order`, `list_orders`, `technician_options` |
| `ui/*.test.tsx` | 0001 AC1–AC3, AC6, AC7, AC9, AC12, AC13: portal access, form, summary, WhatsApp link, detail actions, list, edit |
| `ui/job-list.test.tsx`, `job-page.test.tsx`, `job-files.test.tsx`, `resize.test.ts`, `completion-form.test.tsx`, `payment-form.test.tsx`, `notifications.test.tsx`, `drafts.test.ts` | 0002 AC1–AC6, AC8–AC13, AC15: technician portal screens (api modules replaced by test doubles) |
| `db/access.test.ts` | RLS and grants under `authenticated` / `anon` (AC15, AC16, AC17) |
| `domain/*.test.ts`, `auth/*.test.ts`, `scripts/*.test.ts` | Unit tests for pure helpers |

## Wiring

- `App.tsx` wraps everything in `BrowserRouter`; an Admin gets `AdminPortal`,
  a Technician `TechnicianPortal` (with their staff id), other roles
  `RoleHome`. Screens call only their feature's `api.ts` (which builds on
  `src/lib/api.ts`).
- Job files go browser → Storage (`job-files`, policies decide) → RPC
  (`add_attachment` / `record_payment` read the stored object's real type and
  size). Viewing uses 1-hour signed URLs.
- `NotificationsProvider` subscribes to Realtime `postgres_changes` on
  `notifications` filtered to the staff id; RLS applies to the stream.
- The app reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (publishable
  or legacy anon key) in `src/lib/supabaseConfig.ts`. When either is missing,
  `App.tsx` renders `SetupNotice` instead of the app.
- `AuthProvider` wraps the app: it tracks the Supabase session, calls
  `current_staff()` after sign-in, and exposes sign in / sign out (sign-out
  first clears form drafts on the device). Supabase
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
| `docs/prd/0002-technician-job-portal-prd.md` | Intent | Technician job portal goals |
| `docs/0002-technician-job-portal-workflow.md` | Workflow | Technician portal runtime behavior |
| `docs/prd/0003-whatsapp-notification-prd.md` | Intent | Customer WhatsApp notification goals |
| `docs/0003-whatsapp-notification-workflow.md` | Workflow | Customer message runtime behavior |
| `docs/decisions/0001-*.md` – `0008-*.md` | Decision log | Structural changes that diverged from the plans |
