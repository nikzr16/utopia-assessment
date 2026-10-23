# 0000 - System Foundation Workflow

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

How a service order moves from creation to closing, who may move it at each
step, and what the system records along the way. Every module (0001–0009)
writes through this workflow.

## Trigger

A signed-in staff member's screen calls one of the database functions (RPCs)
in `supabase/migrations/20261022000002_foundation_rules.sql`. Supabase sends
the user's session token; the RPC takes no actor parameter.

## Preconditions

- The caller is signed in (Supabase Auth) and their account is linked to an
  active staff row. `_require_actor()` enforces this for every RPC.
- For order actions, the order exists; it is row-locked for the duration of the call.

## Stages

### 0. Account provisioning (setup, not per request)

**Input:** Seeded staff rows with emails; `SUPABASE_SECRET_KEY` and `STAFF_DEMO_PASSWORD` in `.env.local`.
**Actions:** `npm run auth:create-staff-logins` creates a confirmed Supabase Auth account per active staff email (`--reset-passwords` updates existing ones). The `auth.users` trigger and `link_staff_accounts()` set `staff.auth_user_id` by case-insensitive email, for confirmed emails only.
**Output:** Every active staff member can sign in. Public sign-up is turned off in the Supabase dashboard.
**On failure:** The script prints email → created/existing → linked and exits non-zero if any account failed or is unlinked.

### 1. Sign in

**Input:** Email and password on the sign-in screen.
**Actions:** `supabase.auth.signInWithPassword`; then `current_staff()` loads the signed-in user's active staff profile and branch.
**Output:** Header shows "Signed in as <name> (<Role>, <Branch>)" with Sign out; the role's home screen renders. Supabase keeps the session across reloads.
**On failure:** Wrong credentials → "Email or password is incorrect". No active staff profile → message with Sign out. Profile fails to load → "Could not load your profile" with Try again / Sign out.

### 2. Create order — `create_order`

**Input:** Branch, customer name / phone / address, problem description, service type, quoted price, optional scheduled date, admin notes, optional technician.
**Actions:** Admin only. Validates required fields, branch, active service type, technician, Malaysian phone, and quoted price (RM 0 – 100,000, 2 decimals; since 0001). Stores the phone normalised (`60…`). Inserts the order with the next order number.
**Output:** Status `new`, or `assigned` when a technician was chosen. Audit `created`. Technician notified when assigned.
**On failure:** Plain-language error; nothing written.

### 2a. Edit details — `update_order` (0001)

Admin only, while `new`, `assigned`, or `acknowledged`; audited as `updated`
with old and new values; the assigned technician gets an `order_updated`
notification. Details: `docs/0001-admin-order-portal-workflow.md`.

### 3. Assign or reassign — `transition_order(…, 'assigned', …, technician)`

**Actions:** Admin only, from `new` (assign) or `assigned` / `acknowledged` (reassign, must be a different technician).
**Output:** Status `assigned`. Audit `assigned` or `reassigned` (previous and new technician in details). New technician notified; on a reassign the previous technician gets `reassigned_away` (since 0002).

### 4. Acknowledge and start — `transition_order(…, 'acknowledged' | 'in_progress')`

**Actions:** Assigned technician only. `assigned` → `acknowledged` → `in_progress`, or `assigned` → `in_progress` directly.
**Output:** Audit `acknowledged` / `started`.

### 5. Submit completion — `submit_completion`

**Input:** Work done, extra charges (RM 0.00 – 100,000.00, at most 2 decimals; empty = 0; since 0002), remarks (required when extra charges > 0; since 0002).
**Actions:** Assigned technician only, while `in_progress`. Upserts the completion record and moves the order to `job_done` in one transaction (a reworked job overwrites its completion record).
**Output:** Status `job_done`. Audit `completion_submitted`. Every Manager covering the order's branch notified (home or additional branch, since 0004). The customer message is prepared in the same transaction (0003 trigger; `docs/0003-whatsapp-notification-workflow.md`).

### 6. Record payment — `record_payment`

**Input:** Amount (> 0), method (cash, bank transfer, card, e-wallet), note; since 0002 also a client key and a receipt path (and file name).
**Actions:** Assigned technician or Finance, while `in_progress`, `job_done`, or `reviewed`. A client key already used by the same person on the same order returns that payment unchanged (retry-safe). Bank transfer, card and e-wallet need a receipt: a photo or PDF already uploaded to `job-files/<order>/receipts/…`, saved as an `attachments` row with the payment in the same transaction.
**Output:** Payment row; audit `payment_recorded` (no from / to status; `receipt` flag in details). Payment status recalculates in `order_summary`. When a technician records it, every active Finance user gets `payment_recorded` (since 0002).

### 6a. Job files — Storage + `add_attachment` / `remove_attachment` (0002)

The assigned technician or an Admin uploads job files to the private
`job-files` bucket while the order is `in_progress`, then registers them;
details in `docs/0002-technician-job-portal-workflow.md`.

### 7. Review or return — `transition_order(…, 'reviewed' | 'in_progress')`

**Actions:** Manager only, from `job_done`, and (since 0004) only a Manager covering the order's branch. Returning for rework requires a review note. Approving requires the latest customer message to be sent or told by phone (0004).
**Output:** `reviewed` → every active Finance user notified, and the technician gets `job_approved` (0004). Rework → `in_progress`, technician notified with the note. Screens: `docs/0004-review-and-close-workflow.md`.

### 8. Close — `transition_order(…, 'closed')`

**Actions:** Finance only, from `reviewed`, only when payment status is `paid`, and (since 0004) only when every non-cash payment is verified (`verify_payment`).
**Output:** Status `closed` (terminal). Audit `closed`. The technician gets `job_closed` (0004).

### 9. Cancel — `transition_order(…, 'cancelled', reason)`

**Actions:** Admin only, from `new`, `assigned`, or `acknowledged`; reason required.
**Output:** Status `cancelled` (terminal). Audit `cancelled`. The assigned technician, if any, gets `cancelled` with the reason (since 0002).

### Side flow: Reschedule — `reschedule_order`

**Input:** New date (empty = postponed with no date), reason, requested by (customer / technician / admin), note.
**Actions:** Admin, or the assigned technician, while `new`, `assigned`, `acknowledged`, or `in_progress`. Reason `other` requires a note.
**Output:** `orders.scheduled_at` updated, a row in `order_reschedules`, audit `rescheduled`. Status unchanged.

### Read paths

All reads require a signed-in user with an active staff profile (row-level security).

- `order_summary` view: order plus branch, service type, technician, extra charges, final amount, amount paid, balance, payment status. Technicians see only their own orders; Managers the branches they cover (0004); Admins and Finance all.
- `order_review_summary` view, `manager_orders`, `finance_orders`, `covered_branches` (0004): review and close screens; `docs/0004-review-and-close-workflow.md`.
- `technician_jobs()`: the signed-in technician's `order_summary` rows.
- `my_jobs(p_view)` (0002): the signed-in technician's jobs for one job-list tab (`open`, `submitted`, `finished`).
- `current_staff()`: the signed-in user's staff profile with branch name.
- `list_orders(...)`, `technician_options()` (0001): Admin portal list and technician dropdown, under RLS.
- `notifications` table: each user sees only their own; `mark_notification_read` sets `read_at` for the recipient only; `mark_all_notifications_read` (0002) marks all of the caller's. The table is in the `supabase_realtime` publication (0002), so changes stream to the recipient under the same row-level security.
- `job-files` Storage objects (0002): readable by whoever can read the order.

## Error States

| Error | Cause | Handling |
|---|---|---|
| "You must be signed in" | RPC called without a session | Rejected, nothing written |
| "Your account has no active staff profile" | Signed-in account not linked to an active staff row | Rejected, nothing written |
| "Only <role> can <action>" | Actor's role is not allowed for that move | Rejected, nothing written |
| "Only the assigned technician can <action>" | A different technician tried a technician step | Rejected |
| "An order cannot change from X to Y" | Transition not in `order_status_transitions` | Rejected |
| "<order> is Closed/Cancelled and can no longer be changed" | Order is terminal | Rejected |
| "A reason is required to cancel an order" / "A review note is required…" | Missing note on cancel or rework | Rejected |
| "Order must be fully paid before closing (outstanding balance RM x)" | Close with payment status not `paid` | Rejected |
| "Choose a different technician to reassign this order" | Reassign to the same technician | Rejected |
| "Submit the completion record to mark a job as done" | `transition_order` called with `job_done` | Rejected; use `submit_completion` |
| Order number change | Any update to `order_no` | Rejected by trigger |
| More than 6 completion attachments | Seventh attachment on an order | Rejected by trigger |
| "Explain the extra charges in the remarks" | Extra charges > 0 without remarks (0002) | Rejected |
| "Attach a receipt for bank transfer, card or e-wallet payments" | Non-cash payment without a receipt (0002) | Rejected |
| "Only a Manager of <branch> can …" | Manager not covering the order's branch (0004) | Rejected |
| "Tell the customer the job is done before approving" | Approve with the customer message not sent (0004) | Rejected |
| "Verify every receipt before closing (N not verified yet)" | Close with unverified non-cash payments (0004) | Rejected |
| "<branch> has no Manager. Add a Manager to this branch first." | Staff or order change leaving a branch without a covering Manager (0004) | Rejected |

## Defaults

| Setting | Default |
|---|---|
| Order number | `ORDER` + sequence starting at `1001` |
| New order status | `new` (or `assigned` with a technician) |
| Extra charges | 0 |
| Final amount | quoted price + extra charges (derived) |
| Payment status | `paid` when amount paid ≥ final amount (including zero-amount orders), `partial` when 0 < paid < final, else `unpaid` |
| Time zone / week | Malaysia, UTC+8; weeks run Monday–Sunday (`src/domain/week.ts`) |
| Currency | MYR |
| Completion attachments | Max 6 per order (receipts not counted) |
| Extra charges | RM 0.00 – 100,000.00, at most 2 decimals (0002) |

## Behavioral Constraints

- All writes go through the RPCs; no role has direct write access to any table.
- The actor is always `auth.uid()` resolved to a staff row; nothing the client sends can change who acts.
- Signed-out (`anon`) requests can read nothing and execute nothing.
- Allowed transitions are data in `order_status_transitions`; `src/domain/transitions.ts` mirrors them for the UI and `tests/db/parity.test.ts` keeps both identical.
- Every status change, payment, and reschedule writes one `audit_log` row with actor and role.
- Only confirmed emails are linked to staff profiles; public sign-up is off.

## Related Documents

| Document | Type | Relationship |
|---|---|---|
| `docs/prd/0000-system-foundation-prd.md` | Intent | Product goals this workflow fulfills |
| `docs/plan/0000-system-foundation-plan.md` | Plan | Architecture this workflow implements |
| `docs/reference/folder-structure.md` | Reference | File locations of workflow components |
| `docs/decisions/0001-zero-amount-order-payment-status.md` | Decision log | Zero-amount orders count as paid |
| `docs/decisions/0002-technician-jobs-function.md` | Decision log | `technician_jobs` read function |
| `docs/decisions/0003-reschedule-and-payment-guards.md` | Decision log | Reschedule and payment guards |
| `docs/decisions/0004-real-authentication-replaces-mock-login.md` | Decision log | Real Supabase Auth replaces the mock login |
| `docs/decisions/0005-auth-implementation-hardening.md` | Decision log | Confirmed-email linking, script and app safeguards |
| `docs/0001-admin-order-portal-workflow.md` | Workflow | Admin portal built on these RPCs (edit, list, phone and price rules) |
| `docs/0002-technician-job-portal-workflow.md` | Workflow | Technician portal: job files, retry-safe payments, notifications |
| `docs/0003-whatsapp-notification-workflow.md` | Workflow | Customer message prepared on Job Done |
| `docs/0004-review-and-close-workflow.md` | Workflow | Manager review, Finance verification and close, branch cover |
| `docs/decisions/0007-technician-job-portal-implementation-details.md` | Decision log | 0002 divergences from its plan |
