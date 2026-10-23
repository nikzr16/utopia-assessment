# Product Roadmap

> **Type:** Roadmap | **Must stay current:** Yes -- update when phases, features, or priorities change

<!-- AI Context
Role: This is the top-level sequencing document for the entire product.
It defines development phases, maps PRDs to phases, and captures the
rationale for ordering. Use it to understand *what is being built when*
and *why that order was chosen*.

When a new PRD is created, register it here under the appropriate phase.
When a feature ships or a phase graduates, update the status columns.
When priorities shift, update phase assignments and record the reasoning
in the Prioritization Log below.

Individual PRDs hold feature-level detail. This document holds the
cross-feature ordering logic. Do not duplicate PRD content here.
-->

## Product Vision

An internal operations system that carries every Sejuk Sejuk Service
air-conditioner job from order to payment clearance on one shared data model,
with an AI assistant that answers operational questions from controlled
queries.

## Phasing Strategy

Phases follow the assessment brief's modules and the order a job moves
through the business: the shared foundation first, then the screens for each
step of the job lifecycle, then the insight features that read the data those
screens create, then optional stretch work. A phase graduates when every PRD
in it is shipped (all acceptance criteria passing, including manual checks).

## Phases

### Phase 1: Foundation

**Trigger:** Project kickoff.
**Graduation criteria:** Data model, lifecycle rules, roles, and real sign-in work end to end (0000 shipped).

| PRD | Module | Status | Notes |
|---|---|---|---|
| `docs/prd/0000-system-foundation-prd.md` | `supabase/`, `src/domain/`, `src/features/auth/` | shipped | |

### Phase 2: Core workflow

**Trigger:** Phase 1 shipped.
**Graduation criteria:** An order can go from creation to Closed through the app's screens, customers can leave feedback, and staff are managed on screen (0001–0006 shipped).

| PRD | Module | Status | Notes |
|---|---|---|---|
| `docs/prd/0001-admin-order-portal-prd.md` | `src/features/orders/`, `supabase/migrations/` | shipped | Brief Module 1 |
| `docs/prd/0002-technician-job-portal-prd.md` | `src/features/jobs/`, `src/features/attachments/`, `src/features/notifications/`, `supabase/migrations/` | shipped | Brief Module 2 |
| `docs/prd/0003-whatsapp-notification-prd.md` | `src/features/customer-messages/`, `supabase/migrations/` | shipped | Brief Module 3 |
| `docs/prd/0004-review-and-close-prd.md` | `src/features/review/`, `src/features/finance/`, `src/features/order-review/`, `src/features/payments/`, `supabase/migrations/` | shipped | Manager review and Finance close screens (0002 PRD Q14; 0003 Q10); Manager branch cover; every branch needs a Manager |
| `docs/prd/0005-customer-feedback-prd.md` | `src/features/feedback/`, `supabase/migrations/` | shipped | Private feedback link in the 0003 / 0004 message; public page with no sign-in; staff see ratings; poor ratings alert Managers; data for 0007 |
| 0006 `staff-management` | — | planned | Staff screen: create staff and sign-ins, assign Manager branch cover, deactivate (0004 Q13); PRD not written yet |

### Phase 3: Insights

**Trigger:** Phase 2 shipped.
**Graduation criteria:** KPI dashboard and AI operations query window shipped (0007, 0008).

| PRD | Module | Status | Notes |
|---|---|---|---|
| 0007 `kpi-dashboard` | — | planned | Brief bonus module; PRD not written yet |
| 0008 `ai-ops-query` | — | planned | Brief AI module; PRD not written yet |

### Phase 4: Stretch

**Trigger:** Phase 3 shipped.
**Graduation criteria:** Chosen optional AI challenges shipped (0009).

| PRD | Module | Status | Notes |
|---|---|---|---|
| 0009 `ai-advanced` | — | planned | Optional advanced AI challenges; PRD not written yet |

### Phase 5: Production

**Trigger:** The features chosen for release are shipped.
**Graduation criteria:** The app runs on Vercel (`dev` as preview, `main` as production) against the hosted Supabase project, and every portal and the customer feedback link pass an end-to-end check on real devices (0010 shipped).

| PRD | Module | Status | Notes |
|---|---|---|---|
| 0010 `production-deployment` | — | planned | Vercel set-up and production test of every feature, incl. the 0005 feedback link from a real phone (decision 0012); PRD not written yet |

## Cross-Cutting Concerns

| Concern | Introduced In | Matured In | Current State |
|---|---|---|---|
| Authentication and access (Supabase Auth, RLS, actor from `auth.uid()`) | 0000 | 0005 | Real email/password sign-in; public sign-up off; Managers read and act on the branches they cover (home + additional); signed-out visitors may call only the two feedback page functions, keyed by a random link token |
| Rule parity (`src/domain` mirrors checked against SQL) | 0000 | 0005 | Transitions, enums, phone, price, editable / reschedulable statuses, extra charges, file types / sizes / paths, file and receipt permissions, payment rules, job list tabs, notification events, mobile check, Malaysia time format, customer message rules, branch cover, review / payment tabs, approve / close guards, payment verification, on-behalf message, feedback answers, poor rating, link text and states, phone rating rule |
| Deployment (Vercel) | 0001 | 0010 | `vercel.json` SPA rewrite in place; not deployed yet; 0005 feedback links use a database setting for the public address (local for now) |
| File storage (Supabase Storage) | 0002 | 0002 | Private `job-files` bucket; policies follow order visibility; files registered by RPC from the stored object's real type and size |
| Live updates (Supabase Realtime) | 0002 | 0002 | `notifications` streamed to the recipient under RLS; refresh on return as a fallback |
| In-app notifications UI | 0002 | 0005 | Technicians, Managers and Finance (bell and list open the order in each portal); Managers also get poor-rating notices; Admins have none |

## PRD Registry

| PRD | Phase | Module | Status |
|---|---|---|---|
| `docs/prd/0000-system-foundation-prd.md` | 1 – Foundation | `supabase/`, `src/domain/`, `src/features/auth/` | shipped |
| `docs/prd/0001-admin-order-portal-prd.md` | 2 – Core workflow | `src/features/orders/`, `supabase/migrations/` | shipped |
| `docs/prd/0002-technician-job-portal-prd.md` | 2 – Core workflow | `src/features/jobs/`, `src/features/attachments/`, `src/features/notifications/`, `supabase/migrations/` | shipped |
| `docs/prd/0003-whatsapp-notification-prd.md` | 2 – Core workflow | `src/features/customer-messages/`, `supabase/migrations/` | shipped |
| `docs/prd/0004-review-and-close-prd.md` | 2 – Core workflow | `src/features/review/`, `src/features/finance/`, `src/features/order-review/`, `src/features/payments/`, `supabase/migrations/` | shipped |
| `docs/prd/0005-customer-feedback-prd.md` | 2 – Core workflow | `src/features/feedback/`, `supabase/migrations/` | shipped |

## Prioritization Log

_When a feature moves between phases or priorities shift, record the change and reasoning here. Entries are append-only._

| Date | Change | Reason |
|---|---|---|
| 2026-10-22 | Phases 1–4 defined from the brief's modules (0000–0006) | Build in the order a job moves through the business; insight features need the data the workflow screens create |
| 2026-10-22 | Manager review and Finance close screens are to be scoped in the 0003 PRD | Not part of Module 2 (0002 PRD Q14); Phase 2 cannot graduate without a screen path to Closed |
| 2026-10-22 | Manager review and Finance close screens moved to new PRD 0007 `review-and-close`; customer feedback moved to new PRD 0008 `customer-feedback`; both in Phase 2 after 0003 | Neither is WhatsApp notification (0003 Q6, Q10); review/close first because Phase 2 needs a screen path to Closed |
| 2026-10-23 | Features renumbered in build order: review-and-close 0007 → 0004, customer-feedback 0008 → 0005, kpi-dashboard 0004 → 0006, ai-ops-query 0005 → 0007, ai-advanced 0006 → 0008 (decision 0009) | Feature numbers now follow the order they are built; earlier rows keep the old numbers |
| 2026-10-23 | New feature 0006 `staff-management` in Phase 2 after 0005; kpi-dashboard 0006 → 0007, ai-ops-query 0007 → 0008, ai-advanced 0008 → 0009 (decision 0010) | 0004 Q13 requires a Manager in every branch; a staff screen keeps that manageable without SQL, and numbers keep following the build order |
| 2026-10-23 | New Phase 5 Production with feature 0010 `production-deployment` (decision 0012) | 0005 Q10: build and test locally now; deploy to Vercel and test everything, incl. the feedback link on a real phone, once in its own phase |

## Related Documents

| Document | Type | Relationship |
|---|---|---|
| `docs/documentation-standard.md` | Standard | Governs how all docs are maintained |
| `docs/reference/folder-structure.md` | Reference | Structural placement of modules |
| `docs/decisions/NNNN-*.md` | Decision log | Deviations that may affect roadmap |
