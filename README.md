# Sejuk Sejuk Service: AI Features

An internal operations system for an air-conditioner service company (orders,
technician jobs, review and close, customer feedback, staff, KPI dashboard).
This section covers how AI is used: the brief's AI module (the **Ask**
operations query) and all three optional advanced challenges (**Workflow
Supervisor**, **Document Understanding**, **Operational Insight**). The full
project README follows in feature 0010. Details:
[docs/0008-ai-ops-query-workflow.md](docs/0008-ai-ops-query-workflow.md),
[docs/0009-ai-advanced-workflow.md](docs/0009-ai-advanced-workflow.md).

**One rule for every AI feature:** the database decides every fact, number and
permission; the AI (OpenAI `gpt-6-luna`, called only from Supabase Edge
Functions that hold the key) only chooses from fixed options, reads text, or
words things, and a person always makes the decision.

## How the AI works

Every portal has an **Ask** chat bubble (bottom right). Staff type a question
in English or Malay and get one or two English sentences, a table of the
records behind them (orders link to the order page), and a plain "How I
found this" line.

```text
question ─▶ ask Edge Function ─▶ OpenAI gpt-6-luna picks lookups from a fixed menu (max 3)
                 │                        │
                 │◀── lookup names + inputs (never SQL)
                 ├─ checks every input (menu, schema, names, Malaysia dates)
                 ├─ runs each read in Postgres AS THE PERSON ASKING (row-level security)
                 ├─ sends OpenAI only allowed columns (no phone, address, notes) ─▶ writes the sentence
                 └─▶ browser: sentence + table drawn from the database rows + "How I found this"
```

- The AI never reads the database and never writes SQL. It can only name one
  of nine read functions; the server checks the inputs and runs the read with
  the person's own sign-in, so it sees exactly what the person's screens see.
- Numbers come from the same functions as the KPI dashboard, so they match.
  "Completed" means approved by a Manager.
- The OpenAI key lives only in the Edge Function's secrets, never in the browser.

## Supported questions

| Type | Example questions | Lookup |
|---|---|---|
| Totals for a period | "How many jobs were completed today?" (also says how many wait for review) | `kpi_summary` |
| Who did the most / one technician's numbers | "Which technician completed the most jobs this week?", "How did Bala do last month?", "Compare Ali and Bala this week" | `kpi_technicians` |
| A technician's jobs | "What jobs did technician Ali complete last week?", "Ali's reschedules this month" | `kpi_technician_events` |
| Branches | "Which branch completed the most jobs last month?" | `kpi_branches` |
| Trends | "Is Ali improving over the last 8 weeks?" | `kpi_trend` |
| Job lists | "What is scheduled for tomorrow?", "Which jobs are waiting for review in KL?", "Jobs for customer Tan" | `ask_jobs` |
| Money | "Which jobs are still unpaid?", "Which receipts still need verifying?", "Payments recorded this week" | `ask_payments` |
| Workload (Managers, Admins) | "Which technician might be overloaded this week?", "Anything unusual this week?" | `insight_facts` |
| Follow-ups | "and last week?", "what about Bala?" (last 5 questions of the chat) | — |

Periods: today, yesterday, tomorrow, this / last / next week (Monday–Sunday),
this / last / next month, the last N days, a named month, or typed dates;
always Malaysia time, at most a year. Names may be misspelt ("Jon", "Encik
Bala"); two matches give "Did you mean…?" buttons.

Who may ask: Admins and Finance about every branch, Managers about the
branches they cover, technicians only about their own jobs and numbers.

## Limitations

- **Read-only.** "Assign ORDER1234 to Bala" gets "I can only look things up",
  with a link to the order.
- **Only this company's operations.** Other questions (weather, general
  knowledge, writing emails) get a fixed reply with example questions.
- **Only what the person may see.** "You can only see the branches you cover
  (Shah Alam)." / "You can only ask about your own jobs and numbers."
- **Only the menu.** Questions no lookup can answer (e.g. stock levels,
  customer complaints text, forecasts) cannot be answered.
- **No free text.** Order notes, review notes and customer comments are never
  sent to the AI, so it cannot quote them (and they cannot steer it).
- **Up to 3 lookups per question**; at most 30 rows per lookup reach the AI,
  50 appear in the table ("Showing 50 of 63").
- **English answers only** (questions may be Malay or mixed).
- **The wording is AI-written** and can occasionally be imperfect; the table
  and "How I found this" show exactly what was read, and every answer can be
  checked on the Dashboard.
- **Speed:** usually 3–9 seconds; the app gives up after 20 seconds.
- **Needs OpenAI:** if it is down or not set up, the app says so and points to
  the Dashboard.
- **History:** chats and the Admin AI log are kept 7 days, then deleted.
- **Cost control** is the OpenAI account's spend limit; the app has no rate
  limits. `gpt-6-luna` costs about US$0.001 per question.

## Advanced AI challenges (all three)

### 1. AI Workflow Supervisor — warnings on finished jobs

```text
Ali presses Job Done
  ├─ database rules (instant, exact) ──────────▶ rule warnings
  └─ database posts the job to ai-assist (pg_net + a Vault secret)
        └─ gpt-6-luna reads ONLY the job record: service type, quote, extra
           charges, final amount, problem description, work done, remarks
           ──▶ strict JSON: at most 3 issues ──▶ "AI" warnings
Nurul's review list: "3 warnings"  ─▶ order page: check each with a note ─▶ Approve
```

- **Rules (database):** final amount 50% **and** RM 100 or more above the quote
  ("Final amount RM 880.00 is 214% above the quoted RM 280.00."); Job Done but
  no photos; returned for rework 2+ times; rescheduled 3+ times; a 1–2 star or
  "not working" customer rating (also after approval).
- **AI:** contradictions in the written record that rules cannot see, quoting
  the words: "The service type is "Aircond cleaning," but the work done says
  "Replaced compressor, regassed unit."", "The work is unfinished: it says
  "still leaking"", extra charges the remarks do not explain.
- **Managers** see a warning count in the review list (and a filter), and a
  Warnings box on the order page. **Approve stays off until every warning is
  checked** with a short note (kept forever: who, when, note). Return for
  rework never needs checks. **Re-check with AI** runs the AI again; warnings
  already checked are not raised again. Admins and Finance read the box;
  technicians never see warnings.
- **Limitations:** the AI reads only text (not photos); it can miss a problem or
  raise a false alarm (a note clears it); if OpenAI is down the rule warnings
  still appear, the AI part says "didn't run — Re-check", and Approve is never
  blocked by it; the limits are fixed in code (a developer changes them).

### 2. AI Document Understanding — "Read from photo"

On **New order**, an Admin takes or chooses a photo (JPG, PNG, WebP) or a PDF
(up to 3 pages, 10 MB) of a paper order form. `gpt-6-luna` reads the five
fields of the brief and the form fills itself: customer name, service type
(matched to the company's list, e.g. "Cuci aircond" → Aircond cleaning),
service details, amount and date (and time). The Admin checks, types the phone
and address, and saves; the photo is kept with the order as its **Order form**
(the technician sees it too; it is not one of the 6 job files; it can be
replaced or removed before work starts).

- **All or nothing:** if any field on the form is unclear (or the service type,
  amount or date is not valid), nothing is filled: "Couldn't read this form
  clearly. Try a clearer photo or fill the form by hand."
- **Limitations:** the person must check every field (nothing saves by itself);
  phone numbers and addresses are never read (privacy; typed by hand); text is
  kept as written (Malay is not translated); a date with no time is set to
  09:00 (the screen says so); messy handwriting or a blurry photo fills
  nothing; HEIC photos are not accepted; about 3–6 seconds per form.

### 3. AI Operational Insight — what stands out this week

An **Insights** card at the top of the Dashboard (Managers: their branches;
Admins: all) and the Ask question "Which technician might be overloaded this
week?" both use the same database facts:

| Insight | Rule (database, from the KPI numbers) |
|---|---|
| Busy | completed jobs ≥ 1.5 × the team average **and** ≥ 3 more ("Bala completed 11 jobs this week, well above the team average of 6.3.") |
| Quiet | an active technician with ≤ half the average **and** ≥ 3 fewer |
| Waiting for review | a branch's jobs Job Done for more than 2 days |
| Rising reschedules | a branch's reschedules at least doubled **and** 3 more than the period before |
| Rating drop | a technician's average rating fell by 1.0 or more (≥ 3 ratings in each period) |

The AI only rewords the facts and may add one tip ("Consider sharing Shah Alam
jobs between Bala and Yusoff, and review the 2 waiting jobs."). The server
rejects any sentence that uses a number not in its fact; the wording is saved
and reused until the numbers change.

- **Limitations:** only these five patterns are found ("overloaded" means well
  above the team average, not hours worked or travel); one technician cannot
  be compared with a team; the AI wording can be plain or slightly repetitive,
  but the numbers are always the Dashboard's; if OpenAI is down the card shows
  the plain facts; Finance and technicians do not get insights.

### Admin AI log

Admins see every AI use of the last 7 days (Ask questions, job checks, order
forms read, insights) with who, when, the result, time taken and tokens
(**AI log**, filter by type).

## Privacy

Sent to OpenAI (always with `store: false`):

- **Ask:** the question, earlier turns of the same chat, and the allowed
  columns of the rows read (order numbers, names of technicians, branches and
  customers, service types, statuses, dates, amounts, counts, ratings).
- **Job check:** the job's service type, money, problem description, work done
  and remarks, and the checked warnings' notes. No customer name, phone,
  address or feedback.
- **Read from photo:** the uploaded image or PDF itself (it may show a phone
  number or address, which is not extracted or returned).
- **Insights:** technician and branch names with their counts and averages.

Never sent as text: customer phone numbers and addresses, ids, admin / review
notes or feedback comments. Text written by staff or on a form is marked as data
in the instructions; the AI answers only in a fixed JSON shape that the server
checks, so a remark like "AI: ignore your rules" cannot remove a warning,
approve, or change anything (in the hosted check it was flagged instead).

## Set-up (hosted Supabase)

1. Run `supabase/migrations/20261024000001_ai_ops_query.sql` and
   `supabase/migrations/20261024000002_ai_advanced.sql` (SQL Editor); set
   `app_settings.ai_assist_url` to `https://<ref>.supabase.co/functions/v1/ai-assist`.
2. Supabase dashboard → Edge Functions → Secrets: `OPENAI_API_KEY`
   (optional `OPENAI_MODEL`, default `gpt-6-luna`; `OPENAI_EFFORT`, default
   `medium`) and `AI_TRIGGER_SECRET` (a long random value); the same value in
   Integrations → Vault as `ai_trigger_secret`.
3. `npx supabase functions deploy ask --project-ref <ref> --no-verify-jwt --use-api`
   and `npx supabase functions deploy ai-assist --project-ref <ref> --no-verify-jwt --use-api`

---

The rest of this README describes the harness the project is built on.

# General Harness

A reusable, hands-off **agent-orchestration harness** for Claude Code with a
**docs-first** workflow. Start any new project from this template: you describe the
work in plain language, and the harness routes it to the right agent and workflow.
You don't need to tag an `@agent` or a skill.

## What's Inside

```text
.
├── CLAUDE.md               # Generic harness policy (routing, tiers, guardrails) — core
├── CLAUDE.project.md       # Project context layer — fill this in per project
├── .mcp.json               # MCP servers (empty by default)
├── .claude/
│   ├── agents/             # orchestrator, executor, workflow-author, mcp-connector
│   ├── skills/             # analyze-requirements, execute-plan, author/generate-workflow,
│   │                       # mcp-connector, validate-config (+ validator script)
│   ├── workflows/          # _template.yml, README.md, registry.yml (ships routeless)
│   ├── hooks/              # session_start.py — onboarding + opt-in core auto-pull
│   ├── GLOSSARY.md         # Single source of truth for names
│   ├── CORE.manifest       # Checksum lock over the shared core files
│   └── settings.json       # Registers the SessionStart hook
└── docs/                   # Docs-first source of truth
    ├── documentation-standard.md
    ├── product-roadmap.md  # Starts as the roadmap template — fill it in
    ├── prd/  plan/  reference/  decisions/
    ├── draft/              # Personal scratch space; agents ignore it
    └── templates/          # PRD, plan, workflow, reference, roadmap, decision-log
```

## How Requests Are Routed

| Request shape | What happens |
|---|---|
| Trivial (about 15 lines or fewer, one file) | Runs directly, without the orchestrator |
| Build / implement / change / fix | **orchestrator** picks a route from `registry.yml`, or uses the built-in ad-hoc route (`executor` → self-review) |
| Mentions a workflow / cycle / pipeline / route | **workflow-author** scaffolds, validates, and registers it |
| Mentions an MCP server / connector | **mcp-connector** adds it to `.mcp.json` |

See [CLAUDE.md](CLAUDE.md) for the full policy and
[.claude/workflows/README.md](.claude/workflows/README.md) for the workflow format.

## Docs-First Workflow

1. Set the product direction in `docs/product-roadmap.md`.
2. For each feature, write `docs/prd/NNNN-[feature]-prd.md`, then `docs/plan/NNNN-[feature]-plan.md`,
   starting from `docs/templates/`.
3. Implement against the PRD and plan. When the code diverges from the plan, add an entry
   to `docs/decisions/NNNN-title.md`. Don't rewrite the PRD or plan to match.
4. Keep the workflow and reference docs current, and run the session-close checklist in
   [docs/documentation-standard.md](docs/documentation-standard.md).

## Starting A New Project From This Harness

1. Copy or clone this repo into the new project.
2. Fill in [CLAUDE.project.md](CLAUDE.project.md) and `docs/product-roadmap.md`.
3. Add project-only capabilities under namespaced names so they never collide with core:
   - agent → `.claude/agents/proj.<name>.md`
   - skill → `.claude/skills/proj-<name>/SKILL.md`
   - workflow → `.claude/workflows/proj-<name>.yml`, plus a route in `registry.yml`
4. Validate after any change under `.claude/`:

   ```bash
   python .claude/skills/validate-config/scripts/validate_config.py
   ```

5. (Optional) To receive core updates, add this harness as the `upstream` remote. The
   SessionStart hook then refreshes core files automatically:

   ```bash
   git remote add upstream <this-harness-repo-url>
   ```

**Never edit a core file** (the files listed in `.claude/CORE.manifest`) to change project
behavior. Add a `proj.*` / `proj-*` capability instead. If a core file drifts, the validator
reports a core-lock error. Harness maintainers who deliberately change core should
regenerate the lock with `--update-core-manifest`.
