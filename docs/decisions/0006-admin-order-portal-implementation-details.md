# 0006 - Admin Order Portal Implementation Details

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

Building feature 0001 (`docs/plan/0001-admin-order-portal-plan.md`) surfaced
details the plan did not spell out or got slightly wrong.

## Decision

- **Phone search is anchored when a prefix is typed.** The plan said search
  matches "digits of the query against the stored digits". `list_orders` now
  matches from the start of the stored number when the typed digits begin
  with `0` or `60` (`012-345` → `6012345…`), and anywhere otherwise (`6789`).
- **Edit conflicts compare `updated_at` to the millisecond.** The plan said
  `update_order` rejects a save when `p_expected_updated_at` differs. It
  compares both values truncated to milliseconds.
- **Separate price messages.** The plan named one message ("between RM 0.00
  and RM 100,000.00"). The rule has one message per case: required, "must be
  zero or more" (the 0000 message, kept), "cannot be more than RM 100,000.00",
  "can have at most 2 decimal places".
- **`+60 0…` is accepted.** A stray trunk 0 after the country code
  (`+60 012-345 6789`) is accepted and normalised like `012-345 6789`.
- **Reschedulable statuses are mirrored too.** `RESCHEDULABLE_STATUSES` in
  `src/domain/orderEditing.ts` (not in the plan) decides when Reschedule is
  offered; the parity test checks it against `reschedule_order`.
- **Default branch matched by name.** The new order form defaults the branch
  by matching the Admin's profile `branchName` to the branch list, because the
  0000 profile carries no branch id.
- **jsdom 26, not the latest.** jsdom 30 does not support Node 23; jsdom 26 is
  used for component tests, as Vitest stays on 3.x.

## Reason

Unanchored phone search returned unrelated numbers (`+60 12 345` also matched
`60112345…`), found during DB testing. Browsers keep timestamps at
millisecond precision, so an exact microsecond comparison could reject every
save from a client that parsed the timestamp. Keeping the 0000 negative-price
message leaves the 0000 tests and behavior unchanged. The other points are
small additions that keep screen and database rules in step.

## Impact

- [x] Workflow doc updated
- [x] Reference doc updated
- [ ] No upstream doc update needed
