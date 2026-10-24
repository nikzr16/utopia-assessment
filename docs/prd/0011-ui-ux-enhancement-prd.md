# 0011 - UI/UX Enhancement PRD

> **Type:** Intent | **Must stay current:** No -- record divergences in decision log

<!-- AI Context
Role: This document captures product intent, not implementation detail.
Use it to understand *what* the feature should do and *why*, then consult the
implementation plan and workflow docs for *how*.
Do not rewrite this document during coding. If implementation diverges from
the intent described here, add an entry to the decision log instead.
-->

## Purpose

Features 0000–0010 work end to end on the live app, but every screen still
looks like a prototype: plain grey and white, no brand, no icons, text-only
tabs that wrap or run off a phone screen, filters that fill the whole phone
screen, very long phone pages, and the Ask button covering buttons and
numbers. The brief asks for a "clean UI, simple UX, practical design" for a
real-world internal operations tool, with Admin on desktop and Technician on
mobile. This PRD redesigns the look and feel of every screen and portal into
one consistent, polished, commercial-grade product, without changing any
data, rule, permission or action (decision 0020).

## Current State (audit, 2026-10-24)

Screens captured on the local app against the hosted demo data at 1280 px
and 375 px for every role (Admin, Manager, Finance, Technician) and the
signed-out pages. Biggest problems:

| Screen | Biggest problems |
|---|---|
| Whole app | No brand (text-only "Sejuk Sejuk Service"), no logo mark, one flat grey background, system font, almost no icons (an emoji bell, text arrows); every page has the same plain cards; no dark mode; page width and header shift between pages that scroll and pages that don't |
| Header and navigation | Text tabs under the header; on phone they wrap ("New / order", "AI / log", "Payments / and / closing") or run off the right edge (Manager: Notifications cut off, page 415 px wide at 375 px); "Change password" and "Sign out" take a full row on phone; no "who am I" menu |
| Sign-in | Small card on an empty page; no logo, no product name in the card, no show-password, nothing that says this is a company system |
| Email link (`/auth/confirm`) and feedback errors | Bare coloured box; no logo, no next step or contact |
| Orders list (Admin) | Desktop table is fine but plain; on phone five filters and two date pickers fill the first screen before any order shows; no result count, no active-filter chips |
| New / Edit order | Long single column of boxes; Read from photo looks like any other box; no step order or sticky Save on phone |
| Order page (Admin) | Five action buttons in a row of equal weight (Cancel order looks as safe as Edit); details are small label/value pairs; history is a dense text list; on phone the actions wrap in two rows |
| Review queue / Payments queue | Plain tabs; on phone each card repeats labels; status pills use many unrelated colours |
| Review / Finance order page | Three columns on desktop; on phone the page is about 3,500 px tall and Approve / Close sit far from the warnings and money they depend on |
| Technician job list | Good structure, but cards look the same for Today and Upcoming; amount to collect is small |
| Technician job page | Sticky action bar works, but the Ask button sits on top of it; three equal buttons ("Complete job" is not clearly the main one); Call / WhatsApp / Maps buttons have no icons |
| Complete job / Record payment | Forms are clear but plain; payment method radio tiles are small; receipt upload is a plain button |
| Staff list / Staff form | Branch cover is a hidden "details" toggle; desktop table without avatars or role colours; phone cards repeat the email |
| Dashboard / My week | On phone the page is about 5,900 px tall (each technician is a card with 7 numbers); period buttons wrap; charts use one blue; KPI tiles have no icons or trend |
| Notifications | Every item is a full-width card with an "Unread" dot; no grouping by day; no icon per type |
| AI log (Admin) | Desktop table is tiny text; filter row and table header do not line up; on phone the entries are long text blocks |
| Ask chat | Desktop panel is good; on phone it is full screen but has no header shadow, the Send button looks disabled, suggestion chips wrap unevenly |
| Change password | Floating card with a "Back" link above it; no rules shown as you type |
| Customer feedback page (phone) | Plain header, small "Sejuk Sejuk Service" text, plain cards; used / expired pages look like errors; nothing branded for a customer-facing page |
| States everywhere | "Loading…" text instead of placeholders; empty lists are a plain sentence; success shown as banners that push the page down |

## Goals

- One design system used by every screen: colour, type, spacing, corner
  radius, shadows, icons, buttons, inputs, badges, cards, tables, tabs,
  dialogs, toasts, empty / loading / error states.
- A brand: product name, a simple logo mark and brand colours, used on the
  sign-in page, the app shell, the email-link page and the customer
  feedback page.
- Navigation that fits each device: desktop-first for Admin and Finance,
  phone-first for Technician and Manager, and never wider than the screen.
- Shorter, calmer phone pages: the main action always in reach, filters
  folded away, long data shown as compact lists.
- Accessible by default: WCAG 2.2 AA contrast, visible keyboard focus,
  screen-reader labels on icon buttons, tap targets at least 44 × 44 px,
  respects "reduce motion".
- The same data, actions, rules and permissions as today; every existing
  test still passes (labels updated only where the design needs it).

## Non-Goals

- Any database, migration, RPC, RLS, Edge Function, Storage or business-rule
  change; no new data shown that the screens do not read today.
- New product features (new reports, new filters that need new queries,
  bulk actions, offline mode, push notifications, native apps).
- Changing fixed texts the database or tests rely on (the WhatsApp message,
  the feedback link line, fixed AI limit sentences, status names) unless a
  Product Decision says so.
- Changing the email templates in Supabase (they are set in the dashboard,
  outside the app).
- Malay anywhere except the customer feedback page (staff screens, the
  WhatsApp message and database messages stay English).
- A marketing website.

## Scope

| In Scope | Out of Scope |
|---|---|
| Design tokens (colour, type, spacing, radius, shadow, motion) and shared components in `src/components/` | New npm packages without the user's approval |
| App shell: header / sidebar / bottom bar per role, user menu (name, role, branch, change password, sign out, theme) | New pages or routes (routes stay the same) |
| Every staff screen: orders, new / edit order, order page, review queue and page, payments queue and page, payment form, job list, job page, complete job, notifications, staff list / page / form, dashboard, technician KPI page, My week, AI log, change password | Rule, data or permission changes |
| Ask chat bubble and panel (desktop and phone) | Changes to what Ask can answer |
| Signed-out pages: sign-in, `/auth/confirm` (set password / expired), set-up notice, customer feedback page and its used / expired / replaced / invalid states | Supabase email templates |
| EN / BM switch on the customer feedback page (Q19) | Malay on staff screens or in the WhatsApp message |
| Empty, loading, error and success states; toasts; dialogs; form validation display | Analytics or tracking |
| Charts restyled (colours, tooltips, legends, both themes) | New chart types that need new numbers |
| Tests updated for changed labels / structure; new tests for the shell, theme and toasts | |
| Checks at 1280, 768 and 375 px in the browser pane, light and dark, and on a real phone | |
| README screenshots (Q20) | |

## User Stories

1. **As an Admin on a desktop**, I want a clear sidebar and roomy tables so
   that I can create and follow many orders quickly.
2. **As a technician on site**, I want the next step on a job ("Start",
   "Complete job") always under my thumb and never covered, so that I can
   work with one hand.
3. **As a Manager on my phone**, I want to see warnings, money and the
   Approve button together so that I can review a job without long
   scrolling.
4. **As Finance on a desktop**, I want the money of an order and the Close
   button side by side so that I can close jobs with confidence.
5. **As a customer**, I want a feedback page that clearly comes from Sejuk
   Sejuk and is easy to tap so that I trust it and finish it in under a
   minute.
6. **As any staff member**, I want consistent buttons, colours and messages
   on every page so that I know what is safe to press and what happened
   after I pressed it.
7. **As a keyboard or screen-reader user**, I want visible focus and labels
   on every control so that I can use every screen.

## Product Decisions

Decisions already fixed by the brief, 0000–0010 and the 0011 request:

| Decision | Rationale |
|---|---|
| UI/UX only: same data, actions, routes, permissions and rules; ideas that need a rule or data change become follow-ups | User instruction |
| React 19 + Tailwind CSS 4 stay; the design system is Tailwind theme tokens plus shared components | Brief tech stack; `CLAUDE.project.md` |
| Recharts stays the chart library (restyled) | 0007 |
| Admin and Finance are designed desktop first; Technician and Manager phone first; every screen still works at 375, 768 and 1280 px | Brief ("Admin use desktop, Technician use mobile"); user instruction |
| New npm packages only with the user's approval (e.g. an icon set or a font) | User instruction |
| Fixed texts the database or tests rely on stay unless decided here | User instruction |
| Accessibility target WCAG 2.2 AA (contrast, focus, labels, 44 px tap targets, reduce motion) | User instruction |
| Every portal and the feedback page are checked in the browser pane at desktop and phone size, light and dark, and Technician / Manager / feedback page on a real phone | User instruction; 0010 practice |
| One commit for the feature after every acceptance criterion passes | User instruction |

Decisions made by this PRD (answered 2026-10-24):

| Decision | Rationale |
|---|---|
| Calm modern business look: white surfaces, soft borders, one strong brand colour, roomy spacing (Q1) | Easy on the eyes all day; reads as a modern commercial product |
| Brand colour icy cyan / teal (around Tailwind `cyan-700`, `#0e7490`), with neutral slate greys and the usual green / amber / red for success / warning / danger (Q2) | "Sejuk" = cool air; stands apart from default blue apps |
| Logo mark: a snowflake in a rounded cyan square plus the name, drawn in code (SVG / icon), no image files (Q3) | Same mark on the app shell, sign-in, email-link and customer pages |
| "Sejuk Sejuk" in the app shell; full "Sejuk Sejuk Service" on the sign-in page, the email-link page and the customer feedback page (Q4) | Short in the menu, full company name where outsiders see it |
| Font Poppins, bundled with the app (npm `@fontsource/poppins`, approved; regular, medium, semibold, bold); no request to Google at run time (Q5) | The user's choice; works on weak site signal and leaks no visits |
| Icons from Lucide (npm `lucide-react`, approved); only the icons used are bundled (Q6) | Large, consistent line-icon set |
| Light and dark themes: follow the device setting, with a Light / Dark / System switch in the user menu, remembered on the device (Q7) | Technicians work at night; staff can choose |
| Desktop: a left sidebar with icons and labels, collapsible to icons only, with the user menu (name, role, branch, theme, change password, sign out) at the bottom (Q8) | Common business-tool layout; frees the top of the page |
| Phone: a bottom tab bar with up to 4 icon tabs per role and "More" for the rest; a slim top bar with the logo and the user menu (tablet width decided in the plan) (Q9) | Under the thumb; never wider than the screen |
| Ask stays a floating round button on every size, placed above the bottom bar and any sticky action bar; the person can drag it to another spot; it goes back to the default corner each time the app opens (Q10, Q10b) | The user's choice; dragging moves it out of the way when it covers something |
| Lists on phone are compact cards (number, customer, who, when, amount, status); tap for the full page (Q11) | About 4 per screen with the key facts |
| Phone filters: a search box plus a "Filters" button that opens a bottom sheet; chosen filters show as removable chips; desktop keeps an inline filter bar (Q12) | Orders show on the first phone screen |
| Success shows as a small pop-up (toast) for about 4 seconds; errors stay next to the field or box that caused them (Q13) | Confirms without pushing the page down |
| Loading shows grey placeholder shapes (skeletons) in the page's layout (Q14) | No jumping when data arrives |
| Dashboard and My week on phone: number tiles two per row, leaderboard as a compact ranked list (tap for details), charts full width (Q15) | About 3 screens instead of 7 |
| Order, review and finance pages on desktop: details on the left, an action panel (status, money, main buttons) on the right that stays in view; on phone one column with the main button stuck to the bottom (Q16) | The main action is always next to the facts it depends on |
| Sign-in: split screen on desktop (cyan brand panel with logo, "Sejuk Sejuk Service" and one line about the system; form on the right); logo then form on phone; show-password button (Q17) | First impression of a real product |
| Customer feedback page: branded phone page (logo header, "How did we do?", big tap-friendly stars, one question per card, friendly thank-you / used / expired / replaced pages) (Q18) | Customers trust and finish it |
| The feedback page gets an EN / BM switch: English first, the choice remembered on the customer's phone; only the page's own wording changes (the answers sent stay the same values; messages that come from the database stay as they are) (Q19, Q19b) | The user's choice; many customers read Malay better |
| The README shows 4-6 "after" screenshots taken from demo data (Q20) | Reviewers see the product before reading |

## Constraints

- No backend change of any kind; the hosted project is shared with the live
  app, so the manual check uses demo data or approved test data that is
  cleaned up afterwards.
- Tests run on jsdom: components must keep accessible names (roles, labels)
  that tests query; a renamed label means an updated test, never a removed
  check.
- The build must stay fast on a phone: fonts and icons are bundled (no
  third-party font or icon servers at run time), Recharts stays loaded only
  with the dashboard pages.
- Tailwind CSS 4 is configured in CSS (`@theme`), not a JS config file.
- The Ask panel, dialogs and toasts must not cover the main action button
  on any screen size.
- Customer-facing pages are public and signed out: no staff navigation, no
  staff data.
- `npm test`, `npm run typecheck`, `npm run build` and `validate_config.py`
  pass.

## Acceptance Criteria

| # | Criterion | Verifiable By |
|---|---|---|
| 1 | One set of design tokens (colours, type, spacing, radius, shadow) drives every screen; no screen keeps its own one-off colours | review + test |
| 2 | The brand (name, logo mark, colours) shows on the sign-in page, the app shell, the email-link page and the customer feedback page | manual check |
| 3 | Navigation per role matches the chosen pattern on desktop and phone; no page is wider than the screen at 375, 768 or 1280 px | manual check + test |
| 4 | Every list screen shows a designed empty state, a loading placeholder and an error state with a retry | test + manual check |
| 5 | Success after a save shows the chosen confirmation (Q13) and errors show next to the field or box that caused them | test + manual check |
| 6 | On a phone the main action of the job page, review page and finance page is always visible and never covered by Ask or a toast | manual check |
| 7 | Phone filters on Orders, Staff, AI log and queues are folded behind a control with active-filter chips (Q12) | manual check |
| 8 | Dashboard and My week on a phone are compact (the chosen layout, Q15) and charts read well in both themes | manual check |
| 9 | Ask chat looks and works the same on every role, desktop and phone; the floating button starts above the bottom bar and action bars, can be dragged, and is back in its corner after a reload (Q10) | test + manual check |
| 10 | Sign-in, `/auth/confirm` and every feedback page state (open, sent, used, expired, replaced, invalid) use the new design | test + manual check |
| 10a | The feedback page opens in English; EN / BM switches every word the page itself shows; the choice is remembered on the phone; the answers sent are the same as before (Q19) | test + manual check |
| 11 | Light and dark themes (Q7) pass AA contrast; keyboard focus is visible everywhere; icon-only buttons have labels; tap targets ≥ 44 px | test + manual check (axe in the browser pane) |
| 12 | All data, actions and permissions are unchanged: the same buttons appear for the same role and status as before | test |
| 13 | Before / after screenshots for every screen group at 1280, 768 and 375 px; the README shows 4-6 "after" screenshots from demo data (Q20) | manual check |
| 14 | Technician and Manager pass a real-phone check; the customer feedback page passes a real-phone check | manual check |
| 15 | `npm test`, `npm run typecheck`, `npm run build` and `validate_config.py` pass | test |

## Roadmap Phase

**Phase:** 6 – Polish

## Related Documents

| Document | Type | Relationship |
|---|---|---|
| `docs/prd/0000-programmer-assessment-brief.docx` | Source brief | "Design & Branding": clean UI, simple UX, practical design |
| `docs/decisions/0020-add-ui-ux-enhancement-feature.md` | Decision log | Why 0011 and Phase 6 were added |
| `docs/0001-admin-order-portal-workflow.md` … `docs/0010-production-deployment-workflow.md` | Workflow | What each screen does today (must not change) |
| `docs/product-roadmap.md` | Roadmap | Phase assignment and sequencing for this PRD |
| `docs/plan/0011-ui-ux-enhancement-plan.md` | Plan | Implementation path for this PRD |
| `docs/0011-ui-ux-enhancement-workflow.md` | Workflow | Design system and screen patterns in use |
| `docs/reference/folder-structure.md` | Reference | Structural placement of the feature |
| `docs/decisions/NNNN-*.md` | Decision log | Divergences from this PRD |

## Open Questions

All answered on 2026-10-24; decisions are recorded in Product Decisions.

- [x] **Q1. Look and feel.** Calm modern business app.
- [x] **Q2. Brand colour.** Icy cyan / teal.
- [x] **Q3. Logo mark.** Snowflake in a rounded square plus the name.
- [x] **Q4. Name shown.** "Sejuk Sejuk" in the app, "Sejuk Sejuk Service"
  on sign-in, email-link and customer pages.
- [x] **Q5. Font.** Poppins (Google font), bundled from npm.
- [x] **Q6. Icons.** Lucide (`lucide-react`).
- [x] **Q7. Dark mode.** Light and dark, follows the device, with a switch.
- [x] **Q8. Desktop navigation.** Left sidebar.
- [x] **Q9. Phone navigation.** Bottom tab bar.
- [x] **Q10. Ask on phone.** Floating button on every size, draggable.
- [x] **Q10b. Dragged Ask button.** Back to the default corner each time
  the app opens.
- [x] **Q11. Lists on phone.** Compact cards.
- [x] **Q12. Filters on phone.** Search plus a Filters sheet with chips.
- [x] **Q13. Success messages.** Toasts; errors stay inline.
- [x] **Q14. Loading.** Skeletons.
- [x] **Q15. Dashboard on phone.** Compact phone layout.
- [x] **Q16. Order / review / finance page.** Details left, action panel
  right.
- [x] **Q17. Sign-in page.** Split screen.
- [x] **Q18. Customer feedback page.** Branded phone page.
- [x] **Q19. Malay on the customer page.** EN / BM switch in 0011.
- [x] **Q19b. First language.** English first, choice remembered.
- [x] **Q20. README screenshots.** Yes, 4-6 from demo data.
