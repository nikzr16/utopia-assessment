# 0016 - AI Operations Query Implementation Details

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

Feature 0008 (`docs/prd/0008-ai-ops-query-prd.md`,
`docs/plan/0008-ai-ops-query-plan.md`) was built, tested, deployed to the
hosted project and checked there with the real model (`gpt-6-luna`) as a
Manager, an Admin, Finance and a technician, at desktop and phone width.
The details below differ from the PRD or the plan.

## Decision

1. **The secret key is used for saving (plan P3, PRD constraint).** The PRD
   said the Edge Function holds no database secret key for this feature. The
   `ask` function uses it only to call `ask_record` (granted to
   `service_role` only), so no one can plant a chat answer or a Question log
   entry from the browser. Every lookup still runs with the person's token.
2. **"How I found this" has no Details toggle (PRD Q9).** The PRD chose a
   plain line plus a "Details" toggle with the function name and inputs. In
   the hosted check the user asked to remove it: staff should not see JSON,
   ids or function names. Answers show only the plain-words line; the
   result sent to the browser no longer carries the function and inputs.
   The Admin Question log names lookups in plain words ("a technician's
   jobs", "totals", "job list"); the function and inputs stay in `ask_log`.
3. **Names are matched by the server inside each lookup.** The plan listed
   `find_people` as an AI tool. Instead every lookup that takes
   `technician_name` runs `ask_find_people` itself, so the AI needs one call
   fewer and an ambiguous name stops with fixed "Did you mean…?" buttons
   before any read.
4. **The final answer is plain text, not structured JSON.** Function tools
   and `text.format` in one request are not documented for `gpt-6-luna`, and
   a forum report says it can add a stray text item to structured output.
   The server reads the last message's text and caps it at 800 characters;
   the table and numbers come from the rows anyway.
5. **"Completed" answers always add "waiting for review" (PRD Q5).** In the
   hosted check the model skipped it when the prompt said "when it helps";
   the instruction now asks for `job_list` with status Job Done whenever the
   question is how many jobs were completed.
6. **People by name, never he / she; "(inactive)" said in the sentence.**
   Added to the instructions after the hosted check produced "He" for a
   technician.
7. **`ask_jobs` and `ask_payments` are security invoker; `ask_find_people`
   is security definer.** The first two read the security-invoker views, so
   row-level security decides the rows, with `_ask_scope` (granted, definer)
   giving the KPI refusals and periods. Name search needs `staff_history`,
   which has no client grant, so it is definer and scopes itself.
8. **Limits not in the PRD:** a question is at most 1,000 characters, an
   answer 800; at most 4 AI calls per question (the last must answer); 30
   rows per lookup go to the AI, 50 to the table; the server stops at 18 s.
9. **The migration enables `pg_cron` itself** when the extension is
   available (Supabase), so no dashboard step was needed (plan P4).
10. **Technician refusal wording.** When a technician asks about someone
    else, the model usually declines in its own words ("I can only look up
    your own work…") without a lookup; if it does look up, the server's
    fixed sentence applies. Either way nothing is read.
11. **Extra periods:** tomorrow, next week and next month (for scheduled
    jobs) besides the plan's list.
12. **Hosted check test data** reused the 0007 script and added "AI Test"
    orders, a second "Ali" and an inactive technician
    (`docs/draft/0008-test-data.sql`, removed with
    `docs/draft/0008-cleanup-test-orders.sql`).

## Reason

Items 1, 3, 4 and 7 keep the database the only authority while making the
log trustworthy and the AI step simpler; items 2, 5 and 6 came from the
hosted check with the real model; items 8–11 bound cost and time without
app rate limits (PRD Q14) and make scheduled-job questions work.

## Impact

- [x] Workflow doc written (`docs/0008-ai-ops-query-workflow.md`)
- [x] Reference doc updated (`docs/reference/folder-structure.md`)
- [x] Upstream: roadmap (0008 shipped, Phase 3 graduated), `CLAUDE.project.md`
  (layout, commands, domain rule 12, secrets), README (AI section)
