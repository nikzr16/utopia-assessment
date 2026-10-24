# 0004 - Review and Close Workflow

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

How a finished job is reviewed by a Manager and closed by Finance, so an
order goes from creation to Closed through the app's screens. Also how
Managers cover branches and why every branch needs a Manager. All rules live
in `supabase/migrations/20261023000002_review_and_close.sql`; the screens are
`src/features/review/` (Manager), `src/features/finance/` (Finance) and the
shared `src/features/order-review/` order page.

## Trigger

- A technician submits a job (Job Done, 0002): the Managers covering the
  order's branch are told and it appears in their **To review** tab.
- A Manager approves it (Reviewed): Finance and the technician are told and it
  appears in Finance's **Ready to close** or **Payment outstanding** tab.

## Preconditions

- The hosted database has the 0004 migration and the three new Managers
  (`docs/draft/0004-supabase-update.sql`), and the new Managers have sign-ins
  (`npm run auth:create-staff-logins`).
- Writes are RPCs; the database resolves the actor from the session.

## Stages

### 0. Branch cover and "Manager first" (setup; on screen since 0006)

**Data:** `staff.branch_id` is a person's home branch; `staff.additional_branch_ids` (`uuid[]`, Managers only) lists the other branches a Manager covers. `staff_additional_branches_trg` refuses the list for non-Managers, unknown branches, the home branch again, and duplicates.
**Rule:** A Manager covers their home branch plus every additional branch (`_covers_branch`, mirrored by `coversBranch`).
**Manager first:** `staff_branch_manager_trg` (a constraint trigger checked when the transaction commits) refuses any staff change that leaves a branch with active non-Manager staff but no active covering Manager: "Penang has no Manager. Add a Manager to this branch first." One script may add a Manager and staff in either order. `orders_branch_manager_trg` refuses creating an order for, or moving an order to, a branch with no covering Manager (same message).
**Seed:** one Manager per branch: Nurul Huda (Shah Alam), Tan Wei Ming (Kuala Lumpur), Lim Mei Ling (Penang), Hafiz Osman (Johor Bahru), Grace Lojuni (Kota Kinabalu).
**Changing cover:** an Admin ticks "Also covers" on the Manager's staff form (0006, `docs/0006-staff-management-workflow.md`); the form warns before saving when a change would leave a branch without a Manager ("<Name> is the only Manager covering <branch>…"). This commit check stays the final word, also for plain SQL.

### 1. Who sees what

| Role | Orders and everything hanging off them (completion, files, payments, history, customer messages) |
|---|---|
| Admin, Finance | Every branch |
| Manager | Covered branches only (`orders_read` policy, `_current_staff_covers`; Storage read in `_can_access_job_file`) |
| Technician | Their assigned orders (unchanged) |

Job Done notices (`job_done`) go to every active Manager covering the order's branch (`submit_completion`).

### 2. Manager review queue — `/review`, `manager_orders(p_view, p_branch_id)`

**Tabs** (`?tab=`):
- **To review**: Job Done, oldest completion first. Columns: technician, done at, customer told (WhatsApp sent / By phone / Not told yet), final amount.
- **Returned**: sent back for rework and not resubmitted yet (In Progress, `return_count > 0`), latest return first; with the return note.
- **Reviewed**: approved in the last 30 days (Reviewed or Closed), latest first; approved at and by; customer rating of the latest visit (0005).
**Flags:** "Returned N×" once returned; **Needs attention** at 3 or more returns (`NEEDS_ATTENTION_RETURNS`).
**Branch filter** (`?branch=`): "All my branches" or one covered branch (`covered_branches()`); hidden when the Manager covers one branch.
**Layout:** a table from 768 px; cards below.

### 3. Order page — `/review/:orderNo` and `/finance/:orderNo` (`OrderReviewPage`)

One page for both roles (`order_review_summary`): order details and money, completion record, files (view only), payments with receipts and verification state, history, the customer message panel, and an actions card. On a wide screen the actions card, the "Returned N times" card (every earlier return note, who and when) and the customer message sit beside the details; on a phone they come first. A Manager opening an order outside their branches sees "There is no order X in the branches you cover."

### 4. Tell the customer (Manager) — `confirm_customer_message`

**Panel:** for a covering Manager, while the message is not sent, the text shown and sent is `_customer_on_behalf_message` (mirrored by `customerOnBehalfMessage`):
`Hi {customer}, this is {manager}, Manager at Sejuk Sejuk Service {order branch}, on behalf of Technician {technician}. Job {order_no} was completed at {time}. Please check and leave feedback. Thank you!`
with "Sent in your name, on behalf of the technician." There is no **Edit message** for Managers. Since 0005 the fixed `Leave feedback: <link>` line is added after it (`docs/0005-customer-feedback-workflow.md` stage 2).
**Send:** as 0003 stage 4: WhatsApp opens with that text; "Have you sent it to the customer?" → **Yes, I sent it**. The database saves the on-behalf text as the sent `body` (the prepared text stays in `prepared_body`); audit `customer_messaged` with `on_behalf: true`. A landline is told by phone as in 0003 stage 5 (text unchanged).

### 5. Approve — `transition_order(…, 'reviewed', note)`

**Who / when:** a Manager covering the branch; order Job Done; the latest customer message sent or told by phone.
**Screen:** **Approve job** is disabled with "Tell the customer the job is done before approving. Send the message below (or call) first." until then. The dialog has an optional **Note for Finance**.
**Since 0009:** Approve also needs every supervisor warning checked with a note ("Check every warning before approving (N open)"; database trigger `orders_open_warnings_guard_trg`); see `docs/0009-ai-advanced-workflow.md`. Return for rework never needs checks.
**Output:** Reviewed; audit `reviewed` with the note; every active Finance user gets `reviewed`; the technician gets `job_approved` ("ORDER1003 was approved by Nurul Huda"). The page shows "Approved. Finance and the technician have been told." and "Approved by X at T" with the note.

### 6. Return for rework — `transition_order(…, 'in_progress', note)`

**Who / when:** a Manager covering the branch; order Job Done; a note is required ("What needs fixing"; empty → "A review note is required to return a job for rework").
**Output:** In Progress; audit `returned_for_rework`; the technician gets `rework` with the note. The job moves to **Returned** until resubmitted, then back to **To review** with "Returned N×".

### 7. Finance queue — `/finance`, `finance_orders(p_view, p_branch_id)`

**Tabs** (`?tab=`, default **Ready to close**):
- **Not yet reviewed**: In Progress / Job Done with at least one payment (check receipts early).
- **Ready to close**: Reviewed and fully paid.
- **Payment outstanding**: Reviewed, unpaid or partly paid.
- **Closed**: closed in the last 30 days, with closed at and by.
Columns: final amount, paid, balance, receipts to verify, approved at. **Branch filter**: all branches or one.

### 8. Record a payment (Finance) — `/finance/:orderNo/payment`, `record_payment`

The technician's payment form (`PaymentForm`): amount pre-filled with the balance, method, receipt photo or PDF (required for bank transfer, card, e-wallet), note, confirmation above the balance, one-time client key. Allowed while In Progress, Job Done or Reviewed. Back on the order page: "Payment recorded."

### 9. Verify receipts — `verify_payment` / `unverify_payment`

**Who / when:** Finance; non-cash payments; order not Closed.
**Screen:** each non-cash payment shows "Not verified yet" or "✓ Verified by X at T"; Finance gets **Mark verified (RM x)** / **Undo verified (RM x)**. Others see the state only. Cash needs no tick.
**Output:** `payments.verified_by` / `verified_at` set or cleared; audit `payment_verified` / `payment_unverified` (history: "Verified a payment" / "Undid a payment verification", amount and method).

### 10. Close — `transition_order(…, 'closed')`

**Who / when:** Finance; order Reviewed; fully paid; every non-cash payment verified.
**Screen:** **Close order** is disabled with the reason ("Order must be fully paid before closing (outstanding balance RM x)" or "Verify every receipt before closing (N not verified yet)"). The dialog shows final amount and paid; closing is final.
**Output:** Closed; audit `closed`; the technician gets `job_closed` ("… was closed by Siti Aminah"). Record payment and the verify buttons disappear.

### 11. Approved by / Closed by elsewhere

The Admin order detail and the technician's job page show "Approved by X at T" (with the note) and "Closed by X at T" (`ReviewOutcome`, from `order_review_summary`) once the order is Reviewed or Closed.

### 12. Notifications

Managers and Finance have the bell and `/notifications` (0002 component). Tapping a notice opens the order in the person's portal (`/review/…` or `/finance/…`); an order a Manager no longer covers says "This order is no longer in your branches." Technicians also get **Approved** (`job_approved`) and **Closed** (`job_closed`).

## Error States

| Error | Cause | Handling |
|---|---|---|
| "Only a Manager of <branch> can approve / return …" | Manager not covering the branch | Rejected by `_authorize_transition` |
| "Tell the customer the job is done before approving" | Latest customer message not sent | Rejected; Approve disabled on screen |
| "A review note is required to return a job for rework" | Empty return note | On the field; rejected by the database too |
| "Order must be fully paid before closing (outstanding balance RM x)" | Close while unpaid / partly paid | Rejected; Close disabled with the reason |
| "Verify every receipt before closing (N not verified yet)" | Close with unverified non-cash payments | Rejected; Close disabled with the reason |
| "Only Finance can verify payments" / "Cash payments do not need verifying" | Wrong role / cash | Rejected |
| "Already verified by X at T" / "This payment is not verified" | Double tick / undo without tick | Rejected; the list reloads |
| "ORDER… is Closed and its payments can no longer be changed" | Verify / undo after closing | Rejected |
| "Managers send the prepared message as it is; only the assigned technician or an Admin can edit it" | Manager edit | Rejected (no Edit button) |
| "Only the assigned technician, an Admin or a Manager of the branch can send the customer message of an order" | Other technician, Finance, Manager of another branch | Rejected |
| "<branch> has no Manager. Add a Manager to this branch first." | Staff or order change leaving a branch without a covering Manager | Rejected (staff: at commit) |
| "Only Managers can cover additional branches" / "Choose existing branches as additional branches" / "The home branch cannot also be an additional branch" / "An additional branch is listed twice" | Bad `additional_branch_ids` | Rejected |
| "Only Managers have a review queue" / "Only Finance has a payment queue" / "Only Managers cover branches" / "Unknown … view" | Wrong role or tab | Rejected |
| "There is no order X in the branches you cover." | Manager opening another branch's order | Not found page |

## Defaults

| Setting | Default |
|---|---|
| Manager tab | To review |
| Finance tab | Ready to close |
| Reviewed / Closed tabs | Last 30 days (`QUEUE_HISTORY_DAYS`) |
| Needs attention | 3 or more returns |
| Approve note | Optional (max 500 characters) |
| Return note | Required (max 500 characters) |
| Undo a Verified tick | Allowed until the order is Closed |
| Layout | Manager / Finance / Admin desktop-first, technician phone-first; all usable at 375 px |

## Behavioral Constraints

- Approve, Return and Close still go through `transition_order`;
  `_authorize_transition` adds the branch-cover, customer-told and verified
  checks. No new statuses or moves.
- Branch rules are enforced by RLS and the RPCs, not only on screen.
- `coversBranch`, `managerViewOf`, `financeViewOf`, `approveBlockReason`,
  `closeBlockReason`, `canVerifyPayment`, `canConfirmCustomerMessage` and
  `customerOnBehalfMessage` (`src/domain/review.ts`,
  `src/domain/customerMessages.ts`) mirror the SQL;
  `tests/db/parity.test.ts` runs the same cases through both.
- `payments_verified_check`: who and when are set together, never on cash.
- Cleanup of test orders must switch off `audit_log_no_update_trg` and
  `customer_messages_guard_trg` in its transaction; uploaded receipts are
  deleted in the Storage dashboard.

## Related Documents

| Document | Type | Relationship |
|---|---|---|
| `docs/prd/0004-review-and-close-prd.md` | Intent | Product goals this workflow fulfills |
| `docs/plan/0004-review-and-close-plan.md` | Plan | Architecture this workflow implements |
| `docs/0000-system-foundation-workflow.md` | Workflow | Lifecycle stages 7 (review) and 8 (close) |
| `docs/0002-technician-job-portal-workflow.md` | Workflow | Completion, payments and the bell this builds on |
| `docs/0003-whatsapp-notification-workflow.md` | Workflow | Customer message the Manager sends |
| `docs/reference/folder-structure.md` | Reference | File locations of workflow components |
| `docs/decisions/0010-insert-staff-management-feature.md` | Decision log | Staff screen moved to 0006 |
| `docs/decisions/0011-review-and-close-implementation-details.md` | Decision log | Divergences from the 0004 plan |
| `docs/0005-customer-feedback-workflow.md` | Workflow | Poor-rating notice, feedback card, Reviewed-tab rating column |
