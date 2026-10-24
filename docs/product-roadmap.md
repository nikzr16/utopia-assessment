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
| `docs/prd/0006-staff-management-prd.md` | `src/features/staff/`, `supabase/migrations/`, `supabase/functions/` | shipped | Staff screen: list, add with an invite email, edit, Manager branch cover, deactivate (instant sign-out) / reactivate within the 0004 rules (0004 Q13); staff history and joined / left dates for 0007; only Admins change emails (decision 0014) |

### Phase 3: Insights

**Trigger:** Phase 2 shipped.
**Graduation criteria:** KPI dashboard and AI operations query window shipped (0007, 0008).

| PRD | Module | Status | Notes |
|---|---|---|---|
| `docs/prd/0007-kpi-dashboard-prd.md` | `src/features/kpi/`, `supabase/migrations/` | shipped | Brief bonus module: week and month technician KPIs (jobs completed on Manager approval, amount, collected, postpone / reschedule, returns, ratings); cards, leaderboard, Recharts charts, branch comparison, drill-down, CSV; technicians see only My week; five role-scoped `kpi_*` read functions for 0008 (decision 0015) |
| `docs/prd/0008-ai-ops-query-prd.md` | `src/features/ask/`, `supabase/functions/`, `supabase/migrations/` | shipped | Brief AI module: floating Ask chat for all staff roles (technicians own jobs only); OpenAI `gpt-6-luna` via an Edge Function; the AI picks up to 3 whitelisted lookups (0007 `kpi_*`, job list, name search, payments, customers), run as the person asking; short answer + record table; saved chats and Admin log kept 7 days; limitations handled openly; README lists query types and limits; plain-words "How I found this" without technical details (decision 0016) |

### Phase 4: Stretch

**Trigger:** Phase 3 shipped.
**Graduation criteria:** Chosen optional AI challenges shipped (0009).

| PRD | Module | Status | Notes |
|---|---|---|---|
| `docs/prd/0009-ai-advanced-prd.md` | `src/features/supervisor/`, `src/features/orders/`, `src/features/kpi/`, `src/features/ask/`, `supabase/functions/`, `supabase/migrations/` | shipped | All three optional AI challenges on the 0008 pattern: Workflow Supervisor (rule + AI warnings at Job Done, started by the database; each checked before Approve), Document Understanding (Read from photo on the New Order form, all or nothing, form file kept), Operational Insight (Dashboard card + Ask `workload_insights`; Managers and Admins); Admin AI log (decision 0017) |

### Phase 5: Production

**Trigger:** The features chosen for release are shipped.
**Graduation criteria:** The app runs on Vercel (`dev` as preview, `main` as production) against the hosted Supabase project, and every portal and the customer feedback link pass an end-to-end check on real devices (0010 shipped).

| PRD | Module | Status | Notes |
|---|---|---|---|
| `docs/prd/0010-production-deployment-prd.md` | `vercel.json`, `.github/workflows/`, `README.md`, `supabase/`, `src/features/staff/` | shipped | Vercel `sejuk-sejuk-utopia.vercel.app` (`main` production, `dev` private preview, one Supabase project); CI/CD on GitHub Actions (checks on `dev` and `dev` → `main` pull requests, robot visit after each live deploy, daily wake-up); email and feedback links on the live address (`APP_URL`); staff emails `name.role.branch@sejuk.example.com`; demo data and 7 demo technicians on the hosted project; end-to-end check on live (technician and Manager on a real phone, the feedback link from a real phone); full project README (decisions 0012, 0018) |

### Phase 6: Polish

**Trigger:** Phase 5 shipped (every planned feature live).
**Graduation criteria:** Every screen of every role and the customer feedback page use one design system and pass the desktop, tablet and phone checks, light and dark if chosen, with Technician, Manager and the feedback page on a real phone (0011 shipped).

| PRD | Module | Status | Notes |
|---|---|---|---|
| `docs/prd/0011-ui-ux-enhancement-prd.md` | `src/components/`, `src/features/*/`, `src/index.css`, `src/App.tsx` | shipped | UI/UX redesign of every screen and portal: design system, brand, navigation per role, states, toasts, charts, Ask, sign-in / email-link and customer feedback pages, accessibility; no data, rule or permission changes; EN / BM customer page; notifications as compact one-line rows (decisions 0020, 0021) |

## Cross-Cutting Concerns

| Concern | Introduced In | Matured In | Current State |
|---|---|---|---|
| Authentication and access (Supabase Auth, RLS, actor from `auth.uid()`) | 0000 | 0006 | Real email/password sign-in; public sign-up off; Managers read and act on the branches they cover (home + additional); signed-out visitors may call only the two feedback page functions, keyed by a random link token; staff and sign-ins managed on screen: invite / reset emails (custom SMTP), the `staff-access` Edge Function is the only holder of the secret key, deactivation blocks sign-in and signs the person out at once |
| Rule parity (`src/domain` mirrors checked against SQL) | 0000 | 0007 | Transitions, enums, phone, price, editable / reschedulable statuses, extra charges, file types / sizes / paths, file and receipt permissions, payment rules, job list tabs, notification events, mobile check, Malaysia time format, customer message rules, branch cover, review / payment tabs, approve / close guards, payment verification, on-behalf message, feedback answers, poor rating, link text and states, phone rating rule, staff name / email, phone by role, open jobs, who may manage whom, staff history actions, KPI week / month starts, tie ranking, needs attention |
| Deployment (Vercel) and CI/CD | 0001 | 0010 | Live at `https://sejuk-sejuk-utopia.vercel.app` from `main`; `dev` is a private preview; only `main` / `dev` build; no-index headers; releases are `dev` → `main` pull requests merged by the user; GitHub Actions run tests, typecheck and build on every change, a headless-browser robot visit after each production deploy, and a daily Supabase wake-up; feedback links (`feedback_link_base`) and every email link (`staff-access` `APP_URL`) use the live address |
| AI features (OpenAI via Edge Functions) | 0008 | 0009 | `gpt-6-luna` behind the `ask` and `ai-assist` Edge Functions (key in their secrets); the AI only chooses from a fixed menu of read functions run with the person's token (Ask), or returns strict JSON the server checks (job checks, form reading, insight wording); rules and numbers always come from the database; the database starts the job check itself (`pg_net`, a Vault secret); no phone numbers or addresses sent as text; warnings kept with the order, AI calls in the Admin AI log for 7 days (nightly `pg_cron` purge); no app rate limits (OpenAI spend cap) |
| File storage (Supabase Storage) | 0002 | 0009 | Private `job-files` bucket; policies follow order visibility; files registered by RPC from the stored object's real type and size; the paper order form at `<order>/form/` (0009) |
| Live updates (Supabase Realtime) | 0002 | 0009 | `notifications` streamed to the recipient under RLS; a person's own `staff` row streamed so deactivation signs them out at once (0006); an order's warnings and AI checks (0009); refresh on return as a fallback |
| In-app notifications UI | 0002 | 0005 | Technicians, Managers and Finance (bell and list open the order in each portal); Managers also get poor-rating notices; Admins have none |
| Design system and app frame (UI) | 0011 | 0011 | Named colour tokens for light and dark (device setting or the account menu), Poppins and Lucide bundled, one frame per role (sidebar ≥ 1024 px, icon rail on tablets, bottom tabs on phones), shared page patterns (tables / phone cards, folding filters, sticky action bar, skeletons, empty / error states, toasts), draggable Ask button, branded sign-in and customer page with EN / BM; axe checks in `npm test` (decisions 0020, 0021) |

## PRD Registry

| PRD | Phase | Module | Status |
|---|---|---|---|
| `docs/prd/0000-system-foundation-prd.md` | 1 – Foundation | `supabase/`, `src/domain/`, `src/features/auth/` | shipped |
| `docs/prd/0001-admin-order-portal-prd.md` | 2 – Core workflow | `src/features/orders/`, `supabase/migrations/` | shipped |
| `docs/prd/0002-technician-job-portal-prd.md` | 2 – Core workflow | `src/features/jobs/`, `src/features/attachments/`, `src/features/notifications/`, `supabase/migrations/` | shipped |
| `docs/prd/0003-whatsapp-notification-prd.md` | 2 – Core workflow | `src/features/customer-messages/`, `supabase/migrations/` | shipped |
| `docs/prd/0004-review-and-close-prd.md` | 2 – Core workflow | `src/features/review/`, `src/features/finance/`, `src/features/order-review/`, `src/features/payments/`, `supabase/migrations/` | shipped |
| `docs/prd/0005-customer-feedback-prd.md` | 2 – Core workflow | `src/features/feedback/`, `supabase/migrations/` | shipped |
| `docs/prd/0006-staff-management-prd.md` | 2 – Core workflow | `src/features/staff/`, `supabase/migrations/`, `supabase/functions/` | shipped |
| `docs/prd/0007-kpi-dashboard-prd.md` | 3 – Insights | `src/features/kpi/`, `supabase/migrations/` | shipped |
| `docs/prd/0008-ai-ops-query-prd.md` | 3 – Insights | `src/features/ask/`, `supabase/functions/`, `supabase/migrations/` | shipped |
| `docs/prd/0009-ai-advanced-prd.md` | 4 – Stretch | `src/features/supervisor/`, `src/features/orders/`, `src/features/kpi/`, `src/features/ask/`, `supabase/functions/`, `supabase/migrations/` | shipped |
| `docs/prd/0010-production-deployment-prd.md` | 5 – Production | `vercel.json`, `.github/workflows/`, `README.md`, `supabase/`, `src/features/staff/` | shipped |
| `docs/prd/0011-ui-ux-enhancement-prd.md` | 6 – Polish | `src/components/`, `src/features/*/`, `src/index.css`, `src/App.tsx` | shipped |

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
| 2026-10-23 | Phase 2 graduated: 0001–0006 shipped (0006 staff management last) | Every graduation criterion met: an order goes from creation to Closed on screen, customers leave feedback, staff are managed on screen; Phase 3 (0007, 0008) can start |
| 2026-10-24 | Phase 3 graduated: 0007 and 0008 shipped (0008 AI operations query last) | Every graduation criterion met: the KPI dashboard and the AI query window work on the hosted project for every role; Phase 4 (0009) can start |
| 2026-10-24 | Phase 4 graduated: 0009 shipped with all three optional AI challenges | Every graduation criterion met: Workflow Supervisor, Document Understanding and Operational Insight work on the hosted project with the real model; Phase 5 (0010 production deployment) can start |
| 2026-10-24 | Phase 5 graduated: 0010 shipped (production deployment) | The app runs on Vercel (`main` production, `dev` preview) against the hosted project; every portal, the customer feedback link and the invite email passed the end-to-end check on the live app with technician and Manager on a real phone (decision 0018); all planned features 0000–0010 are shipped |
| 2026-10-24 | New Phase 6 Polish with feature 0011 `ui-ux-enhancement` (decision 0020) | The app works end to end but looks like a prototype; the brief asks for a clean, practical UI for a real internal tool; a UI-only redesign is safest after everything is live |
| 2026-10-24 | Phase 6 graduated: 0011 shipped (UI/UX enhancement) | Every screen of every role and the customer page use one design system and passed the checks at 375, 768, 1024 and 1280 px, light and dark, with a full order flow on the hosted project; the user chose to mark it shipped before the real-phone check of technician, Manager and the feedback link on the `dev` preview, with a fix commit if that check finds a problem (decision 0021) |

## Related Documents

| Document | Type | Relationship |
|---|---|---|
| `docs/documentation-standard.md` | Standard | Governs how all docs are maintained |
| `docs/reference/folder-structure.md` | Reference | Structural placement of modules |
| `docs/decisions/NNNN-*.md` | Decision log | Deviations that may affect roadmap |
