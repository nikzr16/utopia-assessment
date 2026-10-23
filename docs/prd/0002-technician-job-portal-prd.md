# 0002 - Technician Job Portal PRD

> **Type:** Intent | **Must stay current:** No -- record divergences in decision log

<!-- AI Context
Role: This document captures product intent, not implementation detail.
Use it to understand *what* the feature should do and *why*, then consult the
implementation plan and workflow docs for *how*.
Do not rewrite this document during coding. If implementation diverges from
the intent described here, add an entry to the decision log instead.
-->

## Purpose

Technicians work in the field on a phone. Today the foundation (0000) can
store their completion records and payments and the Admin portal (0001) can
dispatch jobs to them, but a technician who signs in sees only a placeholder.
This PRD defines the Technician portal: seeing their jobs, accepting and
starting them, recording the finished work with photos, videos and PDFs, and
recording the payment collected from the customer, quickly, on a phone, on a
patchy mobile connection.

Source: Module 2 of `docs/prd/0000-programmer-assessment-brief.docx`.

## Goals

- A technician sees their open jobs, soonest first, within one tap of
  signing in, and can call the customer or open the address in a map app
  from the job.
- A technician can accept and start a job in one tap each.
- A technician can record a finished job in about a minute on a phone: work
  done, extra charges, up to 6 photos / videos / PDFs, remarks; the final
  amount is calculated for them and the record carries their name and the
  time.
- Submitting the record moves the job to Job Done and tells the branch's
  managers automatically.
- A technician can record a payment collected from the customer (amount,
  method, receipt photo) without ever recording it twice.
- A technician can reschedule or postpone a job with a reason, and fix and
  resubmit a job a manager returned for rework.
- A technician sees their in-app notifications (new job, rework, details
  changed) and can open the job from each one.
- A bad connection never loses typed text or chosen files, and never saves
  anything twice.

## Non-Goals

- Manager review and Finance close screens. They are not part of Module 2
  (see Q14).
- The customer WhatsApp feedback message on Job Done (0003, as assigned by
  the 0000 PRD; see Q13).
- A native mobile app, push notifications to the phone's lock screen, and
  full offline mode (queueing work while offline and sending it later).
- Technician GPS tracking, route planning, or a calendar view.
- Editing an order's customer or job details (Admin only, 0001).
- Invoices or receipts generated for the customer.

## Scope

| In Scope | Out of Scope |
|---|---|
| Technician portal: job list (home), job page, completion form, payment form, notifications list | Manager review and Finance close screens |
| Accept (`acknowledged`) and start (`in_progress`) through `transition_order` | Customer WhatsApp feedback message (0003) |
| Completion form writing through `submit_completion`, with final amount calculated live | Native app, push notifications, offline queue |
| Upload up to 6 photos / videos / PDFs per job to Supabase Storage | GPS, routing, calendar view |
| Private Supabase Storage bucket with row-level security on the files | Editing order details (Admin, 0001) |
| Database functions to add and remove attachments (no direct table writes) | Generated customer invoices / receipts |
| Record payment (amount, method, receipt photo) through `record_payment`, safe to retry | Changes to the order lifecycle or transition table |
| Reschedule / postpone with a reason through `reschedule_order` | Admin / Manager / Finance notification screens |
| Rework: the manager's note shown, the previous record pre-filled, resubmit | |
| In-app notifications list with unread count for technicians | |
| Mobile-first layout (375 px), large tap targets, numeric keypads, camera / gallery picker | |
| Clear handling of slow and dropped connections | |
| Completion section with file upload on the Admin order detail (0001) | |
| In-app notifications to technicians on cancel and reassign-away; to Finance on payment recorded | |

## User Stories

1. **As a Technician**, I want my open jobs listed soonest first so that I know where to go next.
2. **As a Technician**, I want to call the customer or open the address in my map app from the job so that I do not retype anything.
3. **As a Technician**, I want to accept a new job with one tap so that the office knows I have seen it.
4. **As a Technician**, I want to start a job with one tap when I arrive so that the office knows work has begun.
5. **As a Technician**, I want to record the work done and any extra charges and see the final amount worked out for me so that I quote the customer the right total.
6. **As a Technician**, I want to attach photos, a short video, or a PDF from my camera or gallery so that the manager can see the work.
7. **As a Technician**, I want my typed text and chosen files kept if the signal drops so that I never redo the form.
8. **As a Technician**, I want to record the payment the customer gave me, with a photo of the receipt or transfer, so that Finance can clear the job.
9. **As a Technician**, I want to postpone or reschedule a job with a reason so that the office knows why it slipped.
10. **As a Technician**, I want to see the manager's note on a returned job and my previous record so that I fix only what is wrong.
11. **As a Technician**, I want a list of my notifications with an unread count so that I do not miss a new or changed job.
12. **As a Manager**, I want to be told when a job is done so that I can review it promptly.
13. **As Finance**, I want each payment a technician records to carry the method and a receipt so that I can verify it before closing.

## Product Decisions

Decisions already fixed by the brief, 0000, or 0001:

| Decision | Rationale |
|---|---|
| Technicians see and act only on jobs assigned to them, enforced by the database | 0000 rule; `technician_jobs()` and row-level security already do this |
| Every write goes through a database function; the actor is the signed-in technician | 0000 rule: nobody can act as someone else |
| Start counts as accepting (Assigned → In Progress allowed) | 0000 decision for field speed |
| Submitting the completion record moves the job to Job Done in one step and notifies the branch's managers in-app | 0000 `submit_completion` |
| Final amount = quoted price + extra charges, calculated, never typed | 0000 rule |
| A reworked job overwrites its completion record | 0000 `submit_completion` (upsert) |
| Payments are recorded while In Progress, Job Done, or Reviewed; payment status is derived | 0000 `record_payment` and `order_summary` |
| Reschedule is a log entry, allowed while New, Assigned, Acknowledged, or In Progress | 0000 decision and decision 0003 |
| At most 6 completion attachments per job; receipt photos do not count toward the 6 | 0000 trigger counts only rows without a payment |
| Amounts in MYR, times in Malaysia time (UTC+8) | 0000 cross-cutting rule |
| Which actions a screen offers comes from the `src/domain` mirrors; the database still decides | 0000 / 0001 pattern |

Decisions made by this PRD (Open Questions answered 2026-10-22):

| Decision | Rationale |
|---|---|
| Job list has three tabs: Open (Today / Upcoming / No date, overdue flagged), Submitted, Finished (last 30 days); Open is the default (Q1) | The technician's next job is always on top; old jobs stay findable without cluttering |
| The job offers tap-to-call, tap-to-WhatsApp the customer, and Open in Maps (Q2) | No retyping phone numbers or addresses in the field |
| Accept is one tap; Start is one tap plus a short confirmation (Q3) | The technician cannot undo Start |
| Each file uploads as soon as it is chosen, with progress, Retry, and Remove; Submit waits for all uploads (Q4) | A dropped signal costs one file, not the whole form |
| Photos JPEG / PNG / WebP / HEIC resized to at most 2048 px, max 10 MB; videos MP4 / MOV / WebM max 50 MB; PDF max 10 MB; same limits in the screen and the bucket (Q5) | Fast on mobile data; 50 MB is the free-plan per-file cap |
| Files are optional (0–6); submitting with none asks for confirmation (Q6) | Matches the brief ("≤ 6"); the 0008 AI supervisor can flag jobs with none |
| Files are viewed by the assigned technician and every Admin, Manager, and Finance user; uploaded by the assigned technician and Admins; added or removed only while In Progress; removing deletes the stored file (Q7) | Office staff can check the work; other technicians cannot see customer files; files match the submitted record |
| Extra charges follow the quoted price rule (RM 0.00 – 100,000.00, 2 decimals); Remarks is required when extra charges are above zero; enforced in the screen and the database (Q8) | Catches typing slips; every extra charge is explained for the manager and Finance |
| Technician name and timestamp are read-only; the saved time is the server's, shown in Malaysia time (Q9) | The phone's clock cannot be trusted |
| Record payment: amount pre-filled with the balance; one receipt photo or PDF per payment, required for bank transfer, card, and e-wallet, optional for cash; an amount above the balance needs confirmation; retry-safe (Q10) | Finance can verify non-cash payments; overpayment is possible (tips, rounding) but never accidental |
| Technicians get a notification bell with unread count and a `/notifications` list, updated live through Supabase Realtime and refreshed on returning to the app; built as a shared component (Q11) | New and changed jobs are noticed at once; Manager / Finance can reuse it later |
| Technicians are notified in-app when their job is cancelled or reassigned to someone else (Q12) | Today they silently lose the job |
| Managers of the branch are notified on Job Done (0000); Finance is also notified when a technician records a payment (Q13) | Answers the brief's "notify manager / accounts": Finance acts on payments, not on Job Done |
| The customer WhatsApp feedback message stays in 0003; Manager review and Finance close screens stay out of 0002 and are raised when writing the 0003 PRD (Q14) | Keeps the 0000 module split; Phase 2 graduation needs those screens |
| A rework job shows the manager's note, pre-fills the previous record, keeps its files, and is resubmitted (Q15) | The technician fixes only what is wrong |
| No offline mode: typed text is kept as a per-job draft on the phone; uploads retry one by one; every write is locked while sending and safe to retry (a payment carries a one-time key) (Q16) | Works on a patchy signal without the conflicts of a send-later queue |
| The Admin order detail gets a Completion section (record read-only; files, payments, and receipts shown; Admins add or remove files while In Progress) (Q17) | Admins can check the work before Manager screens exist |

## Constraints

- Writes only through RPCs: `transition_order`, `submit_completion`,
  `record_payment`, `reschedule_order`, `mark_notification_read`, and any new
  function this feature adds. No direct table writes from the browser.
- Uploaded files go to Supabase Storage (brief stack). The bucket is private;
  storage row-level security decides who may upload and read; nothing is
  public by URL.
- 0000 and 0001 migrations are committed: any database or storage change is
  a new timestamped migration (append-only). Supabase-only statements
  (storage, roles, policies) stay guarded so migrations still run in PGlite.
  A rule mirrored in `src/domain/` stays in step with the database, checked
  by a test.
- The hosted Supabase project has 0000 and 0001 applied; any schema or
  storage change ships with SQL the user can run there.
- Real authentication stays: only a signed-in Technician with an active staff
  profile gets this portal; Admins keep 0001; Managers and Finance keep
  their placeholders.
- Supabase free-plan storage limits apply (50 MB per file upload).
- Brief stack: React, Tailwind CSS, Supabase. No new paid services.

## Acceptance Criteria

| # | Criterion | Verifiable By |
|---|---|---|
| 1 | A signed-in Technician sees the Technician portal (job list as home); Admins still see the Admin portal; Managers and Finance see their placeholders | test + manual check |
| 2 | The job list shows only the technician's own jobs, open jobs first, soonest scheduled first, each with order number, service type, customer name, area, scheduled date, and status | test + manual check |
| 3 | The job page shows the order details, quoted price, admin notes, and tap-to-call and open-in-maps links; actions offered match `availableTransitions(status, 'technician')` | test + manual check |
| 4 | Accept and Start each work with one tap and show the new status; the database outcome (success or plain-language error) is shown | test + manual check |
| 5 | The completion form has the brief's fields: Order ID (read-only), work done, extra charges, up to 6 photos / videos / PDFs, final amount (calculated live), remarks, technician name, and timestamp | test + manual check |
| 6 | Invalid input (empty work done, bad extra charges, file of a wrong type or too large, a seventh file) is shown on the field with a clear message and nothing is submitted; the database enforces the same rules | test |
| 7 | Uploaded files are stored in a private Supabase Storage bucket; only staff who can read the order can view them; only the assigned technician can add or remove them, and only while the rules allow | test + manual check |
| 8 | Submitting saves through `submit_completion`; the job becomes Job Done; the branch's managers get an in-app notification; the submitted record, files, name, and time show on the job page | test + manual check |
| 9 | A returned (rework) job shows the manager's note, pre-fills the previous record and files, and can be resubmitted | test + manual check |
| 10 | The technician can record a payment (amount, method, receipt) through `record_payment`; the payment status and balance update; retrying after a dropped connection never records the payment twice | test + manual check |
| 11 | The technician can reschedule or postpone their job with a reason through `reschedule_order` | test + manual check |
| 12 | The notifications list shows the technician's own notifications newest first with an unread count; opening one marks it read and opens the job | test + manual check |
| 13 | On a failed request the form keeps its text and files, shows "Could not reach the server…" with a way to retry, and a double tap on Submit saves once | test |
| 14 | Every screen works at 375 px wide without horizontal scrolling, tap targets are at least 44 px, number fields open a numeric keypad, and every field has a visible label | manual check |
| 15 | An Admin sees the Completion section on the order detail (record, files, payments, receipts) and can add or remove files while the job is In Progress | test + manual check |
| 16 | A technician is notified in-app when their job is cancelled or reassigned to someone else; Finance is notified when a technician records a payment | test |

## Roadmap Phase

**Phase:** 2 – Core workflow

## Related Documents

| Document | Type | Relationship |
|---|---|---|
| `docs/prd/0000-programmer-assessment-brief.docx` | Source brief | Module 2 requirements |
| `docs/prd/0000-system-foundation-prd.md` | Intent | Lifecycle, data model, and RPCs this portal writes through |
| `docs/prd/0001-admin-order-portal-prd.md` | Intent | Admin side that dispatches jobs to this portal |
| `docs/product-roadmap.md` | Roadmap | Phase assignment and sequencing for this PRD |
| `docs/plan/0002-technician-job-portal-plan.md` | Plan | Implementation path for this PRD |
| `docs/0002-technician-job-portal-workflow.md` | Workflow | Runtime behavior derived from this PRD |
| `docs/reference/folder-structure.md` | Reference | Structural placement of the feature |
| `docs/decisions/NNNN-*.md` | Decision log | Divergences from this PRD |

## Open Questions

Each question lists options; **(Recommended)** marks the proposed default.
All answered 2026-10-22: option (a) for every question (see Product Decisions).

- [x] **Q1. Job list layout.** `technician_jobs()` returns every job the technician has ever had.
  - (a) Three tabs: **Open** (Assigned, Acknowledged, In Progress; grouped Today / Upcoming / No date; overdue flagged), **Submitted** (Job Done, Reviewed), **Finished** (Closed and Cancelled, last 30 days). Open is the default. **(Recommended)**
  - (b) One list of open jobs only; older jobs not shown.
  - (c) One list of everything, newest first.
- [x] **Q2. Contact and navigation on the job.**
  - (a) Tap-to-call (`tel:`) and tap-to-WhatsApp the customer, plus "Open in Maps" (Google Maps search link; opens Waze or Maps app on the phone). **(Recommended)**
  - (b) Tap-to-call only.
  - (c) Show the phone and address as text only.
- [x] **Q3. Accept and Start.**
  - (a) Accept: one tap, no confirmation. Start: one tap with a short confirmation ("Start ORDER1001 now?"), because Start cannot be undone by the technician. **(Recommended)**
  - (b) Both one tap, no confirmation.
  - (c) Both with confirmation.
- [x] **Q4. When files upload.**
  - (a) Each file uploads as soon as it is chosen, with progress, Retry, and Remove; Submit waits until all are uploaded. Submitting itself is then quick. **(Recommended)**
  - (b) All files upload when Submit is tapped. Simpler, but a dropped signal on Submit means re-uploading everything.
- [x] **Q5. File types and sizes.**
  - (a) Photos: JPEG, PNG, WebP, HEIC; resized in the browser to at most 2048 px before upload (HEIC sent as is when the browser cannot read it), max 10 MB. Videos: MP4, MOV, WebM, max 50 MB (the free-plan per-file cap). PDF: max 10 MB. Same limits in the screen and the storage bucket. **(Recommended)**
  - (b) As (a), but videos max 20 MB (faster on mobile data, about 15–20 s of video).
  - (c) No resizing; every file max 50 MB.
- [x] **Q6. Are files required?**
  - (a) Optional (0–6), but submitting with none asks "Submit without photos?" first. **(Recommended)** Matches the brief ("≤ 6"); the 0008 AI supervisor can flag jobs with none.
  - (b) At least one photo required.
- [x] **Q7. Who can see and add files, and when?** Answered 2026-10-22.
  - **Who:** viewing is limited to the assigned technician plus every Admin, Manager, and Finance user; other technicians cannot see them. Uploading is limited to the assigned technician and Admins (for example, a photo or receipt the technician sent by WhatsApp). Admin uploads count toward the 6-file limit too.
  - **When:** option (a).
  - (a) Files can be added or removed while the job is In Progress (so also during rework). After Job Done they are locked. Removing deletes the stored file too. **(Recommended)**
  - (b) Also while Acknowledged (before starting), e.g. "before" photos.
  - (c) Add only; nothing can be removed once uploaded.
- [x] **Q8. Extra charges rules.** Today the database only checks "not negative".
  - (a) Same rule as quoted price (RM 0.00 – 100,000.00, at most 2 decimals), and Remarks becomes required when extra charges are above zero ("explain the extra charges"). Enforced in the screen and the database. **(Recommended)**
  - (b) Same money rule, Remarks stays optional.
  - (c) Keep today's rule (not negative only).
- [x] **Q9. Technician name and timestamp on the form.**
  - (a) Shown read-only: name from the signed-in profile; time shows "Recorded when you submit", and the saved record shows the server time (Malaysia time). **(Recommended)** The device clock cannot be trusted.
  - (b) Show the phone's current time live on the form.
- [x] **Q10. Recording a payment.**
  - (a) A "Record payment" form on the job page (and offered right after submitting the completion), amount pre-filled with the balance; methods cash, bank transfer, card, e-wallet; one receipt photo or PDF per payment, **required for bank transfer, card, and e-wallet, optional for cash**; an amount above the balance asks for confirmation ("RM x more than the balance"). Retry-safe. **(Recommended)**
  - (b) As (a), but the receipt is always optional.
  - (c) As (a), but amounts above the balance are blocked.
- [x] **Q11. Notifications.**
  - (a) A bell with an unread count in the header and a `/notifications` list for technicians; tapping opens the job and marks it read; "Mark all as read". Updates live through Supabase Realtime, and refreshes when the app comes back to the foreground. The bell is built as a shared component so Manager / Finance can reuse it later. **(Recommended)**
  - (b) As (a), but refresh only on page load and every 60 seconds (no Realtime).
  - (c) As (a), and also turn it on now for Admin, Manager, and Finance.
- [x] **Q12. Missing technician notifications.** Today a technician is not told when their job is cancelled or reassigned to someone else (they just lose it).
  - (a) Add in-app notifications to the technician for "cancelled" and "reassigned away" (the message carries the order number and reason). **(Recommended)**
  - (b) Leave as is.
- [x] **Q13. "Notify manager / accounts when the job is done" (brief bonus).** Today: managers of the branch on Job Done; Finance on Reviewed.
  - (a) Keep that, and also notify Finance when a technician records a payment (so they can verify it). **(Recommended)** Finance acts after review, not after Job Done.
  - (b) Also notify Finance on Job Done.
  - (c) Keep today's behavior only.
- [x] **Q14. Customer WhatsApp feedback message and review screens.**
  - (a) The feedback message stays in 0003 (it will add a button to the job page after submitting). Manager review and Finance close screens stay out of 0002; raise them when writing the 0003 PRD (Phase 2 graduation needs them). **(Recommended)**
  - (b) Build the feedback message in 0002 now; 0003 becomes only the trigger logic.
- [x] **Q15. Rework.**
  - (a) The job shows a "Returned for rework" banner with the manager's note; the form opens pre-filled with the previous record; existing files are kept and can be removed or added to; resubmitting overwrites the record. **(Recommended)**
  - (b) The form opens blank; files are kept.
- [x] **Q16. Bad connection.**
  - (a) No offline mode. Typed text is saved on the phone as a draft per job (restored after a reload or dropped signal; cleared on submit); files upload one by one with Retry; every write is locked while sending and safe to retry (a payment carries a one-time key so a retry cannot double-record; a completion already submitted shows as done). Clear "Could not reach the server" messages. **(Recommended)**
  - (b) As (a), without the saved draft.
  - (c) Full offline mode: queue everything and send later. Much bigger; conflicts with live status rules.
- [x] **Q17. Completion on the Admin order detail.** Admins (and later Managers) cannot see the submitted record yet. Answered 2026-10-22: option (a), with an upload button for Admins (see Q7).
  - (a) Add a "Completion" section (work done, extra charges, remarks, files, payments with receipts) to the 0001 order detail; the record is read-only, and Admins can add or remove files while the job is In Progress. **(Recommended)** Needed to check the work without a Manager screen.
  - (b) Leave it for the Manager review screens.
