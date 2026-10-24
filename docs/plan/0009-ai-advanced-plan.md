# 0009 - AI Advanced Challenges Implementation Plan

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

Three AI challenges on the 0008 pattern (`docs/prd/0009-ai-advanced-prd.md`):

- **Workflow Supervisor** — rule warnings computed in the database by
  triggers; an AI text check started by the database itself (`pg_net`) when
  an order reaches Job Done; warnings stored per order forever; Approve
  blocked by a database guard until every open warning is checked.
- **Document Understanding** — **Read from photo** on the New Order form
  sends the photo / PDF to a new Edge Function, which returns the five
  fields (all or nothing); the file is uploaded only when the Admin saves
  and is registered as the order's **Order form** file.
- **Operational Insight** — one role-scoped SQL function finds the insight
  facts from the 0007 KPI numbers; the Edge Function has the AI word them
  (cached until the facts change); the Dashboard shows an Insights card and
  Ask gets a `workload_insights` lookup reading the same function.

A new Edge Function **`ai-assist`** (P5) holds all three AI calls and is the
only new code that talks to OpenAI; `ask` keeps working on its own. Shared
OpenAI plumbing moves to `supabase/functions/_shared/`. Every AI call is
written to the 0008 log, which becomes the Admin **AI log** (P6).

## Technical Approach

### Shared

- **Model:** `gpt-6-luna` via the official `openai` package (same version as
  `ask`), Responses API, `store: false`, thinking `medium`
  (`OPENAI_MODEL` / `OPENAI_EFFORT` secrets, as in 0008). Each AI step
  returns **strict JSON** through `text.format` with no tools (unlike 0008,
  no function calling is needed), so the server can check every value.
- **Prompts** (`ai-assist/prompts.ts`) tell the model that everything inside
  the data block is content from the business, never instructions, and that
  it may only return the given JSON shape. The server ignores anything else.
- **Function layout:** `supabase/functions/ai-assist/` with `index.ts`
  (Deno wiring), `handler.ts` (routing and checks, tested with Vitest),
  `supervisor.ts`, `formReader.ts`, `insights.ts`, `prompts.ts`;
  `supabase/functions/_shared/openai.ts` (client, errors, token counts) and
  `_shared/keys.ts` (the key-list helper now in `ask/index.ts`). Deployed
  with `--no-verify-jwt --use-api` like `ask`.
- **Who calls it:** the browser with the person's token (form reading,
  insight wording, Re-check) or the database with a shared secret
  (automatic Job Done check, P1). Each action checks the caller first.
- **AI log (P6):** `ask_log` gains `feature` (`ask` / `supervisor` / `form`
  / `insights`, default `ask`) and `order_id`; `staff_id` stays required
  (automatic checks are logged under the technician who submitted). The
  `question` column holds a plain summary for non-Ask rows ("Job check
  ORDER1042", "Read order form (photo, 1.2 MB)", "Insights · this week ·
  Shah Alam"). New outcomes: `warnings`, `no_warnings`, `filled`,
  `unclear`, `worded`. `ask_record` is unchanged; a new `ai_log_record`
  (service_role) writes non-Ask rows. The Question log page becomes
  **AI log** (`/ai-log`, `/question-log` redirects) with a **Type** filter;
  the 7-day purge already covers the table.
- **No app rate limits** (PRD Q3). Errors map to the 0008 fixed sentences
  (`not_set_up`, `ai_unavailable`, `timeout`).

### Workflow Supervisor

- **Tables** (migration `20261025000001_ai_advanced.sql`):
  - `order_warnings` — `id`, `order_id`, `rule` (`over_quote`, `no_photo`,
    `many_returns`, `many_reschedules`, `low_rating`, `ai_text`),
    `source` (`rule` / `ai`), `message` (plain English, written by the
    server), `facts` jsonb (numbers behind it), `status` (`open` /
    `checked` / `resolved`), `opened_at`, `checked_by`, `checked_at`,
    `check_note`, `resolved_at`, `ai_run_id`. One open-or-checked row per
    rule per order for rule warnings. Select under RLS for Admins, Finance
    and covering Managers (technicians: none). No client writes; never
    deleted (`order_warnings_guard_trg`, disabled by test cleanup).
  - `supervisor_runs` — `id`, `order_id`, `trigger` (`job_done` /
    `resubmitted` / `recheck`), `requested_by`, `status` (`pending` /
    `running` / `done` / `failed` / `not_set_up`), `error`, `created_at`,
    `finished_at`. Readable like `order_warnings`.
- **Rules** (`_supervisor_rules(order_id)`, security definer, mirrored in
  `src/domain/supervisor.ts`; limits fixed, P7): only for orders in Job Done,
  Reviewed or Closed.

  | Rule | Opens when | Message (example) |
  |---|---|---|
  | `over_quote` | final ≥ quote × 1.5 **and** final − quote ≥ RM 100 | "Final amount RM 980.00 is 180% above the quoted RM 350.00." |
  | `no_photo` | no `photo` job file (receipts excluded) | "Job Done but no photos uploaded." |
  | `many_returns` | returned for rework ≥ 2 times | "Returned for rework 2 times." |
  | `many_reschedules` | rescheduled or postponed ≥ 3 times | "Rescheduled 3 times." |
  | `low_rating` | latest customer rating 1–2 stars or "not working" | "Customer rated 1 star." |

  Re-evaluated by triggers: order status changes to Job Done (also after
  rework), job files added / removed, a reschedule logged, feedback
  recorded. A rule whose cause is gone marks its open or checked row
  `resolved`; if the cause comes back a new open row appears; a checked row
  whose cause persists stays checked (the facts are updated).
- **AI text check (P1):** an `after update` trigger on `orders` (status →
  `job_done`) inserts a `supervisor_runs` row and, where `pg_net` exists,
  calls `net.http_post` to `app_settings.ai_assist_url` with the run id and
  the header `x-ai-trigger: <secret>` read from Supabase Vault
  (`ai_trigger_secret`). PGlite has no `pg_net`: the run stays `pending`
  and tests call the handler directly. A `pg_cron` sweep every 5 minutes
  re-posts runs left `pending` for more than 2 minutes (once), then marks
  them `failed`.
- **Function action `supervisor_check`** (secret header or a covering
  Manager's token for Re-check): reads `supervisor_ai_input(run_id)`
  (service_role) — service type, quote, extra charges, final amount,
  problem description, work done, remarks, plus the AI warnings already
  **checked** with their notes (P4) — never customer name, phone, address
  or feedback text. The AI returns `{ "issues": [{ "message": string }] }`
  (at most 3, each ≤ 200 characters). `supervisor_save_ai(run_id, issues,
  tokens)` (service_role) marks this order's earlier **open** AI warnings
  `resolved`, inserts the new ones as `open`, closes the run, and logs.
  Checked AI warnings are never touched (P4).
- **Re-check:** `request_supervisor_recheck(order_id)` (covering Manager,
  order in Job Done) inserts a `recheck` run and returns its id; the browser
  calls `ai-assist` with it and the person's token.
- **Check a warning:** `check_order_warning(warning_id, note)` — covering
  Manager, order in Job Done, note 3–300 characters; sets `checked`.
- **Approve guard:** a `before update` trigger on `orders` refuses Job Done
  → Reviewed while any `open` warning exists: "Check every warning before
  approving (2 open)." A `failed` / `pending` AI run does not block
  (PRD Q18). Return for rework is unaffected.
- **Screens** (`src/features/supervisor/`): `WarningsBox` on the Manager,
  Admin and Finance order pages (rule / "AI" label, message, Check with a
  note, checked-by line, "AI check running…" / "AI check didn't run —
  Re-check"; Realtime on `order_warnings` and `supervisor_runs` for that
  order); "2 warnings" badge and a **Warnings** filter in the Manager review
  queue (`order_warning_counts(order_ids)`); Approve disabled with "Check
  every warning first" while any are open.

### Document Understanding

- **Read (P2):** **Read from photo** on `NewOrderPage` (Admins) opens a
  file picker (`accept` photo / PDF, camera on a phone). The browser checks
  type and size (`src/domain/orderForm.ts`: JPG / PNG / WebP / PDF,
  ≤ 10 MB), keeps the file in memory, and posts it (base64 JSON) to
  `ai-assist` action `read_form` with the Admin's token. The panel shows
  "Reading the form…"; the browser gives up after 40 s.
- **Server:** Admin only; checks the bytes' real type and size again and,
  for a PDF, counts pages (`pdf-lib`, ≤ 3). Sends the file to the model as
  `input_image` / `input_file` with the active service types' names. The
  model returns, per field (`customer_name`, `service_type`, `details`,
  `amount`, `date`), `{ "value": string | null, "on_form": boolean,
  "clear": boolean }`. **All or nothing (PRD Q11):** if any field with
  `on_form` is not `clear`, or the service type matches no active type, or
  the amount fails the price rule, or the date is not a real date, the
  answer is "Couldn't read this form clearly. Try a clearer photo or fill
  the form by hand." Otherwise the five values come back; text is kept as
  written (Q20). Phone numbers and addresses are not in the schema (Q22).
  The file is not stored by the function or by OpenAI.
- **Fill:** the five fields are filled (date → the scheduled date / time
  field, time left empty if none); a note "Filled from the photo — check
  every field before saving" shows; nothing is saved.
- **Save (P2):** after `create_order` succeeds, the browser uploads the
  kept file to `job-files/<order_id>/form/<uuid>.<ext>` and calls
  `set_order_form(order_id, path)`. If the upload fails, the order is saved
  and the page shows "The form photo was not attached" with **Try again**.
  Cancelled or left pages store nothing.
- **Order form file:** `attachments.is_order_form boolean default false`;
  at most one per order; not counted in the 6 job files (`add_attachment`'s
  count excludes it); storage access follows the order like job files, but
  writes to `<order_id>/form/` only by Admins via `set_order_form` /
  `remove_order_form` while the order is New, Assigned or Acknowledged
  (P8). The old object is deleted from Storage by the browser after the
  replace succeeds (Storage files cannot be deleted with SQL). Shown as
  **Order form** on the Admin, Manager, Finance and technician order pages
  (technicians see it, Q19).

### Operational Insight

- **Facts:** `insight_facts(p_start date, p_end date, p_branch_id uuid
  default null)` — stable, security definer, Admins (all branches) and
  Managers (covered branches) only; others get "Insights are for Managers
  and Admins." Built on the 0007 internals (`_kpi_period`,
  `_kpi_visible_branches`, `_kpi_metrics`) so the numbers equal the
  dashboard. Returns rows `(kind, subject, branch_name, value, compare,
  team_average, period_label_hint)`:

  | Kind | Rule |
  |---|---|
  | `busy` | completed ≥ 1.5 × team average **and** ≥ average + 3 |
  | `quiet` | active, completed ≤ 0.5 × average **and** ≤ average − 3 |
  | `review_backlog` | per branch, orders in Job Done for more than 2 days (now) |
  | `reschedules_up` | per branch, reschedules this period ≥ 2 × the previous period of the same length **and** ≥ 3 more |
  | `rating_drop` | per technician, average rating down ≥ 1.0 vs the previous period, ≥ 3 ratings in each |

  Team = technicians in the viewed branches with a KPI row for the period
  (0007 `_kpi_active_technicians`). Mirrored in `src/domain/insights.ts`
  with the fixed fallback sentences ("Bala completed 11 jobs, team average
  5.0.").
- **Wording (P3):** `ai-assist` action `word_insights` (person's token):
  reads `insight_facts` as the person, hashes the facts plus period label,
  and looks in `insight_wordings` (hash, sentences jsonb, created_at; service
  role only; purged after 7 days). On a miss the AI gets the facts and
  returns `{ "sentences": [{ "fact": number, "text": string }],
  "tip": string | null }`. The server keeps a sentence only if every number
  in it appears in its fact (else the fixed sentence is used), caps the tip
  at 200 characters, stores and returns it. AI down → fixed sentences.
- **Card:** `InsightsCard` at the top of `DashboardPage` for Managers and
  Admins, following the dashboard's period and branch filter: facts first
  (fixed sentences), replaced by the AI wording when it arrives; "No
  insights for this period" when empty; links to the technician / branch.
- **Ask:** new menu item `workload_insights` (period, optional branch) in
  `ask/lookups.ts` reading `insight_facts`; the answer uses the facts the
  same way; Finance and technicians get the fixed refusal. `ask` is
  redeployed.

## System Components

| Component | Responsibility |
|---|---|
| `supabase/migrations/20261025000001_ai_advanced.sql` | Tables, rules, triggers, guard, RPCs, `insight_facts`, `pg_net` / `pg_cron` / Vault wiring (guarded for PGlite), AI log columns |
| `supabase/functions/ai-assist/` | `supervisor_check`, `read_form`, `word_insights`; caller checks; strict JSON from the AI; logging |
| `supabase/functions/_shared/` | OpenAI client and errors, key helper (used by `ask` and `ai-assist`) |
| `supabase/functions/ask/lookups.ts` | `workload_insights` lookup |
| `src/domain/supervisor.ts`, `src/domain/insights.ts`, `src/domain/orderForm.ts` | Rule limits, insight rules and sentences, form file checks (parity-tested) |
| `src/features/supervisor/` | `WarningsBox`, warning badge, check dialog, Re-check, api |
| `src/features/orders/` | Read from photo, Order form upload / replace / remove |
| `src/features/kpi/` | `InsightsCard` |
| `src/features/ask/` | AI log page (was Question log) with Type filter |
| `src/features/jobs/`, `src/features/order-review/` | Order form link; warnings on the review page and queue |

## Processing Flow

1. **Job Done:** Ali submits → status Job Done → rule triggers write rule
   warnings → AI trigger inserts a run and posts to `ai-assist` → AI
   warnings saved (or the run fails) → Nurul's queue shows the count →
   Nurul checks each warning with a note or returns the job → Approve
   allowed once none are open.
2. **Read from photo:** Farid picks a file → `read_form` → five fields or
   "Couldn't read…" → Farid edits and saves → file uploaded and registered
   as Order form.
3. **Insights:** Nurul opens the Dashboard → `insight_facts` shows fixed
   sentences → `word_insights` returns cached or new AI sentences → card
   updates. Ask's `workload_insights` uses the same facts.

## Dependencies

| Dependency | Purpose |
|---|---|
| `openai` (npm, same version as `ask`) | Responses API with strict JSON output and image / file input |
| `pdf-lib` (npm, in the Edge Function only) | Count PDF pages before sending |
| `pg_net` (Supabase extension) | Database starts the AI check (P1) |
| Supabase Vault | Holds the trigger secret the database sends |
| `pg_cron` (already used by 0008) | Retry sweep for pending checks |

New secrets / settings (the user enters them; the agent never sees them):
`AI_TRIGGER_SECRET` (Edge Function secret for `ai-assist`) and the same
value in Vault as `ai_trigger_secret`; `app_settings.ai_assist_url` (the
function's address, set by the SQL update).

## Implementation Phases

### Phase 1: Database

Migration with tables, rules and triggers, approve guard, warning RPCs,
Order form column and RPCs, `insight_facts`, AI log columns and
`ai_log_record`, `insight_wordings`, guarded `pg_net` / Vault / `pg_cron`.
Domain mirrors and PGlite tests (rules open / resolve / reopen, guard, role
scope, insight numbers equal `kpi_technicians` / `kpi_branches`).

### Phase 2: Edge Functions

`_shared/` extraction (ask tests stay green), `ai-assist` handler with the
three actions and a fake AI client in tests (caller checks, all-or-nothing,
number check on insight sentences, nothing private in the AI input, prompt
injection text stays content), `workload_insights` in `ask`.

### Phase 3: Screens

Warnings box, queue badge and filter, Approve state; Read from photo and
Order form handling (new, edit, all order pages); Insights card; AI log
page. UI tests with `api.ts` doubles; 375 px layouts.

### Phase 4: Verify and document

Full test / typecheck / build / validate-config; hosted SQL
(`docs/draft/0009-supabase-update.sql`), secrets and deploy steps; hosted
manual check with real `gpt-6-luna`; workflow doc, reference, decision log,
roadmap, README, `CLAUDE.project.md`.

## Testing Strategy

- **DB (PGlite):** each rule's thresholds at the edges (RM 99.99 vs RM 100,
  ×1.49 vs ×1.5), resolve and reopen, checked rows kept, approve guard,
  rework not blocked, who may check / re-check, technicians cannot read
  warnings, Order form rules (one per order, not in the 6, status window,
  Admin only), `insight_facts` per kind and role, numbers equal to the KPI
  functions, AI log rows.
- **Functions (Vitest, fake AI):** each action's caller check (secret,
  token, role), strict-JSON parsing and rejection of extra output, form
  all-or-nothing cases (unclear, not on form, bad service type, bad amount,
  PDF > 3 pages, wrong type, > 10 MB), insight number check and fallback,
  AI down / not set up, no phone / address / customer name in any AI input.
- **Parity:** `tests/db/parity.test.ts` gains the supervisor limits, insight
  rules and form file checks.
- **UI (jsdom):** Warnings box states, Approve disabled, Read from photo
  states, Order form replace window, Insights card fallback → AI text, AI
  log filter.

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| `gpt-6-luna` does not accept images / PDFs or strict JSON with them | Form reading cannot work as planned | Check OpenAI's model page at the start of Phase 2; if unsupported, stop and ask (decision log) before any model change |
| `pg_net` call fails or the function is down | No AI warnings for a job | Run stays visible; 5-minute retry sweep; "AI check didn't run — Re-check"; rules unaffected |
| The trigger secret is wrong or missing | Every automatic check is refused | Function logs `not_set_up`; Warnings box offers Re-check (which uses the Manager's token) |
| AI false alarms | Managers write notes for nothing | AI warnings are labelled, at most 3 per check, checked ones are not raised again (P4) |
| Prompt injection in remarks or a form | AI output steered | Strict JSON only; the AI can add a warning or fill boxes, never remove warnings or save; the person reviews |
| Large uploads through the function | Slow or refused requests | 10 MB browser check, server check, 40 s limit, clear message |
| Insight sentences invent numbers | Misleading card | Number check per sentence, fixed sentence fallback |

## Roadmap Phase

**Phase:** 4 – Stretch

## Related Documents

| Document | Type | Relationship |
|---|---|---|
| `docs/product-roadmap.md` | Roadmap | Phase assignment and sequencing for this plan |
| `docs/prd/0009-ai-advanced-prd.md` | Intent | Product goals and constraints this plan implements |
| `docs/plan/0008-ai-ops-query-plan.md` | Plan | The `ask` pattern this plan extends |
| `docs/0009-ai-advanced-workflow.md` | Workflow | Runtime behavior derived from this plan |
| `docs/reference/folder-structure.md` | Reference | Structural placement of planned components |
| `docs/decisions/NNNN-*.md` | Decision log | Divergences from this plan |

## Open Questions

All answered on 2026-10-24.

- [x] **P1. Who starts the AI check.** The database (`pg_net`) at Job Done, with a shared secret.
- [x] **P2. Form file storage.** Uploaded only when the Admin saves.
- [x] **P3. Insight wording.** Reused until the facts change.
- [x] **P4. Re-check.** Checked AI warnings stay checked; the AI is told about them.
- [x] **P5. Server layout.** New `ai-assist` Edge Function beside `ask`.
- [x] **P6. AI log.** One AI log page with a Type filter.
- [x] **P7. Warning limits.** Fixed in the app, listed in the README.
- [x] **P8. Order form photo.** Replace or remove while New, Assigned or Acknowledged.
