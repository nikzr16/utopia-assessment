# 0007 - KPI Dashboard Implementation Plan

> **Type:** Plan | **Must stay current:** No -- record divergences in decision log, rewrite only during re-planning

<!-- AI Context
Role: This document describes *how* to build the feature, not *what* or *why*.
Read the corresponding PRD first for intent and constraints, then use this plan
to guide implementation order, component boundaries, and technical decisions.
Do not rewrite this document during coding. If the implementation diverges from
this plan, add an entry to the decision log instead. Only rewrite during a
deliberate re-planning session.
-->

## Overview

Build `docs/prd/0007-kpi-dashboard-prd.md` on top of 0000–0006. One new
migration adds a few read-only, role-scoped KPI functions (summary cards,
technician leaderboard, branch comparison, trend, technician drill-down),
the indexes they need, and one small column so a reschedule remembers the
technician of that moment. A new `src/features/kpi/` adds the Dashboard
(Admins, Managers, Finance) and "My week" (technicians), with Recharts
charts loaded only when those pages open. No data is written by this
feature; every number is computed in the database when the page loads.

## Technical Approach

- **The database computes every number.** The browser formats and draws;
  it never adds up rows. The same functions are what 0008 will whitelist
  (PRD Q15), so they are small, named, documented, and take plain inputs.
- **Definitions (PRD decisions).**
  | Metric | Counted from | Day it counts on (Malaysia time) | Credited to |
  |---|---|---|---|
  | Jobs completed | orders now Reviewed or Closed | the `reviewed` audit entry (P1) | `order_completions.technician_id` (submitted the approved work) |
  | Total amount | the same jobs: quoted price + extra charges | same as the job | same as the job |
  | Collected | `payments` | `recorded_at` | the order's completion technician, else assigned technician |
  | Rescheduled / Postponed | `order_reschedules` (new date / no date) | `created_at` | the technician assigned when it was logged (P2); none if unassigned |
  | Returned | `returned_for_rework` audit entries | `created_at` | the order's technician (rework always goes back to them) |
  | Rating, rated, poor | latest `customer_feedback` per order of the counted jobs | same as the job (PRD Q6) | the visit's technician (0005) |
  | Active technicians | `staff_history` intervals (role technician, active, branch) | overlapping the period / at its end | — |
  Each job, reschedule, payment, and return counts in the **order's**
  branch (it cannot change once work starts).
- **Periods (P4).** Every function takes `p_start date, p_end date`
  (Malaysia calendar days, end exclusive), converted once to
  `timestamptz` at `+08`. The screen sends a Monday–Monday range for a
  week or a 1st–1st range for a month; 0008 can send any range. Ranges
  longer than 400 days or with end ≤ start are refused ("Choose a period
  of up to a year").
- **Scope inside every function.** `_require_actor()` first (inactive and
  signed-out callers refused). Admin / Finance: all branches. Manager:
  only covered branches (`_current_staff_covers`); asking for another
  branch is refused ("You can only see the branches you cover").
  Technician: only their own events and row, no rank, no other names
  (PRD Q1); a technician calling the branch comparison is refused.
- **Read functions (P3).** `security definer`, `stable`, granted to
  `authenticated` only, each with a SQL comment describing inputs and
  outputs (copied into the workflow doc for 0008):
  | Function | Returns |
  |---|---|
  | `kpi_summary(p_start, p_end, p_branch_id default null)` | one row: jobs completed, total amount, collected, rescheduled, postponed, by requester (customer / technician / admin), by reason (5), returned, rated, average rating, poor ratings, active technicians at the period end |
  | `kpi_technicians(p_start, p_end, p_branch_id default null)` | one row per listed technician (PRD Q10): id, name, active, home branch, every metric above, rank (`rank()` over jobs desc, amount desc; null for a technician caller), needs attention |
  | `kpi_branches(p_start, p_end)` | one row per visible branch: jobs completed, total amount, collected, reschedules, returns, average rating, active technicians |
  | `kpi_trend(p_unit 'week' \| 'month', p_end date, p_count int, p_branch_id default null, p_technician_id default null)` | `p_count` rows (max 26): period start, jobs completed, total amount, reschedules, average rating |
  | `kpi_technician_events(p_technician_id, p_start, p_end, p_branch_id default null)` | the rows behind a technician's numbers: kind (`completed`, `rescheduled`, `postponed`, `returned`), order no, service type, branch, time, amount, rating, working well, reason, requested by, note |
  The five functions share private helpers (`_kpi_period`,
  `_kpi_visible_branches`, `_kpi_completed_jobs`, `_kpi_active_technicians`)
  so every number has one definition.
- **Schema (P1, P2).**
  - `order_reschedules.technician_id uuid references staff` — set by a
    `before insert` trigger from `orders.technician_id`; backfilled for
    existing rows from the audit trail (the technician assigned at that
    time), else the order's current technician.
  - Indexes: partial `audit_log (created_at) where action = 'reviewed'`,
    partial `audit_log (created_at) where action = 'returned_for_rework'`,
    `order_reschedules (created_at)`, `payments (recorded_at)`,
    `customer_feedback (order_id, created_at desc)`,
    `staff_history (staff_id, created_at)`.
  - No summary tables (P3): 40+ teams and a year of orders (about 25,000)
    are small for indexed range queries.
- **Domain (`src/domain/kpi.ts`).** Period helpers built on
  `malaysiaWeekRange` (week and month ranges, previous / next, labels such
  as "Mon 19 – Sun 25 Oct 2026" and "October 2026", ISO week code
  `2026-W43` for file names), address parsing (`?view=week&start=…&branch=…`),
  competition ranking for ties (1, 1, 3), client-side re-sort by column,
  average formatting (1 decimal), CSV building (quoted fields, UTF-8 BOM
  for Excel). Poor rating reuses `isLowFeedback`; "Needs attention" reuses
  `NEEDS_ATTENTION_RETURNS`. Parity: week / month start in SQL vs TS, and
  ranking of the same rows.
- **Screens (`src/features/kpi/`).**
  - Routes: `/dashboard` and `/dashboard/technicians/:id` in the Admin,
    Manager, and Finance portals (nav link **Dashboard**); `/my-week` in
    the technician portal (nav link **My week**). The address keeps
    view, start date, and branch, so a refresh or shared link keeps the
    choice.
  - `PeriodPicker`: Week / Month toggle; "This week" / "Last week" (or
    month); ‹ › arrows; a date input that snaps to its week or month; no
    future periods.
  - `BranchFilter`: "All my branches" + visible branches; hidden for a
    Manager with one branch and for technicians.
  - `SummaryCards`: Jobs completed, Total amount (with Collected),
    Rescheduled / Postponed, Returned, Average rating (rated of
    completed, poor), Active technicians.
  - `Leaderboard`: table from 768 px (rank, technician, branch, jobs,
    amount, collected, reschedules, returned, rating, poor); sortable
    headers (`aria-sort`); cards below 768 px; "(inactive)" and "Needs
    attention" tags; each name opens the drill-down; **Download CSV**.
  - Charts (Recharts, P5): `JobsByTechnicianChart` (horizontal bars,
    leaderboard order), `TrendChart` (area + line, 8 weeks / 6 months),
    `ReschedulesByReasonChart` (stacked bar by requester), and on the
    comparison `BranchComparison` (table + grouped bars). Each chart has
    a "Show as table" toggle and an `aria-label` summary; tooltips show
    "Ali — 8 jobs"; colours come from one palette in `charts/theme.ts`
    checked for contrast; animation off when the user prefers reduced
    motion.
  - `TechnicianKpiPage`: the person's cards, trend, and the event list
    grouped by kind; each order links to the person's portal
    (`/orders/…`, `/review/…`, `/finance/…`).
  - `MyWeekPage`: the technician's own cards, trend, and completed jobs
    (links to `/jobs/…`); no rank and no other names.
  - Empty period: "No jobs completed in this week" (or month) with the
    zero cards; charts are not drawn.
- **Chart code loads only with the dashboard (P5).** Each portal imports
  the KPI pages with `React.lazy`, so Recharts lands in its own chunk; the
  other screens do not grow. A "Loading the dashboard…" fallback shows
  while it downloads.

## System Components

| Component | Responsibility |
|---|---|
| `supabase/migrations/20261023000005_kpi_dashboard.sql` | `order_reschedules.technician_id` + trigger + backfill, indexes, private KPI helpers, the five `kpi_*` read functions with comments, grants (authenticated only) |
| `src/domain/kpi.ts` | Periods, labels, address parsing, ranking, sorting, CSV |
| `src/features/kpi/api.ts` | Typed calls to the five functions |
| `src/features/kpi/DashboardPage.tsx` | Filters, cards, leaderboard, charts, comparison, export |
| `src/features/kpi/TechnicianKpiPage.tsx`, `MyWeekPage.tsx` | Drill-down and the technician's own view |
| `src/features/kpi/components/` | `PeriodPicker`, `BranchFilter`, `SummaryCards`, `Leaderboard`, `BranchComparison` |
| `src/features/kpi/charts/` | The Recharts charts, their table views, `theme.ts` |
| `AdminPortal`, `ManagerPortal`, `FinancePortal`, `TechnicianPortal` | Nav links and lazy routes |
| `docs/draft/0007-supabase-update.sql` | Hosted SQL: the migration (git-excluded) |
| `docs/draft/0007-test-data.sql`, `docs/draft/0007-cleanup-test-orders.sql` | Manual-check data and its cleanup (git-excluded; you press Run) |

## Processing Flow

1. Nurul (Manager, Shah Alam) clicks **Dashboard**. The page reads the
   address (default: this week, all covered branches) and calls
   `kpi_summary`, `kpi_technicians`, and `kpi_trend` together.
2. The database checks Nurul is an active Manager, limits every query to
   Shah Alam, and returns the numbers.
3. Cards, leaderboard, and charts render; Nurul sorts by rating, then
   taps **Last week**: the address changes and the three calls repeat.
4. Nurul clicks Ali → `/dashboard/technicians/<id>?view=week&start=…`
   → `kpi_technician_events` + `kpi_trend` for Ali → the job list.
5. Farid (Admin) switches to Month and "All branches"; `kpi_branches`
   adds the comparison. Farid downloads the CSV.
6. Ali (technician) opens **My week** → the same functions return only
   their own row and events.

## Dependencies

| Dependency | Purpose |
|---|---|
| Supabase Postgres (existing) | The read functions and indexes |
| `recharts` (new, MIT, exact version pinned at install, at least two weeks old) | Charts (PRD Q12) |
| PGlite test harness (`tests/db/helpers.ts`) | Migration chain, roles, timed test data |

## Implementation Phases

### Phase 1: Database

- The migration above.
- Tests `tests/db/kpi.test.ts`: each metric's definition (approval day,
  Job Done / rework / cancelled not counted, final amount, collected,
  reschedule vs postpone and its technician of that moment, returns,
  latest rating per order, late rating fills into the job's week);
  credit after reassign, branch move, and deactivation; listed
  technicians from the staff history (joined mid-week, left mid-week,
  zero jobs); ties share a rank; week and month boundaries at Malaysia
  midnight (Sunday 23:59 vs Monday 00:00); scope per role (Admin,
  Finance, covering / other Manager, technician, inactive, signed out);
  bad periods refused. `access.test.ts`: the functions are not callable
  signed out. Parity cases for periods and ranking.
- Timed test: generate a year of data for 45 technicians (about 25,000
  orders) in PGlite and check each function stays within budget.

### Phase 2: Domain

- `src/domain/kpi.ts` and `tests/domain/kpi.test.ts`.

### Phase 3: Screens

- Install Recharts; the KPI pages, components, charts; nav links and lazy
  routes in the four portals.
- UI tests `tests/ui/kpi.test.tsx` (charts replaced by their table views
  in jsdom): address kept across reloads, period picker steps, branch
  filter options per role, cards and leaderboard figures, sorting and
  `aria-sort`, tie ranks, "(inactive)" and "Needs attention" tags, empty
  period message, CSV content, drill-down list, technician sees no other
  names, cards at 375 px.

### Phase 4: Verify and document

- `npm test`, `npm run typecheck`, `npm run build` (check the Recharts
  chunk is separate), `validate_config.py`.
- `docs/draft/0007-supabase-update.sql`; you run it on hosted.
- Manual check (P6) on hosted, desktop first and 375 px: Admin, a Manager
  (`web-second-role`), Finance and a technician (`web-third-role`).
- Workflow doc `docs/0007-kpi-dashboard-workflow.md` (with the function
  reference for 0008), folder structure, decision log, roadmap,
  `CLAUDE.project.md`.

## Testing Strategy

- **Database (PGlite):** fixtures build orders with backdated audit,
  completion, payment, reschedule, and feedback rows (direct inserts in
  tests only); each definition has a counted and a not-counted case; each
  function is called as every role.
- **Parity:** week / month start dates and tie ranking, SQL vs TS.
- **Domain:** periods across month and year ends, labels, CSV escaping.
- **UI (jsdom):** API test doubles as in earlier features; Recharts
  components are not rendered in jsdom (no layout), their table views
  are.
- **Manual:** each role's view, period and branch switching, drill-down,
  CSV opened in Excel, phone width, and a timing check on hosted.

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| A number on the dashboard differs from the order pages | Managers stop trusting it | One definition per metric in shared SQL helpers; tests compare against hand-counted fixtures; the drill-down lists the rows behind each number |
| A Manager or technician sees other branches' or people's numbers | Data leak | Scope checked inside every function; per-role tests; no direct table reads |
| Week edges off by the time zone | Jobs land in the wrong week | Periods are Malaysia dates converted once at `+08`; boundary tests at Sunday 23:59 / Monday 00:00 |
| Slow on the free tier with a year of data | Page feels broken | Partial indexes, range queries, 400-day cap, timed test, hosted check |
| Recharts makes the app larger | Slower first load for everyone | Lazy routes: only the dashboard chunk includes it |
| Recharts does not render in jsdom | Untested charts | Charts take the same rows as their table views; tables are tested; charts are checked by eye in the manual check |
| Old reschedules have no technician of that moment | Wrong credit for past rows | Backfill from the audit trail; hosted has no orders today |
| With approval as the count day, this week looks low until Managers review | Misread as poor performance | Card hint "Counted when a Manager approves the job" (PRD Q2) |

## Roadmap Phase

**Phase:** 3 – Insights

## Related Documents

| Document | Type | Relationship |
|---|---|---|
| `docs/product-roadmap.md` | Roadmap | Phase assignment and sequencing for this plan |
| `docs/prd/0007-kpi-dashboard-prd.md` | Intent | Product goals and constraints this plan implements |
| `docs/0007-kpi-dashboard-workflow.md` | Workflow | Runtime behavior derived from this plan |
| `docs/0004-review-and-close-workflow.md` | Workflow | Approval and returns the metrics count |
| `docs/0005-customer-feedback-workflow.md` | Workflow | Ratings per visit |
| `docs/0006-staff-management-workflow.md` | Workflow | Staff history used for active technicians |
| `docs/reference/folder-structure.md` | Reference | Structural placement of planned components |
| `docs/decisions/NNNN-*.md` | Decision log | Divergences from this plan |

## Open Questions

Each question listed options, recommended first, with a short scenario.
All answered 2026-10-23.

- [x] **P1. Where the approval day comes from.** (a) The existing `reviewed` audit entry, with a partial index.
- [x] **P2. The technician of a reschedule.** (a) A `technician_id` on each reschedule row, filled from the order at that moment; old rows backfilled.
- [x] **P3. How the numbers are served.** (a) Five small read functions computed live; 0008 can add more.
- [x] **P4. How a period is passed.** (a) A start and end date (Malaysia days), up to a year.
- [x] **P5. Loading the charts.** (a) Dashboard pages load on demand, so Recharts downloads only with them.
- [x] **P6. Test data for the manual check.** (a) A backdated SQL script over 8 weeks plus 2–3 live orders through the app; a matching cleanup script.
