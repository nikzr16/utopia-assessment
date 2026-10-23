# 0009 - Renumber Features In Build Order

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

Feature numbers 0004–0006 were reserved for the brief's later modules
(KPI dashboard, AI operations query, optional AI challenges) when the
roadmap was set up. The 0003 PRD then created two Phase 2 features, Manager
review / Finance close and customer feedback, which took the next free
numbers, 0007 and 0008. Phase 2 has to ship before Phase 3, so the build
order no longer matched the numbers.

## Decision

Renumber the planned features so numbers follow the build order:

| Feature | Old | New |
|---|---|---|
| `review-and-close` (Manager review, Finance close) | 0007 | 0004 |
| `customer-feedback` (feedback link and page) | 0008 | 0005 |
| `kpi-dashboard` | 0004 | 0006 |
| `ai-ops-query` | 0005 | 0007 |
| `ai-advanced` | 0006 | 0008 |

Updated to the new numbers: the roadmap phase tables and graduation
criteria (earlier Prioritization Log rows keep the old numbers; a new row
records the change), the 0003 PRD, plan and workflow doc, the 0001 PRD's
KPI dashboard reference, `CLAUDE.project.md`, a test name, and two
comments in `supabase/migrations/20261023000001_whatsapp_notification.sql`
("0005 adds the feedback link here", "Manager / Finance access comes with
0004").

The migration edit is comment-only: both comments sit outside function
bodies and policy definitions, so nothing stored in the database changes
and the hosted project needs no update. Supabase tracks migrations by file
name, not content.

Also updated: the module range in the 0000 PRD, plan and workflow doc
(0001–0006 → 0001–0008), the 0000 plan's "automated flagging belongs to"
and the 0002 PRD's "AI supervisor" references (0006 → 0008).

Not changed: decision log numbers, which are a separate sequence from
feature numbers (decision 0008 is the 0003 implementation record).

## Reason

Numbers that match the build order make the next feature obvious and keep
PRDs, plans, workflow docs and branches in sequence.

## Impact

- [x] Workflow doc updated
- [x] Reference doc updated
- [ ] No upstream doc update needed
