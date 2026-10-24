# 0008 - AI Operations Query Workflow

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

How a staff member asks an operational question in plain language ("What jobs
did technician Ali complete last week?") and gets a short answer with the
records behind it. The AI (OpenAI `gpt-6-luna`) never reads the database: it
picks lookups from a fixed menu, the server checks them and runs them in the
database as the person asking, and the AI writes one or two sentences from
the rows. Saved chats and the Admin AI log (the Question log until 0009) are
kept for 7 days.
Server: `supabase/functions/ask/`; database:
`supabase/migrations/20261024000001_ai_ops_query.sql`; screens:
`src/features/ask/`.

## Trigger

- An active Admin, Manager, Finance or Technician user clicks the **Ask**
  bubble (bottom right of every portal page) and sends a question, clicks an
  example question, or clicks a "Did you mean…?" / clarify button.
- An Admin opens **AI log** (`/ai-log`; `/question-log` redirects; 0009).

## Preconditions

- The hosted database has the 0008 migration
  (`docs/draft/0008-supabase-update.sql`), with `pg_trgm` and `pg_cron`.
- The `ask` Edge Function is deployed
  (`npx supabase functions deploy ask --project-ref <ref> --no-verify-jwt --use-api`)
  and the secret `OPENAI_API_KEY` is set (Edge Functions → Secrets).
  Optional secrets: `OPENAI_MODEL` (default `gpt-6-luna`), `OPENAI_EFFORT`
  (default `medium`).
- The caller is signed in with an active staff profile.

## Stages

### 1. The browser sends the question

**Input:** the question (1–1,000 characters) and the open chat's id (none for
a new chat).
**Actions:** `askQuestion` POSTs to `/functions/v1/ask` with the person's
sign-in token and reads the answer as a stream of JSON lines. The panel shows
each **step** as it arrives ("Understanding your question…", "Looking up
completed jobs for Ali, last week (12–18 Oct 2026)…", "Writing the answer…").
The browser gives up after **20 seconds**.
**Output:** a `result` or an `error` event.

### 2. The server checks the caller and the chat

**Actions:** checks the token (`auth.getUser`), loads the person
(`current_staff`, plus `covered_branches` for a Manager) and every branch
name. For a follow-up, reads the chat's last 5 questions and answers as the
person (their own chats only, last 7 days).
**On failure:** signed out / inactive → "Your sign-in has expired. Sign in
again."; another person's or an expired chat → "This chat is no longer
available. Start a new chat."

### 3. The AI picks lookups (at most 3)

**Input to OpenAI** (Responses API, `store: false`, thinking `medium`): fixed
instructions (`prompt.ts`), who is asking and today's Malaysia date, the last
5 questions and answers (text plus their "Looked up" lines; never rows), the
question, and the menu as strict function tools.

| Lookup (AI tool) | Database read (as the person) | Answers questions like |
|---|---|---|
| `kpi_summary` | `kpi_summary` (0007) | "How many jobs were completed today?" |
| `technician_leaderboard` | `kpi_technicians` (0007) | "Which technician completed the most jobs this week?", one technician's numbers, comparisons |
| `branch_comparison` | `kpi_branches` (0007) | "Which branch completed the most jobs last month?" |
| `trend` | `kpi_trend` (0007) | "Is Ali improving over the last 8 weeks?" |
| `technician_events` | `kpi_technician_events` (0007) | "What jobs did Ali complete last week?" |
| `job_list` | `ask_jobs` | "What is scheduled for tomorrow?", "Jobs waiting for review", "Jobs for customer Tan" |
| `payment_list` | `ask_payments` | "Which jobs are unpaid?", "Which receipts still need verifying?", "How much was collected this week?" |
| `workload_insights` (0009) | `insight_facts` | "Which technician might be overloaded this week?" (Managers and Admins; others: "Workload insights are for Managers and Admins.") |

Instead of a lookup the AI may call a **reply tool**, which the server words:
`reply_out_of_scope`, `reply_cannot_change_data(order_no)`,
`reply_clarify(question, options)`.

**Server checks before any read:** the tool is on the menu; the input fits its
strict schema (`checkInput`: closed objects, allowed values, branch names from
the database); at most 3 lookups per question (more get "You have used the 3
lookups… Answer with what you have."). A rejected call is sent back to the AI
as an error and never reaches the database.

### 4. Names and periods are resolved by the server

- **Technician names** (`technician_name`): `ask_find_people` as the person.
  One clear match is used (inactive people too, labelled "(inactive)"); two
  or more close matches → "I found more than one technician called "Ali".
  Which one do you mean?" with buttons such as "Ali (Shah Alam)" / "Ali Rahman
  (Kuala Lumpur)"; none → "No technician named "X" in your branches."
  A technician is always themselves ("me" / null); naming someone else →
  "You can only ask about your own jobs and numbers."
- **Periods** (`periods.ts`): named periods (today, yesterday, tomorrow,
  this / last / next week, this / last / next month, last N days, a month,
  a typed range) become Malaysia days `[start, end)`, Monday–Sunday weeks,
  at most 400 days, with a label such as "last week (12–18 Oct 2026)".

### 5. The database reads, as the person

The read runs with the person's token, so row-level security and the 0007
role checks apply: Admins and Finance every branch, Managers the branches
they cover, technicians only their own orders and numbers. A refusal is shown
as a fixed sentence (e.g. "You can only see the branches you cover (Shah
Alam)."); other database text goes to the function log only.

**What the AI receives:** per lookup an allow-list of columns, times in
Malaysia time, at most 30 rows plus the total. Never ids, customer phone
numbers or addresses, problem descriptions, admin / review / return notes,
completion remarks or feedback comments. The **full rows** (phone and address
included for jobs) go only to the person's browser for the table.

### 6. The AI writes the answer

After the lookups the AI writes one or two English sentences (questions may
be English, Malay or mixed), naming the period label, using only numbers in
the rows, people by name (never he / she), "(inactive)" when it applies, and
at most three order numbers. A "how many completed" question also reports
how many jobs are waiting for a Manager's review.

### 7. The person sees the answer

`AnswerCard`: the sentence; buttons for a choice (clarify / Did you mean) or
example questions (out of scope); **Open ORDER…** after a request to change
data; one table per lookup (cards under 640 px; columns with no values are
left out; "Showing 50 of 63" when cut); order links to the person's portal
(`/orders/…`, `/review/…`, `/finance/…`, `/jobs/…`); **Open in Dashboard** (or
**Open in My week** for a technician) for a whole week or month; and **How I
found this** in plain words ("Looked up: completed jobs · Ali · Shah Alam ·
last week (12–18 Oct 2026) · 2 found"). No function names, ids or JSON are
shown (decision 0016).

### 8. Saving and the AI log

`ask_record` (secret key, `service_role` only) saves every answered turn
(including clarify / out-of-scope / refused replies) in the person's chat
(a new chat is titled from the first question, 60 characters) and writes one
`ask_log` entry per question: who, question, lookups and their inputs and
status, rows found, outcome, time taken, tokens. Failed attempts (AI down,
not set up, timeout, error) are logged but not saved in the chat; the
question goes back into the box.

**Chats:** **Chats** lists the person's chats of the last 7 days (open,
**Rename**, **Delete** with a confirmation). Deleting a chat keeps its log
entries until they expire.
**AI log** (Admins; the Question log until 0009): table of the last 7 days
(cards below 768 px), filter by type (Ask, Job check, Order form, Insights),
person and result, totals of entries and tokens; lookups shown in plain words
("a technician's jobs", "totals", "job list", "workload insights", …). The
0009 entries are written by `ai_log_record` (`docs/0009-ai-advanced-workflow.md`).
**7 days:** reads hide anything older; `ask_purge_old()` deletes it nightly
at 03:00 Malaysia time (`pg_cron` job `ask-purge-old`).

## Database reads (0008)

All `stable`, granted to `authenticated` only; inputs and outputs are also in
each `comment on function`.

| Function | Inputs | Output |
|---|---|---|
| `ask_jobs(p_technician_id, p_branch_id, p_statuses text[], p_customer_name, p_payment_status, p_date_kind, p_start, p_end, p_limit default 50)` | technician (credit: completion technician, else assigned), branch, statuses, part of a customer name (wildcards are plain text), `unpaid` / `partial` / `paid`, date kind `scheduled` / `job_done` / `approved` (Reviewed or Closed only) / `created` / `closed` with a period, 1–200 rows | order, status, service, branch, technician (+ active), customer name / phone / address, scheduled / Job Done / approved / closed times, final amount, paid, balance, payment status, rating, returns, `total_count`; security invoker (RLS) |
| `ask_payments(p_kind, p_start, p_end, p_branch_id, p_technician_id, p_limit)` | `recorded` (period required), `unverified` (non-cash, not verified), `unpaid` / `partly_paid` (Job Done or Reviewed; period = Job Done day, optional) | order, status, branch, technician, customer, payment amount / method / recorded / verified, Job Done time, final amount, paid, balance, payment status, `total_count`; security invoker (RLS) |
| `ask_find_people(p_name, p_role default 'technician')` | a typed name; role `technician` / `manager` / `admin` / `finance` / `any` | up to 8 people the caller may ask about (Manager: covered branches incl. history; technician: only themselves) with a 0–1 score and `is_pick` for one clear match; security definer |
| `_ask_scope(p_branch_id, p_technician_id, p_start, p_end)` | — | the caller's visible branches and the period as instants, with the KPI refusals |
| `ask_rename_chat`, `ask_delete_chat` | own chat | renamed chat / nothing ("Chat not found" otherwise) |
| `ask_record(…)`, `ask_purge_old()` | — | `service_role` only (the Edge Function / pg_cron) |

Name score: lower case, punctuation and titles ("bin", "binti", "a/l",
"encik", "puan", "dr", …) dropped; exact 1, a whole word 0.95, a prefix 0.9,
else `pg_trgm` similarity; candidates from 0.4; a pick needs 0.5 and a lead
of more than 0.15 over the next.

## Error States

| Error | Cause | Handling |
|---|---|---|
| "The assistant is not set up yet." | No `OPENAI_API_KEY`, OpenAI refused the key (401 / 403), or the function is not deployed (404) | Logged (`not_set_up`); no Try again |
| "The assistant can't be reached right now. Try again in a minute, or open the Dashboard for the same numbers." | OpenAI error or no answer text | Question back in the box, **Try again**, **Open the Dashboard** (**Open My week** for a technician) |
| "This is taking too long. Try again." | Server 18 s / browser 20 s limit | Same as above |
| "Something went wrong while answering. Try again." | Unexpected database or server failure | Logged; raw text only in the function log |
| "You can only see the branches you cover (…)." / "You can only ask about your own jobs and numbers." | Another branch / another technician | Saved as a `refused` answer |
| "Choose a period of up to a year." / "The period must end after it starts." / "I could not read that month." | Bad period | Saved as `refused` |
| "No technician named "X" in your branches." | No match | `not_found` |
| "Keep the question to 1000 characters" / "Type a question" | Bad request | Shown in the panel |
| "Could not reach the server…" | No signal | Question back in the box, Try again |

## Defaults

| Setting | Default |
|---|---|
| Model / thinking | `gpt-6-luna`, `medium` (`OPENAI_MODEL`, `OPENAI_EFFORT`) |
| Lookups per question | 3 |
| AI calls per question | 4 (the last one must answer) |
| Rows sent to the AI per lookup | 30 (plus the total) |
| Rows per table | 50 (`p_limit`) |
| Follow-up context | last 5 questions and answers |
| Time limits | server 18 s, browser 20 s |
| Question length | 1,000 characters |
| Answer length | 800 characters |
| Chats and log kept | 7 days (nightly removal at 03:00 Malaysia time) |
| Rate limits | none in the app (OpenAI account limits and spend cap) |

## Behavioral Constraints

- The AI never sees the database, SQL, ids, phone numbers, addresses, notes
  or comments; it can only name a lookup from the menu with checked inputs.
- Every lookup runs with the person's own token. The secret key is used only
  for `ask_record` (saving) in the Edge Function.
- Nothing in this feature changes business data.
- Limits are fixed sentences written by the server, not by the AI (except
  the AI's own clarify question and a technician being told they can only see
  their own work).
- "Completed" means approved by a Manager, the same rule and functions as the
  KPI dashboard, so the numbers match.
- Text stored by people (notes, comments) never reaches the AI, so it cannot
  steer it; instructions typed in a question still run only with the
  person's own access.

## Related Documents

| Document | Type | Relationship |
|---|---|---|
| `docs/prd/0008-ai-ops-query-prd.md` | Intent | Product goals this workflow fulfills |
| `docs/plan/0008-ai-ops-query-plan.md` | Plan | Architecture this workflow implements |
| `docs/0007-kpi-dashboard-workflow.md` | Workflow | The five `kpi_*` functions on the menu |
| `docs/0006-staff-management-workflow.md` | Workflow | Edge Function pattern, inactive staff |
| `docs/reference/folder-structure.md` | Reference | File locations of workflow components |
| `docs/decisions/0016-ai-ops-query-implementation-details.md` | Decision log | Deviations from the plan |
