# 0009 - AI Advanced Challenges PRD

> **Type:** Intent | **Must stay current:** No -- record divergences in decision log

<!-- AI Context
Role: This document captures product intent, not implementation detail.
Use it to understand *what* the feature should do and *why*, then consult the
implementation plan and workflow docs for *how*.
Do not rewrite this document during coding. If implementation diverges from
the intent described here, add an entry to the decision log instead.
-->

## Purpose

The Ask assistant (0008) answers questions people type, but nobody is told
when a finished job looks wrong, Admins still retype paper order forms by
hand, and a Manager has to spot an overloaded technician on the dashboard
alone. This PRD builds all three of the brief's optional advanced AI
challenges on the 0008 pattern (a server function holds the AI key, the
database stays the only authority, the person always decides):

1. **Workflow Supervisor** — every Job Done is checked at once; Managers
   see warnings ("Final amount much higher than quoted price", "Job done but
   no photos uploaded") and must check each one before approving.
2. **Document Understanding** — an Admin uploads a photo or PDF of a paper
   order form and the New Order form fills itself (customer name, service
   type, service details, amount, date) for the Admin to check and save.
3. **Operational Insight** — a Dashboard "Insights" card and Ask answers
   such as "Bala completed 11 jobs this week, which is significantly higher
   than the team average (5)."

Source: the brief's Optional Advanced AI Challenges ("candidates may
implement one or more"; the README must describe how AI was integrated and
its limitations; `docs/prd/0000-programmer-assessment-brief.docx`).

## Goals

- A Manager never approves a job without seeing what looks wrong with it:
  warnings are ready in the review list before they open the job, and each
  one is checked with a note (or the job is returned for rework).
- Warnings are trustworthy: facts (amounts, photos, returns, reschedules,
  ratings) are found by fixed rules in the database; the AI only reads the
  technician's written text for contradictions, and its warnings are
  labelled "AI".
- An Admin turns a paper order form into a saved order in under a minute:
  photo in, five fields filled, checked, saved — and the original form stays
  with the order.
- Managers and Admins see who is overloaded or quiet, which branch has a
  review backlog, where reschedules are rising, and whose rating is
  dropping, with numbers that match the KPI dashboard exactly.
- When the AI service is down, every rule-based part still works and says
  plainly which AI part did not run.
- The README explains how each challenge uses AI and its limitations.

## Non-Goals

- Vercel deployment (0010).
- Receipt reading for Finance and job-sheet comparison for Managers (Q9:
  New Order form only).
- The AI changing data on its own: it never approves, returns, saves an
  order, or removes a rule warning.
- Warnings shown to technicians; insights shown to technicians or Finance
  (Q7, Q16).
- App-side rate limits (Q3: OpenAI's own limits and spend cap, as in 0008).
- Translating what customers wrote (Q20).
- Training or fine-tuning a model on company data.

## Scope

| In Scope | Out of Scope |
|---|---|
| Supervisor rule checks in the database at Job Done (Q5, Q6) | Receipt and job-sheet reading (Q9) |
| Supervisor AI text check right after Job Done; Re-check button (Q5, Q6) | Warnings for technicians (Q7) |
| Warning badge in the Manager review list and a Warnings box on the order page (Q7) | Blocking approval because the AI is down (Q18) |
| Each open warning checked with a note before Approve; kept forever (Q4, Q8) | App-side rate limits (Q3) |
| "Read from photo" on the New Order form: photo / PDF, five fields, all-or-nothing (Q9, Q11, Q12) | AI saving an order by itself |
| The form photo kept with the order as an extra "Order form" file the technician also sees (Q10, Q19) | Translation of customer text (Q20) |
| Dashboard "Insights" card and an Ask insights lookup (Q13) | Insights for Finance or technicians (Q16) |
| Busy / quiet technicians, review backlog, rising reschedules, rating drops (Q14, Q15) | Deployment to Vercel (0010) |
| Rules find the facts, the AI words them and may add a tip (Q17) | |
| Admin AI log of every AI call for 7 days (Q4) | |
| Rules still work when the AI is down (Q18) | |
| README AI section for all three challenges (Q21) | |

## User Stories

1. **As a Manager**, I want warnings on a finished job before I review it so that I do not approve an overcharge or a job with no proof by mistake.
2. **As a Manager**, I want to mark a warning "Checked" with a note, or return the job for rework, so that a false alarm costs me one note and a real problem goes back to the technician.
3. **As Finance or an Admin**, I want to see on any order which warnings it had and who checked them, with their notes, so that I can audit approvals later.
4. **As an Admin**, I want to upload a photo or PDF of a paper order form and have the New Order form fill itself so that I do not retype it.
5. **As an Admin**, I want nothing filled when the form cannot be read clearly so that I never save half-guessed data.
6. **As a Technician**, I want to see the customer's original paper form on my job page so that I know exactly what they asked for.
7. **As a Manager**, I want an Insights card on the Dashboard that tells me who is overloaded or quiet, which jobs are waiting too long for review, where reschedules are rising and whose rating is dropping so that I can act this week.
8. **As a Manager**, I want to ask "Who might be overloaded this week?" in Ask and get the same answer and numbers as the card.
9. **As an Admin**, I want a log of every AI call (supervisor, document, insights) for 7 days so that I can check what the AI did and what it cost.
10. **As the business**, I want customer phone numbers and addresses never extracted or sent as text to the AI, and stored text or uploaded documents never able to steer it, so that the AI cannot leak or change records.

## Product Decisions

Decisions already fixed by the brief and 0000–0008:

| Decision | Rationale |
|---|---|
| The AI key lives only in a Supabase Edge Function secret (`OPENAI_API_KEY`); the user sets it, the agent never sees it | 0006 / 0008 pattern |
| AI features read data only through controlled, whitelisted, role-scoped functions; no AI output is run as SQL | 0000 constraint, 0008 |
| A job counts as completed on the Malaysia day a Manager approves it, credited to the submitting technician, in the order's branch; insights use the 0007 `kpi_*` numbers | 0007; the card, Ask and the dashboard must agree |
| Malaysia time (UTC+8), weeks Monday–Sunday, money in MYR | 0000 |
| End users never see function names, ids or JSON; limits are fixed sentences written by the server | 0008, decision 0016 |
| Branch scope: Admins every branch, Managers the branches they cover | 0004 |
| Job files live in the private `job-files` bucket; photo 10 MB, PDF 10 MB | 0002 |
| Automated tests never call the real AI (a fake client) | 0008 |

Decisions made by this PRD (answered 2026-10-24):

| Decision | Rationale |
|---|---|
| **Shared** | |
| Build all three challenges: Workflow Supervisor, Document Understanding, Operational Insight (Q1) | User's choice; shows the full range of AI integration |
| Every challenge uses OpenAI `gpt-6-luna` (the same key and model as 0008), including reading photos and PDFs. If the hosted check shows it reads forms badly, that becomes a stated limitation, not a model switch (Q2) | One key, one cost profile, roughly US$0.001 per check |
| No app-side rate limits; the OpenAI account's limits and monthly spend cap control cost. The Supervisor runs automatically once per Job Done (and resubmission); everything else runs when a person asks (Q3) | User's choice, same as 0008 |
| Supervisor warnings, who checked them, when, and their notes are kept with the order forever (like status history). Every AI call (supervisor check, form reading, insight wording) is written to an Admin **AI log** for 7 days with who, what, outcome, time taken and tokens; the 0008 Question log becomes part of it (Q4) | Audit of approvals stays; personal AI traffic does not pile up |
| **Workflow Supervisor** | |
| Facts are checked by fixed rules in the database: final amount at least 50% **and** at least RM 100 above the quote; Job Done with no photo; returned for rework 2 or more times; rescheduled 3 or more times; a 1–2 star or "not working" customer rating. The AI reads only the written job text — problem description, service type, quote, extra charges, "work done" and remarks — and flags contradictions (e.g. "Work done describes a compressor replacement, but the service is Cleaning with no extra charge"). AI warnings are labelled "AI" (Q5) | Rules are exact and free; the AI does what rules cannot (read text). New compared with 0008: the technician's and Admin's job text is sent to the AI for this check; customer name, phone and address are not |
| Checks run the moment a technician submits Job Done: the rules at once, the AI text check a few seconds later, so warnings are ready before the Manager opens the job. They run again when the job is resubmitted after rework; a Manager can press **Re-check**; a rating or reschedule added later updates the rule warnings (Q6) | Warnings exist before anyone can approve |
| The Manager's review list shows "2 warnings" next to the job; the order page has a **Warnings** box for covering Managers, Admins and Finance. Technicians never see warnings. No bell notifications (Q7) | Seen where the decision is made, without extra noise |
| **Approve** stays disabled until every open warning is marked **Checked** with a short note (or the job is returned for rework, which needs no check). Checked warnings show who, when and the note, forever. A warning whose cause is fixed (e.g. photos added after rework) closes itself on the next check (Q8) | User's choice: nothing slips through; a false alarm costs one note |
| **Document Understanding** | |
| Used only on the Admin **New Order** form: **Read from photo** (Q9) | The brief's fields map onto it exactly |
| The five brief fields are filled: customer name → Customer name, service type → Service type (matched to an active type), service details → Problem description, amount → Quoted price, date → Scheduled date. Everything else (branch, phone, address, technician, notes) is typed by the Admin; the AI never returns a phone number or address (Q9, Q22) | Brief's field list; less personal data comes back from the AI |
| The uploaded photo / PDF is kept with the order as an extra **Order form** file; if the Admin leaves without saving, it is deleted (Q10) | The original stays as evidence for the technician and the office |
| All or nothing: if any field that appears on the form cannot be read with confidence, nothing is filled and the Admin sees "Couldn't read this form clearly. Try a clearer photo or fill the form by hand." A field the form simply does not have (e.g. no date written) stays empty and does not count as unclear. Nothing is ever saved until the Admin presses Save (Q11) | User's choice: never half-guessed data |
| One photo (JPG, PNG or WebP) or one PDF of up to 3 pages, at most 10 MB (Q12) | Same limits as job files; phone photos and emailed PDFs both work |
| The Order form file is not one of the technician's 6 job files; the technician sees it on their job page, as do the office roles (Q19) | Ali knows what the customer wrote; his 6 slots stay free |
| Text is filled exactly as written (Malay, English or mixed: "aircond bocor air" stays as written); warnings, insights and messages are in English (Q20) | The customer's own words are kept |
| **Operational Insight** | |
| A Dashboard **Insights** card at the top of the period shown, and a new Ask lookup so "Who might be overloaded this week?" gives the same answer and numbers (Q13) | Seen without asking; askable in plain words |
| Overloaded: completed jobs at least 1.5× the team average **and** at least 3 more than it, team = the technicians in the branches being viewed for that period. Quiet: at most half the average and at least 3 fewer (active technicians only) (Q14) | Matches the brief's example; the extra "3 more" avoids alarms on tiny numbers |
| Four insights: busy / quiet technicians; review backlog (Job Done waiting more than 2 days for a Manager's review, per branch); rising reschedules (per branch, this period vs the previous one of the same length); rating drops (a technician's average rating this period vs the previous one) (Q15) | User's choice: all four |
| Managers (their covered branches) and Admins (all branches) see the card and may ask the insights lookup. Finance and technicians do not (Q16) | User's choice: workload judgments stay with the people who assign work |
| The app finds each insight with fixed rules from the `kpi_*` numbers (so every number is exact); the AI turns them into short plain sentences and may add one practical tip ("Consider giving Yusoff some of Bala's jobs tomorrow"). The AI never adds a number that is not in the facts (Q17) | Exact numbers, natural wording |
| **Reliability, safety and wording** | |
| AI down: rule warnings still appear; the AI text check shows "AI check didn't run — press Re-check" and does not block Approve; insights show the facts in fixed sentences without the AI wording; Read from photo says "Can't read photos right now. Fill the form by hand." (Q18) | An OpenAI outage never stops approvals or order entry |
| Stored text and uploaded documents are treated as content, never as instructions: the AI can only add an AI warning, fill the five form boxes, or word given facts. It cannot remove or soften a rule warning, approve, return, or save anything, and a person reviews every result (Q21) | Prompt injection in remarks or a planted form can at worst add a warning or fill a box the Admin then checks |
| Waiting: Read from photo shows "Reading the form…" (target under 15 s, give up after 40 s); the AI text check runs in the background (the Warnings box shows "AI check running…"); the Insights card shows the facts first and the AI wording when ready (Q21) | The person always knows what is happening |
| Desktop first; every screen also works at 375 px wide (Read from photo can use the phone camera; the Warnings box and Insights card stack) (Q21) | Same as 0008 |
| Plain wording everywhere: no function names, ids, scores or JSON (Q21) | Decision 0016 |
| The README AI section gets one part per challenge — how it works, what the AI sees and does not see, limitations — plus cost and privacy (Q21) | Brief requirement |

## Constraints

- The Edge Function(s) are the only code that talks to OpenAI; the key is a
  Supabase secret set by the user.
- Rule checks and insight facts are computed in the database by
  whitelisted, role-scoped functions; the AI gets only what each check
  needs and never ids, customer phone numbers or addresses as text.
- Supervisor AI input: problem description, service type, quoted price,
  extra charges, final amount, "work done" and remarks. Nothing else.
- Form reading sends the uploaded image / PDF to OpenAI (`store: false`);
  the image may show a phone number or address, but those are never
  extracted (Q22).
- The AI never writes to business data. Warning checks, order creation and
  the Order form file go through RPCs as the signed-in person; AI warnings
  are saved by the server function only.
- Approve is blocked only by open warnings a person has not checked — never
  by an AI check that failed to run.
- Every database change is a new timestamped migration; 0000–0008
  migrations are committed and append-only. Hosted changes ship with SQL and
  deploy steps (`docs/draft/0009-supabase-update.sql`).
- Automated tests never call the real AI (fake client); the real model is
  checked in the manual check.

## Acceptance Criteria

| # | Criterion | Verifiable By |
|---|---|---|
| 1 | Each rule warning (amount +50% and +RM 100, no photo, 2+ returns, 3+ reschedules, 1–2 star / not working rating) appears at Job Done or when its event happens, and closes when its cause is fixed (Q5, Q6) | test |
| 2 | The AI text check runs after Job Done and resubmission, flags a remark that contradicts the service / charges, is labelled "AI", and Re-check runs it again (Q5, Q6) | test + manual check |
| 3 | The review list shows the warning count; the Warnings box shows for covering Managers, Admins and Finance; technicians never see warnings (Q7) | test + manual check |
| 4 | Approve is disabled until every open warning is checked with a note; Return for rework works without checking; who / when / note are kept and shown (Q8) | test + manual check |
| 5 | With the AI unavailable, rule warnings still appear, the AI check says it did not run and does not block Approve (Q18) | test |
| 6 | Read from photo fills the five fields from a clear photo and a clear PDF; an unclear form fills nothing with the decided message; nothing saves until Save (Q9, Q11) | test + manual check |
| 7 | Only JPG / PNG / WebP or a PDF of up to 3 pages, at most 10 MB, is accepted (Q12) | test |
| 8 | The form file is kept as the order's "Order form" (not one of the 6 job files), visible to the technician and office roles, and removed if the order is not saved (Q10, Q19) | test + manual check |
| 9 | Malay text is filled as written (Q20) | manual check |
| 10 | The Insights card shows busy / quiet technicians, review backlog, rising reschedules and rating drops for the period and branches viewed, with numbers equal to the KPI dashboard (Q13–Q15) | test + manual check |
| 11 | Ask answers "Who might be overloaded this week?" with the same facts as the card (Q13) | manual check |
| 12 | Only Managers (covered branches) and Admins see insights; Finance and technicians are refused by the server (Q16) | test |
| 13 | AI-worded insights contain only numbers from the facts; with the AI down the facts show in fixed sentences (Q17, Q18) | test |
| 14 | No customer phone number or address is sent as text to the AI; text in remarks or a form cannot remove a warning or save data (Q21) | test |
| 15 | Every AI call is in the Admin AI log for 7 days; warnings and checks stay with the order (Q4) | test + manual check |
| 16 | All screens work on a desktop and at 375 px wide (Q21) | manual check |
| 17 | The README describes how each challenge uses AI and its limitations (Q21) | review |

## Roadmap Phase

**Phase:** 4 – Stretch

## Related Documents

| Document | Type | Relationship |
|---|---|---|
| `docs/prd/0000-programmer-assessment-brief.docx` | Source brief | Optional Advanced AI Challenges |
| `docs/prd/0000-system-foundation-prd.md` | Intent | Whitelisted AI reads, Malaysia time, data model |
| `docs/0002-technician-job-portal-workflow.md` | Workflow | Job Done, job files, extra charges and remarks |
| `docs/0004-review-and-close-workflow.md` | Workflow | Manager review, approve, return for rework |
| `docs/0007-kpi-dashboard-workflow.md` | Workflow | The `kpi_*` numbers insights are built on |
| `docs/0008-ai-ops-query-workflow.md` | Workflow | The `ask` Edge Function pattern, Question log |
| `docs/product-roadmap.md` | Roadmap | Phase assignment and sequencing for this PRD |
| `docs/plan/0009-ai-advanced-plan.md` | Plan | Implementation path for this PRD |
| `docs/0009-ai-advanced-workflow.md` | Workflow | Runtime behavior derived from this PRD |
| `docs/reference/folder-structure.md` | Reference | Structural placement of the feature |
| `docs/decisions/NNNN-*.md` | Decision log | Divergences from this PRD |

## Open Questions

All answered on 2026-10-24; decisions are recorded in Product Decisions.

- [x] **Q1. Scope.** All three challenges.
- [x] **Q2. Model.** Same `gpt-6-luna` for everything.
- [x] **Q3. Rate limits.** None in the app (OpenAI spend cap).
- [x] **Q4. Keeping.** Warnings and checks forever with the order; AI calls 7 days in the Admin AI log.
- [x] **Q5. Supervisor checks.** Rules for facts, AI for the written text.
- [x] **Q6. When.** Right away at Job Done (and resubmission), Re-check button.
- [x] **Q7. Where.** Review list badge + Warnings box on the order page; not technicians.
- [x] **Q8. Resolve.** Every warning checked with a note before Approve.
- [x] **Q9. Documents.** New Order form only.
- [x] **Q10. Form file.** Kept with the order.
- [x] **Q11. Unclear form.** All or nothing.
- [x] **Q12. File types.** One photo or PDF (≤ 3 pages), 10 MB.
- [x] **Q13. Insights where.** Dashboard card + Ask.
- [x] **Q14. Overloaded.** ≥ 1.5× team average and ≥ 3 more.
- [x] **Q15. Which insights.** Busy / quiet, review backlog, rising reschedules, rating drops.
- [x] **Q16. Who sees insights.** Managers and Admins only.
- [x] **Q17. Insight wording.** Rules find, the AI words it and may add a tip.
- [x] **Q18. AI down.** Rules keep working; AI parts say they did not run.
- [x] **Q19. Form file count.** Extra "Order form" file; the technician sees it.
- [x] **Q20. Language.** Filled as written; app text in English.
- [x] **Q21. Defaults.** Stored text and documents are content only (the AI can add warnings or fill boxes, never remove or save); waiting text; phone width; plain wording; README per challenge.
- [x] **Q22. Phone and address from the form.** (a) Not filled; the Admin types them.
