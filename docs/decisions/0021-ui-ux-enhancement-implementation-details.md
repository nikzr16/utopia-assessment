# 0021 - UI/UX Enhancement Implementation Details

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

Feature 0011 redesigned every screen on one design system (PRD 0011, plan
0011). Building and checking it at 375, 768 and 1280 px, light and dark,
with every role and a full order flow on the hosted demo data, led to the
choices below that the PRD and plan did not spell out, or changed.

## Decision

1. **Breakpoints.** Phone < 768 px (bottom bar), tablet 768–1023 px (icon
   rail; labels and the unread count become sr-only text and a red dot),
   desktop ≥ 1024 px (sidebar). Detail pages switch to two columns and the
   KPI leaderboard to a table at 1024 px, because a 10-column table and a
   side panel do not fit beside the rail at tablet width.
2. **One `nav` for every size.** The sidebar, icon rail and bottom bar are
   one `<nav>` drawn differently by CSS, so tests and screen readers meet
   each menu link once. The account menu is rendered once and moved to the
   top bar on a phone. Admin's "New order" and "AI log" sit under "More" on
   a phone ("New order" is also the main button on Orders); "Orders" stays
   highlighted on every order page except New order.
3. **Change password inside the frame.** `/account/password` is a route in
   each portal (was outside the portal), so the page keeps the menu.
4. **Toasts are rendered by the page** that shows the message (no global
   provider), so existing tests keep finding the same text; they sit above
   the Ask button and the action bar.
5. **Action bar height** is shared as `--action-h`, so the Ask button and
   toasts never cover the main buttons; a bar that sits in a side panel from
   1024 px (Admin order page) shares 0. The Manager / Finance review page
   puts its buttons in the side panel on wide screens and in the action bar
   on narrow ones (`useWide`), so each button exists once.
6. **Review / finance side panel shows the money** (final amount, paid,
   balance) beside the main buttons; it only shows fields the page already
   loads.
7. **Wording changed** where the old text described a position that no
   longer holds: the Manager hint "…Send the message below (or call)
   first." → "…Send the customer message (or call) first."; "See Warnings
   below." → "See Warnings."; the Admin toast "…on WhatsApp below." → "…on
   WhatsApp."; back links lost their "←" (the arrow is an icon now). Tests
   were updated with the same checks.
8. **Notifications** (user feedback during the check): a narrow list (about
   720 px), one line per notification on wide screens, unread as a dot and a
   bold message instead of an "Unread" word on the far right.
9. **Phone leaderboard rows** show rank, name, branch, rating, amount and
   jobs; a figure you sort by (collected, reschedules, returned, poor
   ratings) is added to each row. The desktop table and the technician page
   still show every figure.
10. **Colour tokens added during the build:** `panel` / `on-panel` (deep
    teal sign-in panel that stays dark in both themes), `on-danger`,
    `on-whatsapp`; light `ink-faint` darkened to `#5b6a7d` to pass AA on the
    page background. Role badges: Admin cyan, Manager blue, Finance amber,
    Technician grey.
11. **Malay counter word** "huruf" instead of "aksara" (the user's choice:
    "aksara" reads as Indonesian).
12. **Accessibility in tests:** `vitest-axe` 0.1 works with Vitest 3; it
    checks the Admin and Technician frames and the sign-in page (colour
    contrast is checked in the browser, because jsdom cannot measure it).
13. **Manual check** ran on the local dev server against the hosted project
    with one approved test order (ORDER1242, "Test Customer 0011"), cleaned
    up with `docs/draft/0011-cleanup-test-orders.sql` and one Storage folder
    deleted by hand. The real-phone check (technician, Manager, feedback
    link) runs on the `dev` preview after the merge (the user's choice).

## Reason

Each choice keeps the PRD's goals (fits every screen, main action always in
reach, no rule or data change) while keeping today's tests as proof that
behaviour did not change.

## Impact

- [x] Workflow doc updated (`docs/0011-ui-ux-enhancement-workflow.md`)
- [x] Reference doc updated (`docs/reference/folder-structure.md`)
- [x] No upstream doc update needed (PRD and plan stay as intent)
