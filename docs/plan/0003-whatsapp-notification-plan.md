# 0003 - WhatsApp Notification Implementation Plan

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

Build the customer WhatsApp notification from
`docs/prd/0003-whatsapp-notification-prd.md` on top of 0000–0002. One new
migration adds a `customer_messages` table, a database trigger that writes the
customer message whenever an order reaches Job Done, RPCs to edit the message
before sending and to confirm "Yes, I sent it" / "Yes, I told them by phone",
a read for the latest message per order, and a backfill for orders already
past Job Done. A shared Customer
message panel shows the Send (or Call) button, the edit box, the confirmation
dialog, and the sent state on the technician's job page and the Admin order
detail; the job card gets a "Customer not told yet" badge.

One plan answer extends the approved PRD: editing the message before
sending (P2). It is recorded in the decision log at Step 6. Once confirmed,
a message stays sent; there is no undo (P5, PRD Q2).

## Technical Approach

- **The database stays the rule authority.** The message is created, worded,
  edited, and confirmed in SQL. The screen only shows what the
  database returns and builds the `wa.me` link from the stored number and
  text.
- **Back-end trigger (P1).** An `after update of status on orders` trigger
  runs when `new.status = 'job_done'` and `old.status <> 'job_done'`. It reads
  the order, its `order_completions` row (completion time, technician), and
  the technician's name, and inserts one `customer_messages` row in the same
  transaction as `submit_completion`. A rework resubmission reaches Job Done
  again and gets a new row (PRD Q4).
- **Message text in one place (P2).** `_customer_job_done_message(...)`
  builds the brief's English wording:
  `Hi {customer}, Job {order_no} has been completed by Technician {name} at {time}. Please check and leave feedback. Thank you!`
  The time is the completion time in Malaysia time (`Asia/Kuala_Lumpur`),
  formatted like the app's `formatMalaysiaDateTime`, e.g.
  `Thu 22 Oct 2026, 3:15 PM` (P7). The prepared text is stored on the row and
  never changes (`prepared_body`); the text that will be sent is `body`.
  0008 adds the feedback link to this function later.
- **Edit before sending (P2).** `edit_customer_message(p_message_id, p_body)`:
  - caller is the order's assigned technician or an Admin;
  - order is Job Done, Reviewed, or Closed;
  - the message is the order's latest, a WhatsApp message, and `not_sent`;
  - text is trimmed, 1–1,000 characters;
  - sets `body`, `edited_by`, `edited_at`; writes an audit entry
    (`customer_message_edited`, details: previous and new text).
  The panel shows "Edited by X at T" with a "Show original" toggle.
- **Channel.** `_is_my_mobile(phone)` mirrors `isMyMobile` (`^601\d{8,9}$`,
  parity-tested). At creation the row's `channel` is `whatsapp` for a mobile
  number and `phone` for a landline (PRD Q7). The customer's number is copied
  onto the row.
- **Table.** `customer_messages`: `id`, `order_id`, `channel`
  (`whatsapp` | `phone`), `phone`, `prepared_body`, `body`, `edited_by`,
  `edited_at`, `status` (`not_sent` | `sent` | `told_by_phone`),
  `confirmed_by`, `confirmed_at`, `created_at`. Checks keep `status`
  consistent with `channel` and require `confirmed_by` / `confirmed_at`
  exactly when the status is not `not_sent`. Rows are never deleted; only the
  two RPCs update them, and a confirmed row never changes again.
- **Confirming (P4).** `confirm_customer_message(p_message_id)`
  (security definer, actor from `auth.uid()`):
  - caller is the order's assigned technician or an Admin;
  - order is Job Done, Reviewed, or Closed;
  - the message is the order's latest one and still `not_sent`;
  - sets `sent` (WhatsApp) or `told_by_phone` (landline), who, and when;
  - writes an audit entry (`customer_messaged` / `customer_called`) so the
    order history shows it.
  A second confirm (the other person got there first) fails with "Already
  sent by X at T"; the screen reloads and shows the sent state. There is no
  undo (P5): a confirmed message stays sent, and the button stays disabled.
- **Reads (P3, P6).** RLS on `customer_messages`: select for the assigned
  technician and Admins (PRD AC 9; Manager / Finance access comes with 0007).
  A `security_invoker` view `latest_customer_messages` returns the newest
  row per order with the editor's and confirmer's names. The job list, job
  page, and order detail fetch it alongside their current reads;
  `order_summary` and `my_jobs` are not changed.
- **Existing orders (P8).** The migration backfills one `not_sent` message
  for every order already in Job Done, Reviewed, or Closed that has a
  completion record, using that completion's time and technician. These
  orders show the Send (or Call) button and the "Customer not told yet"
  badge.
- **Screen flow.** The panel shows:
  - WhatsApp, not sent: the message text, "Edit message", and the "Send to
    customer on WhatsApp" link (`target="_blank"`, `wa.me/<phone>?text=<body>`).
    Tapping Send also opens the dialog "Have you sent it to the customer?"
    Yes → confirm → "Sent by X at T", button disabled. No → close, nothing
    changes.
  - Landline, not told: "No WhatsApp number for this customer (landline).
    Call them instead." with a Call link (`tel:`). Tapping it opens "Did the
    customer pick up, and did you tell them the job is done?" Yes → confirm →
    "Told by phone by X at T".
  - Sent / told: the state line; Send / Call and Edit disabled for good.
  - Order not in Job Done, Reviewed, Closed, or no message: nothing.
- **Badge.** `customerNotTold(latest)` is true when the latest message is
  `not_sent`. The job card (Submitted tab), job page, and Admin order detail
  show "Customer not told yet".

## Resolved PRD Open Questions

All ten answered 2026-10-22; see the PRD's Product Decisions. Q6 (feedback)
and Q10 (review / close screens) moved to 0008 and 0007.

## System Components

| Component | Responsibility |
|---|---|
| `supabase/migrations/20261023000001_whatsapp_notification.sql` | `_is_my_mobile`, `customer_messages` table and checks, `_customer_job_done_message`, Job Done trigger, backfill, `edit_customer_message`, `confirm_customer_message`, `latest_customer_messages` view, RLS, grants |
| `src/domain/customerMessages.ts` | Types, statuses, `CUSTOMER_MESSAGE_STATUSES` (Job Done / Reviewed / Closed), body length rule, `customerNotTold`, state labels |
| `src/domain/phone.ts` | `isMyMobile` (unchanged; now parity-tested against `_is_my_mobile`) |
| `src/domain/whatsapp.ts` | `whatsAppUrl` reused for the customer link |
| `src/features/customer-messages/api.ts` | Fetch latest message(s) by order id(s); call the edit and confirm RPCs |
| `src/features/customer-messages/CustomerMessagePanel.tsx` | Message text, edit box, Send / Call button, confirmation dialog, sent state, badge |
| `src/features/customer-messages/index.ts` | Public exports |
| `src/features/jobs/JobPage.tsx`, `JobCard.tsx`, `JobListPage.tsx` | Panel on the job page; badge on Submitted job cards |
| `src/features/orders/OrderDetailPage.tsx`, `OrderHistory.tsx` | Panel on the Admin order detail; history labels for the three new audit actions |
| `docs/draft/0003-supabase-update.sql` | Hosted Supabase SQL (git-excluded) |

## Processing Flow

1. Technician submits the completion form → `submit_completion` moves the
   order In Progress → Job Done.
2. The `orders` trigger fires → inserts a `customer_messages` row
   (`whatsapp` or `phone`, `not_sent`, filled-in text).
3. The technician lands on the job page → the panel shows the message, Edit,
   Send (or Call), and the "Customer not told yet" badge.
4. Optional: Edit → change the text → save → "Edited by Ali at …".
5. Tap Send → WhatsApp opens with the message → technician presses Send in
   WhatsApp → back in the app, "Have you sent it to the customer?" → Yes.
6. `confirm_customer_message` → `sent`, who, when, audit entry → the panel
   shows "Sent by Ali at …"; the badge clears everywhere.
7. If the technician does not, an Admin sees the badge on the order detail
   and does steps 4–6 there.
8. Manager returns the job for rework → technician resubmits → step 2 runs
   again with a new row; the panel offers the new message.

Terminal states per message: `sent`, `told_by_phone`, or `not_sent` replaced
by a newer message after rework.

## Dependencies

| Dependency | Purpose |
|---|---|
| Supabase Postgres (existing) | Table, trigger, RPCs, RLS |
| `wa.me` deep link (no account) | Opens WhatsApp with the message filled in |
| PGlite test harness (existing, `tests/db/helpers.ts`) | Trigger, RPC, RLS, backfill, and parity tests |

No new npm packages and no new services.

## Implementation Phases

### Phase 1: Database

- Migration `20261023000001_whatsapp_notification.sql` with everything in
  System Components.
- `tests/db/customer-messages.test.ts`: message created on Job Done (and on
  rework resubmission); text, Malaysia time, channel; backfill of existing
  orders; edit and confirm by the allowed roles; each rejected for
  other technicians, Manager, Finance, signed-out, wrong status, older
  message, wrong state, already confirmed; audit entries; RLS reads.
- `tests/db/parity.test.ts`: `isMyMobile` = `_is_my_mobile`; Malaysia time
  format = `formatMalaysiaDateTime`; message statuses and body length.

### Phase 2: Domain

- `src/domain/customerMessages.ts` and `tests/domain/customerMessages.test.ts`.

### Phase 3: Screens

- `src/features/customer-messages/` (api, panel, dialogs).
- Job page, job card badge, Admin order detail, order history labels.
- `tests/ui/customer-message.test.tsx`: WhatsApp and landline panels, edit
  and "Show original", Yes / No, already-sent error and reload,
  badge on the job card, disabled state, 375 px labels.

### Phase 4: Verify and document

- `npm test`, `npm run typecheck`, `npm run build`, `validate_config.py`.
- `docs/draft/0003-supabase-update.sql` for the hosted project.
- Manual check on hosted Supabase at phone width (technician tab and Admin
  tab at `http://[::1]:5174`), with test data you approve and clean up.
- Workflow doc `docs/0003-whatsapp-notification-workflow.md`, folder
  structure reference, decision log (P2 edit extends the PRD),
  roadmap, `CLAUDE.project.md`.

## Testing Strategy

- **Database (PGlite):** the real migration chain 0000–0003; every rule in
  the two RPCs has a passing and a failing case; RLS checked as each role;
  the backfill checked on orders seeded before the migration runs.
- **Parity:** one table of cases through TypeScript and SQL for
  `isMyMobile`, the Malaysia time format, and the body length rule.
- **UI (jsdom):** panel states, edit, dialogs, error handling, badge.
- **Manual:** WhatsApp opens on a phone-sized browser with the right
  (edited) text; confirm from the technician, then the Admin sees "Sent by …"
  with Send disabled; a landline order shows Call.

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Someone taps Yes without sending | Customer not told but marked sent | Confirmer and time recorded in the history; no undo, by choice (P5) |
| Technician and Admin confirm at the same time | Two confirmations | RPC locks the row and accepts only the first; the other sees "Already sent by X" |
| An edit removes key details | Customer gets an unclear message | Original kept and viewable; edit is in the history with who and when |
| Backfill flags many old jobs as "not told" | Badge noise on day one | Expected (P8 b); an Admin can send or the badge clears once confirmed |
| `wa.me` link too long or text mangled | WhatsApp shows the wrong text | `encodeURIComponent`; 1,000-character limit; manual check |
| Time format differs between SQL and app | Confusing times | Parity test |
| Hosted project missing the migration | Screens fail | `docs/draft/0003-supabase-update.sql`, applied before the manual check |

## Roadmap Phase

**Phase:** 2 – Core workflow

## Related Documents

| Document | Type | Relationship |
|---|---|---|
| `docs/product-roadmap.md` | Roadmap | Phase assignment and sequencing for this plan |
| `docs/prd/0003-whatsapp-notification-prd.md` | Intent | Product goals and constraints this plan implements |
| `docs/0003-whatsapp-notification-workflow.md` | Workflow | Runtime behavior derived from this plan |
| `docs/reference/folder-structure.md` | Reference | Structural placement of planned components |
| `docs/decisions/NNNN-*.md` | Decision log | Divergences from this plan |

## Open Questions

Each question lists options; **(Recommended)** marks the proposed default.
All answered 2026-10-23.

- [x] **P1. Where the message is created.** (a) A database trigger on `orders` when the status becomes Job Done.
- [x] **P2. Where the message text is built.** (a) In SQL, stored on the row; plus the technician or an Admin can edit it before sending, with the original kept and the edit shown.
- [x] **P3. How screens read the message state.** (a) A new `latest_customer_messages` view; `order_summary` and `my_jobs` unchanged.
- [x] **P4. Technician and Admin both confirm.** (a) First one wins; the second gets "Already sent by X at T".
- [x] **P5. Undo a mistaken Yes.** (a) No undo; once confirmed, the message stays sent and the button stays disabled.
- [x] **P6. Who can see message status.** (a) Assigned technician and Admins only; 0007 adds Manager / Finance.
- [x] **P7. Time format in the message.** (a) `Thu 22 Oct 2026, 3:15 PM`.
- [x] **P8. Orders already Job Done / Reviewed / Closed before this feature.** (b) Backfill a message for each, so they show Send and the badge.
