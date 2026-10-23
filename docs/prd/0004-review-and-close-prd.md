# 0004 - Review and Close PRD

> **Type:** Intent | **Must stay current:** No -- record divergences in decision log

<!-- AI Context
Role: This document captures product intent, not implementation detail.
Use it to understand *what* the feature should do and *why*, then consult the
implementation plan and workflow docs for *how*.
Do not rewrite this document during coding. If implementation diverges from
the intent described here, add an entry to the decision log instead.
-->

## Purpose

The brief's flow ends with "Manager / Accounts Review", but today a job stops
at Job Done on screen: Managers and Finance only see a placeholder page. The
database already allows the last two steps (0000 stages 7 and 8). This PRD
adds the screens for them: a Manager portal to approve a finished job or
return it for rework, and a Finance portal to verify payments, record
missing ones, and close reviewed, fully paid orders. With it an order can go
from creation to Closed through the app's screens, which is Phase 2's
graduation path. It also makes sure every branch has a Manager, so no job is
left without someone who can review it.

Source: the brief's flow "Order → Assignment → Service Completion → Manager /
Accounts Review", its states "Job Done → Reviewed → Closed", "Managers may
review completed jobs", and the Module 2 bonus "Notify manager/accounts when
job completed" (`docs/prd/0000-programmer-assessment-brief.docx`); 0002 PRD
Q14 and 0003 PRD Q10 moved these screens here.

## Goals

- A Manager sees the jobs waiting for review in the branches they cover,
  opens one, checks the work, and approves it (Reviewed) or returns it for
  rework with a note.
- A Manager can cover more than one branch, so a branch whose Manager left
  is looked after by another Manager until a replacement arrives.
- Every branch has a Manager before it has any other staff or orders.
- Finance verifies each non-cash receipt, records any missing payment with
  a receipt, and closes a reviewed order once it is fully paid and verified.
- Managers, Finance, and technicians are told in-app (bell) when a job
  needs them or changes, and tapping the notice opens the order.
- An order can go New → … → Closed using only the app's screens.
- Admins and technicians can see who reviewed and who closed a job, and when.

## Non-Goals

- The customer feedback link and page (0005 `customer-feedback`).
- A staff management screen (create staff, assign branches, deactivate):
  separate feature 0006 `staff-management` (Q13). Until it ships, staff and
  branch cover change by SQL.
- KPI dashboard and AI query (0007, 0008).
- Editing or deleting a payment that was recorded wrongly.
- Re-opening a Closed order (Closed stays terminal, 0000).
- New order statuses or new lifecycle moves; 0000's moves are reused.
- Notification screens for Admins.

## Scope

| In Scope | Out of Scope |
|---|---|
| Manager branch cover: a Manager covers their home branch and any extra branches assigned to them | Staff management screen (0006) |
| Rule: a branch needs an active Manager before other staff or orders; seed Managers for Penang, Johor Bahru, Kota Kinabalu | Customer feedback (0005) |
| Manager portal: To review / Returned / Reviewed tabs, review page, Approve (optional note), Return for rework (required note) | Editing / voiding payments |
| Managers send and confirm the 0003 customer message, worded "on behalf of" the technician | Admin notification bell |
| Approve blocked until the customer was told | Re-opening Closed orders |
| Finance portal: Not yet reviewed / Ready to close / Payment outstanding / Closed tabs, Verify receipt, Record payment, Close | New lifecycle statuses |
| Notification bell for Managers and Finance; technician told on approve and close | |
| "Approved by X at T" and "Closed by X at T" on Admin and technician screens | |
| Technician screens phone-first; Manager, Finance, Admin desktop-first; all usable on both | |

## User Stories

1. **As a Manager**, I want a list of jobs waiting for review in my branches so that nothing finished sits unchecked.
2. **As a Manager**, I want to see the completion record, files, payments, and whether the customer was told on one page so that I can judge the job without asking anyone.
3. **As a Manager**, I want to approve a job in one step, with an optional note, so that Finance can clear it.
4. **As a Manager**, I want to return a job with a note so that the technician knows exactly what to fix.
5. **As a Manager**, I want to follow up on jobs I returned and see the jobs I approved so that I keep track of my branch.
6. **As a Manager**, I want jobs returned many times flagged so that I can spot repeat problems.
7. **As a Manager**, I want to tell the customer myself when the technician has not, so that I can approve the job.
8. **As a Manager**, I want to cover another branch while it has no Manager so that its jobs are still reviewed.
9. **As Finance**, I want to see orders by stage (not yet reviewed, ready to close, payment outstanding, closed) so that I know what to verify, close, and chase.
10. **As Finance**, I want to tick each receipt as verified so that I only close orders whose money I have checked.
11. **As Finance**, I want to record a payment that came straight to the office (with a receipt) so that the balance is right.
12. **As Finance**, I want closing to be blocked until the order is fully paid and verified so that no unpaid job is marked finished.
13. **As a Manager or Finance user**, I want a bell that tells me when a job needs me so that I act promptly.
14. **As a Technician**, I want to be told when my job is approved and when it is closed so that I know it is finished.
15. **As an Admin or Technician**, I want to see who approved and closed a job and when so that I can answer the customer.

## Product Decisions

Decisions already fixed by the brief, 0000, 0002, or 0003:

| Decision | Rationale |
|---|---|
| Only Managers move Job Done → Reviewed or Job Done → In Progress (rework, note required); the technician is notified with the note | 0000 stage 7 |
| Only Finance moves Reviewed → Closed, and only when payment status is `paid` | 0000 stage 8 |
| Finance and the assigned technician can record a payment while In Progress, Job Done, or Reviewed; non-cash needs a receipt; one-time client key | 0000 stage 6, 0002 Q10 |
| Every active Finance user is notified on Reviewed and on a technician's payment | 0000, 0002 Q13 |
| Final amount = quoted price + extra charges; payment status is derived, never stored | 0000 |
| Job files and receipts are read through signed URLs | 0002 Q7 |
| The customer message is prepared on every Job Done; sent by `wa.me` link and confirmed by a person; a confirmed message never changes | 0003 |
| Writes go through RPCs; the actor is the signed-in user | 0000 |
| Malaysia time (UTC+8), MYR | 0000 |

Decisions made by this PRD (answered 2026-10-23):

| Decision | Rationale |
|---|---|
| A Manager covers their home branch plus any extra branches assigned to them; they see and act only on orders of branches they cover; Job Done notifies every Manager covering the order's branch (Q1 b) | Branch accountability, with temporary cover when a branch loses its Manager |
| Manager portal tabs: **To review** (Job Done, oldest first, resubmissions marked), **Returned** (sent back, still In Progress), **Reviewed** (approved in the last 30 days) (Q2 a) | The Manager follows up on returned jobs and keeps their own history |
| Managers can send and confirm the customer message (as the technician and Admins can); when a Manager sends it, the text says it is sent on behalf of the technician (Q3 b) | The Manager can unblock approval; the customer knows who is writing |
| Approve is blocked until the latest customer message is sent or told by phone (Q4 b) | No job is approved before the customer knows it is done |
| Approve has an optional note (shown in the history to Finance); Return for rework needs a note (Q5 a) | Quick approvals; the technician always knows what to fix |
| Finance sees every branch, with a branch filter, in four tabs: **Not yet reviewed** (In Progress / Job Done with payments), **Ready to close** (Reviewed, paid), **Payment outstanding** (Reviewed, unpaid / partial), **Closed** (last 30 days) (Q6 b) | One central Finance team; receipts can be checked before review |
| Finance records payments from the order page with the technician's payment form (balance pre-filled, receipt for non-cash, confirmation above the balance); technicians keep recording too (Q7 a) | Office payments get recorded; both people who handle money can |
| Each non-cash payment needs Finance's "Verified" tick (who, when) before Close is allowed (Q8 b) | Finance signs off each receipt, not just the total |
| Managers and Finance get the notification bell and list; tapping a notice opens the order in their portal; technicians are also told when their job is approved and when it is closed (Q9 b) | Everyone hears about the step that concerns them |
| Technician screens stay phone-first; Manager, Finance, and Admin screens are desktop-first; every screen works on both desktop and a 375 px phone (Q10) | Matches who uses which device, without locking anyone out |
| Rework has no limit; the review page shows the return count and every earlier return note; a job returned 3 or more times is flagged "Needs attention" in the queue (Q11 b) | Repeat problems stand out |
| Admin order detail and the technician job page show "Approved by X at T" (with the note) and "Closed by X at T"; the history lists every review, return, verification, and close (Q12 a) | Anyone can answer "is my job finished?" at a glance |
| A branch must have an active covering Manager before any other active staff can belong to it or any order can be created for it; a branch's last covering Manager cannot be deactivated, moved, or have the cover removed while other active staff remain; seed data adds one Manager each for Penang, Johor Bahru, and Kota Kinabalu (Q13 a) | Every branch's jobs always have a reviewer |
| A staff management screen is a separate feature, 0006 `staff-management`, right after 0005; planned 0006–0008 move to 0007–0009 (Q13 follow-up) | Keeps 0004 focused; creating sign-ins needs a server function and its own decisions |

## Constraints

- Lifecycle moves reuse `transition_order` and `record_payment`. Every
  database change (branch cover, read access, approve and close guards,
  verification, notifications) is a new timestamped migration; 0000–0003
  migrations are committed and append-only. A rule change also updates the
  `src/domain/` mirror and passes `tests/db/parity.test.ts`.
- Brief stack: React, Tailwind CSS, Supabase. No new paid service.
- Real authentication stays; the actor is never a parameter. Branch rules
  are enforced in the database (RLS and RPCs), not only on screen.
- The hosted Supabase project has 0000–0003 applied; schema changes ship with
  SQL for it, and new seed Managers get logins through
  `npm run auth:create-staff-logins`.

## Acceptance Criteria

| # | Criterion | Verifiable By |
|---|---|---|
| 1 | A signed-in Manager sees the Manager portal; Finance sees the Finance portal; Admins and technicians keep their portals | test + manual check |
| 2 | A Manager sees, reviews, and gets Job Done notices only for orders in branches they cover (home branch plus assigned cover); other branches' orders are hidden and rejected by the database | test + manual check |
| 3 | Adding or activating a non-Manager staff member, or creating an order, for a branch with no active covering Manager is rejected; the last covering Manager of a branch with other active staff cannot be deactivated, moved, or uncovered | test |
| 4 | Seed data has a Manager for each of the five branches | test |
| 5 | Manager tabs: To review (Job Done, oldest first, resubmissions marked), Returned (sent back, In Progress), Reviewed (approved in the last 30 days); a job returned 3 or more times shows "Needs attention" | test + manual check |
| 6 | The review page shows order details, completion record, files, payments with receipts and verification, final amount and payment status, customer message status, return count, and history with every earlier return note | test + manual check |
| 7 | Approve (optional note) moves the order to Reviewed; Finance and the technician are notified; Approve is disabled, and rejected by the database, until the latest customer message is sent or told by phone | test + manual check |
| 8 | Return for rework requires a note, moves the order to In Progress, and notifies the technician with the note | test + manual check |
| 9 | A Manager can send and confirm the customer message; a Manager-sent message says it is sent on behalf of the technician; once confirmed it shows "Sent by X at T" | test + manual check |
| 10 | Finance sees every branch with a branch filter, in tabs Not yet reviewed, Ready to close, Payment outstanding, and Closed (last 30 days), each row with final amount, paid, and balance | test + manual check |
| 11 | Finance can tick each non-cash payment "Verified" (who, when); only Finance can verify | test + manual check |
| 12 | Finance can record a payment with method and amount; non-cash needs a receipt photo or PDF; a retry never records it twice | test + manual check |
| 13 | Close is offered only when the order is Reviewed, fully paid, and every non-cash payment is verified; it asks for confirmation; the database rejects any other close; the technician is notified | test + manual check |
| 14 | Managers and Finance get the notification bell and list; tapping a notice opens that order in their portal | test + manual check |
| 15 | Admin order detail and the technician job page show "Approved by X at T" (with note) and "Closed by X at T"; history lists reviews, returns, verifications, and the close | test + manual check |
| 16 | Other access rules from 0000–0003 still hold; Finance can read but not send the customer message | test |
| 17 | Technician screens are phone-first; Manager, Finance, and Admin screens are desktop-first; all work at 375 px wide and on desktop; every control has a visible label | manual check |

## Roadmap Phase

**Phase:** 2 – Core workflow

## Related Documents

| Document | Type | Relationship |
|---|---|---|
| `docs/prd/0000-programmer-assessment-brief.docx` | Source brief | Workflow, statuses, "Manager / Accounts Review" |
| `docs/prd/0000-system-foundation-prd.md` | Intent | Lifecycle rules for review and close |
| `docs/prd/0002-technician-job-portal-prd.md` | Intent | Completion record, files, payments, bell; Q14 |
| `docs/prd/0003-whatsapp-notification-prd.md` | Intent | Customer message; Q10 |
| `docs/product-roadmap.md` | Roadmap | Phase assignment and sequencing for this PRD |
| `docs/plan/0004-review-and-close-plan.md` | Plan | Implementation path for this PRD |
| `docs/0004-review-and-close-workflow.md` | Workflow | Runtime behavior derived from this PRD |
| `docs/reference/folder-structure.md` | Reference | Structural placement of the feature |
| `docs/decisions/0010-insert-staff-management-feature.md` | Decision log | Staff management inserted as 0006; later features renumbered |
| `docs/decisions/NNNN-*.md` | Decision log | Divergences from this PRD |

## Open Questions

All answered on 2026-10-23; decisions are recorded in Product Decisions.

- [x] **Q1. Which orders a Manager sees and can review.** (b) Own branches only, enforced in the database; a Manager can cover several branches (temporary cover when a branch has no Manager).
- [x] **Q2. Manager queue tabs.** (a) To review, Returned, Reviewed.
- [x] **Q3. Customer message on the review page.** (b) Managers can send and confirm it; the text says it is sent on behalf of the technician.
- [x] **Q4. Should approval wait until the customer was told?** (b) Block Approve until sent or told by phone.
- [x] **Q5. Approve and Return actions.** (a) Optional approve note; required return note.
- [x] **Q6. Which orders Finance sees.** (b) All branches with a filter; Not yet reviewed, Ready to close, Payment outstanding, Closed.
- [x] **Q7. Finance recording payments.** (a) Finance records payments with the technician's form; technicians keep recording too.
- [x] **Q8. Verifying payments before closing.** (b) Each non-cash payment needs a "Verified" tick before Close.
- [x] **Q9. Notification bell.** (b) Bell for Managers and Finance; technicians told on approve and close.
- [x] **Q10. Layout.** Technician phone-first; Manager, Finance, Admin desktop-first; all work on both.
- [x] **Q11. Rework round-trips.** (b) No limit; return count and notes shown; "Needs attention" after 3 returns.
- [x] **Q12. What Admins and technicians see.** (a) "Approved by X at T" and "Closed by X at T" on the order.
- [x] **Q13. Every branch needs a Manager first.** (a) Database rule incl. orders; seed Managers for Penang, Johor Bahru, Kota Kinabalu. A staff screen is separate feature 0006 `staff-management`, right after 0005.
