# 0011 - UI/UX Enhancement Workflow

> **Type:** Workflow | **Must stay current:** Yes -- update when behavior changes

<!-- AI Context
Role: This document describes how the system behaves *today*.
Use it as the authoritative source for current processing flows, stage
sequencing, error handling, and runtime defaults. When writing or modifying
code, the behavior described here is the specification.
This document must be updated before a coding session ends whenever behavior,
flow, or error handling changes. If it conflicts with a PRD or plan, this
document reflects reality; record the divergence in the decision log.
-->

## Purpose

How every screen looks and behaves since 0011: one design system (named
colours, Poppins, Lucide icons, light / dark), one app frame per role
(sidebar, icon rail, phone bottom bar), and shared patterns for lists,
filters, actions, loading, empty, error and success states. Data, rules,
routes and permissions are the ones described in 0000–0010; 0011 changes
only how they are shown (PRD 0011, decision 0020).

## Trigger

Every page load. The theme is set before React starts; the frame and the
page patterns render with the signed-in person's portal.

## Preconditions

- The fonts and icons are bundled with the app (no request to Google or an
  icon server at run time).
- A screen uses only the named colours from `src/index.css`; a source test
  (`tests/ui/design-tokens.test.ts`) fails on a raw Tailwind palette class
  or a hex colour in a component.

## Stages

### 1. Theme

**Input:** the stored choice `sejuk.theme` (`light` / `dark`, nothing =
System) and the device's `prefers-color-scheme`.
**Actions:** an inline script in `index.html` sets `<html data-theme>`
before the app loads (no white flash). `ThemeProvider`
(`src/lib/theme.tsx`) keeps it in step: a Light / Dark / System switch in
the account menu stores the choice on the device; System follows the device
live.
**Output:** every named colour (`canvas`, `surface`, `raised`, `sunken`,
`line`, `ink`, `ink-muted`, `ink-faint`, `brand`, `brand-soft`, `brand-ink`,
`on-brand`, `panel`, `success|warning|danger|info` with `-soft` / `-ink`,
`on-danger`, `whatsapp`, chart colours) switches together. Text pairs pass
WCAG AA in both themes.
**On failure:** storage blocked (private mode) → System; the choice lasts
until reload.

### 2. Frame per role

**Input:** the role's menu items (`AppShell` `items`), each with a label, a
Lucide icon, an optional shorter phone label, and `phone: 'tab' | 'more'`.
**Actions:** one `<nav aria-label="Admin|Manager|Finance|Technician">` that
is drawn three ways:
- ≥ 1024 px: left sidebar with icon and label, the unread count as a red
  badge, the account menu at the bottom and a Collapse button (collapsed /
  open is remembered on the device as `sejuk.sidebar`).
- 768–1023 px: icon rail (labels for screen readers and tooltips; unread as
  a red dot); the content keeps the full width.
- < 768 px: a top bar with the logo and the account button, and a bottom
  tab bar with up to four tabs; the rest under "More".

| Role | Phone tabs | More |
|---|---|---|
| Admin | Orders, Staff, Dashboard | New order, AI log |
| Manager | Review, Staff, Dashboard, Alerts | — |
| Finance | Payments, Dashboard, Alerts | — |
| Technician | Jobs, Week, Alerts | — |

The account menu shows the name, role and branch ("Signed in as …" for
screen readers), the theme switch, Change password (`/account/password`,
inside each portal's frame) and Sign out. A skip link jumps to `#main`.
**Output:** no page is wider than the screen at 375, 768 or 1280 px.

### 3. Page patterns

- **Header:** `PageHeader` (title, optional eyebrow, description, status
  badge, actions); detail pages start with a `BackLink`.
- **Lists:** a table on wide screens (`TABLE` classes) and compact cards on
  a phone (number, customer, who, when, amount, status; the whole card opens
  the page). The KPI leaderboard switches at 1024 px, the other lists at
  768 px.
- **Filters:** `FilterPanel` shows the filters inline on wide screens; on a
  phone the search stays visible and a "Filters" button opens them as a
  bottom sheet, with the chosen ones as removable chips (Orders, Staff, AI
  log).
- **Tabs:** `SegmentedTabs` (job lists, review and finance queues); four
  tabs become a 2 × 2 grid on a phone.
- **Detail pages:** order (Admin), review (Manager) and finance pages put
  the details on the left and a panel with money and the main buttons on
  the right that stays in view from 1024 px; on a phone one column with the
  main buttons in the sticky `ActionBar` above the bottom bar. The
  technician's job, complete-job and payment pages always use the
  `ActionBar`.
- **Dialogs:** a bottom sheet on a phone and a centred card on wider
  screens; focus moves in and returns, Escape closes.
- **Loading:** grey placeholder shapes in the page's layout (`LoadingState`
  `rows | cards | page | tiles`), with the old loading text for screen
  readers.
- **Empty:** `EmptyState` (icon, title, one line, optional action).
- **Errors:** `ErrorState` with Try again, or the error next to the field or
  box that caused it. Errors never become pop-ups.
- **Success:** a pop-up (`Toast`) for about 4.5 seconds with the same words
  as before, closable, announced as a status. Success flags in the address
  (`?created=1`, `?updated=1`, `?submitted=1`, `?paid=1`) still drive it.
- **Notifications:** a narrow list (about 720 px); each one is a single line
  on wide screens (icon, type, message, time), unread ones with a dot and a
  bold message.

### 4. Ask button

The floating Ask button starts in the bottom-right corner above the phone
bottom bar and above any `ActionBar` (the bar shares its height as
`--action-h`; a bar that sits in a side panel from 1024 px shares 0). It can
be dragged anywhere and snaps to the nearer side; a drag never opens the
chat. Its spot is not saved: it is back in the corner after a reload.
Pop-ups sit just above it. The chat opens as a side panel on wide screens
and full screen on a phone.

### 5. Signed-out pages

- **Sign-in:** on ≥ 1024 px a deep-teal brand panel ("Sejuk Sejuk
  Service", three lines about the system) beside the form; on a phone the
  logo above the form. Show-password button; the texts "Sign in" and "Use
  your work email and the password you chose." stay (the `live-check` robot
  reads them).
- **Email link (`/auth/confirm`):** a centred card with the logo for each
  step (Continue, new password, saved, cannot use the link).
- **Customer feedback (`/f/:token`):** branded phone page; an EN / BM switch
  in the header (English first, the choice stored on the phone as
  `sejuk.feedback.lang`); big star buttons (still radio inputs, values 1–5),
  Yes / No tiles, comment counter, friendly thank-you / used / expired /
  replaced / invalid pages. Only the page's own words change language
  (`src/features/feedback/i18n.ts`); the answers sent are the same, and the
  service name from the database stays as stored. Dates in BM use the
  Malay format (`Jum, 23 Okt 2026, 2:00 PTG`).

## Error States

| Error | Cause | Handling |
|---|---|---|
| Storage blocked | Private mode, blocked site data | Theme falls back to System; sidebar to open; feedback page to English; nothing breaks |
| Data fails to load | Network, server | `ErrorState` with Try again (same messages as before) |
| Save fails | Rule or network | Error shown inline next to the field or box; no pop-up |
| Very wide data | Long names on a 375 px phone | Cards wrap text; tables only on wide screens; buttons wrap within the action bar |

## Defaults

| Setting | Default |
|---|---|
| Theme | System (follows the device) |
| Brand colour | `#0e7490` light, `#3cc6dc` dark (text on it switches to dark) |
| Font | Poppins 400 / 500 / 600 / 700 (Latin), body 15 px desktop, 16 px phone |
| Icons | Lucide, imported one by one |
| Sidebar | Open; collapsed state remembered per device |
| Pop-up duration | 4.5 seconds |
| Phone / tablet / desktop breakpoints | < 768 px / 768–1023 px / ≥ 1024 px |
| Feedback page language | English; BM remembered per phone |
| Ask button | Bottom-right, above bars; not remembered after a reload |

## Behavioral Constraints

- No data, rule, route or permission changed: the same buttons appear for
  the same role and status as before 0011 (tests in `tests/ui/` check them).
- Button names, labels, headings and fixed texts keep their 0010 wording,
  apart from the changes in decision 0021.
- Screens use only named colours; components never hard-code a hex value.
- Every icon-only control has a visible text or an sr-only label; tap
  targets are at least 44 px on a phone; motion is off under "reduce
  motion".
- `vitest-axe` checks the frame and the sign-in page in `npm test`; colour
  contrast and layout widths are checked in the browser at 375, 768 and
  1280 px, light and dark.

## Related Documents

| Document | Type | Relationship |
|---|---|---|
| `docs/prd/0011-ui-ux-enhancement-prd.md` | Intent | Product goals this workflow fulfills |
| `docs/plan/0011-ui-ux-enhancement-plan.md` | Plan | Implementation path |
| `docs/decisions/0020-add-ui-ux-enhancement-feature.md` | Decision log | Why the feature exists |
| `docs/decisions/0021-ui-ux-enhancement-implementation-details.md` | Decision log | Divergences from the plan and PRD |
| `docs/reference/folder-structure.md` | Reference | Where the frame and shared components live |
| `docs/0001-admin-order-portal-workflow.md` … `docs/0010-production-deployment-workflow.md` | Workflow | What each screen does (unchanged) |
