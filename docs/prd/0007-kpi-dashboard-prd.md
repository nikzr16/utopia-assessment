# 0007 - KPI Dashboard PRD

> **Type:** Intent | **Must stay current:** No -- record divergences in decision log

<!-- AI Context
Role: This document captures product intent, not implementation detail.
Use it to understand *what* the feature should do and *why*, then consult the
implementation plan and workflow docs for *how*.
Do not rewrite this document during coding. If implementation diverges from
the intent described here, add an entry to the decision log instead.
-->

## Purpose

The app now records every job, payment, reschedule, return for rework, and
customer rating, but nobody can see how each technician team is doing
without opening orders one by one. This PRD adds a KPI dashboard that turns
that data into weekly technician performance: cards, a leaderboard, and
simple charts, scoped to the branches each person may see.

Source: the brief's Bonus Module — KPI Dashboard (metrics: technician, jobs
completed, total amount, postpone / reschedule; card layout, leaderboard,
simple charts; weekly data minimum; bonus for additional views;
`docs/prd/0000-programmer-assessment-brief.docx`), plus the ratings 0005
stores and the staff history 0006 keeps for this feature.

## Goals

- A Manager sees, for any Monday–Sunday week, how many jobs each technician
  team completed, the amount of that work, how often jobs were postponed or
  rescheduled, and how customers rated them.
- The numbers are trustworthy: each one has a single written definition,
  comes from the database, and matches what the order pages show.
- People see only what their role allows: the branches they cover, or only
  their own numbers.
- Beyond the weekly minimum: longer views (month, trend over weeks), branch
  comparison, and a per-technician drill-down (Q8, Q9, Q16).
- The same read functions can later be whitelisted for the AI query window
  (0008), so the dashboard and the AI never disagree (Q15).

## Non-Goals

- AI features (0008, 0009) and Vercel deployment (0010).
- Changing how jobs, payments, reschedules, or ratings are recorded.
- Pay, bonus, or commission calculations from the KPIs.
- Targets, goals, or alerts on KPI thresholds.
- Scheduled or emailed reports.
- Real-time (live-updating) charts; the dashboard loads fresh numbers when
  opened or when the period changes.

## Scope

| In Scope | Out of Scope |
|---|---|
| Summary cards for the chosen period and branch | Pay or bonus calculations |
| Technician leaderboard with every metric | KPI targets and threshold alerts |
| Simple charts (per technician, trend over weeks, reschedule reasons) | Paid chart or analytics services |
| Week picker (this week, last week, any week); month and trend views (Q8) | Emailed or scheduled reports |
| Branch filter and branch comparison (Q9) | AI query window (0008) |
| Active / inactive technicians per period from the staff history (Q10) | Editing any order data from the dashboard |
| Technician drill-down: the jobs behind the numbers (Q16) | Deployment (0010) |
| Role-scoped read functions reusable by 0008 (Q15) | |
| CSV export (Q14) | |

## User Stories

1. **As a Manager**, I want to see this week's jobs completed, amount, reschedules, and ratings for each technician in my branches so that I know who is doing well and who needs help.
2. **As a Manager**, I want to look back at last week or any earlier week so that I can review a week once it is over.
3. **As a Manager**, I want a leaderboard so that I can see at a glance who completed the most jobs.
4. **As a Manager**, I want postpones and reschedules split by who asked for them so that a technician is not blamed for customers who were not home.
5. **As a Manager**, I want to open a technician's numbers and see the jobs behind them so that I can check any figure.
6. **As an Admin**, I want to compare branches so that I can see which branch is busy or short of teams.
7. **As an Admin**, I want trends over several weeks so that I can see whether a team is improving.
8. **As Finance**, I want the amount of work completed per week so that I can match it with what was collected (Q1).
9. **As a Technician**, I want to see my own week so that I know how many jobs I finished and how customers rated me (Q1).
10. **As the business**, I want each number defined once and served by named read functions so that the AI assistant (0008) can answer the same questions with the same numbers.

## Product Decisions

Decisions already fixed by the brief, 0000–0006:

| Decision | Rationale |
|---|---|
| Weeks run Monday–Sunday in Malaysia time (UTC+8); money is MYR | 0000; `src/domain/week.ts` |
| Final amount = quoted price + extra charges; payment status is derived from payments | 0000 |
| Reschedules are a log (`order_reschedules`): old date, new date (empty = postponed with no date), reason, requested by (customer / technician / admin), done by, time | 0000 |
| Reschedule reasons: customer not home, parts unavailable, weather, technician unavailable, other | 0000 |
| The completion record names the technician who submitted the job; a rework overwrites it with the new Job Done time | 0000, 0002 |
| A reassign is possible only before work starts (Assigned / Acknowledged), so the technician who submits a job is the one who did the work | 0000 |
| Cancelled orders were never worked on (cancel is allowed only from New / Assigned / Acknowledged) | 0000 |
| Returns for rework are logged with who and when (`returned_for_rework`); 3 or more returns is "Needs attention" | 0004 |
| Managers read only the branches they cover (home + additional); Admins and Finance read every branch; technicians read their own orders | 0004 |
| Each rating keeps the technician and branch of that visit; 0007 uses the latest rating per order; a poor rating is 1–2 stars or "not working well" | 0005 |
| `staff_history` stores each person's role, branch, and active state after every change, with `joined_at` / `left_at`; inactive staff show with "(inactive)" | 0006 |
| Reads go through database functions under row-level security; no new paid service | 0000, brief stack |

Decisions made by this PRD (answered 2026-10-23):

| Decision | Rationale |
|---|---|
| Admins and Finance see every branch; Managers see the branches they cover; technicians get a "My week" page with only their own numbers (no leaderboard, no other names, no rank); inactive staff and signed-out visitors see nothing (Q1 a) | Each person sees what their role already lets them read; technicians are not compared in public |
| A job counts as completed when a Manager approves it (Reviewed), on the day and in the week of the approval, while it is Reviewed or Closed. Jobs still Job Done (waiting for review) or back In Progress for rework do not count yet; cancelled jobs never count. An approval is final (Reviewed only moves on to Closed), so a counted job never leaves its week (Q2 c) | Only work a Manager has checked is counted; past weeks stay stable |
| Credit goes to the technician of that moment: a completed job and its amount to the technician who submitted the approved work (completion record); a reschedule to the technician assigned when it was logged (none if the order had no technician yet); a rating to the technician stored on that visit (0005). A job counts in the branch of the order. Later branch moves or deactivation do not move past numbers (Q3 a) | Nobody is blamed or credited for what happened on someone else's watch |
| Total amount = the final amount (quoted price + extra charges) of the jobs completed (approved) in the period; "Collected" = payments recorded in the period on the same scope, shown beside it (Q4 a) | The value of approved work, with cash flow next to it |
| Each reschedule log row counts once, in the week it was logged: "Rescheduled" (new date given) or "Postponed" (no new date). The leaderboard shows the total; the breakdown shows requested by (customer / technician / admin) and reason (Q5 a) | Customer requests are not read as the technician's fault |
| Ratings follow the job (same rule as Q2): for the jobs completed (approved) in the period, use the latest rating of each order: average stars (1 decimal), number rated out of completed, and poor ratings (1–2 stars or not working). A rating that arrives later fills into the period its job was approved in (Q6, as Q2) | A rating always sits with the job it rates |
| "Returned" per technician = returns for rework logged in the period, with a total card; 3 or more in the period gets the 0004 "Needs attention" tag (Q7 a) | Quality shows next to quantity |
| Periods: Week (default this week; "This week", "Last week", previous / next arrows, a date picker for any earlier week) and Month (calendar month, Malaysia time; "This month", "Last month", previous / next); an 8-week trend chart (6-month trend in Month view). The choice is kept in the address (Q8 a) | The brief's weekly minimum plus the monthly dashboard and trends as additional views |
| Branch filter ("All my branches" or one; hidden for a Manager with one branch) plus a branch comparison table and chart: per branch jobs completed, amount, reschedules, average rating, active technicians (Q9 a) | Admins and multi-branch Managers see where work and teams are |
| Listed technicians: everyone who was an active technician in the branch at any time in the period (staff history) plus anyone with a counted event there; zero rows show 0; inactive technicians are tagged "(inactive)". A card shows active technicians per branch at the end of the period. A period with nothing counted says "No jobs completed in this week / month" instead of empty charts (Q10 a) | Quiet teams are visible, not hidden |
| Leaderboard order: jobs completed (most first), then total amount, then name; equal jobs and amount share a rank (1, 1, 3); any column header can re-sort, the rank stays the default one (Q11 a) | Simple, explainable ranking |
| Pretty charts with Recharts (free, MIT, React, SVG): jobs completed per technician (bars), the trend (line / area), and reschedules by reason (stacked bar), with tooltips, gentle animation, and the app's colours. The chart code loads only when the dashboard opens; each chart has a "Show as table" view (Q12 b) | Polished visuals without slowing the other screens |
| A "Dashboard" link in the header for Admins, Managers, and Finance ("My week" for technicians); home screens stay as today. Desktop: cards in a row, then leaderboard and charts side by side; phone: cards in two columns, leaderboard as cards, charts full width (Q13 a) | Desktop-first, still works on a phone |
| "Download CSV" of the leaderboard for the chosen period and branch, one row per technician with every metric, built in the browser from the same numbers (Q14 a) | Numbers can be taken into Excel |
| Every dashboard number comes from a few named, read-only, role-scoped database functions (technician KPIs for a period and branch, the jobs behind them, the branch comparison, the trend), documented with inputs and outputs so 0008 can whitelist them as they are (Q15 a) | The dashboard and the AI assistant give the same answer |
| Clicking a technician opens their page for the same period: their cards, the completed jobs (order, service type, approved time, final amount, rating), their reschedules and returns, and their trend; each order opens in the person's portal (Q16 a) | Every number can be checked against the jobs behind it |

## Constraints

- Every number is computed in the database from the recorded data; the
  browser only displays it. A rule mirrored in `src/domain/` passes
  `tests/db/parity.test.ts`.
- The read functions are read-only, take the actor from the session, and
  return only rows the caller may see (same scope as `orders_read`).
- Every database change is a new timestamped migration; 0000–0006
  migrations are committed and append-only.
- Speed: with 5 branches, 40+ technician teams and a year of orders, any
  dashboard view loads in under 2 seconds on the hosted free-tier project.
- Brief stack: React, Tailwind CSS, Supabase. No paid service; the chart
  library is Recharts (free, open source; Q12).
- Desktop-first (Managers and Admins review on a desktop), still usable at
  375 px wide (Q13).
- Charts are never the only way to read a number: every chart has the same
  figures in text or a table, readable by a screen reader.
- The hosted Supabase project has 0000–0006 applied; schema and function
  changes ship with SQL for it.

## Acceptance Criteria

| # | Criterion | Verifiable By |
|---|---|---|
| 1 | Admins and Finance see every branch; a Manager sees only the branches they cover; a technician sees only their own numbers on "My week"; signed-out visitors and inactive staff see nothing — enforced by the database (Q1) | test |
| 2 | A job counts as completed once, on the day and in the week (and month) a Manager approved it, while it is Reviewed or Closed; Job Done, In Progress (rework) and cancelled jobs do not count (Q2) | test |
| 3 | A completed job and its amount go to the technician who submitted it, a reschedule to the technician assigned when it was logged, a rating to the visit's technician; a job counts in the order's branch; past numbers stay put after a branch move or deactivation (Q3) | test |
| 4 | Total amount is the final amount of the completed jobs; "Collected" (payments recorded in the period) is shown beside it (Q4) | test + manual check |
| 5 | Postpones and reschedules are counted in the period they were logged, split into rescheduled / postponed, by requested by and by reason (Q5) | test + manual check |
| 6 | Ratings show the average stars, number rated, and poor ratings of the period's completed jobs, using the latest rating per order; a later rating fills into its job's period (Q6) | test + manual check |
| 7 | Returns for rework in the period are counted per technician; 3 or more shows "Needs attention" (Q7) | test + manual check |
| 8 | The Week view opens on this week and offers last week, previous / next and any earlier week; the Month view does the same for calendar months; the trend chart covers 8 weeks / 6 months; the address keeps the choice (Q8) | test + manual check |
| 9 | The branch filter offers only branches the person may see; the branch comparison shows each of them side by side (Q9) | test + manual check |
| 10 | Every technician active in the branch during the period is listed, including those with no jobs (0) and inactive ones tagged "(inactive)"; active technicians per branch are shown; an empty period says so instead of showing a blank chart (Q10) | test + manual check |
| 11 | The leaderboard is ordered by jobs, then amount, then name; ties share a rank; columns can re-sort (Q11) | test |
| 12 | The three Recharts charts show the same figures as the leaderboard and cards, load only with the dashboard, and each has a "Show as table" view (Q12) | test + manual check |
| 13 | The dashboard is reached from a header link, works on a desktop and at 375 px wide (Q13) | manual check |
| 14 | CSV export downloads the leaderboard for the chosen period and branch (Q14) | test + manual check |
| 15 | The dashboard reads only through named, documented read functions that 0008 can whitelist (Q15) | test |
| 16 | Opening a technician shows the jobs, reschedules and returns behind each of their numbers for the period, and their trend (Q16) | test + manual check |
| 17 | Every view loads in under 2 seconds with a year of data for 40+ teams | test (timed DB test) + manual check |

## Roadmap Phase

**Phase:** 3 – Insights

## Related Documents

| Document | Type | Relationship |
|---|---|---|
| `docs/prd/0000-programmer-assessment-brief.docx` | Source brief | Bonus Module — KPI Dashboard |
| `docs/prd/0000-system-foundation-prd.md` | Intent | Order lifecycle, money rule, reschedule log, Malaysia time |
| `docs/prd/0004-review-and-close-prd.md` | Intent | Branch cover, returns for rework |
| `docs/prd/0005-customer-feedback-prd.md` | Intent | Ratings per visit, poor rating rule |
| `docs/prd/0006-staff-management-prd.md` | Intent | Staff history, joined / left dates (Q15) |
| `docs/product-roadmap.md` | Roadmap | Phase assignment and sequencing for this PRD |
| `docs/plan/0007-kpi-dashboard-plan.md` | Plan | Implementation path for this PRD |
| `docs/0007-kpi-dashboard-workflow.md` | Workflow | Runtime behavior derived from this PRD |
| `docs/reference/folder-structure.md` | Reference | Structural placement of the feature |
| `docs/decisions/NNNN-*.md` | Decision log | Divergences from this PRD |

## Open Questions

All answered on 2026-10-23; decisions are recorded in Product Decisions.

- [x] **Q1. Who may see the dashboard.** (a) Admins and Finance every branch, Managers covered branches, technicians only their own "My week".
- [x] **Q2. What "job completed" means and which day it counts on.** (c) Counted on the day a Manager approves it (Reviewed).
- [x] **Q3. Who gets the credit.** (a) The technician of that moment; the job counts in the order's branch.
- [x] **Q4. What "total amount" means.** (a) Final amount of completed jobs, with "Collected" beside it.
- [x] **Q5. How postpones and reschedules are counted.** (a) Each log row once, rescheduled / postponed, by requester and reason.
- [x] **Q6. Ratings.** Same as Q2: ratings sit in the period their job was approved in; latest rating per order.
- [x] **Q7. Returns for rework.** (a) "Returned" per technician and a total card; "Needs attention" at 3+.
- [x] **Q8. Period.** (a) Week and Month views, with trend charts; kept in the address.
- [x] **Q9. Branch filter and comparison.** (a) Filter plus branch comparison.
- [x] **Q10. Which technicians are listed.** (a) Everyone active in the period, zeros shown, "(inactive)" tag, empty-period message.
- [x] **Q11. Leaderboard order and ties.** (a) Jobs, then amount, then name; shared ranks.
- [x] **Q12. Charts.** (b) Recharts, loaded only with the dashboard, each chart with a table view.
- [x] **Q13. Layout.** (a) Header link; desktop-first, stacks on a phone.
- [x] **Q14. Export.** (a) CSV of the leaderboard.
- [x] **Q15. Read functions for 0008.** (a) Named, documented, role-scoped read functions.
- [x] **Q16. Technician drill-down.** (a) A page per technician with the jobs behind each number.
