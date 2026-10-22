# 0002 - Technician Job Portal Implementation Plan

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

Build the Technician portal from `docs/prd/0002-technician-job-portal-prd.md`
on top of 0000 and 0001: a mobile-first job list (the technician's home), a
job page with accept / start / reschedule, a completion form with file
uploads, a payment form with a receipt, and a notifications list with a live
unread count. One new migration adds a private Supabase Storage bucket with
row-level security, functions to add and remove files, a retry-safe
`record_payment` with a receipt, the extra-charges rule, three new
notification events, and the reads the screens need. The 0001 order detail
gets a Completion section with Admin uploads.

## Technical Approach

- **The database stays the rule authority.** New rules (extra charges, remarks
  required with extra charges, file type and size, receipt required for
  non-cash, when files may change) live in SQL. `src/domain/` mirrors them so
  the phone shows errors at once; parity tests run one table of cases through
  both.
- **Storage.** A private bucket `job-files` (`public = false`, 50 MB file
  limit, allowed MIME types listed). Paths: `<order_id>/<uuid>.<ext>` for job
  files and `<order_id>/receipts/<uuid>.<ext>` for receipts. Policies on
  `storage.objects`:
  - **read:** the order is readable by the caller (the `orders` RLS policy
    already limits technicians to their own jobs), so viewing follows order
    visibility: the assigned technician and every Admin, Manager, Finance user.
  - **insert:** job files by the assigned technician or an Admin while the
    order is In Progress; receipts by the assigned technician or Finance
    while the order is In Progress, Job Done, or Reviewed.
  - **delete:** the uploader, while the same rule as insert holds, and only
    when no `attachments` row points at the object (so a registered file is
    removed through the RPC first).
  - Policies call `security definer` helpers (`_can_upload_job_file(order_id)`
    and friends) that parse the order id from the path, so the rule is in one
    place and testable.
  Files are shown with short-lived signed URLs (1 hour); nothing is public.
- **Upload and register (P1).** The browser uploads the file to Storage, then
  calls `add_attachment(p_order_id, p_storage_path)`. The RPC reads the
  object's real size and MIME type from `storage.objects` (set by Storage,
  not by the browser), checks role, status, type, size, and the 6-file limit
  (existing trigger), and inserts the `attachments` row. If the RPC rejects,
  the browser deletes the uploaded object.
- **Remove (P2).** `remove_attachment(p_attachment_id)` checks the same rule,
  deletes the row, writes an audit entry, and returns the path; the browser
  then deletes the object (the delete policy now allows it).
- **Payment with receipt (P3).** `record_payment` is dropped and recreated
  with two new optional parameters: `p_client_key uuid` (unique per payment;
  a retry with the same key returns the first payment instead of recording
  again), `p_receipt_path text`. It verifies the receipt object, inserts the
  payment and its `attachments` row (`payment_id` set) in one transaction, and
  enforces "receipt required for bank transfer, card, e-wallet". New column
  `payments.client_key uuid unique`.
- **Completion.** `submit_completion` is replaced in place (same signature):
  extra charges through a shared money check (RM 0.00 – 100,000.00, 2
  decimals) and remarks required when extra charges are above zero.
  Resubmitting a job that is already Job Done with identical values is
  treated by the screen as success (the status shows it was saved).
- **Notifications.** New events `cancelled`, `reassigned_away`,
  `payment_recorded` (check constraint widened). `transition_order` is
  replaced in place (same signature) to notify the technician on cancel and
  the previous technician on reassign; `record_payment` notifies every active
  Finance user when a technician records a payment. New
  `mark_all_notifications_read()`. The `notifications` table is added to the
  `supabase_realtime` publication (guarded) so the bell updates live; RLS
  already limits each user to their own rows.
- **Reads.** `my_jobs(p_view text)` (`open`, `submitted`, `finished`)
  returns the signed-in technician's `order_summary` rows for that tab,
  Finished limited to the last 30 days (P5). The job page reads
  `order_summary`, `order_completions`, `attachments`, `payments`, and the
  latest `returned_for_rework` note from `audit_log`, all under RLS.
- **Phone first.** Layout designed at 375 px, then widened; tap targets
  ≥ 44 px; `inputmode="decimal"` for money; file input
  `accept="image/*,video/*,application/pdf"` (camera or gallery, no
  `capture` so both are offered); sticky bottom action bar on the job and
  form pages.
- **Photos resized in the browser (P7).** JPEG / PNG / WebP are drawn to a
  canvas at most 2048 px on the long side and saved as JPEG (quality 0.85);
  HEIC and files the browser cannot decode are sent as they are.
- **Bad connection.** Per-job draft in `localStorage` (text fields only;
  uploaded files are already on the server) restored on open and cleared on
  submit and sign-out (P9); every write button locks while in flight (ref
  guard, as in 0001); network failures show "Could not reach the server.
  Check your connection and try again." with Retry.
- **Screens per role.** Technicians get the job routes; Admins keep 0001 plus
  the new Completion section; Managers and Finance keep their placeholders.

## Resolved PRD Open Questions

All PRD questions were answered on 2026-10-22; see the PRD's Product
Decisions. Plan-level choices are in Open Questions below.

## System Components

| Component | Location | Responsibility |
|---|---|---|
| Migration | `supabase/migrations/20261022000006_technician_job_portal.sql` | Bucket and storage policies (guarded), storage helpers, `add_attachment`, `remove_attachment`, `record_payment` (recreated), `submit_completion` and `transition_order` (replaced, same signatures), `payments.client_key`, notification events, `mark_all_notifications_read`, `my_jobs`, realtime publication (guarded), grants |
| Hosted SQL | `docs/draft/0002-supabase-update.sql` (git-excluded) | Same SQL for the hosted project |
| Money rule | `src/domain/price.ts` (extended) | Shared RM 0 – 100,000 / 2-decimal check for quoted price and extra charges |
| Completion rules | `src/domain/completionForm.ts` | Field validation, final amount, remarks-required rule → error map + RPC args |
| File rules | `src/domain/attachments.ts` | Allowed types, size limits per kind, 6-file limit, when files may change |
| Payment rules | `src/domain/paymentForm.ts` | Amount, method, receipt-required rule, over-balance warning |
| Job views | `src/domain/jobs.ts` | Tab grouping (Today / Upcoming / No date, overdue) in Malaysia time |
| Routing / shell | `src/App.tsx`, `src/features/jobs/TechnicianPortal.tsx` | `/jobs`, `/jobs/:orderNo`, `/jobs/:orderNo/complete`, `/jobs/:orderNo/payment`, `/notifications` |
| Data access | `src/features/jobs/api.ts` | Typed RPC and read calls; error mapping shared with 0001 |
| Job list | `src/features/jobs/JobListPage.tsx`, `JobCard.tsx` | Tabs, grouping, empty / error states |
| Job page | `src/features/jobs/JobPage.tsx`, `ContactLinks.tsx` | Details, call / WhatsApp / maps, accept, start, reschedule, rework banner, submitted record, payments |
| Completion form | `src/features/jobs/CompletionPage.tsx` | Fields, live final amount, files, draft, submit |
| Payment form | `src/features/jobs/PaymentPage.tsx` | Amount, method, receipt, client key, submit |
| Files | `src/features/attachments/` | `FilePicker` (resize, upload, register, retry, remove), `FileGallery` (signed URLs), `storage.ts` |
| Notifications | `src/features/notifications/` | `NotificationBell` (unread count, Realtime + refocus refresh), `NotificationsPage` |
| Admin Completion section | `src/features/orders/CompletionSection.tsx` | Record, files (Admin upload / remove while In Progress), payments and receipts on the 0001 detail |
| Shared UI | `src/components/` | Reuse Field, Dialog, StatusBadge; reschedule dialog shared by both portals |

## Processing Flow

1. Technician signs in → `current_staff()` → role `technician` → `/jobs`
   (`my_jobs('open')`); the bell loads the unread count and subscribes.
2. **Job page:** `/jobs/<order_no>` → Accept (`transition_order` →
   `acknowledged`) or Start (confirm → `in_progress`); Reschedule dialog →
   `reschedule_order`.
3. **Complete:** `/jobs/<order_no>/complete` (In Progress only) → each chosen
   file: resize → upload to Storage → `add_attachment` → shown with Remove;
   text fields saved as a draft as they change → Submit (confirm if no files)
   → `submit_completion` → job page shows the record; Record payment offered.
4. **Payment:** `/jobs/<order_no>/payment` → receipt upload (if any) →
   `record_payment(…, client_key, receipt_path)` → Finance notified → job
   page shows the payment and new balance.
5. **Rework:** Manager returns the job → technician notified (live) → job
   page shows the note → Complete opens pre-filled with the record and files.
6. **Notifications:** `/notifications` → tap → `mark_notification_read` →
   job page (or "This job is no longer assigned to you" for reassigned
   away).
7. **Admin:** `/orders/<order_no>` shows the Completion section; while In
   Progress an Admin can add or remove files through the same components.

## Dependencies

| Dependency | Purpose |
|---|---|
| Existing: `@supabase/supabase-js` (Storage, Realtime, RPC), `react-router`, Tailwind CSS 4, Vitest 3, PGlite, jsdom 26, Testing Library | Unchanged; no new packages (P7) |

## Implementation Phases

### Phase 1: Database and storage

- Migration `20261022000006_technician_job_portal.sql` (append-only;
  Supabase-only statements guarded so PGlite still runs it).
- PGlite storage shim in `tests/db/helpers.ts` (P8).
- DB tests: storage policies (who can read / insert / delete, by role,
  status, path), `add_attachment` / `remove_attachment` (type, size, limit,
  status, roles, orphan check), `record_payment` (client key retry, receipt
  rule, Finance notified), `submit_completion` (extra charges and remarks
  rules), `transition_order` notifications (cancel, reassign away),
  `my_jobs` views, `mark_all_notifications_read`, access (anon and other
  technicians rejected).
- Hosted SQL in `docs/draft/0002-supabase-update.sql`.

### Phase 2: Domain rules

- `price.ts` (shared money check), `completionForm.ts`, `attachments.ts`,
  `paymentForm.ts`, `jobs.ts` with unit tests; parity cases for extra
  charges, remarks rule, file types and sizes, receipt rule.

### Phase 3: Technician shell and job list

- Routes, `TechnicianPortal`, header bell; job list tabs and grouping.

### Phase 4: Job page

- Details, contact links, accept / start, reschedule, rework banner,
  submitted record, payments list.

### Phase 5: Files

- `FilePicker` and `FileGallery`; resize; upload → register → retry /
  remove; signed URLs.

### Phase 6: Completion and payment forms

- Completion form with live final amount, draft, submit-once, no-files
  confirmation; payment form with receipt, client key, over-balance
  confirmation.

### Phase 7: Notifications

- Bell (unread count, Realtime, refresh on focus), list page, mark read,
  mark all read.

### Phase 8: Admin Completion section

- Read-only record, files with Admin add / remove while In Progress,
  payments with receipts on the 0001 order detail.

### Phase 9: Verify and document

- `npm test`, `npm run typecheck`, `npm run build`, and
  `python .claude/skills/validate-config/scripts/validate_config.py` pass.
- Manual check at 375 px in the browser pane against hosted Supabase (user
  signs in; test orders, uploads, and payments only with approval, cleaned up
  afterwards including stored files).
- Workflow doc `docs/0002-technician-job-portal-workflow.md`, 0000 / 0001
  workflow updates (new events, record_payment, Completion section),
  reference doc, decision log, roadmap status, commit message draft.

## Testing Strategy

- **Database (PGlite, `tests/db/`):** new `tests/db/technician-jobs.test.ts`
  and `tests/db/storage.test.ts`, run as the real API roles with RLS; parity
  cases in `tests/db/parity.test.ts`; existing notification and payment tests
  updated for the new events and parameters.
- **Domain (`tests/domain/`):** pure rules, including Malaysia-day grouping
  around midnight and the over-balance case.
- **Components (`tests/ui/`, jsdom):** job list tabs, job page actions per
  status, completion form validation, live final amount, no-files
  confirmation, submit-once, draft restore, payment receipt rule, bell count,
  Admin Completion section. `api.ts` and the storage module are replaced by
  test doubles; image resizing is tested with a stubbed canvas.
- **Manual (hosted Supabase, 375 px):** AC1–5, 7–12, 14, 15.

| PRD AC | Covered by |
|---|---|
| 1 Technician portal per role | `tests/ui/technician-portal.test.tsx` + manual |
| 2 Job list | `tests/db/technician-jobs.test.ts`, `tests/ui/job-list.test.tsx` + manual |
| 3 Job page and actions | `tests/ui/job-page.test.tsx` + manual |
| 4 Accept / start | `tests/ui/job-page.test.tsx` + manual |
| 5 Completion fields | `tests/ui/completion-form.test.tsx` + manual |
| 6 Invalid input, same rules in DB | `tests/domain/*`, `tests/db/parity.test.ts`, `tests/db/storage.test.ts` |
| 7 Private bucket and access | `tests/db/storage.test.ts` + manual |
| 8 Submit → Job Done, managers notified | `tests/db/technician-jobs.test.ts` + manual |
| 9 Rework | `tests/ui/completion-form.test.tsx` + manual |
| 10 Payment, retry-safe | `tests/db/technician-jobs.test.ts`, `tests/ui/payment-form.test.tsx` + manual |
| 11 Reschedule | `tests/ui/job-page.test.tsx` + manual |
| 12 Notifications list | `tests/db/notifications.test.ts`, `tests/ui/notifications.test.tsx` + manual |
| 13 Bad connection, submit once | `tests/ui/completion-form.test.tsx`, `tests/ui/payment-form.test.tsx` |
| 14 375 px, tap targets, keypads | manual |
| 15 Admin Completion section | `tests/ui/completion-section.test.tsx` + manual |
| 16 Cancel / reassign / payment notifications | `tests/db/notifications.test.ts` |

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Storage policies only run on hosted Supabase | A policy bug is found late | PGlite storage shim tests the same policies and helpers; manual check uploads as a technician and an Admin and views as another technician |
| Supabase blocks direct SQL deletes on `storage.objects` | Files cannot be removed from SQL | Removal is RPC (row) then Storage API (file); delete policy allows it once the row is gone |
| Browser upload succeeds but the register RPC fails (signal drop) | Orphan file in the bucket | Browser retries the RPC, or deletes the file on a rule error; manual cleanup lists any orphans (P2) |
| Recreating `record_payment` drops its grants | Payments break | Grant again in the migration; DB test calls it as `authenticated` |
| Replacing `transition_order` / `submit_completion` changes 0000 behavior | Lifecycle regressions | Same signatures; the full 0000 / 0001 DB suite must stay green |
| Realtime publication not enabled on hosted | Bell does not update live | Refresh on focus still works; hosted SQL adds the table to the publication |
| HEIC photos from iPhones | Cannot be resized or previewed in Chrome | Sent as is (Safari usually converts to JPEG on pick); gallery shows a file icon when it cannot preview |
| Large videos on mobile data | Slow uploads | Progress bar, Retry, 50 MB cap |

## Roadmap Phase

**Phase:** 2 – Core workflow

## Related Documents

| Document | Type | Relationship |
|---|---|---|
| `docs/product-roadmap.md` | Roadmap | Phase assignment and sequencing for this plan |
| `docs/prd/0002-technician-job-portal-prd.md` | Intent | Product goals and constraints this plan implements |
| `docs/0002-technician-job-portal-workflow.md` | Workflow | Runtime behavior derived from this plan |
| `docs/0000-system-foundation-workflow.md` | Workflow | The RPCs and rules this portal calls |
| `docs/0001-admin-order-portal-workflow.md` | Workflow | Order detail that gains the Completion section |
| `docs/reference/folder-structure.md` | Reference | Structural placement of planned components |
| `docs/decisions/NNNN-*.md` | Decision log | Divergences from this plan |

## Open Questions

Each question lists options; **(Recommended)** marks the proposed default.
All answered 2026-10-22: option (a) for every question.

- [x] **P1. How a file is uploaded and registered.**
  - (a) Browser uploads to Storage (policy checks who and when), then `add_attachment` registers it after reading the real size and type from `storage.objects`. **(Recommended)** Uses Supabase's normal upload path; the database checks what was actually stored.
  - (b) `begin_attachment` first creates the row and returns a path, then the browser uploads to it. Rows can exist without a file if the upload fails.
  - (c) A Supabase Edge Function receives the file and writes both with the secret key. One more deployed service to maintain.
- [x] **P2. Orphan files** (uploaded but never registered, or row removed but file delete failed).
  - (a) The browser retries the register, or deletes the file on a rule error; anything left is invisible in the app and listed by a query in the hosted SQL notes for manual cleanup. **(Recommended)**
  - (b) Also add a scheduled cleanup (`pg_cron` + Edge Function) that deletes unregistered files older than a day.
- [x] **P3. Payment and receipt together.**
  - (a) Recreate `record_payment` with `p_client_key` and `p_receipt_path`; the payment and its receipt row are saved in one transaction. **(Recommended)** No payment can exist without its required receipt.
  - (b) Keep `record_payment` as is; record the payment, then attach the receipt in a second call. A dropped signal can leave a non-cash payment without a receipt.
- [x] **P4. Receipt rule for Finance.** `record_payment` is also used by Finance (no Finance screen yet).
  - (a) The same rule for everyone: bank transfer, card, and e-wallet need a receipt. **(Recommended)** One rule, one place.
  - (b) Only technicians must attach one; Finance can record without.
- [x] **P5. Job list query.**
  - (a) New `my_jobs(p_view)` returning one tab at a time, Finished limited to 30 days. **(Recommended)** Small responses on mobile data; tested in PGlite.
  - (b) Keep `technician_jobs()` and split into tabs in the browser. Downloads every job the technician ever had.
- [x] **P6. Where cancel / reassign notifications are created.**
  - (a) In `transition_order` (replaced, same signature), next to the existing notifications. **(Recommended)** All notifications stay in the RPCs, as today.
  - (b) A trigger on `orders` status / technician changes.
- [x] **P7. Photo resizing.**
  - (a) Built-in canvas code, no new package. **(Recommended)**
  - (b) A library such as `browser-image-compression`.
- [x] **P8. Testing storage policies.**
  - (a) Add a small `storage` schema shim to the PGlite helpers (buckets, objects, `foldername`) and test the real policies there. **(Recommended)**
  - (b) Check storage policies manually on hosted only.
- [x] **P9. Drafts on the phone.**
  - (a) Text fields only, per job, in `localStorage`; cleared on submit and on sign-out (shared phones). **(Recommended)**
  - (b) As (a), but kept across sign-out.
- [x] **P10. Folder layout.**
  - (a) `src/features/jobs/` (technician screens), `src/features/attachments/` (shared with the Admin Completion section), `src/features/notifications/` (shared bell). **(Recommended)**
  - (b) Everything under `src/features/jobs/`; the Admin section imports from it.
