# 0003 - Guards On Reschedule And Payment Not Spelled Out In The Plan

> **Date:** 2026-10-22 | **Status:** Accepted

<!-- AI Context
Role: This is an append-only record of a single implementation divergence.
Each entry captures why the deviation happened and what it affects.
Never edit an existing decision log entry. To reverse a previous decision,
create a new entry that references the original. After adding an entry,
check the impact checklist below and update affected workflow or reference
docs before the session ends.
-->

## Context

The plan says `reschedule_order` may be used by Admin or the assigned technician
and `record_payment` by the assigned technician or Finance (the latter only while
the order is In Progress, Job Done or Reviewed). It does not say which order
statuses allow a reschedule, or what happens with an empty "other" reason.

## Decision

- `reschedule_order` is allowed only while the order is New, Assigned,
  Acknowledged or In Progress. Completed, Reviewed, Closed and Cancelled orders
  are rejected ("Only an order that is not yet completed can be rescheduled").
- When the reason is `other`, a note is required.
- Audit entries for payments and reschedules carry no `from_status` / `to_status`
  (they are not status changes); the current status is kept in `details`.
- A technician cannot reschedule an order that is not assigned to them.

## Reason

Rescheduling a finished order has no meaning, and "other" with no text loses the
information the reschedule log exists to capture. Keeping non-status audit entries
free of from/to makes "every status change" queries (AC12) exact.

## Impact

- [ ] Workflow doc updated
- [ ] Reference doc updated
- [x] No upstream doc update needed
