# 0002 - Technician Job Portal Workflow

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

How a technician sees their jobs on a phone, accepts and starts them, records
the finished work with photos / videos / PDFs, records the payment collected,
and follows their in-app notifications. All writes go through the 0000
lifecycle (`docs/0000-system-foundation-workflow.md`) plus the 0002 functions
and Storage rules in `supabase/migrations/20261022000006_technician_job_portal.sql`.

## Trigger

A signed-in staff member whose active profile has role `technician` opens the
app. `App.tsx` renders `TechnicianPortal` (with their staff id) for
technicians; Admins get the 0001 portal; Managers and Finance get the 0004
portals (`docs/0004-review-and-close-workflow.md`).

## Preconditions

- Signed in with an active staff profile (0000 stage 1).
- The hosted database has the 0002 migration applied: the private `job-files`
  bucket with its policies, and `notifications` in the `supabase_realtime`
  publication.
- Writes are RPCs (plus Storage uploads and deletes, which Storage policies
  decide); the database resolves the actor from the session.

## Routes

| URL | Screen |
|---|---|
| `/jobs` | Job list, Open tab (the technician's home; any unknown path redirects here) |
| `/jobs?tab=submitted`, `/jobs?tab=finished` | Submitted / Finished tabs |
| `/jobs/<order_no>` | Job page (`?submitted=1`, `?paid=1` show a banner) |
| `/jobs/<order_no>/complete` | Completion form (In Progress only) |
| `/jobs/<order_no>/payment` | Record payment (In Progress, Job Done, Reviewed) |
| `/notifications` | Notifications list |

The portal nav shows **My jobs** and **🔔 Notifications** with the unread count.
Layout is phone first (375 px, tap targets ≥ 44 px, sticky action bar).

## Stages

### 1. Job list — `my_jobs(p_view)`

**Input:** Tab from `?tab=` (`open` default, `submitted`, `finished`).
**Actions:** One `my_jobs` call per tab. Open: Assigned, Acknowledged, In Progress, soonest scheduled first. Submitted: Job Done, Reviewed, latest first. Finished: Closed and Cancelled updated in the last 30 days.
**Output:** Open jobs grouped by Malaysia day: **Overdue** (scheduled before today, in red), **Today** (even if the time has passed), **Upcoming**, **No date yet**; each with a count. Each card: order number, status, service type, customer · area (last part of the address), date and time, "To collect: RM x" when a balance is owed (never on a cancelled job), and on the Submitted tab "Customer not told yet" while the customer message is unsent (0003). The whole card links to the job.
**Refresh:** Refresh button; also automatically when the app becomes visible again or the connection comes back.
**On failure:** "Could not load your jobs" with the message and Try again. Empty tabs say so in plain words.

### 2. Job page — `order_summary` + `fetchOrderRecords`

**Reads:** The order from `order_summary` (RLS: own jobs only), the completion record, payments with their receipts, and the latest `returned_for_rework` audit entry.
**Shows:** Order number, status, service type, date; **Customer** (name, formatted phone, address) with **Call** (`tel:+60…`), **WhatsApp** (`wa.me` with "Hi <customer>, this is <technician> from Sejuk Sejuk Service about your aircond job <order>.") and **Open in Maps** (Google Maps search); **Job** (problem, notes from the office, branch); **Money** (quoted, extra charges, final, paid with payment status, To collect) and the payments list with **Receipt** links; **Photos and files** (In Progress, Job Done, Reviewed, Closed); the **Completion record** ("Previous completion record" during rework).
**Approved / Closed (0004):** Reviewed and Closed jobs show "Approved by X at T" (with the Manager's note) and "Closed by X at T" under the header.
**Customer message (0003):** Job Done, Reviewed and Closed jobs show the Customer message panel under the header: send on WhatsApp (or call a landline customer), edit before sending, confirm. Details: `docs/0003-whatsapp-notification-workflow.md`.
**Banners:** "Returned for rework" with the manager's note, name and time (In Progress with a record and a rework entry); "This job was cancelled. Nothing more to do." (cancelled: contact links hidden).
**Actions (sticky bar):** Accept job (Assigned), Start job (Assigned / Acknowledged), Complete job or **Fix and resubmit** (In Progress), Record payment (In Progress, Job Done, Reviewed), Reschedule (`RESCHEDULABLE_STATUSES`).
**On failure:** "Could not load the job" with Try again. A job the technician cannot read (not theirs, or reassigned away): "Job not found — … may have been reassigned to another technician."

### 3. Accept and start — `transition_order(…, 'acknowledged' | 'in_progress')`

Accept is one tap. Start opens "Start <order> now?" ("The office will see this job as In Progress. You cannot undo this yourself.") with Start job / Not yet. Buttons lock while saving. Success: banner "Job accepted." / "Job started." and the page reloads. Failure: the database message in a red alert.

### 4. Reschedule — `reschedule_order`

The shared Reschedule dialog (also used by Admins): new date and time (Malaysia time) or "Postpone, no new date yet"; reason; requested by (Customer, Technician, Admin); note (required for Other). Success: "New date saved."

### 5. Job files — Storage upload + `add_attachment` / `remove_attachment`

**Where:** The job page's Photos and files section and the completion form (and the Admin order detail, see `docs/0001-admin-order-portal-workflow.md`). Editable only while In Progress by the assigned technician or an Admin; read-only otherwise.
**Add:** "Add photos, videos or PDFs" opens the phone's camera / gallery picker (multiple). Files beyond the 6-file room are not added ("A job can have at most 6 files. N files were not added."). A wrong type is refused at once. Each remaining file, one at a time:
1. **Preparing** — JPEG / PNG / WebP larger than 2048 px on the long side are redrawn to 2048 px and saved as JPEG (quality 0.85); others are sent as they are. The type comes from the file, or its extension when the phone reports none (HEIC, MOV). Size is checked after resizing.
2. **Uploading** — to `job-files/<order_id>/<uuid>.<ext>`. A retry that finds the file already there counts as uploaded.
3. **Saving** — `add_attachment(order, path, file name)`: the database reads the real type and size from `storage.objects`, checks who, when, type, size and the 6-file limit, inserts the `attachments` row, and audits `file_added`. Calling it again for the same file returns the same row.
**On failure:** No signal → the file shows the error with **Retry** (repeats only the failed step, same path) and **Remove** (deletes an uploaded copy). A rule refusal → no Retry; an uploaded copy is deleted.
**Show:** Tiles: photo thumbnails, ▶ Video and 📄 PDF tiles (and a photo tile when a HEIC cannot be previewed); file name and size; each opens a 1-hour signed link.
**Remove:** Remove → Remove / Keep → `remove_attachment` (audits `file_removed`, returns the row) → the stored file is deleted (best effort; a left-over file is invisible in the app).

### 6. Complete the job — `submit_completion`

**Form (`/complete`):** Order ID (read-only), Work done, Extra charges (RM, `inputmode="decimal"`, empty = 0), live **Final amount** (quoted + extra; "—" while the extra charges are not a valid amount), Photos, videos and PDFs (stage 5), Remarks (required when extra charges > 0), Technician (read-only) and Timestamp ("Recorded when you submit"). A reworked job opens pre-filled with the previous record.
**Draft:** Every change is saved on the phone (`localStorage` `sejuk-draft:completion:<order id>`); reopening restores it with "Restored what you typed earlier on this phone." Cleared on submit and on sign-out.
**Submit:** Field errors are shown and the first invalid field is focused. Files still uploading → "Wait for the files to finish uploading."; failed files → "Retry or remove the files that did not upload."; no files → "Submit without photos?" (Add photos / Submit without photos). The button locks while saving (ref guard: one save however often it is tapped).
**Output:** Status Job Done; every Manager covering the branch notified (0000, 0004). Redirect to `/jobs/<order>?submitted=1`: "Job submitted. Your manager has been told and will review it." plus "Record the payment (RM x)" when a balance is owed.
**On failure:** If the connection failed or the database says the job is already Job Done, the job is re-read: Job Done → treated as submitted. Otherwise the message is shown and everything typed stays in the form.

### 7. Record a payment — `record_payment` with client key and receipt

**Form (`/payment`):** Final amount, paid and balance; Amount received (pre-filled with the balance); Payment method (Cash, Bank transfer, Card, E-wallet as large choices); Receipt photo or PDF (required for bank transfer, card, e-wallet; optional for cash); Note.
**Receipt:** Uploaded as soon as it is chosen to `job-files/<order_id>/receipts/<uuid>.<ext>` (photos resized as in stage 5; videos refused). Replace / Remove delete the unsaved copy. Upload failures without signal offer Retry.
**Draft and key:** The form keeps a draft on the phone (`sejuk-draft:payment:<order id>`): values, the uploaded receipt, and a one-time **client key** created when the form first opens.
**Submit:** Validation (amount required, > 0, at most 2 decimals; method; receipt rule). An amount above the balance asks "RM x is RM y more than the balance of RM z. Record it anyway?". One save per tap. `record_payment(…, p_client_key, p_receipt_path, p_receipt_file_name)` saves the payment and the receipt's `attachments` row in one transaction.
**Output:** Redirect to `/jobs/<order>?paid=1`: "Payment recorded. Finance has been told." The draft is cleared.
**On failure:** The message is shown; the draft keeps the same key, so trying again (even after a reload) returns the first payment instead of recording a second.

### 8. Notifications — `notifications` + Realtime

**Count:** `NotificationsProvider` loads the unread count, subscribes to Realtime changes on `notifications` filtered to the technician's staff id, and refreshes again when the app becomes visible or the connection returns. The nav shows the count (red badge, "99+" above 99).
**List (`/notifications`):** The latest 50, newest first: event tag (New job, Job done, Returned for rework, Reviewed, Details changed, Cancelled, Reassigned, Payment recorded, Approved, Closed; the last two since 0004), message, Malaysia time, unread highlighted. Tapping one opens the job at once and marks it read in the background (`mark_notification_read`). A "Reassigned" notification does not open the job: "This job is no longer assigned to you." **Mark all as read** (`mark_all_notifications_read`) when anything is unread.
**Events a technician receives:** `assigned` (new or reassigned to them), `order_updated` (0001), `rework`, `cancelled` (with the reason), `reassigned_away`.

### 9. Sign out

Signing out removes every `sejuk-draft:` entry from the phone before ending the session.

## Error States

| Error | Cause | Handling |
|---|---|---|
| "Describe the work done before submitting" | Work done empty | On the field (screen) or alert (database) |
| "Extra charges cannot be negative" / "cannot be more than RM 100,000.00" / "can have at most 2 decimal places" / "Enter the extra charges as a number…" | Extra charges rule (`_check_extra_charges`) | Same |
| "Explain the extra charges in the remarks" | Extra charges > 0 and no remarks | Same |
| "This file type is not allowed. Use a photo (JPEG, PNG, WebP, HEIC), a video (MP4, MOV, WebM) or a PDF" | Type outside the list | Shown on the file; nothing uploaded |
| "Photos can be at most 10 MB" / "Videos can be at most 50 MB" / "PDFs can be at most 10 MB" / "The file is empty" | Size rule (after resizing) | Shown on the file; uploaded copy deleted |
| "A receipt must be a photo or a PDF" | Video chosen as a receipt | Shown under the receipt |
| "Only the assigned technician or an Admin can change the files of a job" | Other technician, Manager, Finance | Rejected by `add_attachment` / `remove_attachment` (Storage policies refuse the upload) |
| "Files can only be changed while the job is In Progress (it is currently X)" | Add / remove before start or after submit | Rejected; uploaded copy deleted |
| "The file was not uploaded. Try again." | No stored object at that path from this user | Rejected by `add_attachment` / `record_payment` |
| "This file does not belong to ORDER…" / "This receipt does not belong to ORDER…" | Path of another order or the wrong kind | Rejected |
| "This file is already attached" / "This receipt is already attached to a payment" | Path registered by someone else / already used | Rejected |
| "A payment receipt cannot be removed" | `remove_attachment` on a receipt | Rejected |
| "File not found" | Unknown id, or a file of another technician's job | Rejected |
| "An order can have at most 6 completion attachments" | Seventh job file | Rejected by the 0000 trigger |
| "Attach a receipt for bank transfer, card or e-wallet payments" | Non-cash payment without a receipt (any role) | On the form or from `record_payment` |
| "This payment key has already been used" | Client key reused for another order or by another person | Rejected |
| "Enter the payment amount" / "Payment amount must be greater than zero" / "Payment amount can have at most 2 decimal places" | Amount rules (screen; the database checks > 0) | On the field |
| "Wait for the files to finish uploading." / "Retry or remove the files that did not upload." / "Wait for the receipt to finish uploading." | Submit while uploads are pending or failed | Alert; nothing submitted |
| "You cannot add files to this job right now." / "The file is too large to upload." | Storage refused the upload (403 / 413) | Shown on the file |
| "Could not reach the server. Check your connection and try again." | Network failure | Retry where offered; drafts kept |
| "Only technicians have a job list" / "Unknown job list view: X" | `my_jobs` misuse | Rejected |

## Defaults

| Setting | Default |
|---|---|
| Job list tab | Open |
| Finished tab window | 30 days (`FINISHED_JOB_DAYS`) |
| Job files per order | 6 (receipts not counted) |
| Allowed types | JPEG, PNG, WebP, HEIC/HEIF; MP4, MOV, WebM; PDF (bucket and `_job_file_kind`) |
| Size limits | Photo 10 MB, video 50 MB, PDF 10 MB; bucket cap 50 MB |
| Photo resize | Long side ≤ 2048 px, JPEG quality 0.85 (JPEG / PNG / WebP only) |
| Signed link lifetime | 1 hour |
| Notifications listed | 50 latest |
| Payment amount | The balance |
| Drafts | `localStorage`, prefix `sejuk-draft:` |

## Behavioral Constraints

- The portal writes only through `transition_order`, `reschedule_order`,
  `submit_completion`, `record_payment`, `add_attachment`, `remove_attachment`,
  `mark_notification_read`, `mark_all_notifications_read`, plus Storage
  uploads and deletes that the `job-files` policies decide.
- Who may read a stored file follows order visibility (assigned technician,
  every Admin, Manager and Finance user); who may upload / delete follows
  `_job_file_write_error`. A stored file can only be deleted once no
  `attachments` row points at it; SQL cannot delete stored files.
- File types and sizes, extra charges, the remarks rule, the receipt rule,
  who may change files, payment statuses and job list tabs exist in both
  `src/domain/` and SQL; `tests/db/parity.test.ts` runs the same cases
  through both.
- The screen is stricter than the database in one place: payment amounts with
  more than 2 decimals are refused instead of rounded.

## Related Documents

| Document | Type | Relationship |
|---|---|---|
| `docs/prd/0002-technician-job-portal-prd.md` | Intent | Product goals this workflow fulfills |
| `docs/plan/0002-technician-job-portal-plan.md` | Plan | Architecture this workflow implements |
| `docs/0000-system-foundation-workflow.md` | Workflow | Lifecycle RPCs this portal calls |
| `docs/0001-admin-order-portal-workflow.md` | Workflow | Admin side: dispatch, and the Completion section on the order detail |
| `docs/reference/folder-structure.md` | Reference | File locations of workflow components |
| `docs/decisions/0007-technician-job-portal-implementation-details.md` | Decision log | Divergences from the 0002 plan |
| `docs/0003-whatsapp-notification-workflow.md` | Workflow | Customer message panel on the job page and the Submitted-tab flag |
| `docs/0004-review-and-close-workflow.md` | Workflow | Approve / close notices and "Approved by / Closed by" on the job page; the payment form shared with Finance |
