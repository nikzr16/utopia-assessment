# 0003 - WhatsApp Notification Workflow

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

How the customer is told that their job is done. When an order reaches Job
Done the database prepares a WhatsApp message (or, for a landline, a reminder
to call); the assigned technician or an Admin sends it from the app with a
`wa.me` deep link, then confirms it was sent. Everyone who can see the order
sees whether the customer was told, by whom and when. All rules live in
`supabase/migrations/20261023000001_whatsapp_notification.sql`.

## Trigger

An order's status changes to `job_done` from any other status. Today that
happens only through `submit_completion` (0000), first time or after a
rework return.

## Preconditions

- The hosted database has the 0003 migration applied
  (`docs/draft/0003-supabase-update.sql`).
- The order has a completion record (`submit_completion` writes it in the same
  transaction).
- Writes are RPCs; the database resolves the actor from the session.

## Stages

### 1. Prepare the message — `orders_customer_message_trg`

**Input:** The order moving to `job_done`, its `order_completions` row, the technician's name.
**Actions:** An `after update of status` trigger inserts one `customer_messages` row in the same transaction:
- `channel`: `whatsapp` when the customer's number is a Malaysian mobile (`_is_my_mobile`, `^601\d{8,9}$`), otherwise `phone` (landline).
- `phone`: the customer's number, copied.
- `prepared_body` and `body`: `_customer_job_done_message(...)`, in English:
  `Hi {customer}, Job {order_no} has been completed by Technician {name} at {time}. Please check and leave feedback. Thank you!`
  `{time}` is the completion time in Malaysia time, in the app's format (`Fri 23 Oct 2026, 3:30 AM`, `_malaysia_date_time`).
- `status`: `not_sent`.
- `feedback_token` (0005): a random token for a WhatsApp message (none for a landline). The text actually sent is `body` plus a fixed last line `Leave feedback: <address>/f/<token>` that editing cannot remove (`docs/0005-customer-feedback-workflow.md` stage 2).
**Output:** A new row for every Job Done; a rework resubmission adds a new row and the screens show the newest one. Earlier rows stay.
**On failure:** The trigger runs inside `submit_completion`; if it fails the whole submission rolls back. With no completion record (not reachable today) it uses now() and the assigned technician.

### 2. Show the message — `latest_customer_messages`

**Reads:** The newest row per order, with the editor's and confirmer's names (`security_invoker` view; RLS: whoever can read the order, since 0004: the assigned technician, Admins, Finance, and Managers of the branch).
**Where:** The **Customer message** panel (`CustomerMessagePanel`) on the technician's job page (above the customer details), on the Admin order detail (above the order details), and on the Manager / Finance order page (0004: Managers can send it on behalf of the technician, Finance reads it), while the order is Job Done, Reviewed or Closed. Nothing is shown in other statuses or when there is no message.
**Panel:**
- WhatsApp: "Message to the customer" with the text; "Edited by X at T" and **Show original** / **Hide original** when edited; **Send to customer on WhatsApp** and **Edit message**.
- Landline: "No WhatsApp number for this customer (landline). Call them instead." and **Call the customer** (`tel:+60…`).
- Not sent: the **Customer not told yet** badge in the panel heading.
- Sent: "Sent by X at T" / "Told by phone by X at T"; the buttons stay visible but disabled for good.
**Refresh:** When the page becomes visible again or the connection returns, and after every edit or confirmation. On the Admin order detail the history list reloads too.
**On failure:** "Could not load the customer message." with the message and **Try again**.

### 3. Edit before sending — `edit_customer_message(p_message_id, p_body)`

**Who / when:** The assigned technician or an Admin (not Managers, 0004); order Job Done, Reviewed or Closed; the order's newest message; WhatsApp channel; still `not_sent`.
**Form:** **Edit message** opens "Message to send to the customer" (pre-filled, "1 to 1,000 characters. The original is kept.") with **Cancel** and **Save message**. The text is trimmed; empty or over 1,000 characters is refused on the field. Saving unchanged text closes the form without a database call.
**Output:** `body`, `edited_by`, `edited_at` updated; `prepared_body` never changes. Audit `customer_message_edited` with the previous and new text.

### 4. Send on WhatsApp and confirm — `confirm_customer_message(p_message_id)`

**Send:** **Send to customer on WhatsApp** opens `https://wa.me/<phone>?text=<body>` in a new tab; the person presses Send in WhatsApp. The same tap opens "Have you sent it to the customer?" ("Tap Yes only after you pressed Send in WhatsApp. You cannot undo this.") with **No, not yet** and **Yes, I sent it**.
**No:** Closes the question; nothing changes.
**Yes:** Same who / when rules as stage 3 (any channel), plus a Manager covering the branch (0004), whose WhatsApp text is the on-behalf version (`docs/0004-review-and-close-workflow.md` stage 4). Sets `sent`, `confirmed_by`, `confirmed_at` under the order row lock. Audit `customer_messaged` with channel, phone, the text sent and whether it was edited. The panel shows "Sent by X at T", disables Send and Edit, and the badge clears everywhere.
**On failure:** No signal → the question stays open with the error so Yes can be tapped again. Any other refusal → the question closes, the message is shown, and the panel reloads (so "Already sent by X at T" ends with the sent state on screen).

### 5. Landline: call and confirm — `confirm_customer_message(p_message_id)`

**Call:** **Call the customer** dials the number and opens "Did the customer pick up, and did you tell them the job is done?" ("Tap Yes only if you spoke to the customer. You cannot undo this.") with **No, not yet** and **Yes, I told them by phone**.
**Yes:** Sets `told_by_phone`, who and when; audit `customer_called` with the number. The panel shows "Told by phone by X at T".
**On failure:** As stage 4 ("Already told by phone by X at T").

### 6. Not-told flag

`customerNotTold(latest, orderStatus)`: the newest message is `not_sent` and the order is Job Done, Reviewed or Closed. Shown as **Customer not told yet** on:
- the technician's job cards on the **Submitted** tab (`fetchLatestCustomerMessages` for the tab's orders),
- the Customer message panel (job page and Admin order detail).
After a rework return the order is In Progress, so the old unsent message shows no badge until the job is Job Done again (with its new message).

### 7. History

The Admin order detail's history names the three events: "Edited the customer message" (From / To), "Sent the customer message on WhatsApp" (to the formatted number, "(text was edited)" when it was, and the message), "Told the customer by phone" (Called the number).

### 8. Orders finished before 0003

The migration wrote one `not_sent` message for every order already Job Done, Reviewed or Closed that had a completion record, using that record's time and technician. They behave like any other message.

## Error States

| Error | Cause | Handling |
|---|---|---|
| "Only the assigned technician, an Admin or a Manager of the branch can send the customer message of an order" | Other technician, Finance, Manager of another branch (0004 wording) | Rejected by both RPCs |
| "Managers send the prepared message as it is; only the assigned technician or an Admin can edit it" | A covering Manager editing (0004) | Rejected |
| "A customer message can only be edited / confirmed while the order is Job Done, Reviewed or Closed (it is currently X)" | Order returned for rework or cancelled | Rejected |
| "A newer message has been prepared for this order. Reload the page to see it." | An older message after a rework resubmission | Rejected |
| "Already sent by X at T" / "Already told by phone by X at T" | Message already confirmed (the other person got there first) | Rejected; the panel reloads to the sent state |
| "Only a WhatsApp message can be edited (this customer has no WhatsApp number)" | Edit on a landline message | Rejected (the screen offers no Edit) |
| "Enter the message to send" / "The message can be at most 1,000 characters" | Empty or too-long edit | On the field (screen) or alert (database) |
| "Message not found" | Unknown id | Rejected |
| "Customer messages cannot be deleted" / "A confirmed customer message cannot be changed" / "Only the text and the confirmation of a customer message can change" | Direct table change (any role, incl. the owner) | Rejected by `customer_messages_guard_trg` |
| "Could not reach the server. Check your connection and try again." | Network failure | Edit form / question stay open for another try |
| "Could not load the customer message." | Read failed | Try again; on the Submitted tab the whole list shows "Could not load your jobs" |

## Defaults

| Setting | Default |
|---|---|
| Language | English (the brief's wording) |
| Time format | `Fri 23 Oct 2026, 3:30 AM`, Malaysia time |
| Statuses offering the message | Job Done, Reviewed, Closed (`CUSTOMER_MESSAGE_STATUSES`) |
| Edited text | 1 – 1,000 characters, trimmed |
| Undo after confirming | None |
| Who can see messages | Whoever can read the order (0004): assigned technician, Admins, Finance, Managers of the branch |

## Behavioral Constraints

- Writes go only through `edit_customer_message` and
  `confirm_customer_message`; the table and view are read-only for
  `authenticated` and closed to `anon`.
- Rows are never deleted and a confirmed row never changes again; cleanup of
  test orders has to switch `customer_messages_guard_trg` off inside its
  transaction (as with the audit log).
- The app cannot see the Send press inside WhatsApp; "sent" means the person
  confirmed it.
- `isMyMobile` = `_is_my_mobile`, `formatMalaysiaDateTime` =
  `_malaysia_date_time`, the edited-text rule, the statuses and the states
  exist in both `src/domain/customerMessages.ts` and SQL;
  `tests/db/parity.test.ts` runs the same cases through both.
- The screen trims Unicode spaces; the database trims spaces, tabs and line
  breaks. Text made only of non-breaking spaces is refused by the screen but
  not by the database.
- 0005 (`customer-feedback`) adds the feedback link as a fixed last line
  after `body` (`_customer_message_full_text`); `_customer_job_done_message`
  is unchanged. The `customer_messaged` audit entry records the full text.

## Related Documents

| Document | Type | Relationship |
|---|---|---|
| `docs/prd/0003-whatsapp-notification-prd.md` | Intent | Product goals this workflow fulfills |
| `docs/plan/0003-whatsapp-notification-plan.md` | Plan | Architecture this workflow implements |
| `docs/0000-system-foundation-workflow.md` | Workflow | `submit_completion`, which reaches Job Done |
| `docs/0001-admin-order-portal-workflow.md` | Workflow | Admin order detail that hosts the panel |
| `docs/0002-technician-job-portal-workflow.md` | Workflow | Job page and job list that host the panel and the flag |
| `docs/reference/folder-structure.md` | Reference | File locations of workflow components |
| `docs/decisions/0008-whatsapp-notification-implementation-details.md` | Decision log | Divergences from the 0003 PRD and plan |
| `docs/0004-review-and-close-workflow.md` | Workflow | Manager sending on behalf; approval waits for this message |
| `docs/0005-customer-feedback-workflow.md` | Workflow | Feedback link line added to this message |
