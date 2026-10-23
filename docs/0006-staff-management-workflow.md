# 0006 - Staff Management Workflow

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

How staff are managed on screen: Admins (and Managers, for their own
technicians) list, add, edit, deactivate and reactivate staff; a new person
gets an invite email and chooses their own password; a deactivated person is
signed out at once and cannot sign in; every change is recorded. The rules
live in `supabase/migrations/20261023000004_staff_management.sql`; sign-ins
are changed only by the `staff-access` server function
(`supabase/functions/staff-access/`), the only code that holds the Supabase
secret key. Screens: `src/features/staff/` and the password pages in
`src/features/auth/`.

## Trigger

- An Admin or Manager opens **Staff** (`/staff`) and adds, edits,
  deactivates, reactivates, or sends an invite / password reset.
- A person opens the invite or reset email link (`/auth/confirm`).
- A signed-in person chooses **Change password** (`/account/password`).
- A person's staff row turns inactive while their app is open.

## Preconditions

- The hosted database has the 0006 migration
  (`docs/draft/0006-supabase-update.sql`).
- `staff-access` is deployed with the JWT check off:
  `npx supabase functions deploy staff-access --project-ref <ref> --no-verify-jwt --use-api`
  (`supabase/config.toml` sets the same).
- Supabase Auth: custom SMTP (Gmail app password), the Invite user and Reset
  password templates link to
  `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=invite|recovery`,
  Redirect URLs list each app address's `/auth/confirm`, Email OTP
  Expiration 86400 (24 h), sign-up off. Steps: `docs/draft/0006-auth-setup.md`.
- The seeded staff keep their script sign-ins (`npm run
  auth:create-staff-logins`, for setting up a fresh project only).

## Stages

### 1. Who may do what — `_staff_manage_error`, `_staff_change_errors`

| Person | May |
|---|---|
| Admin | Everyone: add, edit (incl. email, role, home branch), branch cover, deactivate / reactivate, invite, password reset |
| Manager | Technicians whose home branch they cover: add, edit name, phone and home branch (covered branches only), deactivate / reactivate, invite, password reset. Never a role, an email, or branch cover |
| Technician, Finance | No staff screen |

Nobody changes their own role or deactivates themselves. The database
decides every time (RPCs as the signed-in person); the screen only hides what
`staff_detail.permissions` says is not allowed. Mirrored by `staffManageError`.

### 2. Staff list — `/staff`, `staff_list`, `branch_cover_overview`

**Who is listed:** Admins see everyone; a Manager sees staff whose home branch or cover touches a branch they cover.
**Search:** name, email, phone (digits typed with `0` / `60` match from the start of the number, otherwise anywhere). **Filters:** role, branch (home or covered), Active (default) / Inactive / All. By name, 25 per page; search, filters and page live in the address.
**Shown:** name, email, role, home branch and "Also covers …", phone, sign-in state, Active / Inactive with joined or left date. A table on wide screens, cards below 768 px.
**Branch cover panel:** "Branch cover: every branch has a Manager" (closed) or "<branch> has no Manager" (open, red); each branch with its Managers ("Name (cover)" for additional cover) and active staff count.

### 3. Add — `/staff/new`, server function `create`

**Form:** Name, Email ("They sign in with this email"), Phone, Role (Admins: all four; Managers: Technician only, fixed), Home branch (Admins: all; Managers: covered branches), Also covers (Admins, Managers only, home branch not offered).
**Before Save:** the form checks itself (`validateStaffForm`) and asks the database 0.4 s after typing stops (`staff_form_check`): phone in use, technician without a mobile, email in use, "Manager first", last Manager, last Admin / Finance. Database problems show under their field once it was touched (branch / role / cover at once).
**Save:** `staff-access` runs `create_staff` as the person (rules, history) → `inviteUserByEmail` with `redirectTo = <app>/auth/confirm` → links the new sign-in (`link_invited_staff`, secret key only) → `staff_access_event('invite_sent')`. The page shows "<Name> is added. An invite was sent to <email>." (about 10 s with Gmail).
**Invite fails:** the person stays added; amber "The invite email was not sent: <fixed reason>" with **Send the invite again**.

### 4. Email link — `/auth/confirm`, `ConfirmLinkPage`

**Route:** before any sign-in check (like `/f/:token`).
**Steps:** "Set up your sign-in" (invite) or "Choose a new password" (recovery) → **Continue** (`verifyOtp`; mail scanners that open the link do not use it up) → New password twice (8–72 characters) → **Save password** (`updateUser`) → "Your password is saved" → **Open the app**.
**Bad link:** "This link no longer works" (expired / used) or "This link is not complete…" (no token).
**Sign-in state** (`_staff_sign_in_state`): `none` (no sign-in yet: "No invite sent"), `invite_pending` (email not confirmed: "Invite sent, password not set yet"), `ready` ("Can sign in"). Opening the link confirms the email, so someone who pressed Continue but never saved a password shows `ready`; a password reset helps them.

### 5. Edit — `/staff/:id/edit`, server function `update`

**Form:** as Add, filled in (phone shown as `012-345 6789`). Email is disabled for Managers ("Only an Admin can change an email (it is how they sign in)"); Role is disabled when the person may not change it.
**Save:** `update_staff` as the person; a role other than Manager clears the cover; Managers' saves keep the cover unchanged (`p_additional_branch_ids` null).
**Email changed:** `ready` → the sign-in email is changed, confirmed, no email sent ("<Name> now signs in with <email>"). `invite_pending` → the unused sign-in is removed and a fresh invite goes to the new email (inactive: just removed). Failure → amber warning with **Change the sign-in email again** (`retry_email`) or **Send the invite again**.
**Moving a technician** with open jobs is allowed; the jobs stay with them.

### 6. Deactivate — server function `deactivate`

**Dialog:** "Deactivate <Name>? They are signed out at once and cannot sign in again. Their past jobs, payments and ratings stay as they are." When it would be refused (`staff_detail.permissions.deactivate_blocker`: open jobs, last covering Manager, last Admin / Finance) the dialog shows the reason and links the open jobs instead of the button.
**Save:** `set_staff_active(false)` (sets `left_at`, history) → ban the sign-in (`ban_duration 876000h`). "<Name> is deactivated, signed out, and cannot sign in." Ban failure → amber warning, **Block their sign-in again** (`retry_block`); the database already gives an inactive person no data.
**Their open app** (`AuthProvider`): a person may read their own staff row even when inactive (`staff_read_own`) and `staff` is in the Realtime publication, so the app hears `active = false` and signs out at once with "Your account is no longer active. Ask your administrator if this is a mistake." on the sign-in form. Fallbacks: a re-check of `current_staff` on window focus, on returning to the tab, and when any RPC fails with "Your account has no active staff profile" (`ACCESS_LOST_EVENT`). Signing in again shows the same message (Auth `user_banned`).

### 7. Reactivate — server function `reactivate`

`set_staff_active(true)` (clears `left_at`; "Manager first", phone rules apply) → lift the ban → a password email: reset (`ready`) or a fresh invite (otherwise). "<Name> is active again. A password email was sent to <email>." Their old password also works again.

### 8. Invite again / password reset — `resend_invite`, `reset_password`

`staff_access_check` first (permission, active, and: invite only before a password is set; reset only after). Invite again removes the unused sign-in and sends a fresh one. Reset sends the recovery email (`resetPasswordForEmail`); Supabase ends the person's other sessions when the new password is saved. Both are recorded in the history.

### 9. Change my password — `/account/password`

Every signed-in staff member ("Change password" in the header): Current password (checked by signing in with it again), New password twice → "Your password is changed. Use it the next time you sign in." Wrong current password: "Your current password is incorrect."

### 10. History and joined / left dates — `staff_history`

**Recorded** (trigger on every staff insert / update, SQL included; plus invite / reset events): `created`, `updated`, `cover_changed`, `deactivated`, `reactivated`, `invite_sent`, `password_reset`, with `changes` (`{field: {from, to}}`, branch names), the actor (null for scripts and plain SQL), and the person's role, home branch and active state after the change (for 0007). Linking a sign-in is not recorded. Never a password.
**Shown** on the staff page, latest first: "Branch cover changed · Fri 23 Oct 2026, 5:59 PM · by Farid Hakim" and lines such as "Also covers: none → Penang" (`describeStaffChanges`); "by set-up" when there is no actor.
**Dates:** `joined_at` (the day the profile was added; staff from before 0006: 22 Oct 2026 00:00 Malaysia time); `left_at` while inactive.

### 11. Inactive staff elsewhere — `staffName`, `useInactiveStaff`

Staff screens tag names "(inactive)": order list and summary, order history actors, completion, payments (recorded / verified by), rework note, Manager and Finance queues, approved / closed by, customer message (edited / sent by), feedback ("Taken by phone by"), staff history. The inactive ids are read once per page load (`staff` table under RLS) and refreshed after a deactivate / reactivate. Never in WhatsApp text, the public feedback page, or the history detail text written at the time ("Assigned to Bala"). Inactive staff are left out of the technician dropdown and get no notices (0000 / 0001). An Admin order page whose open job belongs to an inactive technician (a rework returned after they left) says "<Name> is no longer active. Reassign this job to another technician." and hides the WhatsApp send.

## Error States

| Error | Cause | Handling |
|---|---|---|
| "Only Admins and Managers can manage staff" / "…can see staff" | Technician or Finance | Rejected; no Staff tab |
| "Managers can only manage technicians" / "Managers can only add technicians" / "Only an Admin can change a role" / "Only an Admin can change an email" / "Only an Admin can change branch cover" | Manager outside their scope | Rejected; the form hides or disables the field |
| "Only a Manager of <branch> can manage <name>" / "You do not cover <branch>. Choose one of your branches." | Manager and another branch | Rejected / "Staff member not found" when not visible |
| "You cannot change your own role" / "You cannot deactivate yourself" | Self | Rejected; no button |
| "<Name> has N open jobs. Reassign them first." | Technician with Assigned / Acknowledged / In Progress jobs deactivated or role changed | Rejected (trigger too); dialog lists the jobs |
| "<Name> is the last active Admin / Finance user. Add another … first." | Last of the role | Rejected (checked at commit, one at a time per role) |
| "<Name> is the only Manager covering <branch>. Give another Manager cover of <branch> first." / "<branch> has no Manager. Add a Manager to this branch first." | "Manager first" (0004) | Warned before Save; rejected |
| "A technician needs a Malaysian mobile number for WhatsApp, for example 012-345 6789" | Technician landline | Warned; rejected (trigger too) |
| "This phone number is already used by <name>" / "This email is already used by <name>" | Duplicate (phone: active staff; email: anyone) | Warned; rejected (unique index too) |
| "Name is required" / "Enter a valid email address…" / Malaysian phone messages / "Choose a role" / "Select a valid branch" | Bad form | On the field |
| "<Name> has already set a password. Send a password reset instead." / "…has not set a password yet. Send the invite again instead." / "<Name> is inactive. Reactivate them first." | Wrong sign-in step | Rejected; the page offers the right button |
| "Saved, but…" warnings: invite not sent, sign-in not blocked / still blocked, sign-in email not changed | The Auth step failed after the database step | Amber banner with the retry button; Auth's own text goes to the function log only |
| "Too many emails were sent just now…" / "The email could not be sent…" / "This email cannot be used for a new sign-in…" / "The sign-in service did not accept this…" | Auth / SMTP errors (fixed sentences) | Shown in the warning |
| "This phone number or email is already used by someone else. Reload and try again." | Two saves at once hit a unique index | Rejected |
| "Your account is no longer active. Ask your administrator if this is a mistake." | Deactivated (open app or sign-in) | Signed out |
| "This link has expired or was already used…" | Old or used email link | Link page |
| "Unknown app address" | `redirectTo` not one of the app's addresses | Function rejects (400) |

## Defaults

| Setting | Default |
|---|---|
| Page size | 25 |
| Status filter | Active |
| Email link lifetime | 24 hours (Auth setting) |
| Password | 8–72 characters |
| Ban for inactive staff | 876000 h (lifted on reactivation) |
| App addresses for email links | `http://localhost:5173`, `:5174`, `:5176`, `:5177` (the app asks for `localhost` when the tab runs on `[::1]` / `127.0.0.1`); more via the function secret `APP_ORIGINS` (0010) |
| Joined date before 0006 | 22 Oct 2026 00:00 Malaysia time |

## Behavioral Constraints

- The Supabase secret key exists only in the `staff-access` function's
  environment; answers carry fixed sentences or database rule messages
  (`P0001`), never raw Auth / database text (`tests/functions/`).
- `staff_history` is append-only and readable only through `staff_detail`;
  rows go only with a deleted staff row (test cleanup), and a deleted actor
  becomes null.
- The rules hold for plain SQL too (triggers): stored phone form, technician
  mobile, phone unique among active staff, open jobs, last Admin / Finance;
  "Manager first" stays the 0004 commit check.
- `checkStaffName`, `checkStaffEmail`, `staffPhoneRoleError`,
  `openJobsError`, `staffManageError`, `OPEN_JOB_STATUSES` and
  `STAFF_HISTORY_ACTIONS` (`src/domain/staff.ts`) mirror the SQL;
  `tests/db/parity.test.ts` runs the same cases through both.
- Cleanup of test staff: delete their orders first, then the staff rows
  (history follows), then their `auth.users` rows; history of other staff
  needs `staff_history_no_update_trg` off in the transaction
  (`docs/draft/0006-cleanup-test-staff.sql`).

## Related Documents

| Document | Type | Relationship |
|---|---|---|
| `docs/prd/0006-staff-management-prd.md` | Intent | Product goals this workflow fulfills |
| `docs/plan/0006-staff-management-plan.md` | Plan | Architecture this workflow implements |
| `docs/0004-review-and-close-workflow.md` | Workflow | Branch cover and "Manager first" rules |
| `docs/0000-system-foundation-workflow.md` | Workflow | Roles, sign-in, the login script |
| `docs/reference/folder-structure.md` | Reference | File locations of workflow components |
| `docs/decisions/0014-staff-management-implementation-details.md` | Decision log | Divergences from the 0006 PRD and plan |
