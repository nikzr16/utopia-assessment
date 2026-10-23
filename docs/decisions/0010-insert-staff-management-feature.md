# 0010 - Insert Staff Management Feature

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

The 0004 PRD (Q13) requires every branch to have an active Manager before
it has other staff or orders, and lets a Manager cover several branches
(Q1). Staff are created only by seed data and SQL today, and creating a
sign-in needs the Supabase secret key, which must never reach the browser.
Building a staff screen inside 0004 would roughly double that feature.

## Decision

Staff management (create staff and their sign-ins, assign Manager branch
cover, deactivate) is a separate feature, `staff-management`, in Phase 2
right after customer feedback. Because feature numbers follow the build
order (decision 0009), the planned features after it move up by one:

| Feature | Old | New |
|---|---|---|
| `staff-management` | — | 0006 |
| `kpi-dashboard` | 0006 | 0007 |
| `ai-ops-query` | 0007 | 0008 |
| `ai-advanced` | 0008 | 0009 |

Updated to the new numbers: the roadmap phase tables and graduation
criteria (Phase 2 now needs 0001–0006; earlier Prioritization Log rows keep
the old numbers; a new row records the change), `CLAUDE.project.md`, the
module range in the 0000 PRD, plan and workflow doc (0001–0008 →
0001–0009), the 0000 plan's "automated flagging belongs to" and the 0002
PRD's "AI supervisor" references (0008 → 0009), and the 0001 PRD's KPI
dashboard reference (0006 → 0007).

Not changed: decision log numbers (a separate sequence), code, and
migrations (none name these features).

Until 0006 ships, the 0004 database rule protects every way staff are
added, and staff or branch cover changes are made by SQL.

## Reason

Keeps 0004 focused on review and close so Phase 2's path to Closed ships
sooner, and gives staff management (who may create whom, first passwords,
deactivation) its own PRD and decisions.

## Impact

- [x] Workflow doc updated
- [ ] Reference doc updated (it names no planned feature numbers)
- [ ] No upstream doc update needed
