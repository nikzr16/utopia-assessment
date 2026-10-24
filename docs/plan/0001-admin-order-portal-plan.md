# 0001 - Admin Order Portal Implementation Plan

> **Type:** Plan | **Must stay current:** No -- record divergences in decision log, rewrite only during re-planning

<!-- AI Context
Role: This document describes *how* to build the feature, not *what* or *why*.
Read the corresponding PRD first for intent and constraints, then use this plan
to guide implementation order, component boundaries, and technical decisions.
Do not rewrite this document during coding. If the implementation diverges from
this plan, add an entry to the decision log instead. Only rewrite during a
deliberate re-planning session.
-->

## Overview

Build the Admin portal from `docs/prd/0001-admin-order-portal-prd.md` on top of
the 0000 foundation: an order list (the Admin's home), a new order form with a
summary and a WhatsApp deep link after saving, and an order detail page with
history, editing, assign / reassign / cancel, and reschedule. One new
migration adds the edit function, the phone and price rules, two read
functions, and an `order_updated` notification. Every rule the screen checks
has a `src/domain/` mirror kept identical to the database by parity tests.

## Technical Approach

- **The database stays the rule authority.** New rules (Malaysian phone,
  quoted price range) live in SQL helpers called by `create_order` (replaced
  in place, same signature) and the new `update_order`. `src/domain/` mirrors
  them so the form can show errors as the Admin types; parity tests run one
  shared table of cases through both.
- **Phones are stored normalised.** `_normalize_my_phone(text)` strips spaces,
  dashes, dots, and brackets, accepts `+60`, `60`, or `0` prefixes, checks the
  number against Malaysian mobile and landline patterns, and returns digits
  with the country code (`60123456789`). Invalid numbers raise
  "Enter a valid Malaysian phone number". The screen shows them formatted
  (`+60 12-345 6789`, `+60 3-1234 5678`).

  | Kind | National form (after the leading 0) | Example |
  |---|---|---|
  | Mobile `010, 012–014, 016–019` | `1x` + 7 digits | `012-345 6789` |
  | Mobile `011, 015` | `1x` + 8 digits | `011-2345 6789` |
  | Landline Klang Valley `03` | `3` + 8 digits | `03-1234 5678` |
  | Landline `04–07, 09` | area digit + 7 digits | `04-123 4567` |
  | Landline Sabah / Sarawak `082–089` | `8x` + 6 digits | `082-123 456` |

- **Price rule.** `_check_quoted_price(numeric)`: not null, 0 to 100,000,
  at most 2 decimals ("Quoted price must be between RM 0.00 and
  RM 100,000.00" / "Quoted price can have at most 2 decimal places").
- **Editing is an audited RPC.** `update_order(p_order_id, p_expected_updated_at,
  …editable fields)`: Admin only; status New, Assigned, or Acknowledged
  ("An order can only be edited while it is New, Assigned or Acknowledged
  (it is currently X)"); the same validation as `create_order`. It compares old
  and new values; with no change it returns the order and writes nothing. With
  changes it writes one `audit_log` row, action `updated`, with
  `details.changes = { field: { from, to } }`, and, when a technician is
  assigned, an `order_updated` notification to them. `p_expected_updated_at`
  guards against overwriting another Admin's change (see P7).
- **Technician changes stay in `transition_order`.** The edit function never
  touches the technician or the status.
- **Reads.** Two `security invoker` read functions, so row-level security
  still applies:
  - `list_orders(p_search, p_statuses, p_branch_id, p_technician_id,
    p_scheduled_from, p_scheduled_to, p_limit, p_offset)` returns
    `order_summary` rows plus `total_count`, newest first. Search matches order
    number and customer name (case-insensitive) and phone (digits of the query
    against the stored digits).
  - `technician_options()` returns active technicians with branch, phone, and
    open-job count (Assigned, Acknowledged, In Progress).

  Order detail reads `order_summary` and `audit_log` (with the actor's name)
  directly; RLS already covers both.
- **WhatsApp.** A pure `src/domain/whatsapp.ts` builds the message (order
  number, service type, customer name and phone, address, problem, scheduled
  date in Malaysia time, quoted price, admin notes, and a link to the order
  in the app) and the `https://wa.me/<digits>?text=<encoded>` URL. The button
  opens it in a new tab. Nothing is recorded, because the app cannot know
  whether the message was sent.
- **Malaysia time in the form.** `datetime-local` values are read and written
  as UTC+8 whatever the browser's time zone (`src/domain/malaysiaTime.ts`).
- **Screens per role.** After sign-in, an Admin gets the portal routes; other
  roles keep their `RoleHome` placeholder. The database rejects non-Admin
  writes regardless.
- **Submitting once.** The form disables its submit button and ignores
  further submits while a save is in flight (a ref guard, not just state), so
  a double click creates one order.

## Resolved PRD Open Questions

All PRD questions were answered with option (a) on 2026-10-22; see the PRD's
Product Decisions. Plan-level choices are in Open Questions below.

## System Components

| Component | Location | Responsibility |
|---|---|---|
| Migration | `supabase/migrations/20261022000005_admin_order_portal.sql` | `_normalize_my_phone`, `_check_quoted_price`, `create_order` (replaced, same signature), `update_order`, `list_orders`, `technician_options`, `order_updated` notification event, execute lockdown and grants |
| Hosted SQL | `docs/draft/0001-supabase-update.sql` (git-excluded) | Same SQL as the migration, for the hosted project |
| Phone rules | `src/domain/phone.ts` | `normalizeMyPhone`, `formatMyPhone`, `isMyMobile` |
| Price rules | `src/domain/price.ts` | `checkQuotedPrice`, limits |
| Order form rules | `src/domain/orderForm.ts` | Field-level validation of the form values → error map + RPC arguments |
| Editable statuses | `src/domain/orderEditing.ts` | `EDITABLE_STATUSES`, `canEditOrder` |
| WhatsApp | `src/domain/whatsapp.ts` | Message text and `wa.me` URL |
| Malaysia time | `src/domain/malaysiaTime.ts` | `datetime-local` ↔ UTC+8 ISO, display format |
| Routing / shell | `src/App.tsx`, `src/features/orders/AdminPortal.tsx` | Admin routes and navigation |
| Data access | `src/features/orders/api.ts` | Typed calls to the RPCs and reads; maps database errors to messages |
| Order list | `src/features/orders/OrderListPage.tsx` | Search, filters, pagination |
| New order | `src/features/orders/NewOrderPage.tsx`, `OrderForm.tsx`, `TechnicianSelect.tsx` | Create form (shared with editing) |
| Summary | `src/features/orders/OrderSummaryCard.tsx`, `WhatsAppButton.tsx` | After-save summary and WhatsApp link |
| Order detail | `src/features/orders/OrderDetailPage.tsx`, `OrderHistory.tsx`, `EditOrderPage.tsx` | Details, money, history, edit |
| Actions | `src/features/orders/actions/` | Assign / reassign, cancel (reason), reschedule (reason, requested by, note) |
| Shared UI | `src/components/` | Field, Button, StatusBadge, Dialog, Pagination |
| SPA hosting | `vercel.json` | Rewrite all paths to `index.html` (needed for deep links like `/orders/ORDER1001`) |

## Processing Flow

1. Admin signs in → `current_staff()` → role `admin` → portal at `/orders`.
2. **Create:** `/orders/new` loads service types, branches, and
   `technician_options()`; the Admin fills the form; `src/domain/orderForm.ts`
   validates; `create_order` saves (normalises the phone and checks the price
   again); the page navigates to `/orders/<order_no>?created=1` and shows the
   summary with the WhatsApp button when a technician is assigned.
3. **Find:** `/orders` calls `list_orders` with search, filters, and page.
4. **Detail:** `/orders/<order_no>` reads `order_summary` and the audit log;
   actions come from `availableTransitions(status, 'admin')` and
   `canEditOrder(status)`.
5. **Edit:** `/orders/<order_no>/edit` → `update_order` → back to detail;
   the technician gets `order_updated` in-app and the WhatsApp button is
   shown again.
6. **Assign / reassign / cancel / reschedule:** dialogs on the detail page →
   `transition_order` / `reschedule_order` → detail reloads; after an assign
   or reassign the WhatsApp button is highlighted.
7. Every error from the database is shown in plain language; nothing is half
   written because each RPC is one transaction.

## Dependencies

| Dependency | Purpose |
|---|---|
| `react-router` (v7, library mode) | URLs for list, new, detail, edit (see P1) |
| `jsdom`, `@testing-library/react`, `@testing-library/user-event` (dev) | Component tests for the form, summary, and actions (see P3) |
| Existing: `@supabase/supabase-js`, Tailwind CSS 4, Vitest 3, PGlite | Unchanged |

Exact versions are pinned at install time; Vitest stays on 3.x (Node 23).

## Implementation Phases

### Phase 1: Database

- Migration `20261022000005_admin_order_portal.sql` (append-only; Supabase-only
  statements guarded so PGlite still runs it).
- DB tests: phone and price rules through `create_order`; `update_order`
  (fields, statuses, roles, audit diff, notification, no-op, stale
  `updated_at`); `list_orders` (search, filters, paging, technician sees only
  own); `technician_options` counts; access (anon and non-Admin rejected).
- Hosted SQL in `docs/draft/0001-supabase-update.sql`.

### Phase 2: Domain rules

- `phone.ts`, `price.ts`, `orderForm.ts`, `orderEditing.ts`, `whatsapp.ts`,
  `malaysiaTime.ts` with unit tests.
- Parity tests: shared phone / price case table through TS and SQL;
  `EDITABLE_STATUSES` against `update_order`'s behavior.

### Phase 3: App shell

- Router, Admin layout with navigation (Orders, New order), other roles
  unchanged; `vercel.json`; shared UI components; test setup for jsdom.

### Phase 4: New order and summary

- `OrderForm` with inline validation, technician dropdown (order's branch
  first, open-job counts), branch default, optional scheduled date.
- Save once; summary card; WhatsApp button.

### Phase 5: Order list

- Search, filters, pagination, empty and error states; responsive table that
  becomes cards on phone widths.

### Phase 6: Order detail, edit, actions

- Details, money summary, history; edit page; assign / reassign, cancel, and
  reschedule dialogs; WhatsApp button after assign, reassign, and edit.

### Phase 7: Verify and document

- `npm test`, `npm run typecheck`, `npm run build`, and
  `python .claude/skills/validate-config/scripts/validate_config.py` pass.
- Manual check in the browser pane against hosted Supabase (user signs in;
  test data only with approval, cleaned up afterwards).
- Workflow doc `docs/0001-admin-order-portal-workflow.md`, reference doc,
  decision log for divergences, roadmap status and fixes, commit message draft.

## Testing Strategy

- **Database (PGlite, `tests/db/`):** every new SQL rule and function, run as
  the real API roles with RLS, like the 0000 tests. New file
  `tests/db/admin-orders.test.ts`, plus parity cases in `tests/db/parity.test.ts`.
- **Domain (`tests/domain/`):** pure functions, including Malaysia-time edge
  cases (midnight, browser in another time zone) and WhatsApp URL encoding.
- **Components (`tests/ui/`, jsdom):** form validation messages, submit-once,
  summary fields, WhatsApp link, which actions show for each status, non-Admin
  sees no portal. The Supabase client is replaced by a test double at the
  `api.ts` boundary; real database behavior is covered by the PGlite tests.
- **Manual (hosted Supabase):** AC1, AC2, AC5–AC9, AC12, AC14.

| PRD AC | Covered by |
|---|---|
| 1 Admin-only portal | `tests/ui/portal.test.tsx` + manual |
| 2 Form fields | `tests/ui/order-form.test.tsx` + manual |
| 3 Inline validation | `tests/domain/orderForm.test.ts`, `tests/ui/order-form.test.tsx` |
| 4 Database rejects invalid phone / price | `tests/db/admin-orders.test.ts`, `tests/db/parity.test.ts` |
| 5 Saves through `create_order` | `tests/db/admin-orders.test.ts` + manual |
| 6 Summary after submission | `tests/ui/order-summary.test.tsx` + manual |
| 7 WhatsApp link | `tests/domain/whatsapp.test.ts`, `tests/ui/order-summary.test.tsx` + manual |
| 8 List, search, filters | `tests/db/admin-orders.test.ts` + manual |
| 9 Detail and history | `tests/ui/order-detail.test.tsx` + manual |
| 10 Edit, audited | `tests/db/admin-orders.test.ts` |
| 11 Edit rejected (role, status) | `tests/db/admin-orders.test.ts` |
| 12 Assign / reassign / cancel | `tests/ui/order-detail.test.tsx` + manual |
| 13 Plain errors, single submit | `tests/ui/order-form.test.tsx`, `tests/db/admin-orders.test.ts` |
| 14 Responsive, labelled, keyboard | manual (375 px and desktop) |

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Hosted orders saved before 0001 have un-normalised phones | Phone search misses them | Check the count on hosted during the manual step; the migration does not rewrite old rows (no audit trail for that); ask before any clean-up |
| `create or replace create_order` drops grants | Admins cannot create orders | Same signature keeps its privileges; a DB test calls it as `authenticated` after all migrations |
| Notification event check constraint change on hosted | Hosted SQL fails | Drop and re-add the named constraint in one transaction; existing events stay valid |
| Browser time zone not UTC+8 | Wrong scheduled dates | All conversion in `malaysiaTime.ts` with tests that fake other zones |
| Deep links 404 on Vercel | Shared `/orders/…` links break | `vercel.json` rewrite |
| Two Admins edit the same order | One silently overwrites the other | `p_expected_updated_at` check (P7) |

## Roadmap Phase

**Phase:** 2 – Core workflow

## Related Documents

| Document | Type | Relationship |
|---|---|---|
| `docs/product-roadmap.md` | Roadmap | Phase assignment and sequencing for this plan |
| `docs/prd/0001-admin-order-portal-prd.md` | Intent | Product goals and constraints this plan implements |
| `docs/0001-admin-order-portal-workflow.md` | Workflow | Runtime behavior derived from this plan |
| `docs/0000-system-foundation-workflow.md` | Workflow | The RPCs and rules this portal calls |
| `docs/reference/folder-structure.md` | Reference | Structural placement of planned components |
| `docs/decisions/NNNN-*.md` | Decision log | Divergences from this plan |

## Open Questions

Each question lists options; **(Recommended)** marks the proposed default.
All answered 2026-10-22: option (a) for every question. P6 detail: when the
order already has a date, the edit form shows it read-only with a "Change
date" link that opens Reschedule; `update_order` rejects changing a date that
is already set.

- [x] **P1. Routing.**
  - (a) `react-router` v7 with real URLs (`/orders`, `/orders/new`, `/orders/ORDER1001`, `/orders/ORDER1001/edit`) and a `vercel.json` rewrite. **(Recommended)** Links can be shared and the WhatsApp message can link to the order.
  - (b) Hand-written hash routing (`/#/orders/…`), no dependency.
  - (c) No URLs; switch views in React state. Reload always returns to the list.
- [x] **P2. Data loading.**
  - (a) Small hooks over `supabase-js` in `src/features/orders/api.ts`, no new library. **(Recommended)**
  - (b) TanStack Query for caching and refetching.
- [x] **P3. Component tests.**
  - (a) Add jsdom and Testing Library; test the form, summary, and actions as a user would. **(Recommended)**
  - (b) Test only domain functions and the database; check screens manually.
- [x] **P4. Where the database enforces phone and price.**
  - (a) In the RPCs (`create_order`, `update_order`) through shared SQL helpers. **(Recommended)** Same as 0000's required-field checks; old hosted rows stay readable.
  - (b) Also as table check constraints (`NOT VALID`, so existing rows are not checked). Stronger against a future RPC that forgets, but two places to change.
- [x] **P5. Order list queries.**
  - (a) A `list_orders` read function in SQL. **(Recommended)** Search and filters are tested in PGlite, and no filter strings are built in the browser.
  - (b) Query `order_summary` from the browser with `supabase-js` filters.
- [x] **P6. Scheduled date in editing vs the reschedule log.** Editing the date directly would skip the reschedule log that the KPI dashboard counts.
  - (a) The edit form sets the date only while it is empty; changing an existing date is done with Reschedule (reason required, logged). **(Recommended)**
  - (b) The edit form can change the date freely; the change is in the audit log but not the reschedule log.
- [x] **P7. Two Admins editing the same order.**
  - (a) Reject a save if the order changed since the form opened ("This order was changed by someone else. Reload to see the latest version."). **(Recommended)**
  - (b) Last save wins.
