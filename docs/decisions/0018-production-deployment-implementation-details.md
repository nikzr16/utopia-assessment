# 0018 - Production Deployment Implementation Details

> **Date:** 2026-10-24 | **Status:** Accepted

<!-- AI Context
Role: This is an append-only record of a single implementation divergence.
Each entry captures why the deviation happened and what it affects.
Never edit an existing decision log entry. To reverse a previous decision,
create a new entry that references the original. After adding an entry,
check the impact checklist below and update affected workflow or reference
docs before the session ends.
-->

## Context

Feature 0010 (`docs/prd/0010-production-deployment-prd.md`,
`docs/plan/0010-production-deployment-plan.md`) put the app on Vercel, set
every address-dependent setting, and was checked end to end on the live app:
Admin and Finance on a desktop, technician and Manager on the user's phone,
the customer feedback link from the phone, an invite email opened on the
phone, and every AI feature. The details below differ from the PRD or the
plan.

## Decision

1. **Live address `sejuk-sejuk-utopia.vercel.app` (PRD Q1).**
   `sejuk-sejuk.vercel.app`, `sejuk-sejuk-ops` and `sejuk-sejuk-service` were
   already taken by other projects; the user chose "sejuk sejuk utopia".
   Vercel's own `sejuk-sejuk-theta.vercel.app` also points at production and
   is kept (handy as a second origin for a second signed-in role).
2. **The 7 demo technicians exist only on the hosted project (plan Q-P5).**
   Adding them to `supabase/seed.sql` changed the team in 10 earlier
   database tests (empty branches, team averages, name search). They are
   inserted by `docs/draft/0010-supabase-update.sql`; the seed keeps the 12
   staff (with the new email shape).
3. **`APP_ORIGINS` is replaced by `APP_URL` (plan Q-P1).** `staff-access`
   no longer reads `APP_ORIGINS` or a local address list; the browser no
   longer sends `redirectTo`. Supabase Redirect URLs list only the live
   `/auth/confirm`. Local invite links therefore open the live app (PRD Q13).
4. **Demo data details (plan "Demo data", Q-P4, Q-P6, Q-P7).**
   - Demo orders are marked by the admin note "Demo data (0010)" instead of
     an order-number range; the script refuses to run twice.
   - Payments are cash only (a receipt needs a real file in Storage).
   - No demo job has a photo, so each carries the "Job done but no photos"
     warning, checked by the Manager on approved jobs (user's choice).
   - Every staff member's first history line and joined date are moved to
     60 days before loading, so the KPI pages count them as active in the
     demo weeks.
   - Loaded on 2026-10-24 (238 orders from 11 Sep; 7 waiting for review;
     the AI checked the 5 newest).
5. **`live-check` before the release.** Run from this computer on the live
   app (still 0009 code): the app checks passed; the no-index header and
   `robots.txt` failed as expected, because `vercel.json` and
   `public/robots.txt` reach production with the 0010 release. Acceptance
   criteria 13–16 (GitHub `ci` on a pull request, the robot after a
   production deploy, the wake-up run, the no-index signal) are verified on
   the 0010 release pull request.
6. **Extra safety headers** (`nosniff`, `strict-origin-when-cross-origin`,
   `X-Frame-Options: DENY`) and a `<meta name="robots">` tag join the
   no-index header; `ci` also runs `validate_config.py`.

## Reason

Names on `vercel.app` are first come, first served; keeping earlier tests
unchanged is safer than rewriting them for demo-only staff; one address for
email links is what the user chose; GitHub runs deployment and scheduled
workflows only from `main`.

## Impact

- [x] Workflow doc updated (`docs/0010-production-deployment-workflow.md`
  new; 0005 and 0006 workflow docs)
- [x] Reference doc updated (`docs/reference/folder-structure.md`)
- [x] Upstream docs updated (roadmap, README, `CLAUDE.project.md`)
