# 0005 - Auth Implementation Hardening

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

Implementing decision 0004 (real authentication) surfaced details the plan
did not spell out.

## Decision

- **Only confirmed emails are linked.** The `auth.users` trigger and
  `link_staff_accounts()` link a sign-in account to a staff row only when
  `email_confirmed_at` is set; the trigger also fires when that column is
  updated. The plan said only "link by email".
- **Migrations fail loudly without Supabase roles.** The auth link and access
  migrations raise an error if `anon`, `authenticated`, or `service_role` is
  missing, instead of silently skipping.
- **`anon` keeps schema `USAGE`** (PUBLIC has it by default) but has no table,
  view, sequence, or function privileges and no policies.
- **Login script safeguards.** `npm run auth:create-staff-logins` refuses a
  publishable key in the secret-key slot, decides "linked" by re-reading
  `staff`, and exits non-zero if any account failed or is unlinked.
- **Extra app states.** "Could not load your profile" (Try again / Sign out);
  an unknown role counts as no profile; a missing branch shows "All branches".

## Reason

Linking unconfirmed emails would let anyone who registers a staff member's
address take over that profile if public sign-up were ever left on. Failing
loudly avoids a "successful" migration that grants nothing. The script and app
states make setup errors visible instead of silent.

## Impact

- [x] Workflow doc updated
- [x] Reference doc updated
- [ ] No upstream doc update needed
