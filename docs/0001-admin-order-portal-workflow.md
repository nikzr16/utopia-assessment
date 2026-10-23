# 0001 - Admin Order Portal Workflow

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

How an Admin creates, finds, edits, and dispatches service orders, and how the
assigned technician is told about a job. All writes go through the 0000
lifecycle (`docs/0000-system-foundation-workflow.md`) plus the 0001 functions
in `supabase/migrations/20261022000005_admin_order_portal.sql`.

## Trigger

A signed-in staff member whose active profile has role `admin` opens the app.
`App.tsx` renders `AdminPortal` for Admins; technicians, Managers and Finance
get their own portals (0002, 0004) whatever the URL.

## Preconditions

- Signed in with an active staff profile (0000 stage 1).
- The hosted database has the 0001 migration applied.
- Writes are RPCs; the database resolves the actor from the session.

## Routes

| URL | Screen |
|---|---|
| `/orders` | Order list (the Admin's home; any unknown path redirects here) |
| `/orders/new` | New order form |
| `/orders/<order_no>` | Order detail (`?created=1`, `?updated=1` show a banner; `?action=reschedule` opens Reschedule) |
| `/orders/<order_no>/edit` | Edit order |

`vercel.json` rewrites every path to `index.html` so these URLs load directly.

## Stages

### 1. Find orders — `list_orders`

**Input:** URL params `q`, `status` (`''` all, `open`, or one status), `branch`, `tech`, `from` / `to` (Malaysia dates), `page`.
**Actions:** One `list_orders` call, 25 rows per page, newest first. Search matches order number and customer name (case-insensitive, `%` and `_` taken literally) and phone digits: typed with a `0` or `60` prefix it matches from the start of the stored number, otherwise anywhere. Date filters cover whole Malaysia days.
**Output:** Table on wide screens, cards below 768 px; "Showing x–y of n" with Previous / Next.
**On failure:** "Could not load orders" with Try again. No rows: "No orders yet" (with a create button) or "No orders match your search and filters".

### 2. Create order — `create_order`

**Input:** Branch (defaults to the Admin's own branch, matched by name), customer name, phone, address, problem description, service type (active ones), quoted price, optional technician, optional scheduled date and time (Malaysia time), optional admin notes. Order No shows "Generated on save".
**Actions:** `src/domain/orderForm.ts` validates on blur and on submit; the first invalid field gets focus. A valid phone is reformatted on blur (`+60 12-345 6789`). Submit is locked while saving (a second click does nothing). `create_order` validates again, stores the phone normalised, and generates the order number.
**Output:** Navigates to `/orders/<order_no>?created=1` (the order summary). Status New, or Assigned with a technician.
**On failure:** "The order was not saved" with the database message; the form keeps its values.

The technician dropdown lists active technicians from `technician_options()`: the order's branch first, each with their open-job count (Assigned, Acknowledged, In Progress).

### 3. Order detail and summary

**Reads:** `order_summary` by order number, the technician's phone from `staff`, and `audit_log` with the actor's name (newest first).
**Shows:** Status badge, order details, money (quoted, extra charges, final, paid, balance, payment status), history in plain words (edits as `field: old → new`, reassign as `From A to B`, reschedule with reason and requester, notes).
**Actions offered:** Edit (`canEditOrder`), Assign / Reassign and Cancel (`availableTransitions(status, 'admin')`), Reschedule (`canRescheduleOrder`). Closed, Cancelled, Job Done and Reviewed orders show none (In Progress shows Reschedule only).
**History wording:** payments name the method and whether a receipt was attached ("RM 150.00 by Bank transfer, with receipt"); `file_added` / `file_removed` (0002) read "Added a file" / "Removed a file" with the file name; the 0003 customer message events read "Edited the customer message", "Sent the customer message on WhatsApp", "Told the customer by phone".

### 3b. Customer message (0003)

**When shown:** The order is Job Done, Reviewed, or Closed and has a customer message.
**Approved / Closed (0004):** Reviewed and Closed orders show "Approved by X at T" (with the Manager's note) and "Closed by X at T" above the Customer message panel.
**Shows:** The Customer message panel above the order details: the message, Edit, Send to customer on WhatsApp (or Call the customer for a landline), the "Have you sent it?" question, "Sent by X at T", and the "Customer not told yet" badge. The history reloads after an edit or confirmation. Details: `docs/0003-whatsapp-notification-workflow.md`.

### 3a. Completion section (0002)

**When shown:** The order is In Progress, Job Done, Reviewed, or Closed.
**Reads:** `fetchOrderRecords` (completion record, payments with receipts, latest rework note), reloaded whenever the order changes.
**Shows:** The technician's record read-only (work done, extra charges, final amount, remarks, submitted by and when) or "Not submitted yet."; the rework note while a returned job is In Progress; **Photos, videos and PDFs** with the same uploader as the technician (an Admin can add or remove files only while the job is In Progress; read-only otherwise); **Payments** with Receipt links and, for non-cash payments, "Not verified yet" or "✓ Verified by X at T" (0004), or "No payments recorded yet." The history names "Verified a payment" / "Undid a payment verification" (0004). Uploader details: `docs/0002-technician-job-portal-workflow.md` stage 5.

### 4. Notify the technician — WhatsApp deep link

**When shown:** The order has a technician and is Assigned, Acknowledged, or In Progress.
**Actions:** `src/domain/whatsapp.ts` builds the message (order number, service type, customer name and phone, address, problem, scheduled date, quoted price, admin notes, link to the order) and `https://wa.me/<technician phone>?text=…`. The opening line depends on what just happened: assigned, reassigned, or updated. The button opens WhatsApp in a new tab; the Admin taps Send there.
**Output:** Nothing is recorded (the app cannot know whether it was sent). If the technician has no mobile number: "No WhatsApp number on file for <name>".

### 5. Edit order — `update_order`

**Input:** The same fields as create except technician (read-only; changed by assign / reassign). A date already set is read-only with a "Change date (Reschedule)" link; an empty date can be set here.
**Actions:** Admin only; status New, Assigned, or Acknowledged. Sends `updated_at` as loaded; the database rejects the save if the order changed since. Same field rules as create. No change → nothing written.
**Output:** One audit entry `updated` with `details.changes = { field: { from, to } }` (branch and service type by name); the assigned technician gets an in-app `order_updated` notification naming the changed fields. Navigates to `/orders/<order_no>?updated=1`.
**On failure:** The message is shown above the form and the edits stay in it. A conflict adds "Your edits are still in the form." Editing a non-editable order shows "This order can no longer be edited" instead of the form.

### 6. Assign / reassign — `transition_order(…, 'assigned', …, technician)`

Dialog with the technician dropdown (the current technician is not offered). On success: banner "Assigned to X." / "Reassigned to X." and the WhatsApp button is highlighted with the matching message.

### 7. Reschedule / postpone — `reschedule_order`

Dialog (shared with the Technician portal, `src/components/RescheduleDialog.tsx`): new date and time (Malaysia time) or "Postpone, no new date yet"; reason; requested by; note (required for "Other"). On success: banner "New date saved." and a `rescheduled` history entry.

### 8. Cancel — `transition_order(…, 'cancelled', reason)`

Dialog with a required reason. On success the order is Cancelled: no actions, no WhatsApp button, edit refused. The assigned technician gets an in-app `cancelled` notification with the reason (0002); a reassign likewise tells the previous technician (`reassigned_away`).

## Error States

| Error | Cause | Handling |
|---|---|---|
| "Enter a valid Malaysian phone number, for example 012-345 6789 or 03-1234 5678" | Phone fails `_normalize_my_phone` | Shown on the field (screen) or above the form (database); nothing saved |
| "Quoted price must be zero or more" / "cannot be more than RM 100,000.00" / "can have at most 2 decimal places" / "is required" | Price fails `_check_quoted_price` | Same |
| "Only Admin can edit an order" | Non-Admin calls `update_order` | Rejected |
| "An order can only be edited while it is New, Assigned or Acknowledged (it is currently X)" | Edit after work started or terminal | Rejected |
| "This order was changed by someone else. Reload to see the latest version." | `updated_at` differs (compared to the millisecond) | Rejected; edits kept in the form |
| "Use Reschedule to change a scheduled date" | `update_order` changes or clears a date that is set | Rejected |
| "Select a valid service type" | Switching to an inactive service type (keeping one is allowed) | Rejected |
| "You do not have permission to do that." | Database permission error (42501) | Shown as is |
| "Could not reach the server. Check your connection and try again." | Network failure | Shown as is |

## Defaults

| Setting | Default |
|---|---|
| Phone storage | Digits with country code, no trunk 0 (`60123456789`) |
| Phone display | `+60 12-345 6789`, `+60 11-2345 6789`, `+60 3-1234 5678`, `+60 4-123 4567`, `+60 82-123 456` |
| Quoted price | RM 0.00 – RM 100,000.00, at most 2 decimals |
| Editable statuses | New, Assigned, Acknowledged (`EDITABLE_STATUSES`) |
| Reschedulable statuses | New, Assigned, Acknowledged, In Progress (`RESCHEDULABLE_STATUSES`) |
| List page size | 25 (`list_orders` caps at 100) |
| Dates and times | Malaysia time (UTC+8) in every form and display |

## Behavioral Constraints

- The portal never writes a table directly; only `create_order`, `update_order`, `transition_order`, `reschedule_order`, and (0002, Completion section) `add_attachment` / `remove_attachment` with Storage uploads and deletes.
- Phone, price, editable and reschedulable statuses exist in both `src/domain/` and SQL; `tests/db/parity.test.ts` runs the same cases through both.
- `list_orders` and `technician_options` are `security invoker`: row-level security applies (a technician calling them sees only their own orders).
- `create_order` stores new phones normalised; rows saved before 0001 keep the phone as typed.

## Related Documents

| Document | Type | Relationship |
|---|---|---|
| `docs/prd/0001-admin-order-portal-prd.md` | Intent | Product goals this workflow fulfills |
| `docs/plan/0001-admin-order-portal-plan.md` | Plan | Architecture this workflow implements |
| `docs/0000-system-foundation-workflow.md` | Workflow | Lifecycle RPCs this portal calls |
| `docs/reference/folder-structure.md` | Reference | File locations of workflow components |
| `docs/decisions/0006-admin-order-portal-implementation-details.md` | Decision log | Divergences from the 0001 plan |
| `docs/0002-technician-job-portal-workflow.md` | Workflow | Technician side, and the job-file uploader the Completion section reuses |
| `docs/0003-whatsapp-notification-workflow.md` | Workflow | Customer message panel on the order detail |
