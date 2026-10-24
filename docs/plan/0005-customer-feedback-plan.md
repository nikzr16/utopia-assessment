# 0005 - Customer Feedback Implementation Plan

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

Build `docs/prd/0005-customer-feedback-prd.md` on top of 0000–0004. One new
migration gives every WhatsApp Job Done message a random feedback secret,
adds the feedback table, a link-address setting, the poor-rating notice,
staff reads, and the only two functions signed-out visitors may call. A
public page at the link lets the customer rate the visit; a "Customer
feedback" card shows ratings on the Admin, technician, and Manager /
Finance order pages; Admins and covering Managers can record a rating taken
by phone for landline customers.

Everything is built and tested locally; the link address is the local app
until 0010 `production-deployment` (decision 0012).

## Technical Approach

- **The database stays the rule authority.** Expiry, one submission per
  visit, who may record a phone rating, the poor-rating rule, and the link
  line are SQL; `src/domain/feedback.ts` mirrors them and
  `tests/db/parity.test.ts` checks both.
- **One secret per visit (PRD Q2, Q4; P1).** `customer_messages` gains
  `feedback_token` (text, unique): 22 URL-safe characters encoding a
  random `gen_random_uuid()` (122 random bits, built into Postgres, no
  extension), set by the Job Done trigger for WhatsApp
  messages only (landlines get none). The token is never the order number
  or an ID. `customer_messages_guard` is redefined so the token never
  changes. Rows from before 0005: not-yet-confirmed WhatsApp messages get a
  token; confirmed ones keep the text that was sent, with no link.
- **Link address (PRD Q10).** New table `app_settings (key, value)` with
  row `feedback_link_base` (for now `http://localhost:5173`), changed by SQL
  until 0010. Readable by no client role; only definer functions read it.
  The link is `<base>/f/<token>` (P2).
- **Link line (PRD Q2; P3).** `body` stays the editable text. The text
  that is sent = `body` + a blank line + `Leave feedback: <link>`, built by
  `_customer_message_full_text(...)`. `latest_customer_messages` (and the
  Manager's on-behalf text) gain `feedback_url` and `full_body`; the panel
  shows the link line under the editable text as fixed, read-only text and
  opens `wa.me` with `full_body`. `confirm_customer_message` saves the full
  text in the audit entry. If `feedback_link_base` is missing, the link
  uses the placeholder `https://feedback-address-not-set.invalid` and the
  panel warns "The feedback link address is not set".
- **Feedback table.** `customer_feedback`: `message_id` (unique: one
  feedback per visit), `order_id`, `technician_id`, `branch_id` (copied
  at submit time for 0007), `rating` 1–5, `working_well` boolean,
  `comment` (trimmed, at most 1,000 characters, optional), `source`
  (`link` / `phone`), `recorded_by` (staff, phone only), `created_at`.
  Rows never change or get deleted (guard trigger, like customer
  messages).
- **Signed-out access (PRD constraints).** `anon` gets `usage` on the
  schema and `execute` on exactly two security-definer functions, nothing
  else (Supabase's default grants on new objects are revoked in the
  migration):
  - `feedback_form(p_token)` → `state` (`open`, `submitted`, `expired`,
    `replaced`, `not_found`) and, only when `open` or `submitted`, the
    order number, service type, technician name, and Job Done date
    (PRD Q6). Nothing else.
  - `submit_feedback(p_token, p_rating, p_working_well, p_comment)`:
    accepts only an `open` link, locks the order row so two taps store
    one row, and returns the new state. A `submitted`, `expired`,
    `replaced`, or unknown link is rejected with the page's message.
  - `open` = the message is the order's latest, its order is Job Done,
    Reviewed, or Closed, it is under 7 days old (from Job Done, PRD Q3),
    and has no feedback yet. Also granted to `authenticated`, so a signed-in
    staff member's browser behaves the same.
- **Phone rating (PRD Q5; P4).**
  `record_phone_feedback(p_message_id, p_rating, p_working_well, p_comment)`:
  Admin or a Manager covering the order's branch; phone-channel message,
  the order's latest, marked "Told by phone", no feedback yet. The
  assigned technician is rejected. Audited `feedback_recorded`.
- **Poor rating (PRD Q9).** `_is_low_feedback(rating, working_well)` =
  rating ≤ 2 or not working. On insert, every active Manager covering the
  branch gets notification event `low_feedback`; the bell opens
  `/review/:orderNo`. Audit `feedback_received` for link submissions (no
  actor; the audit actor column allows null for this event).
- **Staff reads (PRD Q8).** RLS on `customer_feedback` follows order
  visibility (`orders_read`): Admins, Finance, covering Managers, the
  assigned technician. `manager_orders` is recreated with a
  `latest_rating` / `latest_working_well` pair for the Reviewed tab's
  rating column (return type changes, so drop and create; same
  parameters).
- **Screens.**
  - `App.tsx`: `/f/:token` renders `FeedbackPage` before any sign-in check,
    with a plain company header (no staff header or sign-out).
  - `FeedbackPage` (phone-first): job facts, five large star buttons with
    labels, "Is your aircon working well now?" Yes / No, optional comment
    with a character count, Submit (once, disabled while sending), then
    "Thank you". Clear pages for already received, expired, replaced, and
    unknown links; network errors keep the answers and offer Retry.
  - `FeedbackCard` (staff): every visit's feedback, latest first: stars,
    working well, comment, "Received at T" or "Taken by phone by X at T",
    and a "Poor rating" tag. Shown on the Admin order detail, the
    technician job page, and the Manager / Finance order page.
  - `PhoneFeedbackDialog`: same questions, for Admins and covering
    Managers on a told-by-phone visit with no feedback.
  - Manager Reviewed tab: rating column (stars, "Not working", or "—").
  - `NotificationsPage` label for `low_feedback`.

## System Components

| Component | Responsibility |
|---|---|
| `supabase/migrations/20261023000003_customer_feedback.sql` | `customer_messages.feedback_token` + backfill, guard and Job Done trigger redefined, `app_settings`, `_feedback_link`, `_customer_message_full_text`, `latest_customer_messages` and on-behalf text with link, `customer_feedback` + guard, `_is_low_feedback`, `feedback_form`, `submit_feedback`, `record_phone_feedback`, `low_feedback` event and notice, audit actions, RLS, `manager_orders` recreated, `anon` grants |
| `src/domain/feedback.ts` | Rating range, comment limit, 7-day expiry, link states and their messages, `isLowFeedback`, link line format, form validation, `canRecordPhoneFeedback` |
| `src/domain/` (existing) | Notification event + label, audit labels |
| `src/features/feedback/` | `FeedbackPage`, `FeedbackCard`, `PhoneFeedbackDialog`, `api.ts` |
| `src/features/customer-messages/` | Fixed link line under the text, `full_body` in the `wa.me` link, missing-address warning |
| `src/features/orders/`, `jobs/`, `order-review/`, `review/` | `FeedbackCard` on the three order pages; rating column in the Reviewed tab |
| `src/App.tsx` | Public `/f/:token` route before the sign-in check |
| `docs/draft/0005-supabase-update.sql` | Hosted SQL: the migration + `feedback_link_base` (git-excluded) |

## Processing Flow

1. Ali submits ORDER1042 → Job Done → the trigger prepares the message
   with a new token.
2. Ali (or an Admin, or Nurul on behalf) taps Send: WhatsApp opens with
   the text and the last line `Leave feedback: http://localhost:5173/f/<token>`;
   "Yes, I sent it" saves the full text.
3. Puan Aminah opens the link (signed out) → `feedback_form` = `open` →
   she rates 2 stars, "No", "still leaking" → `submit_feedback` stores it
   → "Thank you". Nurul gets a `low_feedback` notice.
4. Staff see the feedback card on the order. Opening the link again shows
   "already received".
5. Rework: Nurul returns the job; Ali resubmits → a new message and token;
   the old link (if unused) now shows "replaced"; the customer rates the
   fix with the new link.
6. Landline: Mr Tan is called, marked "Told by phone"; Nurul or an Admin
   records his rating with "Record rating taken by phone".

A link stops working after 7 days, after use, or when replaced.

## Dependencies

| Dependency | Purpose |
|---|---|
| Supabase Postgres, Realtime (existing) | Rules, RLS, live notices |
| PGlite test harness (`tests/db/helpers.ts`) | Migration chain, `anon` checks |

No new npm packages and no new services.

## Implementation Phases

### Phase 1: Database

- The migration above.
- Tests: `tests/db/feedback.test.ts` (token per WhatsApp visit, none for
  landlines, link line survives edits, form states, submit once and
  concurrently, 7-day expiry, replaced after rework, phone rating rules,
  low-rating notice, RLS reads per role); `access.test.ts` and
  `auth.test.ts` updated: `anon` may call exactly the two feedback
  functions and read nothing; customer message, notification, and review
  tests updated; parity cases.

### Phase 2: Domain

- `src/domain/feedback.ts` and tests.

### Phase 3: Screens

- Public page, feedback card, phone dialog, panel link line, Reviewed
  rating column, notification label, App route.
- UI tests: form validation and single submit, each link state, retry
  keeps answers, card on each page, phone dialog for Admin / Manager and
  not for the technician, panel shows the fixed link, 375 px labels.

### Phase 4: Verify and document

- `npm test`, `npm run typecheck`, `npm run build`, `validate_config.py`.
- `docs/draft/0005-supabase-update.sql`; you run it.
- Manual check on hosted Supabase, local app: technician / Manager at
  375 px, Admin and Finance on desktop, second role at `http://[::1]:5174`,
  the customer page at 375 px signed out (in the signed-out tab). Test data
  only with your OK; cleanup in `docs/draft/0005-cleanup-test-orders.sql`.
- Workflow doc `docs/0005-customer-feedback-workflow.md`, 0003 / 0004
  workflow notes, folder structure, decision log, roadmap,
  `CLAUDE.project.md`.

## Testing Strategy

- **Database (PGlite):** full migration chain; each rule has a passing and
  a failing case; reads and calls checked as `anon`, Admin, each Manager
  (covering / not), Finance, assigned and other technician.
- **Parity:** one case table through TypeScript and SQL for expiry, link
  states, low-rating rule, comment limit, and the link line.
- **UI (jsdom):** page states, validation, disabled states, errors.
- **Manual:** one order to Job Done, message sent with the link, feedback
  submitted signed out at 375 px, Manager notice, card on every page, a
  rework with a new link, and a landline phone rating.

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Opening anything to `anon` leaks data | Customer data exposed | Two definer functions only; tests assert `anon` can read no table and call nothing else; the form returns only the PRD Q6 fields |
| Supabase default grants give `anon` the new tables | Same | Migration revokes all on new objects from `anon`; access test checks every table |
| Anyone with the link (forwarded, or staff who sent it) can submit | A rating not from the customer | One submission per visit, 7-day expiry; accepted risk of a private link (PRD Q6) |
| Tokens guessed by brute force | Fake ratings | 122 random bits per token; unknown tokens return no data |
| Link points at `localhost` | Customers cannot open it | Local only by design; 0010 sets the real address (decision 0012) |
| Recreating `manager_orders` drops earlier behavior | Broken Manager queue | Copy the 0004 version; existing review tests must pass |

## Roadmap Phase

**Phase:** 2 – Core workflow

## Related Documents

| Document | Type | Relationship |
|---|---|---|
| `docs/product-roadmap.md` | Roadmap | Phase assignment and sequencing for this plan |
| `docs/prd/0005-customer-feedback-prd.md` | Intent | Product goals and constraints this plan implements |
| `docs/0005-customer-feedback-workflow.md` | Workflow | Runtime behavior derived from this plan |
| `docs/reference/folder-structure.md` | Reference | Structural placement of planned components |
| `docs/decisions/0012-add-production-deployment-feature.md` | Decision log | Why the link is local until 0010 |
| `docs/decisions/NNNN-*.md` | Decision log | Divergences from this plan |

## Open Questions

Each question lists options, recommended first, with a short scenario.
All answered 2026-10-23.

- [x] **P1. Where the link's secret is stored.** (a) A column on the customer message.
- [x] **P2. How the link looks.** (a) `<address>/f/<22 characters>`.
- [x] **P3. Message wording around the link.** (a) The brief's text, then a last line `Leave feedback: <link>`.
- [x] **P4. How long a phone rating can be recorded.** (a) Any time until the job's next visit, once per visit.
- [x] **P5. Extra spam protection.** (a) None beyond the random link, one submission per visit, and the 7-day expiry.
