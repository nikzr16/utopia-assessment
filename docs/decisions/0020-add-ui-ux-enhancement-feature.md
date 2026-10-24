# 0020 - Add UI/UX Enhancement Feature

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

Features 0000–0010 are shipped and live at
`https://sejuk-sejuk-utopia.vercel.app`, and every roadmap phase (1–5) has
graduated. Each feature built its screens with a few shared Tailwind class
strings (`src/components/styles.ts`), so the app works on desktop and phone
but looks like a prototype: no brand, no icons, plain tabs that wrap or run
off a phone screen, long phone pages and no shared empty / loading / success
patterns. The brief's "Design & Branding" section asks for a clean UI,
simple UX and practical design for a real-world internal operations tool.

## Decision

Add feature 0011 `ui-ux-enhancement` in a new roadmap Phase 6 (Polish),
after Phase 5. It redesigns every screen, portal and public page on one
design system. It changes no database object, Edge Function, rule, route
or permission; any idea that needs one is listed as a follow-up.

## Reason

Doing the redesign once, after every screen exists and is live, keeps one
consistent design and avoids reworking screens feature by feature. A
UI-only scope keeps the live app's data and rules safe.

## Impact

- [ ] Workflow doc updated (written at the end of 0011)
- [ ] Reference doc updated (at the end of 0011, for new shared components)
- [x] No upstream doc update needed (roadmap updated for the new phase and
  feature; `CLAUDE.project.md` is updated when 0011 ships)
