# 0011 - Review and Close Implementation Details

> **Date:** 2026-10-23 | **Status:** Accepted

<!-- AI Context
Role: This is an append-only record of a single implementation divergence.
Each entry captures why the deviation happened and what it affects.
Never edit an existing decision log entry. To reverse a previous decision,
create a new entry that references the original. After adding an entry,
check the impact checklist below and update affected workflow or reference
docs before the session ends.
-->

## Context

Feature 0004 (`docs/prd/0004-review-and-close-prd.md`,
`docs/plan/0004-review-and-close-plan.md`) was built and checked by hand on
the hosted project. A few details differ from the plan, or were settled
where the PRD and plan left them open.

## Decision

1. **Order branch check is a trigger.** The plan put the "branch needs a
   Manager" check in `create_order` and `update_order`. It is
   `orders_branch_manager_trg` (before insert, or update of `branch_id`)
   instead, so every way of writing an order is covered and the 0001 RPCs
   are not redefined. Editing an order without changing its branch is not
   checked.
2. **One data module for both portals.** The plan listed an `api` in
   `features/review/` and `features/finance/`. Both portals use
   `features/order-review/api.ts`, next to the shared order page they both
   render.
3. **`order_review_summary` view.** The queue functions return rows of this
   `security_invoker` view (order summary plus return count, latest message
   status, payment and unverified counts, approved / closed by and when).
   The order page and the "Approved by / Closed by" lines read it too.
4. **The `RoleHome` placeholder is removed.** Every role now has a portal.
5. **On-behalf message details.** It names the order's branch (not the
   Manager's home branch) and the technician on the completion record. A
   landline customer told by phone keeps the prepared text.
6. **Approve guard.** Approve is refused only while the latest customer
   message is `not_sent`; an order with no message at all (not reachable
   after 0003) is not blocked.
7. **Verification state is visible to everyone who sees payments.** Admins,
   Managers and technicians see "Not verified yet" / "Verified by X at T" on
   non-cash payments; only Finance has Mark verified / Undo. Close checks
   payment first, then verification.
8. **Phone layout.** After the manual check, the order page's actions card,
   return notes and customer message come first on a phone and sit beside
   the details on a wide screen.
9. **History labels.** The manual check showed raw `payment_verified` /
   `payment_unverified` in the history; they now read "Verified a payment" /
   "Undid a payment verification" with the amount and method.
10. **Notifications page per portal.** `NotificationsPage` takes the portal's
    order path and the message for an order the person can no longer read.
11. **Note lengths.** The approve and return notes are limited to 500
    characters on screen (the database keeps its existing rule: return note
    required).

## Reason

Each keeps the database the rule authority with the fewest redefinitions of
earlier functions, and keeps the two portals on one tested page.

## Impact

- [x] Workflow doc updated (`docs/0004-review-and-close-workflow.md`; 0000–0003 workflow docs)
- [x] Reference doc updated (`docs/reference/folder-structure.md`)
- [ ] No upstream doc update needed
