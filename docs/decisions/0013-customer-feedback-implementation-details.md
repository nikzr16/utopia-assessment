# 0013 - Customer Feedback Implementation Details

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

Feature 0005 (`docs/prd/0005-customer-feedback-prd.md`,
`docs/plan/0005-customer-feedback-plan.md`) was built and checked on the
hosted project. A few details differ from the plan or were settled during
the build and the manual check.

## Decision

1. **No audit entry for a customer's own submission.** The plan had
   `submit_feedback` write an audit entry `feedback_received` with no actor.
   `audit_log.actor_id` is required and the history screen names the actor,
   so the `customer_feedback` row (with its time) is the record instead.
   Ratings taken by phone are audited (`feedback_recorded`) because a staff
   member records them.
2. **`manager_orders` is not recreated.** The plan recreated it to add the
   latest rating. Instead `order_review_summary` gains `latest_rating` and
   `latest_working_well` at the end (`create or replace view`), and
   `manager_orders` / `finance_orders`, which return that row type, carry
   them unchanged.
3. **A link is "replaced" as soon as the job is back In Progress.** The plan
   called a link open while its message is the order's latest and the order
   is Job Done, Reviewed or Closed. During a rework the old message is still
   the latest, so an unused link already shows "no longer active. We will
   send you a new link when the job is done" while the job is being fixed.
4. **A rating taken by phone needs the order Job Done, Reviewed or Closed**
   (not during a rework), as for the customer message itself. "Until the
   next visit" (plan P4) therefore ends when the job is returned.
5. **The migration sets `feedback_link_base` itself** to
   `http://localhost:5173`, so local and hosted behave the same until 0010
   changes it (decision 0012).
6. **Fixes from the manual check.** The technician's feedback card now
   reloads after the message is confirmed (it kept saying the link "goes
   out with the customer message"); each "required" message on the feedback
   form clears as soon as that question is answered.
7. **Two more local dev configurations** in `.claude/launch.json`
   (`web-third-role`, `web-customer`) so Admin, technician, Manager and a
   signed-out customer can be checked side by side. A signed-out tab can also
   use the `[::1]` address of a running server (a different origin, so no
   session).

## Reason

Each keeps the PRD's behavior while fitting the existing schema (required
audit actor, row types shared by the queue functions) or makes the screens
match what the user sees during the check.

## Impact

- [x] Workflow doc updated (`docs/0005-customer-feedback-workflow.md`)
- [x] Reference doc updated (`docs/reference/folder-structure.md`)
- [ ] No upstream doc update needed
