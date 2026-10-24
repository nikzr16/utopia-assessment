# 0006 - Staff Management PRD

> **Type:** Intent | **Must stay current:** No -- record divergences in decision log

<!-- AI Context
Role: This document captures product intent, not implementation detail.
Use it to understand *what* the feature should do and *why*, then consult the
implementation plan and workflow docs for *how*.
Do not rewrite this document during coding. If implementation diverges from
the intent described here, add an entry to the decision log instead.
-->

## Purpose

Staff, their sign-ins, and Manager branch cover are changed by SQL and a
local script today, so nobody in the business can add a technician, move
someone to another branch, or let a Manager cover a branch without a
developer. This PRD adds a staff screen where the people who run the
business do that themselves, inside the database rules 0004 already
enforces ("Manager first", last covering Manager), and keeps the record of
who joined and left that the KPI dashboard (0007) will need.

Source: the brief's company profile (5 branches, 40+ technician teams,
roles Admin / Technician / Manager / Finance;
`docs/prd/0000-programmer-assessment-brief.docx`); 0004 PRD Q13 and
decision 0010 moved the staff screen here.

## Goals

- An authorised person lists, finds, adds, edits, deactivates, and
  reactivates staff on screen, with no SQL and no developer.
- A new staff member gets a working sign-in from the same screen, without
  the Supabase secret key ever reaching a browser.
- A Manager's branch cover is set on screen, and every "Manager first" or
  last-Manager refusal is shown as a clear message that says what to do.
- Deactivating someone cuts their access at once and never breaks history:
  orders, payments, messages, and ratings keep pointing at them.
- Every staff change is recorded (who, what, when), and the joined / left
  dates the KPI dashboard needs are kept.

## Non-Goals

- The KPI dashboard and its charts (0007); this feature only keeps the data.
- AI features (0008, 0009) and Vercel deployment (0010).
- Adding, renaming, or closing branches (the 5 branches stay seed data).
- Public sign-up, single sign-on, or two-factor sign-in.
- HR data (salary, leave, documents, IC numbers).
- Members inside a technician team (Q12): one technician profile is one
  field team with one sign-in, as today.
- Deleting staff rows: they are never deleted, only deactivated.

## Scope

| In Scope | Out of Scope |
|---|---|
| Staff list with search, filters, and paging for 40+ teams | KPI dashboard (0007) |
| Add a staff member and create their sign-in | Branch management |
| Edit name, phone, email, role, home branch | HR records |
| Set a Manager's additional branch cover | Team members within a technician team |
| Deactivate and reactivate | Deleting staff |
| Invite email for new sign-ins; reset email sent by an authorised person; change own password | A "Forgot password?" link on the sign-in page |
| Clear on-screen messages for "Manager first" and last-Manager rules | Changing the 0004 rules themselves |
| Handling a technician's open jobs on deactivation or move (Q5) | AI features (0008, 0009), deployment (0010) |
| Audit trail of staff changes; joined / left dates for 0007 | |

## User Stories

1. **As an Admin**, I want to add a new technician team with a sign-in so that they can start receiving jobs the same day.
2. **As an Admin**, I want to find a staff member quickly by name, phone, or email and filter by role, branch, and status so that I can manage 40+ teams without scrolling.
3. **As an Admin**, I want to move a technician to another branch or change someone's role so that the system matches how the business is organised.
4. **As an Admin**, I want to let a Manager cover another branch while that branch has no Manager so that its jobs are still reviewed.
5. **As an Admin**, I want to deactivate someone who left so that they can no longer sign in, while their past jobs, payments, and ratings stay intact.
6. **As an Admin**, I want a clear message when a change would leave a branch without a Manager, saying what to do first.
7. **As an Admin**, I want to reset a staff member's password when they forget it so that they are not locked out.
8. **As a new staff member**, I want to receive my first sign-in safely and then choose my own password.
9. **As a Manager**, I want to see the staff of the branches I cover and add or update my own technician teams so that I can run my branches without waiting for the office (Q1).
10. **As the business**, I want every staff change recorded with who made it and when, and each person's joined and left dates kept, so that the KPI dashboard can count active technicians per branch over time.

## Product Decisions

Decisions already fixed by the brief, 0000, 0001, 0004, or 0005:

| Decision | Rationale |
|---|---|
| Roles are Admin, Technician, Manager, Finance; each staff member has one role and one home branch | 0000 |
| Real Supabase Auth sign-in; public sign-up stays off; the Supabase secret key never reaches the browser | 0000, decision 0004 |
| Writes go through database functions; the actor is the signed-in user; every table has RLS | 0000 |
| Email is unique regardless of letter case; a sign-in is linked to the staff row by email | 0000 |
| Staff rows are never deleted: orders, audit history, payments, customer messages, and feedback point at them | 0000–0005 |
| A Manager covers their home branch plus any additional branches; only Managers may have additional branches | 0004 Q1 |
| A branch needs an active covering Manager before it has other active staff or orders; its last covering Manager cannot be deactivated, moved, or uncovered while other active staff remain (checked when the change is saved) | 0004 Q13 |
| Inactive staff can read nothing and are not offered in the technician dropdown; notices go to active staff only | 0000, 0001, 0004 |
| Phone numbers are stored as digits with the country code (`60123456789`); the technician's phone receives the assignment WhatsApp | 0000, 0001 |
| Each rating keeps the technician and branch of that visit, so later staff changes do not move it | 0005 |

Decisions made by this PRD (answered 2026-10-23):

| Decision | Rationale |
|---|---|
| Admins manage all staff and branch cover. A Manager adds, edits, deactivates, reactivates, and resets technicians whose home branch is one they cover, and may move a technician only between branches they cover; they cannot touch Admins, Finance, other Managers, roles, or branch cover. Technicians and Finance have no staff screen (Q1 b) | Branch Managers can onboard their own field teams; office-wide roles and cover stay with Admins |
| A new sign-in is created by a Supabase Edge Function that holds the secret key and checks the caller; the person gets an invite email and sets their own password from the link. Nobody ever sees or types their password. Every new staff member needs a real mailbox (Q2 b) | The secret key stays server-side; no password is ever handed over |
| An Admin (or the technician's covering Manager) can send a password reset: the person gets a reset email link and their other sessions end; every signed-in staff member can change their own password (Q3 a, by email per Q2) | Same safe channel as the invite |
| Name, phone, email, role, and home branch can change after creation; an email change also changes the sign-in email; a Manager who stops being a Manager loses their additional branches (Q4 a) | Typos and promotions are fixed in place; the unique email stays with one row |
| A technician with Assigned, Acknowledged, or In Progress jobs cannot be deactivated or change role until those jobs are reassigned; the message lists and links them. Moving their home branch is allowed and keeps the jobs, with a note. A rework returned to an inactive technician shows "no longer active — reassign" to the Admin (Q5 a) | No job is ever left with someone who cannot open it |
| The Staff page shows each branch with its covering Managers and active staff count; the form warns before saving when a change would break "Manager first" or remove a branch's last covering Manager, naming the branch and the fix; the 0004 database message is the final word (Q6 a) | Users see the rule before they hit it |
| Deactivating someone ends their sessions and blocks sign-in; a signed-in deactivated person sees "Your account is no longer active" and is signed out at their next action (Q7 a) | Access ends at once |
| Reactivating restores sign-in and sends a new password-set email; the "Manager first" rule applies; past jobs and ratings stay theirs (Q8 a, by email per Q2) | An old password that others may know is never revived |
| Deactivated staff keep their name in order history, payments, messages, and ratings with an "(inactive)" tag; they are left out of dropdowns and notices; the staff list hides them unless "Inactive" or "All" is chosen (Q9 a) | History stays truthful; choices stay clean |
| Nobody can deactivate themselves or change their own role; the last active Admin and the last active Finance user cannot be deactivated or change role (Q10 a) | The business can never lock itself out of admin or payment close |
| A technician's phone must be a Malaysian mobile number (they get WhatsApp); other staff may use mobile or landline; a phone number already used by another active staff member is refused (Q11 b) | One profile per team means one phone per team; WhatsApp always arrives |
| One technician profile is one field team with one sign-in; the list searches name, email, and phone, filters by role, branch (home or covered), and Active / Inactive / All, is sorted by name, shows 25 per page, and keeps its filters in the address (Q12 a) | Finds any of 40+ teams in seconds; a refresh keeps the view |
| A new append-only staff history stores every add, edit (from → to), cover change, deactivate, reactivate, invite, and password reset with who and when, shown on the staff member's page; never a password (Q13 a) | Who changed what is always answerable |
| Staff screens are a desktop table that becomes cards at phone width; every action works on both (Q14 a) | Admins work on desktop; Managers may use a phone |
| Each profile has a joined date (the day it was added; seeded staff use their seed date) and, while inactive, a left date; with the staff history, 0007 can count active technicians per branch on any past date, including branch moves (Q15 a) | The KPI dashboard can trend team size per branch |
| `npm run auth:create-staff-logins` stays for setting up a fresh project (seed / demo sign-ins and the first Admin); everything after that is done on screen (Q16 a) | A new project can still be bootstrapped |

## Constraints

- Every database change is a new timestamped migration; 0000–0005
  migrations are committed and append-only. A rule mirrored in
  `src/domain/` passes `tests/db/parity.test.ts`.
- Creating or changing a sign-in needs the Supabase secret key. It runs
  only where that key is safe (a Supabase server function or the local
  script), never in the browser, and the caller is checked server-side.
- The app is not deployed yet (0010): anything server-side must run on the
  hosted Supabase project, and the local app calls it there.
- The 0004 rules stay the authority; the screen explains them but never
  bypasses them.
- Passwords are never stored in the database, never written to the audit
  trail, and never shown on screen; people set them only from an email
  link or "Change my password".
- Invite and reset emails need a working email (SMTP) service on the
  hosted Supabase project, on a free tier (Supabase's built-in email only
  reaches project team members, a few per hour). The links open the local
  app until 0010 deploys it. Test staff need real mailboxes; the seeded
  `@sejuk.example.com` staff keep their script sign-ins.
- Brief stack: React, Tailwind CSS, Supabase. No new paid service.
- Staff screens are desktop-first (Admins work on desktop) and still usable
  at 375 px wide.
- The hosted Supabase project has 0000–0005 applied; schema and server
  function changes ship with SQL and deploy steps for it.

## Acceptance Criteria

| # | Criterion | Verifiable By |
|---|---|---|
| 1 | An Admin can add, edit, deactivate, reactivate, and reset any staff member and change branch cover; a Manager can do the same only for technicians whose home branch they cover, moving them only between covered branches, and never roles or cover; everyone else is refused by the database and the server function (Q1) | test |
| 2 | Admins and Managers have a Staff screen (Managers see the staff of branches they cover); Technicians and Finance do not (Q1) | test + manual check |
| 3 | The staff list searches name, email, and phone; filters by role, branch, and Active / Inactive / All; shows 25 per page sorted by name; filters survive a page reload (Q12) | test + manual check |
| 4 | Adding a staff member creates the profile and sends an invite email; the person sets their own password from the link and can then sign in; no password is ever shown on screen (Q2) | test + manual check |
| 5 | If the invite email cannot be sent, nothing half-made is left: the screen says so and the invite can be sent again (Q2) | test + manual check |
| 6 | An Admin, or the technician's covering Manager, can send a password reset email; the person's other sessions end; any signed-in staff member can change their own password (Q3) | test + manual check |
| 7 | Name, phone, email, role, and home branch can be changed; an email change also changes the sign-in email (Q4) | test + manual check |
| 8 | A technician with Assigned, Acknowledged, or In Progress jobs cannot be deactivated or change role; the message lists those jobs and links to them. Moving their home branch is allowed and keeps the jobs (Q5) | test + manual check |
| 9 | Any change that would leave a branch without a covering Manager is refused with "<Branch> has no Manager. Add a Manager to this branch first." or a last-Manager message that names the branch and the fix; the form warns before saving (Q6) | test + manual check |
| 10 | The screen shows, for each branch, its covering Managers and active staff count (Q6) | test + manual check |
| 11 | Deactivating someone blocks their sign-in and ends their sessions; a signed-in deactivated person loses access at once and sees "Your account is no longer active" (Q7) | test + manual check |
| 12 | Reactivating restores sign-in and sends a new password-set email, subject to the "Manager first" rule (Q8) | test + manual check |
| 13 | Deactivated staff keep their name in order history, payments, messages, and ratings with an "inactive" tag; they are not offered in dropdowns and get no notices (Q9) | test + manual check |
| 14 | An Admin cannot deactivate themselves or change their own role; the last active Admin and the last active Finance user cannot be deactivated or change role (Q10) | test |
| 15 | A technician's phone must be a Malaysian mobile number; other staff may use mobile or landline; a phone already used by another active staff member is refused (Q11) | test + manual check |
| 16 | Every staff change (add, edit with from → to, cover, role, branch, deactivate, reactivate, invite, password reset — never a password) is stored with who and when, and shown on the staff member's page (Q13) | test + manual check |
| 17 | Each staff member has a joined date and, while inactive, a left date; 0007 can count active technicians per branch on any past date from the stored changes (Q15) | test |
| 18 | Staff screens work on a desktop (table) and at 375 px wide (cards); every control has a visible label (Q14) | manual check |
| 19 | The Supabase secret key is never sent to the browser; signed-out visitors can call no staff function | test |

## Roadmap Phase

**Phase:** 2 – Core workflow

## Related Documents

| Document | Type | Relationship |
|---|---|---|
| `docs/prd/0000-programmer-assessment-brief.docx` | Source brief | Company profile, roles |
| `docs/prd/0000-system-foundation-prd.md` | Intent | Roles, staff table, real sign-in |
| `docs/prd/0001-admin-order-portal-prd.md` | Intent | Technician dropdown, technician WhatsApp |
| `docs/prd/0004-review-and-close-prd.md` | Intent | Branch cover (Q1), "Manager first" (Q13) |
| `docs/prd/0005-customer-feedback-prd.md` | Intent | Ratings keep technician and branch |
| `docs/decisions/0010-insert-staff-management-feature.md` | Decision log | Why staff management is its own feature |
| `docs/product-roadmap.md` | Roadmap | Phase assignment and sequencing for this PRD |
| `docs/plan/0006-staff-management-plan.md` | Plan | Implementation path for this PRD |
| `docs/0006-staff-management-workflow.md` | Workflow | Runtime behavior derived from this PRD |
| `docs/reference/folder-structure.md` | Reference | Structural placement of the feature |
| `docs/decisions/NNNN-*.md` | Decision log | Divergences from this PRD |

## Open Questions

All answered on 2026-10-23; decisions are recorded in Product Decisions.

- [x] **Q1. Who may manage staff.** (b) Admins manage everyone and branch cover; Managers manage technicians in branches they cover.
- [x] **Q2. How a sign-in is created.** (b) Edge Function + invite email; the person sets their own password; every new staff member needs a real mailbox.
- [x] **Q3. Password resets.** (a) Admin (or covering Manager for technicians) sends a reset, by email per Q2; everyone can change their own password.
- [x] **Q4. What can change after creation.** (a) Everything, with guards; email change updates the sign-in email.
- [x] **Q5. Technician with open jobs.** (a) Block deactivation and role change until reassigned; allow the branch move.
- [x] **Q6. Rules on screen.** (a) Branch cover panel, warnings before saving, database message as the final word.
- [x] **Q7. Sign-out on deactivation.** (a) Sessions end and sign-in is blocked.
- [x] **Q8. Reactivation.** (a) New password-set email, per Q2.
- [x] **Q9. Deactivated staff elsewhere.** (a) Kept by name with an "(inactive)" tag; hidden from choices.
- [x] **Q10. Safety guards.** (a) Self, last Admin, last Finance.
- [x] **Q11. Phone rules.** (b) Technicians need a Malaysian mobile; duplicates among active staff are blocked.
- [x] **Q12. Search, filters, paging, teams.** (a) One profile per team; search, filters, 25 per page.
- [x] **Q13. Audit trail.** (a) Append-only staff history.
- [x] **Q14. Layout.** (a) Desktop table, cards at phone width.
- [x] **Q15. KPI data.** (a) Joined and left dates plus the staff history.
- [x] **Q16. Local login script.** (a) Kept for setting up a fresh project.
