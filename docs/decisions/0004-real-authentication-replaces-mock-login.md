# 0004 - Real Authentication Replaces The Mock Login

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

The first 0000 build followed the brief's minimum: a mock role switcher, with
every RPC taking a client-supplied `p_actor_id`. The role switcher passed its
manual check against hosted Supabase, but it lets anyone act as any staff
member and leaves all data readable without signing in.

## Decision

Replace the mock login with real Supabase Auth (email + password) inside 0000,
before 0000 ships:

- RPCs no longer take `p_actor_id`; the actor is `auth.uid()` resolved to an
  active `staff` row by `_require_actor()`. This also changes the
  `technician_jobs` signature recorded in decision 0002 to `technician_jobs()`.
- `staff` gains `email` and `auth_user_id`; a trigger on `auth.users` links
  accounts to staff by email.
- RLS grants read access to `authenticated` staff only (technicians limited to
  their own jobs); `anon` gets nothing.
- The role switcher is replaced by a sign-in screen; accounts are provisioned
  by a script, and public sign-up is off.

The PRD and plan were updated in a deliberate re-planning step, since this
changes product direction rather than diverging during coding.

## Reason

The brief's mock login is a floor, not the target. A real internal operations
tool must know who is acting and must not expose customer and payment data to
anyone with the URL. Doing it now, before modules 0001–0006 are built on the
actor-parameter contract, avoids reworking every screen later.

## Impact

- [x] Workflow doc updated
- [x] Reference doc updated
- [ ] No upstream doc update needed
