# 0011 - UI/UX Enhancement Implementation Plan

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

A front-end-only redesign of every screen on one design system (PRD 0011).
First a foundation: design tokens in `src/index.css` (Tailwind 4 `@theme`),
Poppins and Lucide, light / dark themes, a new app shell (desktop sidebar,
phone bottom bar, user menu), and a kit of shared components in
`src/components/` (buttons, inputs, cards, badges, tables / list cards,
filter sheet, toasts, skeletons, empty / error states, page header, action
panel). Then every screen moves onto the kit, group by group, checked at
1280, 768 and 375 px in light and dark, with before / after screenshots.
Routes, data calls (`src/features/*/api.ts`), domain rules (`src/domain/`)
and everything under `supabase/` stay untouched.

The code today: about 11,200 lines of `.tsx` in 88 files, about 600
hard-coded colour classes (mostly `slate-*`, `sky-*`, `red-*`, `amber-*`),
shared class strings in `src/components/styles.ts`, a header in
`src/components/AppHeader.tsx`, text tabs in each `*Portal.tsx`, success
banners driven by `?created=1`-style query flags, and 19 UI test files in
`tests/ui/` that find elements by role, label and text.

## Technical Approach

### Design tokens and themes (PRD Q1, Q2, Q7; plan P2: named colours)

- `src/index.css` defines named colours as CSS variables and exposes them
  to Tailwind with `@theme`: `canvas` (page), `surface` (cards), `raised`
  (menus, dialogs), `line` / `line-strong` (borders), `ink` / `ink-muted` /
  `ink-faint` (text), `brand` / `brand-strong` / `brand-soft` / `on-brand`
  (cyan), and `success`, `warning`, `danger`, `info` with `-soft` and `-ink`
  pairs. Screens use only these names (`bg-surface`, `text-ink-muted`,
  `border-line`, `bg-brand`), never raw palette classes.
- Dark theme: the same names get dark values under `[data-theme="dark"]` on
  `<html>`; Tailwind's `dark:` variant is pointed at that attribute
  (`@custom-variant dark`), for the few places that need it.
- A small `ThemeProvider` (`src/lib/theme.tsx`) reads the stored choice
  (`light` / `dark` / `system`, `localStorage`, wrapped in try / catch),
  follows `prefers-color-scheme` when `system`, and sets the attribute. An
  inline script in `index.html` sets it before React loads, so there is no
  white flash at night.
- Status badges get one tone per status family (new / waiting = neutral,
  assigned / acknowledged = brand, in progress = info, job done = warning,
  reviewed / closed = success, cancelled = danger), all from the tokens, AA
  in both themes.
- Radius, shadow, spacing and motion tokens (`--radius-*`, `--shadow-*`,
  `--ease-*`); motion off under `prefers-reduced-motion`.

### Font and icons (PRD Q5, Q6)

- `@fontsource/poppins` (weights 400, 500, 600, 700, Latin subset) imported
  in `src/main.tsx`; `--font-sans` = Poppins, then system fonts. Body 14–15
  px on desktop and 16 px on phone (Poppins is wide), tabular numbers for
  money (`font-variant-numeric: tabular-nums`).
- `lucide-react` icons imported one by one (tree-shaken). Icon-only buttons
  always get an `aria-label`; decorative icons `aria-hidden`.
- The logo mark is a `Logo` component: Lucide `Snowflake` in a rounded
  `bg-brand` square plus "Sejuk Sejuk" (shell) or "Sejuk Sejuk Service"
  (sign-in, email link, feedback page). Favicon: the same mark as an SVG in
  `public/`.

### App shell and navigation (PRD Q8, Q9; plan P4)

- `src/components/shell/AppShell.tsx` replaces `AppHeader` for signed-in
  staff. Each portal passes its nav items (`{ to, label, icon, badge? }`)
  instead of rendering its own `<nav>`; routes inside each portal stay as
  they are.
- Desktop (≥ 1024 px): left sidebar (logo, nav items with icons, the
  notification count as a badge on its item), collapsible to icons; the user
  menu at the bottom: name, role · branch, theme (Light / Dark / System),
  Change password, Sign out.
- Phone (< 768 px): slim top bar (logo, page title, user menu button) and a
  bottom tab bar, safe-area aware. Tabs per role: Technician – Jobs, My
  week, Alerts; Manager – Review, Staff, Dashboard, Alerts; Finance –
  Payments, Dashboard, Alerts; Admin – Orders, Staff, Dashboard, More (New
  order, AI log). "New order" is also the main button on Orders.
- Tablet (768–1023 px): an icon-only sidebar (labels as tooltips and for
  screen readers), so two-column pages still fit (P4).
- The sidebar's collapsed / open state is remembered on the device
  (`localStorage`, try / catch) (P8).
- Page content gets one max width per page type (wide for tables, narrow
  for forms), and `scrollbar-gutter: stable` so the layout no longer shifts
  between short and long pages.

### Shared components (`src/components/`)

| Component | Replaces / used by |
|---|---|
| `Button` (primary / secondary / ghost / danger / whatsapp; sizes; icon; loading) | `BUTTON.*` strings everywhere |
| `TextField`, `TextArea`, `Select`, `DateField`, `Checkbox`, `RadioCards`, `Field` (label, hint, error) | `INPUT` strings, `Field.tsx` |
| `Card`, `CardHeader`, `DescriptionList` (label / value pairs) | `CARD` string, order / job details |
| `PageHeader` (back link, title, status badge, actions) | every page title row |
| `ActionPanel` (sticky right column on desktop, sticky bottom bar on phone) | order, review, finance, job pages (PRD Q16) |
| `DataTable` (desktop) + `ListCard` (phone) from one column definition | orders, staff, queues, AI log, leaderboard |
| `FilterBar` (desktop inline) + `FilterSheet` (phone bottom sheet) + `FilterChips` | orders, staff, AI log, queues (PRD Q12) |
| `Tabs` / `SegmentedControl` | queue tabs, job tabs, period picker |
| `StatusBadge`, `Badge`, `CountBadge` | status pills, warnings, notification count |
| `Toast` provider + `useToast()` | `?created=1` / `?paid=1` banners (PRD Q13) |
| `Skeleton` (row, card, tile variants) | "Loading…" text (PRD Q14) |
| `EmptyState`, `ErrorState` (with retry) | "No orders" sentences, error boxes |
| `Dialog` (restyled; still inline, same focus rules) and `Sheet` | `Dialog.tsx`, reschedule / assign dialogs |
| `StatTile` (icon, number, caption) | KPI cards |
| `Logo`, `Avatar` (initials) | shell, staff list |

`styles.ts` stays during the move so not-yet-moved screens keep working,
and is removed when the last screen has moved.

### Toasts (PRD Q13)

Success flags stay in the URL as today (`?created=1`, `?paid=1`,
`?submitted=1`, staff `flash` state), because the page that shows the
message is a different page from the one that saved. The destination page
reads the flag, calls `toast.success(...)` with the same wording as today's
banner, and clears the flag (`replace`). The toast region is one
`role="status"` live region; errors never become toasts. Toasts sit above
the bottom bar and never cover an action bar.

### Ask button (PRD Q10, Q10b)

`AskAssistant` keeps its logic. The launcher becomes a draggable floating
button (pointer events; keyboard users keep the normal button) that snaps
to the nearest side, stays above the bottom bar and the action bar, and
starts in its default corner on every load (no storage). The panel stays a
side panel on desktop and full screen on phone, restyled.

### Dashboard and charts (PRD Q15)

KPI tiles become `StatTile`s (two per row on phone); the leaderboard is a
`DataTable` on desktop and a compact ranked `ListCard` list on phone (tap
opens the existing technician page). Recharts colours, grid, tooltips and
legends come from the tokens (cyan series, neutral grid), so charts work in
both themes. Recharts stays lazy-loaded with the dashboard.

### Public pages (PRD Q17, Q18, Q19)

- Sign-in: split layout on desktop (brand panel + form), stacked on phone,
  show-password toggle, same labels ("Email", "Password", "Sign in").
- `/auth/confirm` and the set-up notice: centred branded card with the logo
  and a clear next step.
- Feedback page: branded phone page, big star buttons (still radio inputs
  underneath, same values), one question per card, friendly result pages.
  EN / BM: the page's own words move into a small dictionary
  (`src/features/feedback/i18n.ts`, `en` and `ms`), a switch in the header,
  English first, choice stored in `localStorage` (try / catch). Messages
  that come from the database are shown as they are. The staff
  "rating by phone" form stays English.

### Accessibility

Visible focus ring token on every interactive element, labels on icon
buttons, landmarks (`nav`, `main`, `header`), skip link, 44 × 44 px minimum
tap targets on phone, AA contrast in both themes, `prefers-reduced-motion`
respected, the bottom bar and sidebar as `nav` with `aria-current`.

## System Components

| Component | Responsibility |
|---|---|
| `src/index.css` | Tokens (`@theme`), light / dark values, base styles, focus ring, reduced motion |
| `index.html` | Theme attribute set before React; favicon |
| `src/lib/theme.tsx` | Theme choice, device setting, storage |
| `src/components/shell/*` | App shell, sidebar, bottom bar, top bar, user menu, nav items per role |
| `src/components/ui/*` | Shared kit (table above) |
| `src/components/toast/*` | Toast provider, hook, region |
| `src/features/*/` | Screens moved onto the kit (markup and classes only; `api.ts` untouched) |
| `src/features/feedback/i18n.ts` | EN / BM words for the customer page |
| `tests/ui/*` | Updated for changed labels / structure; new tests for shell, theme, toasts, Ask drag, BM switch |

## Processing Flow

1. Foundation lands (tokens, fonts, icons, theme, shell, kit) with tests.
2. A screen group moves onto the kit; its tests are updated in the same
   step; `npm test`, `npm run typecheck`, `npm run build` pass.
3. The group is checked in the browser pane at 1280, 768 and 375 px, light
   and dark; before / after screenshots go to the user and the next group
   starts (P3).
4. Repeat for the next group; at the end remove `styles.ts` and any raw
   palette classes (a test fails if one remains).
5. Manual check (PRD AC 14), docs, README screenshots, one commit.

## Dependencies

| Dependency | Purpose |
|---|---|
| `@fontsource/poppins` (npm, approved in PRD Q5) | Bundled Poppins font files |
| `lucide-react` (npm, approved in PRD Q6) | Icons |
| `vitest-axe` (npm, dev only, approved in P6) | Accessibility checks in `npm test` |
| Tailwind CSS 4 `@theme` / `@custom-variant` (already installed) | Tokens and dark variant |
| Recharts (already installed) | Charts, restyled |
| Local dev server + browser pane | Screenshots and checks at three widths |
| A real phone (the user) | Technician, Manager and feedback page check |

## Implementation Phases

Order per P1: foundation, Technician, Manager, Admin, Finance, shared
pages, public pages. Each group ends with tests passing, an axe check and
a browser check at 1280 / 768 / 375 px with before / after screenshots;
the screenshots go to the user and work carries on to the next group
without waiting (P3); the user reviews everything at the end.

### Phase 1: Foundation

Packages, tokens, themes, Poppins, Lucide, `Logo`, theme switch, app shell
for all four roles (sidebar, bottom bar, user menu), toast provider,
skeletons, empty / error states, the shared kit, restyled `Dialog`. Every
portal moves into the shell (screens inside still old-style).

### Phase 2: Technician (phone first)

Job list, job page (action bar), complete job, record payment, job files,
My week, notifications, Ask launcher and panel.

### Phase 3: Manager (phone first)

Review queue, review page (action panel, warnings, customer message,
feedback card), staff list / page / form, branch cover.

### Phase 4: Admin (desktop first)

Orders list (table + phone cards + filter sheet), new / edit order (Read
from photo), order page (action panel, assign / reschedule / cancel
dialogs, history), AI log.

### Phase 5: Finance (desktop first)

Payments queue, finance order page, finance payment form.

### Phase 6: Shared pages

Dashboard, technician KPI page, charts, branch comparison, insights card,
change password.

### Phase 7: Public pages

Sign-in, `/auth/confirm`, set-up notice, customer feedback page (all states,
EN / BM switch).

### Phase 8: Clean-up and finish

Remove `styles.ts` and raw palette classes; final pass at 1280 / 768 / 375,
light and dark; accessibility pass; manual check; docs; README screenshots.

## Testing Strategy

- Tests keep finding things by role and accessible name; the design keeps
  today's button names, labels and headings wherever the PRD does not
  change them, so most tests keep passing as proof nothing broke (P5).
- Where a label or structure changes, the test changes in the same step,
  keeping the same check (never deleted).
- New tests: shell nav items per role (and that each role sees only its
  items), user menu (theme, change password, sign out), theme provider
  (system / light / dark, storage failure), toast shown from a URL flag and
  the flag cleared, skeleton then content, empty and error states with
  retry, filter sheet and chips, Ask button drag and reset on reload, EN /
  BM switch (every page string in both, answers unchanged), and a
  "no raw palette classes" source test.
- Accessibility in the suite (P6): `vitest-axe` (dev dependency,
  approved) runs axe on the shell, every page group and the feedback page
  in both languages; a test fails on any violation jsdom can see (labels,
  roles, names). If `vitest-axe` 0.1 does not work with Vitest 3, the same
  check runs on `axe-core` with a small helper (asked first).
- Layout widths, colour contrast and focus are checked in the browser pane
  (jsdom cannot measure layout or colour) with axe, light and dark, per
  group.
- `npm test`, `npm run typecheck`, `npm run build`, `validate_config.py`
  after every group.

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| A redesign hides or moves a button a role needs | A role cannot finish a job | Same buttons per role and status (AC 12); tests on actions stay; manual check per role |
| Many label changes break tests at once | Slow, risky build | Keep names; update tests per group, never in bulk |
| Dark mode misses a hard-coded colour | Unreadable text at night | Named colours only; a test fails on raw palette classes |
| Poppins is wide on 375 px phones | Wrapping and overflow | 16 px body, tighter headings, overflow check at 375 px per group |
| Ask button or toasts cover the main action | Technician cannot press Complete job | Fixed safe zones above the action bar and bottom bar; checked per group |
| Malay wording is wrong | Customers confused | I draft every BM string as a side-by-side EN / BM list; the user checks it before the feedback group is finished (P7) |
| Bundle grows | Slower first load on site | One font family with 4 weights, Latin only; icons imported one by one; Recharts stays lazy |
| Shared hosted project | Test data seen on live | No test data until the manual-check step, asked once, cleaned up after |

## Roadmap Phase

**Phase:** 6 – Polish

## Related Documents

| Document | Type | Relationship |
|---|---|---|
| `docs/product-roadmap.md` | Roadmap | Phase assignment and sequencing for this plan |
| `docs/prd/0011-ui-ux-enhancement-prd.md` | Intent | Product goals and constraints this plan implements |
| `docs/decisions/0020-add-ui-ux-enhancement-feature.md` | Decision log | Why the feature exists |
| `docs/0011-ui-ux-enhancement-workflow.md` | Workflow | Runtime behavior derived from this plan |
| `docs/reference/folder-structure.md` | Reference | Structural placement of planned components |
| `docs/decisions/NNNN-*.md` | Decision log | Divergences from this plan |

## Open Questions

All answered on 2026-10-24.

- [x] **P1. Order of screens.** Foundation, then Technician, Manager,
  Admin, Finance, shared pages, public pages, clean-up.
- [x] **P2. How colours work in code.** Named colours that switch by theme.
- [x] **P3. Checkpoints.** Show before / after after each group and carry
  on; the user reviews at the end.
- [x] **P4. Tablet.** Icon-only sidebar.
- [x] **P5. Tests.** Keep today's names; update a test only when the PRD
  changes its label.
- [x] **P6. Accessibility check.** axe in the browser pane per group, and
  `vitest-axe` in the test suite (dev dependency approved).
- [x] **P7. Malay wording.** I draft every BM string; the user checks them.
- [x] **P8. Sidebar state.** Remembered on the device.
