# 0007 - KPI Dashboard Workflow

> **Type:** Workflow | **Must stay current:** Yes -- update when behavior changes

<!-- AI Context
Role: This document describes how the system behaves *today*.
Use it as the authoritative source for current processing flows, stage
sequencing, error handling, and runtime defaults. When writing or modifying
code, the behavior described here is the specification.
This document must be updated before a coding session ends whenever behavior,
flow, or error handling changes. If it conflicts with a PRD or plan, this
document reflects reality; record the divergence in the decision log.
-->

## Purpose

How technician performance is shown per week or month: summary cards, a
leaderboard, simple charts, a branch comparison, and a drill-down to the jobs
behind every number, scoped to what each role may read. Nothing is stored:
every number is computed by five read-only database functions when a page
loads. The same functions are on the AI assistant's lookup menu (0008,
`docs/0008-ai-ops-query-workflow.md`). Rules: `supabase/migrations/20261023000005_kpi_dashboard.sql`;
screens: `src/features/kpi/`; pure rules: `src/domain/kpi.ts`.

## Trigger

- An Admin, Manager, or Finance user opens **Dashboard** (`/dashboard`), or a
  technician page under it (`/dashboard/technicians/:id`).
- A technician opens **My week** (`/my-week`).
- The period, branch, or sort changes on those pages.

## Preconditions

- The hosted database has the 0007 migration
  (`docs/draft/0007-supabase-update.sql`).
- The caller is signed in with an active staff profile (`_require_actor`).

## Stages

### 1. Definitions (one place each, the private `_kpi_*` helpers)

| Metric | Counted from | Day it counts on (Malaysia time) | Credited to |
|---|---|---|---|
| Jobs completed | orders now Reviewed or Closed | the `reviewed` audit entry (the Manager's approval; final) | the completion record's technician (who submitted the approved work) |
| Total amount | those jobs: quoted price + extra charges | as the job | as the job |
| Collected | `payments` | `recorded_at` | the completion technician, else the assigned technician |
| Rescheduled / Postponed | `order_reschedules` (new date / no date) | `created_at` | `order_reschedules.technician_id`: the technician assigned when it was logged (none before assignment) |
| Returned | `returned_for_rework` audit entries | `created_at` | the order's technician |
| Rated, average, poor | latest feedback of each counted job (by visit, as on the order page) | as the job | the technician stored on the visit (0005) |
| Active technicians | `staff_history` intervals (technician, active, branch) | at the end of the period | — |

Every job, payment, reschedule, and return counts in the **order's** branch.
Job Done (waiting for review), In Progress (rework) and Cancelled orders never
count as completed. Poor rating = 1–2 stars or "not working well"; "Needs
attention" = 3 or more returns in the period (0004 `NEEDS_ATTENTION_RETURNS`).

**Reschedule technician:** `order_reschedules_technician_trg` fills
`technician_id` from the order on insert (an explicit value is kept). Rows
from before 0007 were backfilled from the assignment in force at that time
(`created` / `assigned` / `reassigned` audit entries), else the order's current
technician.

### 2. Scope — every function

| Caller | Sees |
|---|---|
| Admin, Finance | every branch |
| Manager | the branches they cover (home + additional); asking for another → "You can only see the branches you cover" |
| Technician | only their own events and row (no rank, no other names); `kpi_branches` refused; asking about another technician refused |
| Inactive or signed out | nothing (`_require_actor`; not executable by `anon`) |

### 3. Periods

**Input:** `p_start`, `p_end`: Malaysia calendar days, `p_end` exclusive (a week
is Monday → next Monday, a month the 1st → next 1st), converted once at `+08`.
**Refused:** a missing date ("Choose a start and an end date"), end ≤ start
("The period must end after it starts"), more than 400 days ("Choose a period
of up to a year").
**Screen:** `PeriodPicker`: Week / Month; "This week" / "Last week" (or
month); ‹ › arrows (no future periods); "Go to a date" snaps to its week or
month. The address keeps `view` (`week` | `month`), `start` (`YYYY-MM-DD`) and
`branch`, so a reload or shared link keeps the choice
(`parseKpiAddress` / `kpiAddress`).

### 4. Dashboard — `/dashboard` (Admin, Manager, Finance)

**Calls:** `kpi_summary`, `kpi_technicians`, `kpi_trend` (8 weeks / 6 months),
plus `kpi_branches` when two or more branches are visible.
**Branch filter:** "All branches" / "All my branches" or one branch
(`BranchFilter`); hidden for a Manager covering one branch. A refused or stale
branch in the address shows the database message with **Show all branches**.
**Cards (`SummaryCards`):** Jobs completed ("Counted when a Manager approves
the job"), Total amount (with Collected), Rescheduled / Postponed (asked by
customer / technician / admin), Returned, Average rating (rated of completed,
poor), Active technicians (at the end of the period).
**Leaderboard (`Leaderboard`):** rank, technician (link to the drill-down),
branch, jobs, amount, collected, reschedules, returned, rating ("n of m
rated"), poor ratings; "(inactive)" and "Needs attention" tags. Default order:
jobs, then amount, then name; equal jobs and amount share a rank (1, 1, 3).
Headers re-sort (`aria-sort`); the rank stays the default one. Table from
768 px; cards with a "Sort by" control below.
**Download CSV:** the leaderboard as sorted, every metric, UTF-8 with BOM,
named `kpi-<2026-W43 | 2026-10>-<branch | all-branches>.csv`, built in the
browser from the same rows.
**Charts (Recharts, `src/features/kpi/charts/`):** jobs completed per
technician (horizontal bars, leaderboard order, first 15 with a note), jobs
completed over time (area + line), reschedules and postponements by reason
(stacked by requester: admin, customer, technician), branch comparison (one
measure at a time: jobs, amount, reschedules, average rating). Each chart has
an `aria-label` summary, hover tooltips ("Ali — 8 jobs"), a legend for two or
more series, and **Show as table**; animation is off under
`prefers-reduced-motion`. Colours: `charts/theme.ts`.
**Empty period:** "No jobs completed in this week" (or month); the zero cards
and leaderboard stay, charts are not drawn.

### 5. Technician drill-down — `/dashboard/technicians/:id`

**Calls:** `kpi_technicians` (the person's row for the cards),
`kpi_trend` (their trend), `kpi_technician_events`.
**Shows:** their cards; completed jobs (order, service type, branch, approved
time, final amount, rating); rescheduled; postponed; returned for rework
(`EventList`). Each order opens in the person's portal (`/orders/…`,
`/review/…`, `/finance/…`). Same period and address rules as the dashboard.

### 6. My week — `/my-week` (technician)

**Calls:** the same functions; the database returns only the technician's own
numbers and events.
**Shows:** their cards, trend, completed jobs, reschedules and returns; no
leaderboard, rank, branch filter, or other names. Orders open at `/jobs/…`.

### 7. Loading

The dashboard pages are loaded on demand (`lazy.tsx`, `React.lazy`), so the
Recharts code downloads only when Dashboard or My week opens ("Loading the
dashboard…"). If the chunk cannot be downloaded: "Could not load the
dashboard" with **Reload the page**.

## Read functions (whitelist for 0008)

All `security definer`, `stable`, actor from the session, granted to
`authenticated` only. Inputs and outputs are also in each `comment on
function`.

| Function | Inputs | Output |
|---|---|---|
| `kpi_summary(p_start date, p_end date, p_branch_id uuid default null)` | period, optional branch | one row: `jobs_completed`, `total_amount`, `collected`, `rescheduled`, `postponed`, `requested_by_customer` / `_technician` / `_admin`, `reason_customer_not_home` / `_parts_unavailable` / `_weather` / `_technician_unavailable` / `_other`, `reason_by_requester` (json), `returned`, `rated`, `average_rating`, `poor_ratings`, `active_technicians` |
| `kpi_technicians(p_start date, p_end date, p_branch_id uuid default null)` | period, optional branch | one row per listed technician (active in the scope during the period, or with a counted event there): `id`, `name`, `active`, `branch_id`, `branch_name`, every metric above per technician, `reschedules`, `rank` (null for a technician caller), `needs_attention`; best first |
| `kpi_branches(p_start date, p_end date)` | period | one row per visible branch: jobs, amount, collected, rescheduled, postponed, reschedules, returned, rated, average rating, poor ratings, active technicians |
| `kpi_trend(p_unit text, p_end date, p_count int, p_branch_id uuid default null, p_technician_id uuid default null)` | `week` / `month`, exclusive end day, 1–26 rows, optional branch / technician | oldest first: `period_start`, `period_end`, `jobs_completed`, `total_amount`, `reschedules`, `average_rating` |
| `kpi_technician_events(p_technician_id uuid, p_start date, p_end date, p_branch_id uuid default null)` | technician, period, optional branch | latest first: `kind` (`completed`, `rescheduled`, `postponed`, `returned`), `order_id`, `order_no`, `service_type`, `branch_id`, `branch_name`, `happened_at`, `amount`, `rating`, `working_well`, `reason`, `requested_by`, `note` |

## Error States

| Error | Cause | Handling |
|---|---|---|
| "Choose a start and an end date" / "The period must end after it starts" / "Choose a period of up to a year" | Bad period (only reachable by a hand-edited call) | Rejected; the screen never sends one |
| "You can only see the branches you cover" | Manager asks for another branch (e.g. edited address) | Message with **Show all branches** |
| "Branch not found" | Unknown branch id | Same |
| "You can only see your own numbers" / "The branch comparison is not available to technicians" | Technician asks about another technician, or for the comparison (edited call) | Rejected by the database |
| "Technician not found" / "Choose week or month" / "Choose between 1 and 26 periods" | Bad drill-down or trend call | Rejected |
| "You must be signed in" / "Your account has no active staff profile" | Signed out / inactive | Rejected (0000); the app signs an inactive person out (0006) |
| "Could not reach the server…" | No signal | The page shows the error with Try again |
| "Could not load the dashboard" | Chart chunk failed to download | **Reload the page** |

## Defaults

| Setting | Default |
|---|---|
| Period | This week (Monday–Sunday, Malaysia time) |
| Trend | 8 weeks (Week view), 6 months (Month view) |
| Branch | All visible branches |
| Leaderboard order | Jobs completed desc, total amount desc, name |
| Longest period | 400 days |
| Bars per chart | 15 technicians (the table lists everyone) |

## Behavioral Constraints

- Read-only: the dashboard writes nothing and stores no totals.
- Every number comes from the five `kpi_*` functions; the browser only formats
  and sorts. `src/domain/kpi.ts` mirrors week / month starts and tie ranking;
  `tests/db/parity.test.ts` keeps them equal to SQL.
- A counted job never leaves its period: approval is final (Reviewed only
  moves on to Closed). A later rating fills into its job's period.
- Past numbers do not move when a technician changes branch or is deactivated.

## Related Documents

| Document | Type | Relationship |
|---|---|---|
| `docs/prd/0007-kpi-dashboard-prd.md` | Intent | Product goals this workflow fulfills |
| `docs/plan/0007-kpi-dashboard-plan.md` | Plan | Architecture this workflow implements |
| `docs/0004-review-and-close-workflow.md` | Workflow | Approval and returns the metrics count |
| `docs/0005-customer-feedback-workflow.md` | Workflow | Ratings per visit |
| `docs/0006-staff-management-workflow.md` | Workflow | Staff history used for active technicians |
| `docs/reference/folder-structure.md` | Reference | File locations of workflow components |
| `docs/decisions/0015-kpi-dashboard-implementation-details.md` | Decision log | Deviations from the plan |
