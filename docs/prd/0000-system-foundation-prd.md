# 0000 - System Foundation PRD

> **Type:** Intent | **Must stay current:** No -- record divergences in decision log

<!-- AI Context
Role: This document captures product intent, not implementation detail.
Use it to understand *what* the feature should do and *why*, then consult the
implementation plan and workflow docs for *how*.
Do not rewrite this document during coding. If implementation diverges from
the intent described here, add an entry to the decision log instead.
-->

## Purpose

Sejuk Sejuk Service Sdn Bhd (5 branches, 40+ field technician teams) wants to
digitise its service workflow: Order → Assignment → Service Completion →
Manager / Finance Review. This PRD defines the shared foundation every module
(0001–0006) builds on: who the users are, what an order is, which states it
moves through, who may move it, and what gets recorded along the way.

Source: `docs/prd/0000-programmer-assessment-brief.docx`.

## Goals

- One shared data model that all modules read and write, so the dashboard and
  AI assistant can answer questions from the same records the portals create.
- An order lifecycle with explicit states, owners, and allowed transitions.
- Real authentication: staff sign in with email and password, and the
  signed-in staff member's role decides what they can see and do.
- Every key action is traceable: who did what, when, and what changed.
- Money on an order is always consistent: final amount and payment status are
  calculated, never typed.

## Non-Goals

- Building the module screens themselves (order form, technician job page,
  dashboard, AI window). Those belong to PRDs 0001–0006.
- Self-service sign-up, password reset emails, SSO, and multi-factor
  authentication. Staff accounts are created by the company.
- Fully automatic WhatsApp sending through the WhatsApp Business Cloud API.
- Invoicing, tax (SST), inventory, spare parts, or technician GPS tracking.
- A customer-facing portal.

## Scope

| In Scope | Out of Scope |
|---|---|
| Entities: branches, users, orders, service types, payments, attachments, reschedule log, audit log, notifications | Module UIs (0001–0006) |
| Order status lifecycle and transition rules | Self sign-up, password reset emails, SSO, MFA |
| Role permissions for every transition | WhatsApp Business API integration |
| Email/password sign-in linked to staff profiles; data access requires sign-in | Multi-currency |
| Derived values: final amount, payment status | Invoicing and tax |
| In-app notification records for workflow events | Push notifications to phones |
| Seed data: 5 branches, demo staff per role with sign-in accounts, service types | Branch-based data access restrictions |

## Roles

| Role | Device | Responsibility |
|---|---|---|
| Admin | Desktop | Creates orders, assigns and reassigns technicians, cancels orders |
| Technician | Mobile | Accepts, starts, and completes assigned jobs; records payments and reschedules |
| Manager | Desktop | Reviews completed jobs; approves or returns them for rework |
| Finance | Desktop | Verifies payment and closes reviewed jobs |

Finance is the brief's "Accounts" role, renamed so it is not confused with
user accounts. Each user belongs to one branch and has exactly one role.

## Order Lifecycle

```text
New → Assigned → Acknowledged → In Progress → Job Done → Reviewed → Closed
                     (optional)                   │
                                                  └─ returned for rework → In Progress
New / Assigned / Acknowledged → Cancelled
```

| Status | Meaning |
|---|---|
| New | Order saved without a technician |
| Assigned | Technician chosen; they have not accepted yet |
| Acknowledged | Technician accepted the job (the brief sample's `"Pending"`) |
| In Progress | Technician started work on site |
| Job Done | Technician submitted the completion record; awaiting manager review |
| Reviewed | Manager approved the work; awaiting payment clearance |
| Closed | Finance confirmed payment cleared; terminal |
| Cancelled | Order withdrawn before work started; terminal |

### Allowed Transitions

| From | To | Who | Condition |
|---|---|---|---|
| (create) | New | Admin | No technician selected |
| (create) | Assigned | Admin | Technician selected on create |
| New | Assigned | Admin | Technician selected |
| Assigned / Acknowledged | Assigned | Admin | Reassign to a different technician |
| Assigned | Acknowledged | Assigned technician | — |
| Assigned / Acknowledged | In Progress | Assigned technician | Starting implies acknowledging |
| In Progress | Job Done | Assigned technician | Completion record submitted |
| Job Done | Reviewed | Manager | — |
| Job Done | In Progress | Manager | Review note required (rework) |
| Reviewed | Closed | Finance | Payment status is `paid` |
| New / Assigned / Acknowledged | Cancelled | Admin | Reason required |

Any transition not in this table is rejected with a clear message.

## Product Decisions

| Decision | Rationale |
|---|---|
| Add **Acknowledged** between Assigned and In Progress | Shows whether a technician has actually seen the job; a job stuck in Assigned is a dispatch problem worth surfacing |
| Allow Assigned → In Progress directly | Field speed: tapping "Start job" counts as accepting |
| Keep the brief's name **Job Done** for technician submission | The brief's notification trigger is literally `status = Job Done`; UI label reads "Job Done – awaiting review" |
| **Reviewed** (Manager) and **Closed** (Finance) are separate steps | Gives the brief's "Manager / Accounts Review" real meaning: quality sign-off and payment sign-off are different people |
| Only Finance can close, and only when payment status is `paid` | A job is never closed just because the work is done |
| Rework returns the order to In Progress with a note, not a new status | Fewer statuses; the note and audit log carry the history |
| Add **Cancelled** | Customers cancel; real systems need a terminal state for it |
| Reassignment returns the order to Assigned | The new technician must acknowledge it themselves |
| Final amount = quoted price + extra charges, always calculated | Removes arithmetic errors and keeps the AI and dashboard consistent |
| Payments are stored as individual rows; payment status is derived | Handles deposits, split payments, and disputed extra charges without a manual "partial" flag |
| Payment status: `unpaid` (0), `partial` (0 < paid < final), `paid` (paid ≥ final) | Simple, unambiguous rule Finance can rely on |
| Postpone / reschedule is a log, not a status | A postponed job is still at the same stage; a status would lose where it was |
| Every order belongs to a branch | Five branches exist; branch is cheap to record and lets the dashboard and AI filter by it |
| Status changes are validated in one server-side place, not only hidden in the UI | Rules hold even if a screen has a bug; the brief asks that rules be considered in design |
| Technicians see only orders assigned to them | Keeps the mobile view short and focused |
| In-app notifications are database records; WhatsApp messages are deep links a person taps to send | `wa.me` links cannot send by themselves; this keeps the WhatsApp part dependency-free |
| Time zone is Malaysia (UTC+8); weeks run Monday–Sunday; currency is MYR | "This week" and "last week" must mean the same thing to the dashboard and the AI |
| Real email/password authentication, not a mock login or role switcher | The brief allows a mock; a real internal tool needs to know who is acting, so we build it properly (also the brief's bonus) |
| The acting user is always the signed-in user, never a value sent by the browser | Nobody can act as someone else by editing a request |
| Accounts are created by the company; public sign-up is off | Internal tool: only staff should have access |
| Signed-out visitors can read or change nothing; technicians can read only their own jobs, enforced by the database | Access rules hold even if a screen has a bug |

## Data Model (intent)

Field-level schema belongs in the plan; this lists what each entity must hold.

| Entity | Must hold |
|---|---|
| Branch | Name; the 5 branches are seeded |
| User (staff) | Name, email, phone, role, branch, active flag, link to their sign-in account |
| Service type | Name (e.g. cleaning, repair, gas refill, installation) for the order form dropdown |
| Order | Order number (auto, unique, not editable), customer name, phone, address, problem description, service type, quoted price, assigned technician, admin notes, branch, status, scheduled date, created by and timestamps |
| Completion record | Work done, extra charges, final amount (derived), remarks, technician, completed at |
| Attachment | Up to 6 photos / videos / PDFs per completion; also receipt photos for payments |
| Payment | Amount, method, receipt photo, recorded by, recorded at |
| Reschedule entry | Old date, new date (empty = postponed with no new date), reason, requested by (customer / technician / admin), done by, time |
| Audit entry | Actor, role, action, status from → to, note, time |
| Notification | Recipient (user or role), event, order, read / unread, time |

Reschedule reasons: customer not home, parts unavailable, weather,
technician unavailable, other.

## Notification Events

| Event | Recipient | Channel | Owning module |
|---|---|---|---|
| Order assigned / reassigned | Technician | WhatsApp deep link (admin taps send) | 0001 |
| Job Done | Customer | WhatsApp deep link with feedback message (technician taps send) | 0003 |
| Job Done | Managers of the order's branch | In-app, automatic | 0002 |
| Returned for rework | Assigned technician | In-app, automatic | 0002 |
| Reviewed | Finance | In-app, automatic | 0000 |

## User Stories

1. **As an Admin**, I want to save an order before I know which technician is free so that intake is never blocked by scheduling.
2. **As an Admin**, I want to reassign a job so that I can cover for a technician who is unavailable.
3. **As a Technician**, I want to accept and start a job in one or two taps so that I can work quickly in the field.
4. **As a Technician**, I want to record a reschedule with a reason so that the office knows why a job slipped.
5. **As a Manager**, I want to be told when a job is done so that I can review it promptly.
6. **As a Manager**, I want to return a job with a note so that the technician knows what to fix.
7. **As Finance**, I want to see reviewed jobs that are not fully paid so that I know which payments to chase.
8. **As Finance**, I want closing to be blocked until the job is fully paid so that no unpaid job is marked finished.
9. **As a staff member**, I want to sign in with my email and password so that the system knows who I am and shows my role's view.
10. **As a Manager**, I want an order's full history so that I can see who did what and when.
11. **As the company**, I want only staff accounts we created to get in so that customer and payment data stays internal.

## Constraints

- The brief's preferred stack is React, Tailwind CSS, Supabase (database and
  storage), and Vercel; AI calls run in a Node.js or serverless function. The
  final choice is made in the 0000 plan.
- The brief accepts a mock login; we implement real authentication instead
  (the brief lists basic authentication as a bonus).
- AI features may only read data through controlled, whitelisted queries,
  never unrestricted database access. This PRD's data model must make those
  queries straightforward (jobs by technician, date range, status, branch).
- Technicians named in the brief's sample data: Ali, John, Bala, Yusoff.
- Up to 6 attachments per completion (brief, Module 2).

## Acceptance Criteria

| # | Criterion | Verifiable By |
|---|---|---|
| 1 | Seed data loads 5 branches, at least one user per role, the four brief technicians, and the service types | manual check |
| 2 | Staff sign in with email and password; the signed-in staff member is the actor for every action and is recorded in the audit log; signing out ends access | test + manual check |
| 3 | Every transition in the Allowed Transitions table succeeds for the listed role and condition | test |
| 4 | Any transition not in the table, or by the wrong role, is rejected with a clear message | test |
| 5 | Only the assigned technician can acknowledge, start, or submit a job | test |
| 6 | Closing is rejected unless the actor is Finance and payment status is `paid` | test |
| 7 | Returning for rework and cancelling are rejected without a note / reason | test |
| 8 | Reassigning sets the status to Assigned and records both technicians in the audit log | test |
| 9 | Final amount always equals quoted price plus extra charges after any change | test |
| 10 | Payment status is `unpaid`, `partial`, or `paid` according to the sum of payments versus final amount | test |
| 11 | Recording a reschedule creates a log entry and leaves the order status unchanged | test |
| 12 | Every status change creates an audit entry with actor, role, from, to, and time | test |
| 13 | Job Done creates in-app notifications for the branch's managers; Reviewed creates one for Finance; rework creates one for the technician | test |
| 14 | Order numbers are generated automatically, unique, and cannot be edited | test |
| 15 | A technician can read only orders assigned to them, enforced by the database | test |
| 16 | Signed-out requests can read no data and every action is rejected | test |
| 17 | A signed-in account with no active staff profile cannot read data or act | test |

## Roadmap Phase

**Phase:** 1 – Foundation

## Related Documents

| Document | Type | Relationship |
|---|---|---|
| `docs/prd/0000-programmer-assessment-brief.docx` | Source brief | Original assessment requirements |
| `docs/product-roadmap.md` | Roadmap | Phase assignment and sequencing for this PRD |
| `docs/plan/0000-system-foundation-plan.md` | Plan | Implementation path for this PRD |
| `docs/0000-system-foundation-workflow.md` | Workflow | Runtime behavior derived from this PRD |
| `docs/reference/folder-structure.md` | Reference | Structural placement of the feature |
| `docs/decisions/NNNN-*.md` | Decision log | Divergences from this PRD |

## Open Questions

- [ ] Confirm the tech stack (brief's preferred stack, or something else).
- [ ] Order number format: follow the brief sample (`ORDER1234`) or a dated format such as `ORD-2610-0001`?
- [ ] Store customer details on each order, or keep a separate customer list for repeat customers?
- [ ] Should Admin and Manager see only their own branch's orders, or all branches?
- [ ] Can Admin reassign a job that is already In Progress?
- [ ] Overpayment (paid > final amount): treat as `paid`, or flag it for Finance?
- [ ] Is Finance central (sees every branch) or per branch?
