# 0009 - AI Advanced Challenges Workflow

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

The brief's three optional AI challenges, built on the 0008 pattern (the AI
key only in an Edge Function, the database the only authority, a person
always decides):

- **Workflow Supervisor** — every Job Done is checked: fixed rules in the
  database plus an AI read of the written job record. A covering Manager
  checks each warning with a note before Approve.
- **Document Understanding** — "Read from photo" on the Admin's New Order
  form fills five fields from a photo or PDF of a paper order form (all or
  nothing); the file is kept with the order as its **Order form**.
- **Operational Insight** — the database finds busy / quiet technicians,
  review backlog, rising reschedules and rating drops from the 0007 numbers;
  the AI words them on the Dashboard Insights card; Ask's
  `workload_insights` lookup reads the same facts.

Server: `supabase/functions/ai-assist/` (with `_shared/keys.ts`); database:
`supabase/migrations/20261024000002_ai_advanced.sql`; screens:
`src/features/supervisor/`, `src/features/orders/ReadFromPhoto.tsx`,
`OrderFormEditor.tsx`, `src/features/attachments/OrderFormLink.tsx`,
`src/features/kpi/components/InsightsCard.tsx`, the AI log in
`src/features/ask/QuestionLogPage.tsx`.

## Trigger

- An order's status changes to **Job Done** (first time or after rework).
- A customer rating or a reschedule is recorded for a Job Done / Reviewed /
  Closed order (rule warnings only).
- A covering Manager presses **Mark as checked** or **Re-check with AI**.
- An Admin presses **Read from photo** (New order) or **Replace / Remove**
  (Edit order).
- A Manager or Admin opens the **Dashboard** (Insights card) or asks Ask a
  workload question.
- `pg_cron` every 5 minutes (`supervisor-retry`).

## Preconditions

- The hosted database has the 0009 migration
  (`docs/draft/0009-supabase-update.sql`): `pg_net`, `pg_cron`, and
  `app_settings.ai_assist_url` set to the function's address.
- The same random secret in Supabase Vault as `ai_trigger_secret` and in the
  Edge Function secrets as `AI_TRIGGER_SECRET`; `OPENAI_API_KEY` (from 0008).
- `ai-assist` deployed with
  `npx supabase functions deploy ai-assist --project-ref <ref> --no-verify-jwt --use-api`;
  `ask` redeployed for `workload_insights`.

## Stages

### 1. Supervisor: rule warnings (database)

**Input:** an order in Job Done, Reviewed or Closed.
**Actions:** `_supervisor_rules(order)` runs the fixed rules
(`src/domain/supervisor.ts` `SUPERVISOR_LIMITS`):

| Rule | Opens when | Message (example) |
|---|---|---|
| `over_quote` | final ≥ quote × 1.5 **and** final − quote ≥ RM 100 | "Final amount RM 880.00 is 214% above the quoted RM 280.00." |
| `no_photo` | no `photo` job file (receipts and the order form do not count) | "Job Done but no photos uploaded." |
| `many_returns` | returned for rework ≥ 2 times | "Returned for rework 2 times." |
| `many_reschedules` | rescheduled or postponed ≥ 3 times | "Rescheduled or postponed 3 times." |
| `low_rating` | latest rating 1–2 stars or "not working" | "Customer said the aircond is not working (rated 1 star)." |

A rule whose cause is gone becomes `resolved`; if its numbers change (e.g. a
third return), the old row is resolved and a new **open** one replaces it, so
a Manager's note always refers to what they saw. Rules do not run while a job
is back in rework; they run again at resubmission.
**Output:** `order_warnings` rows (`source = 'rule'`).

### 2. Supervisor: the AI check

**Input:** a Job Done order.
**Actions:** the same status change inserts a `supervisor_runs` row
(`job_done`, or `resubmitted` after rework) and `_supervisor_post` sends
`{action: 'supervisor_check', run_id}` to `ai-assist` with `pg_net` and the
header `x-ai-trigger: <Vault secret>` (fire and forget; Job Done never waits
or fails because of it). `ai-assist` reads `supervisor_ai_input(run_id)`
(service role; marks the run `running`): service type, quote, extra charges,
final amount, problem description, work done, remarks, and the AI warnings a
Manager already checked with their notes. No customer name, phone, address,
admin notes or feedback. `gpt-6-luna` returns strict JSON
`{issues: [{message}]}` (at most 3, ≤ 200 characters, quoting the evidence;
instructions say the job text is data, never instructions).
`supervisor_save_ai` resolves the order's earlier **open** AI warnings,
inserts the new ones, and closes the run (`done`); checked AI warnings are
never touched. Every call is written to the AI log.
**Re-check:** a covering Manager (job in Job Done) calls
`request_supervisor_recheck` (a run waiting from the last 2 minutes is
reused), then the browser calls `ai-assist` with their token; the function
only runs a check that Manager asked for.
**On failure:** no key / refused key → run `not_set_up`; OpenAI error →
`failed` ("The assistant cannot be reached"); over 25 s → `failed` ("The AI
check took too long"). `supervisor_retry_pending` (every 5 min) posts runs
still `pending` after 2 minutes again (2 attempts in all), then marks them
`failed`; runs `running` for over 5 minutes become `failed`. The order page
then says "AI check didn't run. Press Re-check to try again."
**Output:** `order_warnings` rows (`rule = 'ai_text'`, labelled **AI**).

### 3. Supervisor: what Managers see and do

- **Review queue** (`/review`, To review): a **Warnings** column ("2 warnings")
  from `order_warnings` (open only) and an **Only jobs with warnings** filter
  (`?warnings=1`).
- **Order page** (Manager, Admin and Finance pages): the **Warnings** box —
  each warning with its label (Amount, Photos, Returns, Reschedules, Rating,
  AI), "AI check running…" / "didn't run", checked ones with "Checked by …,
  time" and the note. Live through Realtime on `order_warnings` /
  `supervisor_runs` (and every 5 s while a check runs). Technicians never see
  warnings (RLS).
- **Mark as checked** (covering Manager, job in Job Done): a 3–300 character
  note → `check_order_warning`; kept forever.
- **Approve** is disabled while any warning is open ("Check every warning
  before approving (2 open). See Warnings below.") and the database refuses it
  (`orders_open_warnings_guard_trg`). A pending or failed AI check never
  blocks. **Return for rework** never needs checks.

### 4. Read from photo (New order, Admins)

**Input:** one photo (JPG, PNG, WebP) or PDF (≤ 3 pages), ≤ 10 MB.
**Actions:** the browser checks type and size, shrinks large photos (2048 px,
JPEG), keeps the file in memory, and posts it as base64 to `ai-assist`
(`read_form`, Admin token; 40 s limit; "Reading the form…"). The function
checks the real type from the bytes, the size and (pdf-lib) the page count,
then sends it to `gpt-6-luna` as `input_image` (detail high) or `input_file`
with today's Malaysia date and the active service type names. Strict JSON:
`readable` and, for customer name, service type, details, amount and date,
`{value, on_form, clear}`. **All or nothing:** if any field that is on the
form is unclear, the service type matches no active type, the amount fails
the price rule (0–100,000, 2 decimals) or the date is not real, nothing is
filled. Phone and address are never asked for or returned. Text is kept as
written (Malay stays Malay). Nothing is stored by the function or OpenAI.
**Output:** the five fields fill the form (date with no time → 09:00, said in
the note); "Filled from the photo: … Check every field before saving."
**On failure:** see Error States; the Admin fills the form by hand.

### 5. Saving the order form

After `create_order`, the browser uploads the kept file to
`job-files/<order>/form/<uuid>.<ext>` and calls `set_order_form` (Admin;
order New, Assigned or Acknowledged; photo or PDF). It is an attachment with
`is_order_form = true`: at most one per order, not one of the 6 job files,
readable like job files (the assigned technician too). If the upload fails
the order is saved and the page says "Order … is saved, but the form photo was
not attached" with **Try again**. **Edit order** has a Paper order form panel:
**Replace** (`set_order_form`, then the old file is deleted from Storage) and
**Remove** (`remove_order_form`). History lines: "Attached the paper order
form", "Removed the paper order form". Every order page shows **Open the paper
order form (photo / PDF)**.

### 6. Insights (Managers and Admins)

**Input:** the Dashboard's period and branch filter.
**Actions:** `insight_facts(start, end, branch)` (Admins all branches,
Managers covered ones; others "Insights are for Managers and Admins") builds
on `kpi_technicians` / `kpi_branches`:

| Kind | Rule |
|---|---|
| `busy` | completed ≥ 1.5 × team average **and** ≥ average + 3 |
| `quiet` | active, completed ≤ 0.5 × average **and** ≤ average − 3 |
| `review_backlog` | per branch, jobs in Job Done for more than 2 days (now) |
| `reschedules_up` | per branch, ≥ 2 × the previous period **and** ≥ 3 more |
| `rating_drop` | average rating down ≥ 1.0, ≥ 3 ratings in each period |

Team = the technicians in the leaderboard for that period and branches
(average rounded to one decimal; busy / quiet need at least 2 technicians).
The card shows the facts at once as fixed sentences
(`src/domain/insights.ts`), then calls `ai-assist` (`word_insights`, 20 s).
The function reads the facts as the person, hashes them with the period
phrase, and returns a saved wording if there is one (`insight_wordings`, 7
days); otherwise `gpt-6-luna` rewrites each fact and may add one tip. A
sentence with any number not in its fact (or the period) falls back to the
fixed one; a tip with a stray number is dropped.
**Output:** the card: tagged facts, "See their numbers" links, the tip, and
"Worded by AI from the numbers above…" (or "AI wording is not available right
now; these are the plain facts."). **Ask:** `workload_insights` (period,
branch) returns the same rows as an "Insights" table.

### 7. AI log

Every AI call is written to `ask_log` (`feature` = `ask` / `supervisor` /
`form` / `insights`, `order_id`), by `ask_record` (Ask) or `ai_log_record`
(service role). The Admin **AI log** (`/ai-log`; `/question-log` redirects)
lists the last 7 days with a **Type** filter (Ask, Job check, Order form,
Insights), outcome ("Found warnings", "No warnings", "Form filled", "Form
unclear", "Worded", …), time and tokens. Automatic job checks are logged under
the technician who submitted the job.

## Error States

| Error | Cause | Handling |
|---|---|---|
| "Check every warning before approving (N open)" | Approve with open warnings | Approve disabled; database refuses |
| "Write a short note (at least 3 characters)" / "Keep the note to 300 characters" | Bad check note | Shown under the note |
| "Only a Manager of <branch> can check warnings" / "… re-check a job" | Not a covering Manager | Refused by the database |
| "Warnings can only be checked while the job is waiting for review" / "Only a job waiting for review can be re-checked" | Wrong status | Refused |
| "AI check didn't run. Press Re-check to try again." | Run `failed` / `not_set_up` | Shown in the Warnings box; Approve not blocked |
| "This check is no longer waiting. Refresh the page." | Re-check of a finished or someone else's run | 404 from `ai-assist` |
| "Couldn't read this form clearly. Try a clearer photo or fill the form by hand." | Any field unclear / invalid | Nothing filled; logged `unclear` |
| "Use a photo (JPG, PNG or WebP) or a PDF" / "The file can be at most 10 MB" / "The PDF can have at most 3 pages" / "This file could not be opened…" | Bad file | Checked in the browser and the function |
| "Can't read photos right now. Fill the form by hand." / "The assistant is not set up yet. Fill the form by hand." / "Reading the form took too long…" | AI down / no key / 35 s | Logged; form unchanged |
| "Order … is saved, but the form photo was not attached" | Upload / `set_order_form` failed after saving | Try again (file still in memory) or open the order |
| "The order form can only be changed while the order is New, Assigned or Acknowledged (it is currently …)" / "Only an Admin can change the order form" | Wrong status / role | Refused (RPC and Storage policy) |
| "Insights are for Managers and Admins" / "You can only see the branches you cover" | Finance / technician / other branch | Card not shown; Ask: "Workload insights are for Managers and Admins." |
| "AI wording is not available right now; these are the plain facts." | AI down / not set up / 15 s | Fixed sentences |

## Defaults

| Setting | Default |
|---|---|
| Model / thinking | `gpt-6-luna`, `medium` (`OPENAI_MODEL`, `OPENAI_EFFORT`) |
| Supervisor limits | over quote ×1.5 and RM 100; 2 returns; 3 reschedules; rating ≤ 2 or not working |
| AI issues per check | 3, each ≤ 200 characters |
| AI check time limit | 25 s; retry sweep every 5 min, 2 posts, running > 5 min = failed |
| Re-check reuse window | 2 minutes |
| Check note | 3–300 characters |
| Order form file | photo (JPG/PNG/WebP) or PDF ≤ 3 pages, ≤ 10 MB; one per order |
| Form reading time limit | server 35 s, browser 40 s |
| Date with no time | 09:00 |
| Insight limits | busy ×1.5 and +3; quiet ×0.5 and −3; backlog > 2 days; reschedules ×2 and +3; rating −1.0 with ≥ 3 ratings |
| Insight wording | 15 s server / 20 s browser; saved 7 days by facts hash |
| AI log | 7 days (0008 nightly purge, which also removes insight wordings) |
| Rate limits | none in the app (OpenAI account limits and spend cap) |

## Behavioral Constraints

- Rule warnings, insight facts and every number come from the database; the
  AI only adds AI warnings, fills the five form fields for a person to check,
  or rewords given facts. It never removes or softens a rule warning, approves,
  returns, saves an order or changes data.
- Business text sent to the AI (job text for the supervisor, the uploaded
  form) is marked as data in the instructions; the answer must be strict JSON
  and every value is checked by the server.
- No customer phone number or address is sent as text or returned; the
  uploaded form image may show them, but they are not extracted.
- Warnings and checks are kept forever with the order (deleted only with the
  order); AI calls and insight wordings are kept 7 days.
- Technicians never see warnings or insights; Finance sees warnings, not
  insights.

## Related Documents

| Document | Type | Relationship |
|---|---|---|
| `docs/prd/0009-ai-advanced-prd.md` | Intent | Product goals this workflow fulfills |
| `docs/plan/0009-ai-advanced-plan.md` | Plan | Architecture this workflow implements |
| `docs/0008-ai-ops-query-workflow.md` | Workflow | Ask, the AI log, the `ask` function pattern |
| `docs/0004-review-and-close-workflow.md` | Workflow | Approve and return for rework |
| `docs/0007-kpi-dashboard-workflow.md` | Workflow | The numbers insights are built on |
| `docs/reference/folder-structure.md` | Reference | File locations of workflow components |
| `docs/decisions/0017-ai-advanced-implementation-details.md` | Decision log | Deviations from the plan |
