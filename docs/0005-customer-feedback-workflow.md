# 0005 - Customer Feedback Workflow

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

How a customer rates a finished job: a private link in the Job Done message
opens a public page with no sign-in, the answers are stored once per visit,
a poor rating alerts the branch's Managers, and staff see every rating on the
order. Landline customers (no link) can have their rating taken on the phone
call. All rules live in
`supabase/migrations/20261023000003_customer_feedback.sql`; the screens are
`src/features/feedback/` (customer page, staff card, phone dialog) plus the
link line in `src/features/customer-messages/`.

## Trigger

- An order reaches Job Done (0003 trigger `orders_customer_message_trg`): a
  WhatsApp message gets a new feedback token, so the visit gets its own link.
- The customer opens `<address>/f/<token>`.
- An Admin or a covering Manager records a landline customer's rating.

## Preconditions

- The hosted database has the 0005 migration
  (`docs/draft/0005-supabase-update.sql`).
- `app_settings.feedback_link_base` holds the app's public address: the
  live app `https://sejuk-sejuk-utopia.vercel.app` on the hosted project
  since 0010 (the migration's default, for a fresh local database, is
  `http://localhost:5173`).
- The app serves `/f/:token` (Vite locally; the `vercel.json` SPA rewrite on
  Vercel).

## Stages

### 1. Token on Job Done — `orders_customer_message`

**Actions:** For a WhatsApp customer the new `customer_messages` row gets `feedback_token`: 22 URL-safe characters encoding a random UUID (`_new_feedback_token`, 122 random bits; not the order number or any ID). Landline messages get none. The token is unique and never changes (`customer_messages_guard`).
**Rework:** every Job Done prepares a new message (0003), so each visit gets its own token; the earlier link stops working (stage 3).
**Before 0005:** WhatsApp messages not yet sent got a token in the migration; sent ones keep their text, with no link.

### 2. The link line in the message — `CustomerMessagePanel`

**Text sent:** `body` (editable, 0003) + a blank line + `Leave feedback: <address>/f/<token>` (`_customer_message_full_text`, mirrored by `customerMessageFullText`). `latest_customer_messages` returns `feedback_url` and `full_body`.
**Panel:** shows the message, then "Last line, added automatically" with the link and "Editing the message does not change it." `wa.me` opens with the full text. A Manager's on-behalf text (0004) gets the same line.
**Missing address:** if `feedback_link_base` is not set, the link uses `https://feedback-address-not-set.invalid` and the panel warns "The feedback link address is not set, so this link will not open for the customer."
**Confirm:** `confirm_customer_message` records the full text (link included) in the `customer_messaged` audit entry.

### 3. Customer page — `/f/:token`, `feedback_form(p_token)`

**Route:** `AppRoutes` renders `FeedbackPage` before any sign-in check, with a plain "Sejuk Sejuk Service / Customer feedback" header (no staff header). It works the same signed in or out.
**Link state** (`_feedback_link_state`, checked in this order):

| State | When | Page |
|---|---|---|
| `not_found` | Unknown or malformed token | "This link cannot be used" — "This feedback link is not valid…" |
| `submitted` | The visit already has feedback | "Feedback received" + job facts |
| `replaced` | A newer visit exists, or the job is back In Progress for rework | "This link cannot be used" — "…no longer active. We will send you a new link…" |
| `expired` | 7 days after Job Done (the message's `created_at`) | "This link cannot be used" — "…has expired…" |
| `open` | Otherwise | The form |

**Job facts** (only for `open` / `submitted`): order number, service type, technician (completion technician, else assigned), Job Done time. Never the customer's name, phone, address or any amount.
**Form:** "How would you rate the job?" five buttons (1 – Very poor … 5 – Excellent), "Is your aircon working well now?" Yes / No, optional comment (0 / 1,000 characters), **Send feedback**. Phone-first (five buttons fit 375 px).

### 4. Submit — `submit_feedback(p_token, p_rating, p_working_well, p_comment)`

**Checks:** the link must be `open` (re-checked under the order row lock, so two taps store one row); answers by `_check_feedback`: rating 1–5, Yes / No required, comment trimmed, at most 1,000 characters, empty → none.
**Stores:** a `customer_feedback` row: message (visit), order, technician (completion technician, else assigned), branch, rating, working well, comment, `source = 'link'`, time. One row per message (unique); rows never change or get deleted (`customer_feedback_guard_trg`).
**Page:** "Thank you!". A network failure keeps the answers ("Your answers are kept.") and Send can be tried again; any other refusal reloads the link state and shows that page (for example "Feedback received").
**Audit:** none (the audit log needs a staff actor); the feedback row is the record.

### 5. Poor rating — `_notify_low_feedback`

**Rule:** 1–2 stars, or "No" to working well (`_is_low_feedback`, mirrored by `isLowFeedback`).
**Notice:** event `low_feedback` to every active Manager covering the order's branch (not the person who recorded it): "ORDER1042: the customer rated 2/5 and says the aircon is not working well". Tag "Poor rating"; tapping it opens `/review/:orderNo`.

### 6. Staff see feedback — `FeedbackCard`, `order_feedback`

**Where:** Admin order detail, technician job page, Manager / Finance order page, below the customer message.
**Who:** whoever can read the order (`customer_feedback_read` follows `orders_read`): Admins, Finance, covering Managers, the assigned technician.
**Card:** every visit, latest first: stars (`★★☆☆☆`, read as "2 out of 5 stars"), label, "Poor rating" tag, "Aircon working well now: Yes / No", comment, "Received from the customer at T" or "Taken by phone by X at T", and "visit done T" when there is more than one visit. While the latest visit has none: "No feedback yet. The customer's link works until T." (or "goes out with the customer message…", "expired on T", or the landline hints). Hidden before the first Job Done.
**Manager Reviewed tab:** column "Customer rating" with the latest visit's stars (and "Not working"); poor ratings in red (`order_review_summary.latest_rating`, `latest_working_well`).

### 7. Rating taken by phone — `record_phone_feedback(p_message_id, …)`

**Who:** an Admin or a Manager covering the branch; never the technician, never Finance (`_phone_feedback_error`, mirrored by `canRecordPhoneFeedback`).
**When:** the order's latest message is a landline one marked "Told by phone", the order is Job Done, Reviewed or Closed, and the visit has no feedback yet. No time limit until the next visit.
**Screen:** "Record rating taken by phone" on the feedback card opens a dialog with the same three questions worded for the caller; **Save rating**.
**Stores:** `source = 'phone'`, `recorded_by`; audit `feedback_recorded` (rating, working well, comment), shown in the history as "Recorded the customer rating taken by phone". A poor rating notifies the other covering Managers.

## Error States

| Error | Cause | Handling |
|---|---|---|
| "This feedback link is not valid. Check that you opened the full link from our message" | Unknown / malformed token | `not_found` page; submit rejected |
| "Thank you, we have already received your feedback for this job" | Second submission | `submitted` page; nothing stored |
| "This feedback link is no longer active. We will send you a new link when the job is done" | Newer visit, or job in rework | `replaced` page; nothing stored |
| "This feedback link has expired (links work for 7 days after the job is done)" | 7 days after Job Done | `expired` page; nothing stored |
| "Choose a rating from 1 to 5 stars" / "Tell us whether your aircon is working well now" / "The comment can be at most 1,000 characters" | Missing or bad answers | On the field (each clears when answered); rejected by the database too |
| "Only an Admin or a Manager of <branch> can record a rating taken by phone" | Technician, Finance, Manager of another branch | Rejected; no button on screen |
| "This customer has WhatsApp and rates the job with their feedback link" | Phone rating on a WhatsApp visit | Rejected |
| "Call the customer and mark them "Told by phone" before recording their rating" | Not told yet | Rejected; card says "Call the customer first" |
| "Already rated N/5, taken by phone by X at T" / "…received from the customer at T" | Second rating of a visit | Rejected; shown in the dialog |
| "A newer visit has been prepared for this order. Reload the page to see it." | Rating an old visit | Rejected |
| "Could not reach the server…" | No signal | Customer page keeps the answers; Send again |

## Defaults

| Setting | Default |
|---|---|
| Link address | `app_settings.feedback_link_base` = `https://sejuk-sejuk-utopia.vercel.app` on the hosted project (0010); `http://localhost:5173` in a fresh database |
| Link path | `/f/<22 characters>` |
| Link lifetime | 7 days after Job Done, while it is the latest visit and unused |
| Poor rating | 1–2 stars, or not working well |
| Comment | Optional, at most 1,000 characters |
| Phone rating window | Until the next visit (no 7-day limit) |
| Language | English |

## Behavioral Constraints

- Signed-out visitors (`anon`) have schema usage and `execute` on exactly
  `feedback_form` and `submit_feedback`; no table, view or other function
  (`tests/db/access.test.ts`). `app_settings` is readable by no API role.
- Feedback never blocks Approve or Close; it is accepted after Close.
- Each feedback row keeps the technician and branch of that visit, for the
  KPI dashboard (0007), which uses the latest visit per order.
- `customerMessageFullText`, `validateFeedbackForm`, `isLowFeedback`,
  `canRecordPhoneFeedback`, `FEEDBACK_STATE_MESSAGES` and
  `FEEDBACK_LINK_PLACEHOLDER` (`src/domain/feedback.ts`) mirror the SQL;
  `tests/db/parity.test.ts` runs the same cases through both.
- Cleanup of test orders must switch off `audit_log_no_update_trg`,
  `customer_messages_guard_trg` and `customer_feedback_guard_trg` in its
  transaction (`docs/draft/0005-cleanup-test-orders.sql`).

## Related Documents

| Document | Type | Relationship |
|---|---|---|
| `docs/prd/0005-customer-feedback-prd.md` | Intent | Product goals this workflow fulfills |
| `docs/plan/0005-customer-feedback-plan.md` | Plan | Architecture this workflow implements |
| `docs/0003-whatsapp-notification-workflow.md` | Workflow | The Job Done message that carries the link |
| `docs/0004-review-and-close-workflow.md` | Workflow | On-behalf message, Manager queue, bell |
| `docs/reference/folder-structure.md` | Reference | File locations of workflow components |
| `docs/decisions/0012-add-production-deployment-feature.md` | Decision log | Local link address until 0010 |
| `docs/0010-production-deployment-workflow.md` | Workflow | The live address and where it is set |
| `docs/decisions/0013-customer-feedback-implementation-details.md` | Decision log | Divergences from the 0005 plan |
