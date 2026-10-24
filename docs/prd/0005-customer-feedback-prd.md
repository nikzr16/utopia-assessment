# 0005 - Customer Feedback PRD

> **Type:** Intent | **Must stay current:** No -- record divergences in decision log

<!-- AI Context
Role: This document captures product intent, not implementation detail.
Use it to understand *what* the feature should do and *why*, then consult the
implementation plan and workflow docs for *how*.
Do not rewrite this document during coding. If implementation diverges from
the intent described here, add an entry to the decision log instead.
-->

## Purpose

The Job Done message (0003) asks the customer to "Please check and leave
feedback", but there is nowhere to leave it. This PRD adds a private
feedback link to that message (and to the Manager's on-behalf version,
0004), a public page where the customer rates the job without signing in,
and the places where staff see the result. The ratings are also the data
the KPI dashboard (0007) will read later.

Source: the Module 2 bonus "Generate WhatsApp feedback message send to
customer" and the Module 3 sample message "Please check and leave
feedback" (`docs/prd/0000-programmer-assessment-brief.docx`); 0003 PRD Q6
moved feedback collection here.

## Goals

- Every Job Done message sent by WhatsApp carries a private link for that
  job, whoever sends it (technician, Admin, or Manager on behalf).
- The customer opens the link on their phone, sees which job it is about,
  rates it, and submits, with no sign-in and no app to install.
- Each link works once; it cannot be guessed, reused, or used for another
  job.
- Staff who handle the job see the feedback on the order, and a poor
  rating reaches the Manager quickly.
- Every rating is stored with what the KPI dashboard needs (technician,
  branch, job, time).

## Non-Goals

- The KPI dashboard and its charts (0007); this feature only stores the data.
- Staff management (0006).
- Replying to the customer from the app, or a public reviews page.
- Automatic sending (WhatsApp Business Cloud API); sending stays the 0003
  deep link confirmed by a person.
- Feedback at other moments (after assignment, after close).
- Customer accounts or sign-in.
- Deploying the app to Vercel and testing the link from a real phone:
  0010 `production-deployment` (Q10).
- Changing review or close rules: feedback never blocks Approve or Close.

## Scope

| In Scope | Out of Scope |
|---|---|
| A private feedback link in the Job Done message and the on-behalf message | KPI dashboard (0007) |
| Public feedback page (no sign-in), phone-first | Customer accounts |
| One submission per link; link expiry; safe failure pages (expired, used, unknown) | Replying to feedback in the app |
| Feedback shown on the order to the staff who handle it | Staff management (0006) |
| In-app alert to covering Managers on a poor rating | Public reviews / marketing use |
| Feedback for landline customers (Q5) | Cloud API sending |
| Stored data the KPI dashboard needs | |

## User Stories

1. **As a Customer**, I want a link in the WhatsApp message that opens a short form on my phone so that I can rate the job in under a minute.
2. **As a Customer**, I want to see which job I am rating (order, technician, date) so that I know the link is genuine.
3. **As a Customer**, I want a clear "Thank you" after I submit, and a clear message if the link has expired or was already used.
4. **As a Technician, Admin, or Manager**, I want the link added to the message by itself so that I never have to copy or type it.
5. **As a Manager**, I want to be told when a customer is unhappy so that I can call them and arrange a fix.
6. **As a Manager or Admin**, I want to see each order's feedback on the order page so that I can follow up.
7. **As a Technician**, I want to see how customers rated my jobs so that I know how I am doing (Q8).
8. **As the business**, I want each rating tied to the technician, branch, and job so that the KPI dashboard can rank and trend it later.

## Product Decisions

Decisions already fixed by the brief, 0000, 0003, or 0004:

| Decision | Rationale |
|---|---|
| Feedback is collected through a private link in the Job Done message, with no sign-in, one submission per job | 0003 Q6 |
| The message is sent by `wa.me` deep link and confirmed by a person; a confirmed message never changes | 0003 Q1, Q8 |
| Every Job Done, including a rework resubmission, prepares a new message | 0003 Q4 |
| A covering Manager sends the WhatsApp message in their own name, "on behalf of" the technician | 0004 Q3 |
| A landline customer gets no WhatsApp message; they are called and marked "Told by phone" | 0003 Q7 |
| Messages are in English; times are Malaysia time (UTC+8) | 0003 Q5, 0000 |
| Writes go through RPCs; the actor is the signed-in user; every table has RLS | 0000 |
| Public sign-up stays off; signed-out visitors can read or run nothing except what this feature opens on purpose | 0000, 0004 |

Decisions made by this PRD (answered 2026-10-23):

| Decision | Rationale |
|---|---|
| The customer gives an overall 1–5 star rating (required), answers "Is your aircon working well now?" Yes / No (required), and may add a comment (Q1 a) | Quick to finish on a phone; the Yes / No catches jobs that need a return visit |
| The system adds the link as a fixed last line of the WhatsApp message ("Leave feedback: https://…"); Edit changes only the text above it; the Manager's on-behalf message gets the same line (Q2 a) | The link can never be lost or mistyped |
| A link works for 7 days after the job was marked Job Done, and only while it is the job's latest link (Q3 b, Q4 a) | Fresh feedback; old or forwarded links stop working |
| One feedback per visit: every Job Done message (including a rework resubmission) gets a new link; the earlier unused link stops working; the order shows every rating and 0007 uses the latest per order (Q4 a) | The customer can rate the fix too; the original complaint is kept |
| Landline customers get no link; during the phone call the caller may ask for a rating, and an Admin or a covering Manager records it on the order, marked "Taken by phone by X"; the technician cannot record their own job's rating (Q5 a) | Landline jobs can still be rated, and the person being rated never enters it |
| The page shows the company name, order number, service type, technician name, and Job Done date; never the customer's name, phone, address, or any amount (Q6 a) | Enough to trust the link; a forwarded link leaks nothing personal |
| The page is in English, like the message (Q7 a) | One language to maintain, matching 0003 Q5 |
| Feedback is shown on the order page to everyone who can open the order (Admin, covering Manager, the assigned technician, Finance); the Manager's Reviewed tab gets a rating column (Q8 a) | Everyone works from the same facts |
| A rating of 1–2 stars, or "No" to "working well now?", sends an in-app notice to every Manager covering the order's branch; tapping it opens the order (Q9 a) | Unhappy customers get a call quickly |
| The link's public address is a setting kept in the database. For now it is the local app address; deploying to Vercel and testing the link from a real phone is a later feature, 0010 `production-deployment`, in a new Phase 5 (Q10 a, decision 0012) | The feature works and is tested locally now; production set-up is done once, for every feature, in its own phase |
| Feedback never blocks Approve or Close; feedback arriving after Close is still stored and shown (Q11 a) | Review and close stay as 0004 defined them |

## Constraints

- Every database change is a new timestamped migration; 0000–0004
  migrations are committed and append-only. A rule mirrored in `src/domain/`
  passes `tests/db/parity.test.ts`.
- Signed-out visitors get access only to what the feedback page needs, only
  through the link's secret, and only through database functions (no table
  reads). Nothing else becomes readable without sign-in.
- The link's secret is long and random (cannot be guessed or counted
  through) and is not the order number or ID.
- Brief stack: React, Tailwind CSS, Supabase. No new paid service.
- The customer page is phone-first (375 px wide); staff screens keep their
  0004 layout rules.
- The hosted Supabase project has 0000–0004 applied; schema changes ship with
  SQL for it.
- Each stored rating keeps the technician and branch of that job, so later
  reassignment or staff changes do not move it (needed by 0007).

## Acceptance Criteria

| # | Criterion | Verifiable By |
|---|---|---|
| 1 | Every Job Done WhatsApp message (technician, Admin, and on-behalf versions) ends with a feedback link for that visit; editing the message cannot remove or change the link | test + manual check |
| 2 | Opening the link signed out shows the company name, order number, service type, technician name, and Job Done date, and nothing else about the order or customer | test + manual check |
| 3 | The form asks for 1–5 stars (required), "Is your aircon working well now?" Yes / No (required), and an optional comment; it cannot be submitted without the required answers | test + manual check |
| 4 | Submitting stores the feedback once and shows "Thank you"; opening or submitting the same link again says it was already received and stores nothing | test + manual check |
| 5 | An unknown link, a link more than 7 days after its Job Done, or a link replaced by a rework's newer link shows a clear message and stores nothing | test + manual check |
| 6 | A rework resubmission's message carries a new link; the order keeps every visit's feedback | test |
| 7 | A landline customer's message has no link; an Admin or a covering Manager can record the customer's rating on the order, shown as "Taken by phone by X"; the assigned technician cannot | test + manual check |
| 8 | Signed-out visitors cannot read or change any table or call any function other than the two the feedback page uses | test |
| 9 | Feedback shows on the order page for Admins, covering Managers, the assigned technician, and Finance; the Manager's Reviewed tab shows a rating column | test + manual check |
| 10 | 1–2 stars or "No" notifies every Manager covering the order's branch; tapping the notice opens the order | test + manual check |
| 11 | Each feedback row stores the order, the visit's message, technician, branch, rating, "working well" answer, comment, how it was taken (link / phone), and when | test |
| 12 | Feedback never blocks Approve or Close; feedback after Close is stored and shown | test |
| 13 | The link's address comes from a database setting; locally it opens the local app | test + manual check |
| 14 | The customer page works at 375 px wide; every control has a visible label | manual check |

## Roadmap Phase

**Phase:** 2 – Core workflow

## Related Documents

| Document | Type | Relationship |
|---|---|---|
| `docs/prd/0000-programmer-assessment-brief.docx` | Source brief | Module 2 bonus, Module 3 sample message |
| `docs/prd/0003-whatsapp-notification-prd.md` | Intent | Job Done message; Q6 |
| `docs/prd/0004-review-and-close-prd.md` | Intent | On-behalf message; Manager branch cover; notification bell |
| `docs/product-roadmap.md` | Roadmap | Phase assignment and sequencing for this PRD |
| `docs/plan/0005-customer-feedback-plan.md` | Plan | Implementation path for this PRD |
| `docs/0005-customer-feedback-workflow.md` | Workflow | Runtime behavior derived from this PRD |
| `docs/reference/folder-structure.md` | Reference | Structural placement of the feature |
| `docs/decisions/0012-add-production-deployment-feature.md` | Decision log | Vercel deployment moved to new feature 0010 |
| `docs/decisions/NNNN-*.md` | Decision log | Divergences from this PRD |

## Open Questions

All answered on 2026-10-23; decisions are recorded in Product Decisions.

- [x] **Q1. What the customer is asked.** (a) 1–5 stars, "Is your aircon working well now?" Yes / No, optional comment.
- [x] **Q2. The link inside the message.** (a) A fixed last line added by the system; Edit cannot remove it.
- [x] **Q3. How long a link works.** (b) 7 days after Job Done, and only while it is the job's latest link.
- [x] **Q4. Rework.** (a) One feedback per visit; each Job Done message gets a new link.
- [x] **Q5. Landline customers.** (a) No link; an Admin or covering Manager records the rating taken by phone; never the technician.
- [x] **Q6. What the page shows.** (a) Company, order number, service type, technician, Job Done date; nothing personal.
- [x] **Q7. Language.** (a) English.
- [x] **Q8. Which staff see feedback.** (a) Everyone who can open the order; rating column in the Manager's Reviewed tab.
- [x] **Q9. Alert on a poor rating.** (a) 1–2 stars or "No" notifies the covering Managers.
- [x] **Q10. Public address.** (a) Database setting, local address for now; Vercel deployment and real-phone testing move to new feature 0010 `production-deployment` (decision 0012).
- [x] **Q11. Feedback and review / close.** (a) Never blocks Approve or Close.
