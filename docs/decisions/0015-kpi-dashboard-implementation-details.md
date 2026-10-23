# 0015 - KPI Dashboard Implementation Details

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

Feature 0007 (`docs/prd/0007-kpi-dashboard-prd.md`,
`docs/plan/0007-kpi-dashboard-plan.md`) was built, reviewed, and checked on
the hosted project with backdated test orders over eight weeks plus live
orders through the app. No product decision changed; the details below differ
from the plan.

## Decision

1. **No new feedback index.** The plan listed
   `customer_feedback (order_id, created_at desc)`; 0005 already has it.
2. **Latest rating per order is chosen by visit** (the latest customer
   message), the same rule as `order_review_summary`, so the dashboard and
   the order page always show the same rating. Its credit is
   `customer_feedback.technician_id`, else the completion technician.
3. **Reschedule backfill** uses the latest `created` / `assigned` /
   `reassigned` audit entry before the reschedule; only an order with no
   assignment history at all falls back to its current technician, and an
   unassigned order stays null.
4. **Extra private helpers** (`_kpi_day_start`, `_kpi_events`, `_kpi_metrics`,
   `_kpi_needs_attention`) so each definition exists once.
5. **Three period errors instead of one:** "Choose a start and an end date",
   "The period must end after it starts", "Choose a period of up to a year".
6. **`kpi_trend.p_end` is exclusive** like the other functions, and each row
   also returns `period_end`.
7. **Richer rows:** `kpi_technicians` also returns per-technician rescheduled,
   postponed, requester and reason counts; `reason_by_requester` (json) is on
   `kpi_summary` only. For a technician caller `active_technicians` is 1 (not
   null).
8. **Layout:** the leaderboard is full width with the charts in a two-column
   grid below it (ten columns do not fit beside a chart); the plan had them
   side by side.
9. **Empty period:** the message shows and the zero cards and leaderboard
   stay; no chart is drawn, including the trend, even when other periods have
   data.
10. **Branch comparison** appears only when two or more branches are visible
    (so not for a Manager covering one branch), always covers every visible
    branch whatever the branch filter says, and shows one measure at a time
    (jobs, amount, reschedules, average rating) — never two scales on one
    chart.
11. **Chart limits:** the per-technician bar chart shows the first 15 with a
    note (the table lists everyone); a chart whose values are all zero shows
    a sentence instead; the trend chart draws jobs completed only (the other
    measures are in its table view).
12. **Drill-down cards** come from the person's `kpi_technicians` row; there
    is no single-technician summary function.
13. **A refused or stale branch in the address** shows the database message
    with a **Show all branches** button instead of an empty page.
14. **CSV download** frees the file a second after the click (an immediate
    release can cancel the save in some browsers).
15. **Timed test budget:** the full-year call in `tests/db/kpi-volume.test.ts`
    has an 8-second budget (it takes under 1 s alone; the whole suite runs in
    parallel); week and month views keep the 2-second budget.
16. **Chart colours** use the validated categorical order blue `#2a78d6`,
    orange `#eb6834`, aqua `#1baf7a`. Aqua (2.8:1) and orange (3.2:1) are
    close to or under 3:1 on white, so every chart also has a legend, named
    tooltips, 2 px gaps between segments, and a table view.

## Reason

Items 1–7 keep one definition per number and make the dashboard agree with
the order pages and with what 0008 will need; items 8–13 came from fitting
the screens to real data and phone width without two scales on one chart;
items 14–16 make the download, the test suite, and the colours dependable.
The 0007 migration needs `staff_history`, so the 0006 and 0003 backfill tests
hold it back while they seed old data.

## Impact

- [x] Workflow doc updated (`docs/0007-kpi-dashboard-workflow.md`, with the
  five read functions for 0008; 0000 workflow reschedule and read-path notes)
- [x] Reference doc updated (`docs/reference/folder-structure.md`)
- [x] Upstream: roadmap (0007 shipped), `CLAUDE.project.md` (layout, stack,
  domain rule 11)
