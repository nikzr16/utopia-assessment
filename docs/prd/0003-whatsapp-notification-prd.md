# 0003 - WhatsApp Notification PRD

> **Type:** Intent | **Must stay current:** No -- record divergences in decision log

<!-- AI Context
Role: This document captures product intent, not implementation detail.
Use it to understand *what* the feature should do and *why*, then consult the
implementation plan and workflow docs for *how*.
Do not rewrite this document during coding. If implementation diverges from
the intent described here, add an entry to the decision log instead.
-->

## Purpose

When a technician finishes a job, the customer should hear about it straight
away and be asked for feedback. Today the job reaches Job Done (0002) and the
branch's managers are told in-app, but nothing reaches the customer. This
PRD defines the WhatsApp notification to the customer on Job Done: what
triggers it, what it says, who sends it, and how it is tracked.

Source: Module 3 of `docs/prd/0000-programmer-assessment-brief.docx`
("Send WhatsApp notification when a job is marked Job Done"; trigger
`status = Job Done`; WhatsApp deep link with a pre-filled message; key skill
"back-end trigger logic + API / deep-link integration") and the Module 2
bonus "Generate WhatsApp feedback message send to customer". Collecting the
customer's feedback itself is a separate feature (0005, see Q6).

## Goals

- Every time an order reaches Job Done, the system prepares the customer
  message by itself (back-end trigger), with the brief's content filled in.
- The technician can send it from their phone with one tap right after
  submitting; an Admin can send it from the order page.
- Once someone confirms the message was sent, it is marked sent (who, when)
  and cannot be sent again.
- A job whose customer has not been told yet is easy to spot.
- A customer without a WhatsApp-capable number is called instead, and that
  call is tracked the same way.

## Non-Goals

- Messages to the customer at other moments (assigned, on the way,
  rescheduled). 0002 already offers a free-form WhatsApp chat link.
- Messages to staff (0001 technician WhatsApp link, in-app notifications).
- Marketing or bulk messages.
- Automatic sending through the WhatsApp Business Cloud API (Q1).
- Collecting customer feedback (feedback link, page, ratings): 0005
  `customer-feedback` (Q6).
- Manager review and Finance close screens: 0004 `review-and-close` (Q10).

## Scope

| In Scope | Out of Scope |
|---|---|
| Database trigger on Job Done that records a customer message (text, number, status) | Other customer message moments |
| "Send to customer on WhatsApp" for the assigned technician (job page) and Admins (order detail) | Staff messaging changes |
| The brief's message in English, in Malaysia time, with the technician's name | Bulk / marketing messages; Cloud API sending |
| "Have you sent it?" confirmation; marked sent (who, when); button disabled after | Feedback link and feedback page (0005) |
| Landline customers: Call, then "Did the customer pick up?" confirmation | Manager review / Finance close screens (0004) |
| "Customer not told yet" badge until sent or told by phone | |

## User Stories

1. **As a Technician**, I want a ready-made message to the customer right after I submit the job so that I can tell them in one tap.
2. **As an Admin**, I want to send the same message from the order page so that the customer is told even if the technician forgot or had no signal.
3. **As a Technician or Admin**, I want the message marked sent once I confirm it so that nobody sends it twice.
4. **As an Admin**, I want to see whether the customer was told, by whom and when, so that I can follow up.
5. **As a Customer**, I want to be told when my job is done and asked for feedback so that I can check the work.
6. **As a Technician**, I want to be told clearly when the customer has no WhatsApp number so that I call them instead, and record that I told them.

## Product Decisions

Decisions already fixed by the brief, 0000, or 0002:

| Decision | Rationale |
|---|---|
| The trigger is the order reaching **Job Done** | Brief: `status = Job Done`; Job Done is reached only through `submit_completion` (0000) |
| The message is a `wa.me` deep link a person taps to send | Brief's preferred method; 0000 decision (WhatsApp Business Cloud API was a 0000 non-goal) |
| The customer's number is stored as digits with country code; only Malaysian mobiles (`601…`) can receive WhatsApp | 0001 phone rule; `isMyMobile` |
| Times are Malaysia time (UTC+8) | 0000 cross-cutting rule |
| Writes go through RPCs; the actor is the signed-in user | 0000 rule |

Decisions made by this PRD:

| Decision | Rationale |
|---|---|
| Deep link only: the database prepares the message on Job Done; a person taps Send and presses Send in WhatsApp (Q1 a) | Brief's preferred method; free; no new accounts |
| Both the assigned technician (job page) and Admins (order detail) can send it (Q2) | The customer is told even if one side forgets |
| The button is offered while the order is Job Done, Reviewed, or Closed (Q3) | The message stays reachable after review |
| Every Job Done, including a rework resubmission, prepares a new message; the screen offers the latest; earlier ones stay in the history (Q4) | The customer hears about the fixed job too |
| The message is in English and uses the brief's sample wording, with no feedback link yet (Q5, Q6) | Brief sample; no broken link before 0005 exists |
| Customer feedback is its own feature, 0005 `customer-feedback`: a private link in the message, no sign-in, one submission per job (Q6) | Keeps 0003 to Module 3; 0005 adds the link to this message |
| A customer with a landline gets no WhatsApp button; the screen says so and offers Call, then asks "Did the customer pick up, and did you tell them the job is done?" Yes marks it "Told by phone" (who, when) (Q7) | The customer is still told, and it is tracked |
| After tapping Send, the app asks "Have you sent it to the customer?" Yes marks the message sent (who, when) and disables the button; No leaves it unsent (Q8 b, Q2) | The app cannot see the Send press inside WhatsApp; the person confirms it |
| A "Customer not told yet" badge shows on the technician's job card (Submitted tab), the job page, and the Admin order detail until the latest message is sent or told by phone (Q9 a) | Easy to spot without a scheduled job |
| Manager review and Finance close screens move to a new PRD, 0004 `review-and-close`, next in Phase 2 (Q10 a) | Not WhatsApp notification; each feature stays reviewable |

## Constraints

- The trigger and the message record live in the database (a new
  timestamped migration; 0000–0002 migrations are committed and
  append-only). The message text is built in one place and mirrored on
  screen only if a parity test checks it.
- Brief stack: React, Tailwind CSS, Supabase. No new paid service.
- Real authentication stays; only the assigned technician and Admins can
  read or update an order's customer messages.
- The hosted Supabase project has 0000–0002 applied; schema changes ship with
  SQL for it.

## Acceptance Criteria

| # | Criterion | Verifiable By |
|---|---|---|
| 1 | When an order reaches Job Done (including a resubmission after rework), the database records a customer message with the filled-in text, the customer's number, and status "not sent", in the same transaction | test |
| 2 | The message is in English and follows the brief: customer name, order number, technician name, completion time in Malaysia time, a request for feedback | test |
| 3 | While the order is Job Done, Reviewed, or Closed, the assigned technician's job page offers "Send to customer on WhatsApp", opening `https://wa.me/<customer>?text=<message>` | test + manual check |
| 4 | An Admin can send the same message from the order detail | test + manual check |
| 5 | After tapping Send, the app asks "Have you sent it to the customer?"; Yes marks the latest message sent with who and when, shows "Sent by X at T", and disables the button; No leaves it unsent | test + manual check |
| 6 | A rework resubmission prepares a new message and the button is active again for it; earlier messages stay in the history | test |
| 7 | A customer without a mobile number gets no WhatsApp button; the screen says so and offers Call, then "Did the customer pick up, and did you tell them the job is done?"; Yes marks it "Told by phone by X at T" | test + manual check |
| 8 | "Customer not told yet" shows on the technician's job card (Submitted tab), the job page, and the Admin order detail, and clears once the latest message is sent or told by phone | test + manual check |
| 9 | Only the assigned technician and Admins can read, send, or confirm an order's messages; other technicians and signed-out visitors cannot | test |
| 10 | Works at 375 px wide; every control has a visible label | manual check |

## Roadmap Phase

**Phase:** 2 – Core workflow

## Related Documents

| Document | Type | Relationship |
|---|---|---|
| `docs/prd/0000-programmer-assessment-brief.docx` | Source brief | Module 3 and the Module 2 bonus |
| `docs/prd/0000-system-foundation-prd.md` | Intent | Notification events table (Job Done → Customer → WhatsApp deep link) |
| `docs/prd/0002-technician-job-portal-prd.md` | Intent | Job page and completion flow this builds on; Q14 |
| `docs/product-roadmap.md` | Roadmap | Phase assignment and sequencing for this PRD |
| `docs/plan/0003-whatsapp-notification-plan.md` | Plan | Implementation path for this PRD |
| `docs/0003-whatsapp-notification-workflow.md` | Workflow | Runtime behavior derived from this PRD |
| `docs/reference/folder-structure.md` | Reference | Structural placement of the feature |
| `docs/decisions/NNNN-*.md` | Decision log | Divergences from this PRD |

## Open Questions

All answered on 2026-10-22; decisions are recorded in Product Decisions.

- [x] **Q1. How the message is sent.** (a) Back-end trigger + deep link; a person presses Send in WhatsApp.
- [x] **Q2. Who can send it.** (a) The assigned technician and Admins; once confirmed sent, the button is disabled.
- [x] **Q3. When the button is offered.** (a) While Job Done, Reviewed, or Closed.
- [x] **Q4. Rework resubmissions.** (a) A new message on every Job Done; earlier ones stay in the history.
- [x] **Q5. Message wording and language.** (a) The brief's sample, in English.
- [x] **Q6. How the customer leaves feedback.** Separate feature 0005 `customer-feedback`: a private link, no sign-in, one submission per job. 0003's message has no link until then.
- [x] **Q7. Customer with a landline only.** No WhatsApp button; Call, then "Did the customer pick up, and did you tell them the job is done?" Yes marks it "Told by phone".
- [x] **Q8. Tracking "sent".** (b) "Have you sent it to the customer?" after tapping Send; Yes marks it sent.
- [x] **Q9. Reminder for unsent messages.** (a) "Customer not told yet" badge.
- [x] **Q10. Manager review and Finance close screens.** (a) New PRD 0004 `review-and-close`, next in Phase 2, before 0005.
