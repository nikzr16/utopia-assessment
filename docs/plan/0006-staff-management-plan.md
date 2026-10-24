# 0006 - Staff Management Implementation Plan

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

Build `docs/prd/0006-staff-management-prd.md` on top of 0000–0005. One new
migration adds joined / left dates, an append-only staff history, the new
staff rules (technician mobile phone, unique active phone, open jobs, last
Admin / Finance), and the staff functions the screens call. One Supabase
Edge Function, `staff-access`, is the only code that holds the secret key:
it creates sign-ins by invite email, sends reset emails, changes sign-in
emails, and blocks or unblocks sign-in. A Staff screen for Admins and
Managers lists, adds, edits, deactivates, and reactivates staff; new
public auth pages let a person set their password from the email link; every
staff member can change their own password.

Everything is built and tested locally against the hosted project; the
email links open the local app until 0010 `production-deployment`.

## Technical Approach

- **The database stays the rule authority.** Who may change whom, the
  phone rules, open jobs, last Admin / Finance, and the 0004 "Manager
  first" rules are SQL; `src/domain/staff.ts` mirrors the pure rules and
  `tests/db/parity.test.ts` checks both.
- **One server function for everything that touches Auth (P1).** The
  browser calls `staff-access` with the signed-in person's token and an
  action. The function first calls the staff RPC **as the caller** (so
  `auth.uid()` is the caller, every rule and permission is checked, and the
  history row is written), then uses the secret key for the Auth admin
  call. The browser never calls the Auth admin API and never sees the key.
  Actions:
  | Action | Database step (as caller) | Auth step (secret key) |
  |---|---|---|
  | `create` | `create_staff(...)` → new row | `inviteUserByEmail(email, redirectTo)`; link the new user id to the row (`link_invited_staff`, service role only) |
  | `resend_invite` | `staff_access_event(id, 'invite_sent')` (checks permission, not yet signed in) | invite again |
  | `reset_password` | `staff_access_event(id, 'password_reset')` | send the reset email |
  | `update` | `update_staff(...)` (incl. email) | if the email changed: change the sign-in email (confirmed, no email to the person); a not-yet-accepted invite is sent again to the new address |
  | `deactivate` | `set_staff_active(id, false)` | block sign-in (ban) |
  | `reactivate` | `set_staff_active(id, true)` | unblock, then send a password-set email |
  If the Auth step fails after the database step succeeded, the function
  answers "Saved, but <step> failed: <reason>" and the screen offers the
  step again (e.g. "Send invite again"). A deactivated person whose ban
  failed still reads nothing: the database blocks inactive staff already.
- **Email links (P2, P3).** Invite and reset emails go through Gmail SMTP
  (`smtp.gmail.com`, port 465, a Gmail address with 2-step verification
  and an app password), set by you in the Supabase dashboard (P2). The two email templates link
  to `<app>/auth/confirm?token_hash=…&type=invite|recovery`; that public
  page shows a "Continue" button (so mail scanners opening the link do not
  use it up), calls `verifyOtp`, then shows "Choose your password" and
  saves it with `updateUser`. Links last 24 hours (Auth setting); an
  expired link says "This link has expired. Ask your administrator to send
  a new one." The app's address is sent as `redirectTo`; the hosted
  project's allowed redirect list holds the local addresses
  (`http://localhost:5173`, `http://[::1]:5174`, `http://[::1]:5175`).
- **Linking.** The function links the invited Auth user to the staff row by
  id at invite time, so later email changes, bans, and resets always find
  the right account. The 0000 email-match link trigger stays for the
  script (Q16).
- **Schema.**
  - `staff.joined_at timestamptz not null default now()` (existing rows
    backfilled to 2026-10-22 00:00 Malaysia time, the day the foundation
    seed was applied); `staff.left_at timestamptz` set on deactivate,
    cleared on reactivate.
  - `staff_history`: `staff_id`, `actor_id` (null for set-up scripts),
    `action` (`created`, `updated`, `cover_changed`, `deactivated`,
    `reactivated`, `invite_sent`, `password_reset`), `changes jsonb`
    (`{field: {from, to}}`, names not ids for branches), `created_at`.
    Append-only trigger like `audit_log`. Written by a trigger on `staff`
    for every insert / update (so SQL changes are recorded too, with
    actor = `_current_staff_id()` or null) and by `staff_access_event` for
    invites and resets. Never a password.
  - The 0006 snapshot of history rows lets 0007 rebuild "active
    technicians in branch X on date D" (role, branch, active over time).
- **Rules (P5).** Triggers on `staff`, so SQL changes obey them too:
  - Technician phone must be a Malaysian mobile (`_is_my_mobile`, 0001);
    others mobile or landline (existing rule).
  - Phone unique among active staff: friendly check ("60123456789 is
    already used by Ali") plus a partial unique index as the backstop.
  - A technician with Assigned / Acknowledged / In Progress orders cannot
    be deactivated or change role: "Ali has 3 open jobs. Reassign them
    first." (the screen lists them via `staff_detail`).
  - Last active Admin / last active Finance cannot be deactivated or
    change role (checked at commit, like 0004).
  - In the RPCs (need the actor): nobody deactivates themselves or changes
    their own role; a Manager may act only on technicians whose home
    branch they cover, may move them only between covered branches, and
    may not change role or cover; only Admins change cover.
  - A role change away from Manager clears `additional_branch_ids` in the
    same update; the 0004 deferred check then guards the branches.
- **Reads.**
  - `staff_list(p_search, p_role, p_branch_id, p_status, p_page)` → rows
    (name, role, home branch, additional branches, phone, email, active,
    joined / left, sign-in state: `invite_pending` / `active` / `blocked`)
    plus `total`; 25 per page, by name. Admins see everyone; Managers see
    staff whose home branch or cover touches a branch they cover. Sign-in
    state comes from `auth.users` through the definer function only.
  - `staff_detail(id)` → profile, what the caller may do
    (`can_edit`, `can_deactivate`, …), open jobs (order no, status), and
    history (latest first).
  - `branch_cover_overview()` → each branch, its covering Managers (home /
    additional), active staff count, and "no Manager" flag.
  - `staff_form_check(...)` → the same warnings the save would hit
    ("Kota Kinabalu has no Manager…", last-Manager, open jobs, duplicate
    phone), so the form warns before Save (PRD Q6); the save's own error
    is still the final word.
- **Inactive tag (PRD Q9, P6).** Reads that return a staff name used on
  staff screens also return that person's `active` flag, and the UI adds
  "(inactive)" with `staffLabel(name, active)`. The customer WhatsApp text
  and the public feedback page never carry the tag.
- **Signed-out deactivated person (PRD Q7, P4).** Immediate and final:
  - A new RLS policy lets a signed-in person read **their own** staff row
    even when inactive (nobody else's), and `staff` joins the
    `supabase_realtime` publication. `AuthProvider` subscribes to its own
    row; when `active` turns false it shows "Your account is no longer
    active" and signs out at once (about a second after Save).
  - Fallbacks if the live connection is down: re-check `current_staff` on
    window focus and whenever an RPC fails with the "no active staff
    profile" error.
  - The ban blocks signing in again and token refreshes; the sign-in form
    maps Auth's "banned" error to "Your account is no longer active. Ask
    your administrator." The database already gives inactive staff no
    data, so nothing is readable in between.
- **Screens.**
  - Admin and Manager nav gain **Staff**. Routes: `/staff`,
    `/staff/new`, `/staff/:id`, `/staff/:id/edit`.
  - `StaffListPage`: search box, role / branch / status filters (in the
    address), table on desktop, cards below 768 px, paging, Add button
    (Admins; Managers for technicians). Above it, `BranchCoverPanel`
    (collapsible on a phone).
  - `StaffForm` (add / edit): name, email, phone, role (Admins only;
    Managers add technicians only), home branch, "Also covers" branch
    checkboxes (Admins, Managers only). Warnings from `staff_form_check`
    appear under the fields before Save.
  - `StaffPage`: profile, sign-in state, open jobs with links, actions
    (Edit, Deactivate / Reactivate with a confirm dialog, Send invite
    again, Send password reset), and history.
  - Public routes before the sign-in check: `/auth/confirm` →
    `SetPasswordPage`. Staff header menu: **Change password**
    (`/account/password`): current password (checked by signing in
    again, P7), new password twice.
  - Rework return of an inactive technician's job: the Admin order page
    shows "Ali is no longer active — reassign" (from the order's
    technician `active` flag).

## System Components

| Component | Responsibility |
|---|---|
| `supabase/migrations/20261023000004_staff_management.sql` | `joined_at` / `left_at` + backfill, `staff_history` + append-only + recording trigger, staff rules triggers, active-phone index, `create_staff`, `update_staff`, `set_staff_active`, `staff_access_event`, `link_invited_staff` (service role), `staff_list`, `staff_detail`, `branch_cover_overview`, `staff_form_check`, `active` flags on staff names in existing reads, own-row read policy, `staff` in the Realtime publication (guarded for PGlite), RLS and grants |
| `supabase/functions/staff-access/handler.ts` | Action routing, caller check, database-then-Auth steps, partial-failure answers; plain TypeScript with injected clients so Vitest can test it |
| `supabase/functions/staff-access/index.ts` | Deno entry: CORS, builds the caller and secret-key clients from the function's environment, calls the handler |
| `src/domain/staff.ts` | Role / phone rule, open-job statuses, `canManageStaff` mirror, form validation, history labels, `staffLabel`, sign-in state labels |
| `src/features/staff/` | `StaffListPage`, `BranchCoverPanel`, `StaffForm`, `StaffPage`, `StaffHistory`, `api.ts` (RPC reads; writes through the function) |
| `src/features/auth/` | `ConfirmLinkPage` / `SetPasswordPage`, `ChangePasswordPage`, inactive re-check in `AuthProvider` |
| `src/App.tsx`, `AdminPortal`, `ManagerPortal`, `AppHeader` | Public `/auth/confirm`; Staff nav and routes; Change password menu item |
| Existing staff-name reads (`order_summary`, history, payments, messages, feedback, queues) | Return the `active` flag for the "(inactive)" tag |
| `docs/draft/0006-supabase-update.sql` | Hosted SQL: the migration (git-excluded) |
| `docs/draft/0006-auth-setup.md` | Your dashboard steps: SMTP, email templates, link expiry, redirect URLs, function deploy (git-excluded) |

## Processing Flow

1. **Add.** Farid opens Staff → Add, enters "Ravi, technician, Shah Alam,
   ravi@…, 012-345 6789". Warnings appear before Save if any. Save → the
   function runs `create_staff` as Farid (rules + history), invites Ravi,
   links the account. The page shows "Invite sent to ravi@…".
2. **Accept.** Ravi opens the email → `/auth/confirm` → Continue → Choose
   your password → he lands in the Technician portal.
3. **Manager adds.** Nurul (Shah Alam) adds a technician to Shah Alam the
   same way; the role is fixed to Technician and only her covered branches
   are offered.
4. **Edit / move / cover.** Farid moves Ali to KL (jobs stay, note shown);
   gives Mei Ling cover of Kota Kinabalu; the panel updates.
5. **Deactivate.** Farid deactivates Bala (no open jobs). The function sets
   Bala inactive and blocks his sign-in; Bala's open app shows "Your
   account is no longer active" and signs out at once; signing in again
   is refused.
6. **Reactivate.** Farid reactivates Bala; Bala gets a password-set email.
7. **Reset.** Ravi forgets his password; Nurul presses Send password
   reset; Ravi sets a new one from the email; his other sessions end when
   the password changes (Supabase behaviour).
8. Every step above adds a line to the person's history.

## Dependencies

| Dependency | Purpose |
|---|---|
| Supabase Postgres, Auth (existing) | Rules, RLS, sign-ins, invite / recovery emails |
| Supabase Edge Functions (new on this project) | `staff-access`, the only holder of the secret key |
| Gmail SMTP with an app password (P2) | Sends the invite and reset emails (free, about 500 a day) |
| Supabase Realtime (existing) | Pushes the person's own deactivation to their open app (P4) |
| Supabase CLI via `npx supabase` (P8) | Deploys the function; no install, you sign in to it yourself |
| PGlite test harness (`tests/db/helpers.ts`) | Migration chain, roles, `auth.users` shim |

No new npm packages in the app.

## Implementation Phases

### Phase 1: Database

- The migration above.
- Tests: `tests/db/staff.test.ts` (create / update / deactivate /
  reactivate per role: Admin, covering Manager, other Manager, technician,
  Finance; self-guards; last Admin / Finance; open jobs; technician
  mobile; duplicate active phone; Manager-first and last-Manager messages
  through the RPCs; `staff_form_check` warnings; history rows for RPC and
  plain SQL changes; joined / left dates; list search, filters, paging,
  Manager scope; sign-in state), `access.test.ts` (new functions not
  callable signed out; `link_invited_staff` service role only;
  `staff_history` not readable directly), branch-cover tests still pass;
  parity cases.

### Phase 2: Domain and server function

- `src/domain/staff.ts` and tests.
- `staff-access` handler and tests with fake clients: caller without a
  token or profile refused; every action runs the database step first and
  stops on its error; Auth failure after a database success returns the
  "Saved, but…" answer; the secret key never appears in a response.

### Phase 3: Screens

- Staff list, panel, form, staff page, history; auth confirm / set
  password; change password; inactive re-check; "(inactive)" tags;
  rework-to-inactive note; nav and routes.
- UI tests: filters in the address, paging, Manager sees no role / cover
  fields, warnings before Save, partial-failure banner with retry, confirm
  dialogs, expired link page, password rules, inactive sign-out, tag
  rendering, labels at 375 px.

### Phase 4: Verify and document

- `npm test`, `npm run typecheck`, `npm run build`, `validate_config.py`.
- `docs/draft/0006-supabase-update.sql` and `docs/draft/0006-auth-setup.md`;
  you run the SQL, set up SMTP / templates / redirects, and deploy the
  function (I give each step).
- Manual check on hosted Supabase, local app, desktop first and 375 px:
  Admin in one tab, a Manager in a second (`web-second-role`), each new
  test staff member in their own tab (`web-third-role`). Test staff use
  real mailboxes you choose; test data only with your OK; cleanup in
  `docs/draft/0006-cleanup-test-staff.sql` plus deleting their sign-ins in
  Supabase Auth (you press Run / Delete).
- Workflow doc `docs/0006-staff-management-workflow.md`, 0004 workflow
  stage 0 note, folder structure, decision log, roadmap,
  `CLAUDE.project.md` (rule 8).

## Testing Strategy

- **Database (PGlite):** full migration chain; each rule has a passing and
  a failing case; every function called as signed out, Admin, covering /
  other Manager, technician, Finance, and inactive staff.
- **Parity:** one case table through TypeScript and SQL for the
  role / phone rule, who-may-manage-whom, open-job statuses.
- **Server function:** handler tests with fake database and Auth clients
  (Vitest); the Deno entry is kept thin and checked in the manual test.
- **UI (jsdom):** list, form, staff page, auth pages, inactive sign-out.
- **Manual:** add a technician (invite → set password → sign in), a
  Manager adds a technician, edit and move, cover change with panel
  update, blocked deactivation with open jobs, deactivate with the person
  signed in, reactivate, reset, change own password, phone width.

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Secret key leaks to the browser | Anyone could create or change sign-ins | Key exists only in the function's environment; handler tests assert no response carries it; the app has no `VITE_` secret |
| Function trusts a forged caller | Unauthorised staff changes | Every action starts with the staff RPC run as the caller's token; the database decides; the function adds no permission of its own |
| Database step succeeds, Auth step fails | Row without invite, or inactive but not blocked | "Saved, but…" answer with a retry; inactive staff read nothing anyway |
| Supabase Edge Functions' built-in JWT check does not accept the project's new-style keys | Function refuses every call | Deploy with the built-in check off and verify the caller's token inside the function (`auth.getUser`) |
| Email lands in spam or Gmail's daily limit is hit | Person never gets the link | Resend button; history shows when it was sent; Gmail's limit is far above our volume |
| The own-row read policy exposes more than intended | An inactive person reads data | The policy matches only `auth_user_id = auth.uid()` on `staff`; every other table still needs an active profile; access tests cover it |
| The live connection is down when someone is deactivated | Sign-out waits | Focus and refused-action re-checks; the ban and the database block access meanwhile |
| Mail scanners open the link first | Link used up before the person clicks | Confirm page needs a Continue press (P3) |
| Email links point at `localhost` | Links work only on this computer | By design until 0010 sets the real address |
| Adding `active` flags to existing reads breaks earlier screens | Regressions in 0001–0005 | Existing UI and DB tests must still pass; columns only added |
| Hosted data breaks a new rule (duplicate phone, technician landline) | Migration fails on hosted | Seed phones are unique mobiles; the SQL draft checks first and reports offending rows |

## Roadmap Phase

**Phase:** 2 – Core workflow

## Related Documents

| Document | Type | Relationship |
|---|---|---|
| `docs/product-roadmap.md` | Roadmap | Phase assignment and sequencing for this plan |
| `docs/prd/0006-staff-management-prd.md` | Intent | Product goals and constraints this plan implements |
| `docs/0006-staff-management-workflow.md` | Workflow | Runtime behavior derived from this plan |
| `docs/0004-review-and-close-workflow.md` | Workflow | Branch cover and "Manager first" rules this feature puts on screen |
| `docs/reference/folder-structure.md` | Reference | Structural placement of planned components |
| `docs/decisions/0010-insert-staff-management-feature.md` | Decision log | Why staff management is its own feature |
| `docs/decisions/NNNN-*.md` | Decision log | Divergences from this plan |

## Open Questions

Each question listed options, recommended first, with a short scenario.
All answered 2026-10-23.

- [x] **P1. How the screen reaches the server function.** (a) One call per action; the function does the database step, then Auth.
- [x] **P2. Email service.** Gmail SMTP with an app password (option b).
- [x] **P3. What the email link does.** (a) A "Continue" page, then "Choose your password"; valid 24 hours.
- [x] **P4. How fast an open session notices deactivation.** Immediately: a live push on the person's own staff row signs them out at once, and the ban stops them signing in again (new option, replacing a / b).
- [x] **P5. Where the new rules live.** (a) Database triggers for data rules; RPCs for who may act.
- [x] **P6. Where "(inactive)" appears.** (a) Every staff name on staff screens; never in WhatsApp text or the public page.
- [x] **P7. Change my password.** (a) Current password first.
- [x] **P8. Deploying the server function.** (a) Supabase CLI through `npx`.
