# 0007 - Technician Job Portal Implementation Details

> **Date:** 2026-10-22 | **Status:** Accepted

<!-- AI Context
Role: This is an append-only record of a single implementation divergence.
Each entry captures why the deviation happened and what it affects.
Never edit an existing decision log entry. To reverse a previous decision,
create a new entry that references the original. After adding an entry,
check the impact checklist below and update affected workflow or reference
docs before the session ends.
-->

## Context

Building feature 0002 (`docs/plan/0002-technician-job-portal-plan.md`)
surfaced details the plan did not spell out or placed differently, and the
manual check on hosted Supabase confirmed how some of them behave.

## Decision

- **Shared plumbing moved to `src/lib/`.** `ApiError` / `toApiError` / `run` /
  `OrderSummary` (`lib/api.ts`), `useLoad` (from `features/orders/`), and new
  `orderRecords.ts`, `useRefreshOnReturn.ts`, `drafts.ts`, so the jobs,
  attachments and notifications features do not import from the Admin
  feature. `features/orders/api.ts` re-exports what its screens and tests use.
- **Files on the job page too.** The plan put the uploader on the completion
  form; the job page's Photos and files section uses it as well, editable
  while In Progress (the same rule), so "before" photos can be added while
  working.
- **More file data stored.** `attachments.file_name` and `size_bytes`, and a
  unique index on `storage_path`; `add_attachment` takes `p_file_name`,
  `record_payment` takes `p_receipt_file_name`. Adding a file is audited as
  `file_added` (the plan only named an audit entry for removing,
  `file_removed`).
- **`remove_attachment` returns the removed row** (the plan said the path);
  the browser uses its `storage_path`.
- **Delete policy is not limited to the uploader.** Anyone who may upload to
  that order and kind may delete a stored file once no `attachments` row
  points at it, so an Admin can finish removing a technician's file.
- **Payment drafts keep more than text.** Plan P9 said drafts hold text only;
  the payment draft also keeps the one-time client key and the uploaded
  receipt's path, so a retry after a reload reuses the same key and receipt.
- **Client key reuse.** A key returns the first payment only for the same
  person on the same order; anything else is "This payment key has already
  been used".
- **Payment amount decimals.** The screen refuses more than 2 decimals
  ("Payment amount can have at most 2 decimal places"); `record_payment`
  still rounds as in 0000. The parity test covers the receipt rule and the
  statuses, not this screen-only check.
- **Overdue is its own group.** PRD Q1 said overdue jobs are flagged within
  the Open tab; they are a separate "Overdue" group above Today, in red, each
  card marked "Overdue".
- **Customer WhatsApp opener.** PRD Q2 named tap-to-WhatsApp; the message is
  "Hi <customer>, this is <technician> from Sejuk Sejuk Service about your
  aircond job <order>." (not the 0003 feedback message).
- **Notifications bell sits in the portal nav,** next to My jobs, not in the
  shared `AppHeader`; `NotificationBell` and `NotificationsProvider` are
  generic so other portals can mount them. The list shows the latest 50.
- **Lost-answer recovery on submit.** When `submit_completion` fails for lack
  of signal (or reports the job is already Job Done), the form re-reads the
  job and treats Job Done as submitted.
- **Uploads go one at a time,** and a file whose register step failed keeps
  its path so Retry repeats only that step.
- **Storage shim in tests** also mimics Supabase's guard against direct SQL
  deletes on `storage.objects`, so tests prove the RPCs never delete files.

## Reason

Keeping shared code in `src/lib/` avoids features depending on each other.
Storing the file name and size lets every screen label files without a
Storage call. The delete-policy and draft changes were needed for the
remove-then-delete and retry flows to work end to end; the manual check on
hosted Supabase (uploads, removal, receipt, payment, live notifications)
passed with them. The rest are small UX choices inside the PRD's decisions.

## Impact

- [x] Workflow doc updated
- [x] Reference doc updated
- [ ] No upstream doc update needed
