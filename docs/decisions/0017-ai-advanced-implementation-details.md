# 0017 - AI Advanced Challenges Implementation Details

> **Date:** 2026-10-24 | **Status:** Accepted

<!-- AI Context
Role: This is an append-only record of a single implementation divergence.
Each entry captures why the deviation happened and what it affects.
Never edit an existing decision log entry. To reverse a previous decision,
create a new entry that references the original. After adding an entry,
check the impact checklist below and update affected workflow or reference
docs before the session ends.
-->

## Context

Feature 0009 (`docs/prd/0009-ai-advanced-prd.md`,
`docs/plan/0009-ai-advanced-plan.md`) was built, tested, deployed to the
hosted project and checked there with the real model (`gpt-6-luna`) as an
Admin, a technician and a Manager, at desktop and phone width. The details
below differ from the PRD or the plan.

## Decision

1. **Migration name.** The plan named `20261025000001_ai_advanced.sql`; the
   file is `20261024000002_ai_advanced.sql` (built on the same day as 0008).
2. **A rule warning whose numbers change reopens (PRD Q8, plan "Rules").**
   The plan kept a checked rule warning checked when its cause persisted. A
   warning whose numbers change (e.g. a third return, a higher amount after
   rework) is now resolved and a new **open** one replaces it, so a Manager's
   note always refers to what they saw. Same numbers: the check stays.
3. **Only the key helper is shared (plan "Function layout").** The plan moved
   the OpenAI plumbing to `supabase/functions/_shared/`. `ask` uses function
   tools and a stream; `ai-assist` uses strict JSON (`text.format`) with no
   tools, so each keeps its own small client. `_shared/keys.ts` holds the
   Supabase key helper and a constant-time secret compare.
4. **No `order_warning_counts` function.** The review queue reads open
   warnings straight from `order_warnings` under RLS (one query per page).
5. **Re-check runs only the asker's run.** `supervisor_ai_input` takes
   `p_requested_by`; a Manager's token can only run the check that Manager
   requested (`request_supervisor_recheck`), not someone else's or the
   automatic one.
6. **Warnings are ordered by a sequence column.** Several AI warnings are
   saved in one transaction, so `opened_at` cannot order them; `seq` keeps
   the AI's order.
7. **Warnings follow their order on delete.** The guard refuses deleting a
   warning while its order exists; deleting the order (test cleanup) removes
   its warnings without switching the guard off.
8. **A date with no time is filled as 09:00 (PRD Q11).** The scheduled date
   and time field needs a time; the note says "No time was on the form: the
   time is set to 09:00."
9. **`createOrder` returns the id too.** The browser needs the new order's id
   to upload the order form after saving (plan P2).
10. **Busy / quiet need at least 2 technicians** in the team (one technician
    cannot be above or below their own average). The plan did not say.
11. **Insight sentences name the period** ("this week (Mon 19 – Sun 25 Oct
    2026)" or "in Mon 12 – Sun 18 Oct 2026"); its numbers are allowed in the AI
    wording. Only the AI's own sentences are saved, so a reused wording still
    marks fixed sentences correctly.
12. **Ask table formatting.** In the hosted check the insights table showed a
    rating of 2.0 as "2"; averages and ratings now show one decimal.
13. **Test data and samples.** The hosted check reused the 0008 test data with
    the supervisor triggers switched off for the history part, added 22 "AI
    Test 9xx" orders (busy / quiet week, backlog, reschedules, rating drop, and
    six Job Done jobs that ran real AI checks), and three generated sample forms
    (clear English photo, Malay PDF, blurry photo)
    (`docs/draft/0009-test-data.sql`, `docs/draft/0009-samples/`, removed with
    `docs/draft/0009-cleanup-test-orders.sql`).

## Reason

Items 2, 5, 6 and 7 make the audit trail exact and safe; items 3, 4 and 9 are
smaller than the plan without losing anything; items 8, 10 and 11 fill gaps
the plan left open; item 12 came from the hosted check.

## Impact

- [x] Workflow doc written (`docs/0009-ai-advanced-workflow.md`); 0002, 0004
  and 0008 workflow docs updated (order form file, approve guard, AI log and
  `workload_insights`)
- [x] Reference doc updated (`docs/reference/folder-structure.md`)
- [x] Upstream: roadmap (0009 shipped, Phase 4 graduated), `CLAUDE.project.md`
  (layout, commands, domain rule 13, secrets), README (AI section)
