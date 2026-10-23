# 0012 - Add Production Deployment Feature

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

The 0005 customer feedback link must open on the customer's phone, so it
needs a public address. The app is not deployed yet: `vercel.json` exists,
but no Vercel project is set up, and deploying needs the user's Vercel
sign-in and a pushed branch. 0005 PRD Q10 asked whether to deploy inside
0005 or later.

## Decision

0005 is built and tested locally. The feedback link's public address is a
setting kept in the database, set to the local app address for now.

Deploying to Vercel becomes its own feature, 0010 `production-deployment`,
in a new roadmap Phase 5 (Production), after the features chosen for
release. Feature numbers 0001–0009 do not change.

0010 must at least cover (carried forward for its PRD):

- Vercel project for the repository: `dev` as preview, `main` as
  production; `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` set per
  environment; the `vercel.json` SPA rewrite serves deep links such as
  the feedback page.
- Supabase Auth site URL and redirect URLs for the deployed addresses.
- Set the 0005 feedback-link address setting to the production address;
  confirm new Job Done messages carry it.
- End-to-end test of every portal on the deployed app (Admin and Finance
  on desktop, technician and Manager on a phone), each role signed in by
  the user.
- Customer feedback from a real phone: send the Job Done message by
  WhatsApp, open the link signed out, submit, see it on the order; check
  the expired, used, and replaced-link pages and the poor-rating alert.
- Clean up test data on the hosted project afterwards.

## Reason

Production set-up is done once, for every feature, and tested end to end
in one place. 0005 is not blocked on a Vercel account or a push the user
has not asked for.

## Impact

- [ ] Workflow doc updated (0005's workflow doc is written at the end of
  0005)
- [ ] Reference doc updated (no structure change)
- [x] No upstream doc update needed (roadmap and `CLAUDE.project.md`
  updated for the new feature number)
