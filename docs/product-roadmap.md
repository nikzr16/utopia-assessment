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
**Graduation criteria:** An order can go from creation to Closed through the app's screens (0001–0003 shipped).

| PRD | Module | Status | Notes |
|---|---|---|---|
| `docs/prd/0001-admin-order-portal-prd.md` | `src/features/orders/`, `supabase/migrations/` | shipped | Brief Module 1 |
| 0002 `technician-job-portal` | — | planned | Brief Module 2; PRD not written yet |
| 0003 `whatsapp-notification` | — | planned | Brief Module 3; PRD not written yet |

### Phase 3: Insights

**Trigger:** Phase 2 shipped.
**Graduation criteria:** KPI dashboard and AI operations query window shipped (0004, 0005).

| PRD | Module | Status | Notes |
|---|---|---|---|
| 0004 `kpi-dashboard` | — | planned | Brief bonus module; PRD not written yet |
| 0005 `ai-ops-query` | — | planned | Brief AI module; PRD not written yet |

### Phase 4: Stretch

**Trigger:** Phase 3 shipped.
**Graduation criteria:** Chosen optional AI challenges shipped (0006).

| PRD | Module | Status | Notes |
|---|---|---|---|
| 0006 `ai-advanced` | — | planned | Optional advanced AI challenges; PRD not written yet |

## Cross-Cutting Concerns

| Concern | Introduced In | Matured In | Current State |
|---|---|---|---|
| Authentication and access (Supabase Auth, RLS, actor from `auth.uid()`) | 0000 | 0000 | Real email/password sign-in; public sign-up off |
| Rule parity (`src/domain` mirrors checked against SQL) | 0000 | 0001 | Transitions, enums, phone, price, editable / reschedulable statuses |
| Deployment (Vercel) | 0001 | — | `vercel.json` SPA rewrite in place; not deployed yet |

## PRD Registry

| PRD | Phase | Module | Status |
|---|---|---|---|
| `docs/prd/0000-system-foundation-prd.md` | 1 – Foundation | `supabase/`, `src/domain/`, `src/features/auth/` | shipped |
| `docs/prd/0001-admin-order-portal-prd.md` | 2 – Core workflow | `src/features/orders/`, `supabase/migrations/` | shipped |

## Prioritization Log

_When a feature moves between phases or priorities shift, record the change and reasoning here. Entries are append-only._

| Date | Change | Reason |
|---|---|---|
| 2026-10-22 | Phases 1–4 defined from the brief's modules (0000–0006) | Build in the order a job moves through the business; insight features need the data the workflow screens create |

## Related Documents

| Document | Type | Relationship |
|---|---|---|
| `docs/documentation-standard.md` | Standard | Governs how all docs are maintained |
| `docs/reference/folder-structure.md` | Reference | Structural placement of modules |
| `docs/decisions/NNNN-*.md` | Decision log | Deviations that may affect roadmap |
