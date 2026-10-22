# 0008 - WhatsApp Notification Implementation Details

> **Date:** 2026-10-23 | **Status:** Accepted

<!-- AI Context
Role: This is an append-only record of a single implementation divergence.
Each entry captures why the deviation happened and what it affects.
Never edit an existing decision log entry. To reverse a previous decision,
create a new entry that references the original. After adding an entry,
check the impact checklist below and update affected workflow or reference
docs before the session ends.
-->

## Context

Building feature 0003 (`docs/prd/0003-whatsapp-notification-prd.md`,
`docs/plan/0003-whatsapp-notification-plan.md`) added one product behavior
the approved PRD did not have, and surfaced details the plan did not spell
out. The manual check on hosted Supabase confirmed how they behave.

## Decision

- **Edit before sending (extends the PRD).** Plan answer P2: the assigned
  technician or an Admin can change the WhatsApp text before it is confirmed
  sent. `prepared_body` keeps the database's text, `body` is what is sent;
  the panel shows "Edited by X at T" with Show original, and the history
  records the previous and new text. A confirmed message stays locked, as the
  PRD says (plan P5: no undo; an Admin reset was considered and dropped).
- **Badge takes the order status.** After a rework return the old unsent
  message is still the newest until the job is resubmitted; `customerNotTold`
  also checks that the order is Job Done, Reviewed or Closed, so an In
  Progress job shows no badge.
- **Guard trigger on `customer_messages`.** Beyond the plan's checks,
  `customer_messages_guard_trg` refuses deletes, any change to a confirmed
  row, and any change to the prepared text, for every role including the
  owner. Test-order cleanup switches it off inside its transaction, like the
  audit log.
- **Trigger fallback.** With no completion record the trigger uses now() and
  the assigned technician; `submit_completion` never reaches this path.
- **The panel loads its own data.** `CustomerMessagePanel` takes the order
  id, status and whether the person may act, reads the newest message
  itself, and reports writes through `onChange`; the Admin order detail uses
  it to reload the history. The badge sits in the panel heading and is also
  used on the job cards.
- **No call for unchanged text.** Saving an edit with identical text closes
  the form without writing an "edited" entry.
- **Retry on lost signal only.** A network error keeps the "Have you sent
  it?" question open so Yes can be tapped again; any other refusal closes it,
  shows the message and reloads the panel.
- **Landline wording.** A second confirmation of a landline message reads
  "Already told by phone by X at T" (the plan named only "Already sent by").
- **Job list read.** If reading the messages fails on the Submitted tab, the
  whole list shows "Could not load your jobs" rather than hiding the badges.
- **Hosted SQL file name.** `docs/draft/0003-supabase-update.sql`, like the
  earlier features (the plan first said `0003-hosted.sql`).
- **Trim difference.** The screen trims Unicode spaces; the database trims
  spaces, tabs and line breaks. Text of only non-breaking spaces passes the
  database; no parity case covers it.
- **Second-role preview.** `.claude/launch.json` gained `web-second-role`
  (Vite on `http://[::1]:5174`) for checking a second signed-in role.

## Reason

Editing was the user's choice while answering the plan questions, so a
technician can fix or personalise the message without losing what the
system prepared. The rest keep "never deleted, no undo" true in the database
itself, avoid a false "not told" flag during rework, and keep the screens
honest when two people act at once. The manual check on hosted Supabase
(trigger, edit, Send link, Yes / No, landline call, first-confirmation-wins,
badges, Admin history) passed with them.

## Impact

- [x] Workflow doc updated
- [x] Reference doc updated
- [ ] No upstream doc update needed
