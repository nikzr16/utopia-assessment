# 0002 - technician_jobs Function For The Job List

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

PRD acceptance criterion 15 (a technician's job list contains only their own
orders) is listed in the plan as tested through a "query helper / view filter".
A test that only runs a filter written inside the test would not exercise any
shipped code.

## Decision

Added a seventh function, `technician_jobs(p_actor_id)`, to
`20261022000002_foundation_rules.sql`. It returns `order_summary` rows for the
acting technician only and rejects non-technician actors. It is read-only, is
granted to `anon` in the access migration, and is covered by `tests/db/orders.test.ts`.
The six RPCs in the plan are unchanged.

## Reason

Gives AC15 a real, shipped, testable implementation that feature 0002 (technician job portal) can call, at
the cost of one small function.

## Impact

- [ ] Workflow doc updated
- [ ] Reference doc updated
- [x] No upstream doc update needed
