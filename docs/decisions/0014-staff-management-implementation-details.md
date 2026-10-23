# 0014 - Staff Management Implementation Details

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

Feature 0006 (`docs/prd/0006-staff-management-prd.md`,
`docs/plan/0006-staff-management-plan.md`) was built, reviewed by an
independent security pass, and checked on the hosted project. One product
decision changed and several details differ from the plan.

## Decision

1. **Only Admins change a staff member's email** (changes PRD Q1 / Q4). A
   Manager could otherwise change a technician's email to an address they
   own, send a password reset there, and act as that technician. Managers
   still edit their technicians' name, phone and home branch; the email field
   is disabled for them ("Only an Admin can change an email (it is how they
   sign in)") and `_staff_manage_error` refuses it. Decided by the user after
   the security review.
2. **An unused invite is started over, never confirmed.** Changing the email
   of someone who has not set a password, or sending their invite again,
   removes the unused sign-in and invites a fresh one to the current email
   (the plan changed the sign-in email, which confirms it, so it could no
   longer be invited). A person with a password keeps their sign-in; only its
   email changes.
3. **The server function answers with fixed sentences.** Only database rule
   messages (`P0001`) pass through; Auth / SMTP / other database errors become
   fixed sentences ("The email could not be sent…", "This email cannot be
   used for a new sign-in…") and the raw text goes to the function log, so a
   Manager cannot probe which emails have sign-ins.
4. **Email links open only the app's own addresses.** The function accepts
   `redirectTo` only for `/auth/confirm` of `DEFAULT_APP_ORIGINS` (the local
   ports) plus the `APP_ORIGINS` function secret (0010). Supabase's redirect
   list rejects `[::1]`, so a tab on `[::1]` / `127.0.0.1` asks for the same
   port on `localhost` (`confirmAddress`).
5. **"(inactive)" tags use one shared list of inactive staff ids**
   (`src/lib/staffStatus.ts`), read once per page load under RLS and refreshed
   after a deactivate / reactivate, instead of adding an `active` flag to
   every read (plan P6). `order_review_summary` gains only the ids behind its
   names (`completion_technician_id`, `reviewed_by_id`, `closed_by_id`); the
   other reads already carried ids. History detail text written at the time
   ("Assigned to Bala") is not tagged.
6. **Last active Admin / Finance check takes a per-role advisory lock** at
   commit, so two people deactivating each other at the same moment cannot
   both pass.
7. **Migration details for a project that already has staff.** `left_at` is
   kept by its own trigger (`staff_left_at_trg`); after the backfill the
   migration runs `set constraints all immediate` (the 0004 commit check
   would otherwise block the later `alter table staff`).
8. **Staff history and test cleanup.** History rows go with a deleted staff
   row (`on delete cascade`), and an actor who is deleted becomes null; any
   other change is still refused. Staff are never deleted in the app; this
   lets test cleanup remove test staff.
9. **A deactivated person can read their own staff row** (`staff_read_own`),
   which the live sign-out needs. Earlier access tests that expected an
   inactive account to read nothing now allow exactly that one row; tests
   that deactivate a technician who still owns jobs (the rework case) use a
   helper that skips the open-jobs rule.
10. **Sign-in state after opening a link.** Pressing Continue on an invite
    confirms the email, so someone who stops before saving a password shows
    "Can sign in" and is offered a password reset rather than a new invite.
11. **Sign-in refusal text.** A blocked (deactivated) sign-in now reads "Your
    account is no longer active. Ask your administrator if this is a
    mistake." (was "This account has been disabled…").
12. **Small structural choices.** The pager moved to `src/components/Pager.tsx`
    (orders and staff lists); `supabase/config.toml` sets the function's JWT
    check off and it is deployed with `--use-api` (no Docker).
13. **Fix from the manual check.** The staff page's "Saved / added" banner no
    longer comes back after a page reload.

## Reason

Items 1–4 close the security review's findings without changing the PRD's
flow for Admins; items 5–13 fit the existing schema, keep the hosted
migration safe, or match what the user saw during the check.

## Impact

- [x] Workflow doc updated (`docs/0006-staff-management-workflow.md`; 0004 stage 0 and 0000 stage 0 notes)
- [x] Reference doc updated (`docs/reference/folder-structure.md`)
- [x] Upstream: roadmap (0006 shipped, Phase 2 graduated), `CLAUDE.project.md`
