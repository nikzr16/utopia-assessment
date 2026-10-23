# 0004 - Review and Close Implementation Plan

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

Build `docs/prd/0004-review-and-close-prd.md` on top of 0000–0003. One new
migration adds Manager branch cover, the "every branch needs a Manager"
rule, Manager-scoped read access, the approve and close guards, payment
verification, Manager sending of the customer message ("on behalf of"),
technician notices on approve and close, and two queue reads. Seed data
gains three Managers. Two new portals (Manager, Finance) share one order
page with a role-specific action bar; the notification bell is mounted for
both. Admin and technician screens gain "Approved by / Closed by" lines.

No new lifecycle moves: Approve, Return, and Close still go through
`transition_order`; payments through `record_payment`.

## Technical Approach

- **The database stays the rule authority.** Every rule below lives in SQL
  (RPCs, triggers, RLS). Screens show what the database returns and disable
  buttons using a `src/domain/` mirror that `tests/db/parity.test.ts` checks.
- **Branch cover (PRD Q1, P1).** The staff record has two branch columns:
  the existing home branch (`staff.branch_id`) and a new list
  `staff.additional_branch_ids` (`uuid[]`, default empty). A trigger keeps
  the list valid: only Managers may have one; every entry is an existing
  branch; no duplicates; the home branch is not repeated. A Manager covers
  their home branch plus every additional branch. Helper
  `_covers_branch(p_staff, p_branch_id)` answers "may this Manager act on
  this branch". Additional branches are set by SQL until 0006
  `staff-management`.
- **Every branch needs a Manager (PRD Q13, P2).** Helper
  `_branch_has_manager(p_branch_id)` = an active Manager whose home branch is
  it or who covers it. Enforced:
  - a commit-time constraint trigger on `staff` (insert, update of role /
    home branch / additional branches / active): a branch with any active
    non-Manager staff must still have a covering Manager (P2);
  - `create_order` and `update_order` (branch change) reject a branch with
    no covering Manager: "Penang has no Manager yet. Add a Manager to this
    branch first."
- **Manager read scope (PRD Q1).** The `orders_read` policy becomes: Admin
  and Finance read all; a Manager reads orders of covered branches; a
  technician reads their own. Everything that follows order visibility
  (completions, files, payments, reschedules, audit, `order_summary`, Storage
  read in `_can_access_job_file`) follows automatically or is updated to
  match. `customer_messages_read` adds covering Managers and all Finance.
- **Manager actions.** `_authorize_transition` gains two checks for a
  Manager: the order's branch is covered ("You do not cover Penang"), and,
  for Approve, the latest customer message is sent or told by phone ("Tell
  the customer the job is done before approving") (PRD Q4).
  `transition_order` is redefined (same signature) to notify the
  technician on Approve (`job_approved`) and Close (`job_closed`) (PRD Q9);
  `submit_completion` is redefined to notify every Manager covering the
  order's branch on Job Done.
- **Customer message from a Manager (PRD Q3, P4).**
  `_customer_message_error` lets a covering Manager confirm. When a Manager
  sends, the text is built by `_customer_on_behalf_message(...)`:
  `Hi {customer}, this is {manager}, Manager at Sejuk Sejuk Service {branch}, on behalf of Technician {technician}. Job {order_no} was completed at {time}. Please check and leave feedback. Thank you!`
  The screen builds the same text with a parity-tested TypeScript mirror so
  the WhatsApp link opens on one tap; `confirm_customer_message` saves that
  text as the sent body when the confirmer is a Manager (the prepared text
  stays in `prepared_body`).
- **Payment verification (PRD Q8, P6).** `payments` gains `verified_by`,
  `verified_at`. `verify_payment(p_payment_id)` and
  `unverify_payment(p_payment_id)`: Finance only; non-cash payments only;
  order not Closed; audited (`payment_verified` / `payment_unverified`).
  `_authorize_transition` blocks Close while any non-cash payment is
  unverified ("Verify 2 receipts before closing").
- **Queue reads (P5).** Two RPCs in the `my_jobs` style, each returning
  `order_summary` columns plus `return_count`, `latest_message_status`,
  `unverified_count`, `reviewed_at` / `reviewed_by_name`, `closed_at`:
  - `manager_orders(p_view)`: `to_review` (Job Done, oldest first),
    `returned` (In Progress and last returned, not resubmitted),
    `reviewed` (approved in the last 30 days); covered branches only.
  - `finance_orders(p_view, p_branch_id)`: `not_reviewed` (In Progress /
    Job Done with at least one payment), `ready` (Reviewed, paid),
    `outstanding` (Reviewed, unpaid / partial), `closed` (last 30 days);
    all branches, optional branch filter.
  `return_count` = audit rows `returned_for_rework`; 3 or more shows
  "Needs attention" (PRD Q11).
- **"Approved by / Closed by" (PRD Q12).** Read from the latest `reviewed`
  and `closed` audit rows of the order (with the approve note). Shown on the
  Admin order detail, the technician job page, and the shared order page.
- **Screens (P7).**
  - `ManagerPortal`: `/review` (tabs To review / Returned / Reviewed),
    `/review/:orderNo`, `/notifications`.
  - `FinancePortal`: `/finance` (tabs Not yet reviewed / Ready to close /
    Payment outstanding / Closed, branch filter), `/finance/:orderNo`,
    `/finance/:orderNo/payment`, `/notifications`.
  - One `OrderReviewPage` for both: order details, completion record,
    files, payments (with Verified state), money summary, customer message
    panel, return count and earlier notes, history; action bar per role:
    Manager → Approve (optional note) and Return for rework (required note);
    Finance → Verify / Undo per receipt, Record payment, Close.
  - The technician payment form moves to a shared component so Finance's
    Record payment page reuses it (receipt rule, client key, above-balance
    confirmation).
  - Desktop-first: tables at `md` and up, cards below; every page works at
    375 px (PRD Q10).
  - `NotificationsProvider` and `NotificationBell` mounted in both portals;
    `NotificationsPage` gets each portal's order path; the technician's
    bell opens the job for `job_approved` / `job_closed`.

## System Components

| Component | Responsibility |
|---|---|
| `supabase/migrations/20261023000002_review_and_close.sql` | `staff.additional_branch_ids` and its check, `_covers_branch`, `_branch_has_manager`, branch rule triggers, `create_order` / `update_order` branch check, RLS changes, `_authorize_transition` / `transition_order` / `submit_completion` redefinitions, notification events, payment verification columns and RPCs, Manager customer message rule and `_customer_on_behalf_message`, `manager_orders`, `finance_orders`, grants |
| `supabase/seed.sql` | Managers for Penang, Johor Bahru, Kota Kinabalu (P3) |
| `src/domain/review.ts` | Queue tabs, `NEEDS_ATTENTION_RETURNS = 3`, `canApprove`, `canClose`, payments needing verification, on-behalf text |
| `src/domain/` (existing) | Notification events, audit labels |
| `src/features/review/` | `ManagerPortal`, `ReviewQueuePage`, `ApproveDialog`, `ReturnDialog`, api |
| `src/features/finance/` | `FinancePortal`, `FinanceQueuePage`, `FinancePaymentPage`, verify controls, api |
| `src/features/order-review/` | Shared `OrderReviewPage`, "Approved by / Closed by" block, api |
| `src/features/payments/` | Payment form moved out of `jobs/PaymentPage` for reuse |
| `src/features/customer-messages/` | Manager send with on-behalf text; Finance read-only |
| `src/features/notifications/` | Per-portal order paths; new events |
| `src/features/orders/`, `src/features/jobs/` | "Approved by / Closed by" block; history labels |
| `src/App.tsx` | Route Managers and Finance to their portals |
| `docs/draft/0004-supabase-update.sql` | Hosted SQL: migration + seed Managers (git-excluded) |

## Processing Flow

1. Ali submits ORDER1042 (Shah Alam) → Job Done → Nurul (home branch) and
   any Manager covering Shah Alam are notified.
2. Ali sends the customer message (or Nurul does, "on behalf of" Ali).
3. Nurul opens To review → the order page → Approve (optional note) →
   Reviewed; Finance and Ali notified. Or Return for rework (note) → In
   Progress; Ali notified; the job shows under Returned until resubmitted.
4. Siti sees the order under Ready to close or Payment outstanding; records
   any office payment; ticks each non-cash receipt Verified.
5. Close (confirm) → Closed; Ali notified; Admin and technician pages show
   "Closed by Siti at T".

Terminal state: Closed. Rework loops back to step 1.

## Dependencies

| Dependency | Purpose |
|---|---|
| Supabase Postgres, Storage, Realtime (existing) | Rules, RLS, files, live notifications |
| PGlite test harness (`tests/db/helpers.ts`) | Migration chain, RLS per role, constraint triggers |
| `npm run auth:create-staff-logins` (existing) | Sign-ins for the three new Managers |

No new npm packages and no new services.

## Implementation Phases

### Phase 1: Database

- The migration and seed changes above.
- Tests: `tests/db/branch-cover.test.ts` (cover, branch rule incl. orders,
  read scope per role), `tests/db/review.test.ts` (approve guard, cover
  guard, notices, return count, Manager customer message),
  `tests/db/finance.test.ts` (verify / undo, close guard, queues);
  existing access, storage, notification, and seed tests updated;
  parity for tabs, threshold, verification methods, events, on-behalf text.

### Phase 2: Domain

- `src/domain/review.ts` and tests.

### Phase 3: Screens

- Shared payment form, `OrderReviewPage`, Manager and Finance portals,
  bell, "Approved by / Closed by", App routing.
- UI tests: queues and tabs, approve blocked / allowed, return note
  required, verify / undo, close enabled only when ready, on-behalf link,
  notifications open the right page, 375 px labels.

### Phase 4: Verify and document

- `npm test`, `npm run typecheck`, `npm run build`, `validate_config.py`.
- `docs/draft/0004-supabase-update.sql`; you run it, then the logins script.
- Manual check on hosted Supabase: Manager and Finance on desktop and
  375 px, technician at 375 px, second role at `http://[::1]:5174`; test data
  only with your OK; cleanup in `docs/draft/0004-cleanup-test-orders.sql`.
- Workflow doc `docs/0004-review-and-close-workflow.md`, 0000 workflow
  stages 7–8, folder structure, decision log, roadmap, `CLAUDE.project.md`.

## Testing Strategy

- **Database (PGlite):** the full migration chain; each new rule has a
  passing and a failing case; RLS checked as Admin, each Manager (home,
  covered, not covered), Finance, technician, signed-out.
- **Parity:** one table of cases through TypeScript and SQL for tabs,
  threshold, verification methods, notification events, on-behalf text.
- **UI (jsdom):** portals, pages, dialogs, disabled states, errors.
- **Manual:** one order from New to Closed through the screens, including a
  rework round-trip and a Finance office payment.

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Changing `orders_read` hides orders from someone who needs them | Broken screens | RLS tests per role; Admin and Finance unchanged |
| Branch rule blocks existing tests or SQL setup | Failing tests / setup | Seed Managers first; commit-time triggers allow any order in one transaction (P2) |
| Redefining `transition_order` / `submit_completion` drops earlier behavior | Lost notices or checks | Copy the 0002 versions; existing transition and notification tests must still pass |
| Approve blocked when the customer cannot be reached | Job waits | Landline "told by phone" path exists; the Manager can send it themself |
| Hosted project missing the migration or Managers | Portals fail; orders blocked | `docs/draft/0004-supabase-update.sql` before the manual check |

## Roadmap Phase

**Phase:** 2 – Core workflow

## Related Documents

| Document | Type | Relationship |
|---|---|---|
| `docs/product-roadmap.md` | Roadmap | Phase assignment and sequencing for this plan |
| `docs/prd/0004-review-and-close-prd.md` | Intent | Product goals and constraints this plan implements |
| `docs/0004-review-and-close-workflow.md` | Workflow | Runtime behavior derived from this plan |
| `docs/reference/folder-structure.md` | Reference | Structural placement of planned components |
| `docs/decisions/NNNN-*.md` | Decision log | Divergences from this plan |

## Open Questions

Each question lists options, recommended first, with a short scenario.
All answered 2026-10-23.

- [x] **P1. Where branch cover is stored.**
  - (a) Home branch stays on the staff row; extra branches go in a `manager_branches` table. **(Recommended)** *Scenario:* Nurul's home is Shah Alam; one row adds Penang. Removing that row ends the cover.
  - (b) Every branch a Manager covers, home included, goes in the table. *Scenario:* Nurul has two rows, Shah Alam and Penang; her staff row's branch is only her "home" label.
  - **Answer:** neither; two columns on the staff record: home branch, and additional branches as a list (Managers only). *Scenario:* Nurul: Home Shah Alam, Additional Penang, Johor Bahru.

- [x] **P2. When the "Manager first" rule is checked.**
  - (a) When the change is saved as a whole (end of the transaction). **(Recommended)** *Scenario:* One SQL script adds Manager Mei Ling and technician Ravi to Penang in either order; it succeeds because Penang has a Manager when it finishes.
  - (b) On every single row. *Scenario:* The same script fails if Ravi's line comes before Mei Ling's.
  - **Answer:** (a) Checked when the whole change is saved.

- [x] **P3. The three new seed Managers.**
  - (a) Penang: Lim Mei Ling (`meiling@`), Johor Bahru: Hafiz Osman (`hafiz@`), Kota Kinabalu: Grace Lojuni (`grace@`), all `@sejuk.example.com`. **(Recommended)**
  - (b) Your own names / emails.
  - **Answer:** (a) Lim Mei Ling, Hafiz Osman, Grace Lojuni.

- [x] **P4. How a Manager sends the "on behalf" message.**
  - (a) One tap: the WhatsApp link opens with the on-behalf text; after "Yes, sent", that text is saved as what was sent. Managers do not edit the text. **(Recommended)** *Scenario:* Nurul taps Send, WhatsApp opens with "Hi Puan Lim, this is Nurul, Manager at Sejuk Sejuk Service Shah Alam, on behalf of Technician Ali…", she sends, taps Yes.
  - (b) Two steps: "Use my message" first saves the on-behalf text as an edit (Nurul can then change it like an Admin), then Send. *Scenario:* Nurul adds "Sorry for the delay" before sending.
  - **Answer:** (a) One tap; the on-behalf text is saved as sent; Managers do not edit.

- [x] **P5. How the queues are read.**
  - (a) Two database functions (`manager_orders`, `finance_orders`) decide which order is in which tab. **(Recommended)** *Scenario:* The tab rules are tested once in SQL; the screens just show the rows.
  - (b) The screen filters `order_summary` itself. *Scenario:* Simpler SQL, but the return count and message status need extra queries per page.
  - **Answer:** (a) `manager_orders` and `finance_orders` decide the tabs.

- [x] **P6. Undo a "Verified" tick.**
  - (a) Finance can undo it until the order is Closed; both are in the history. **(Recommended)** *Scenario:* Siti ticks the wrong receipt, taps Undo, ticks the right one.
  - (b) No undo. *Scenario:* A wrong tick stays; she must close anyway or ask for a SQL fix.
  - **Answer:** (a) Finance can undo a Verified tick until the order is Closed.

- [x] **P7. One order page or two.**
  - (a) One shared order page; the buttons at the bottom change by role. **(Recommended)** *Scenario:* Nurul and Siti see the same layout; Nurul sees Approve / Return, Siti sees Verify / Record payment / Close.
  - (b) A separate Manager page and Finance page. *Scenario:* Each page shows only what that role needs, but the code is duplicated.
  - **Answer:** (a) One shared order page; buttons by role.
