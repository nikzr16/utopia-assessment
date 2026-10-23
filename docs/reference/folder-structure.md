# Folder Structure Reference

> **Type:** Reference | **Must stay current:** Yes -- update when structure, routes, schemas, or config change

<!-- AI Context
Role: This document records structural facts about the codebase: files,
modules, routes, schemas, config, and their relationships.
Treat it as a lookup table. When creating or modifying files, routes, or
schemas, update this document before the coding session ends.
If this document conflicts with a PRD or plan, this document reflects the
current state; record the divergence in the decision log.
-->

## Overview

Where the application, database, tests, and docs live. Covers everything up to
and including feature 0006 (staff management).

## Directory Layout

```text
.
├── index.html                  Vite entry HTML
├── package.json                Scripts: dev, build, test, typecheck, auth:create-staff-logins
├── vite.config.ts              Vite + React + Tailwind + Vitest config
├── vercel.json                 SPA rewrite: every path serves index.html (deep links like /orders/ORDER1001)
├── tsconfig*.json              TypeScript project references (app, node + scripts, test incl. src + DOM + JSX)
├── .env.example                Env template → copy to .env.local (browser + script-only vars)
├── src/
│   ├── main.tsx                React root
│   ├── App.tsx                 App shell (BrowserRouter): public `/f/:token` feedback page (0005) and `/auth/confirm` email link page (0006); otherwise setup notice → sign-in → `/account/password` or the Admin, Technician, Manager or Finance portal
│   ├── index.css               Tailwind entry
│   ├── components/             Shared UI: AppHeader (Change password, Sign out), SetupNotice, Notice, Field, Dialog, StatusBadge, Pager, RescheduleDialog, styles
│   ├── domain/                 Pure business rules mirrored from the database
│   ├── features/auth/          Supabase Auth: session context, sign-in form, staff profile, live sign-out, email link and change-password pages (0006)
│   ├── features/orders/        Admin order portal (0001): routes, pages, dialogs, data access; Completion section (0002)
│   ├── features/jobs/          Technician job portal (0002): job list, job page, completion and payment forms
│   ├── features/attachments/   Job files and receipts in Supabase Storage (0002): uploader, gallery, payments list
│   ├── features/notifications/ In-app notifications (0002): live unread count, bell, list
│   ├── features/customer-messages/ Customer WhatsApp message on Job Done (0003): panel, not-told badge, data access
│   ├── features/payments/      Payment form shared by technicians and Finance (0004), `record_payment` call
│   ├── features/order-review/  Manager / Finance order page, queue list, dialogs, data access (0004)
│   ├── features/review/        Manager portal (0004): review queue
│   ├── features/finance/       Finance portal (0004): payment queue, record payment
│   ├── features/feedback/      Customer feedback (0005): public page, staff feedback card, phone rating dialog
│   ├── features/staff/         Staff management (0006): list, branch cover panel, add / edit form, staff page, data access
│   └── lib/                    Supabase client and config, shared API plumbing, order records, inactive-staff tags, hooks, drafts
├── scripts/
│   ├── create-staff-logins.ts  Creates/links Supabase Auth accounts for staff (secret key)
│   └── lib/                    Pure planning logic for the script
├── supabase/
│   ├── config.toml             Supabase CLI: `staff-access` deploys with the JWT check off (0006)
│   ├── functions/staff-access/ Edge Function (0006): the only holder of the secret key; creates / changes sign-ins
│   ├── migrations/             Ordered SQL migrations (Supabase CLI layout)
│   └── seed.sql                Reference data and staff (with emails)
├── tests/
│   ├── domain/                 Unit tests for src/domain
│   ├── auth/                   Unit tests for auth helpers
│   ├── scripts/                Unit tests for the login script's planning logic
│   ├── ui/                     Component tests (jsdom + Testing Library; api.ts replaced by test doubles)
│   ├── functions/              Edge Function logic tests (fake database and Auth clients, 0006)
│   └── db/                     PGlite database tests (Supabase shim + migrations + seed)
└── docs/                       Roadmap, PRDs, plans, workflows, reference, decisions
```

## Domain (`src/domain/`)

| File | Purpose |
|---|---|
| `statuses.ts` | Order statuses, UI labels, terminal statuses |
| `transitions.ts` | TS mirror of `order_status_transitions` for deciding which actions to show |
| `money.ts` | `finalAmount`, `paymentStatus` |
| `week.ts` | Malaysia-time (UTC+8) Monday–Sunday week range |
| `phone.ts` | Malaysian phone rules: `normalizeMyPhone` (mirror of `_normalize_my_phone`), `formatMyPhone`, `isMyMobile` |
| `price.ts` | Quoted price rules: `parseQuotedPrice` (mirror of `_check_quoted_price`) |
| `orderEditing.ts` | `EDITABLE_STATUSES` / `canEditOrder` (mirror of `update_order`), `RESCHEDULABLE_STATUSES` / `canRescheduleOrder` (mirror of `reschedule_order`) |
| `orderForm.ts` | Order form values, validation, clean RPC input, `orderToFormValues` |
| `malaysiaTime.ts` | `datetime-local` ↔ UTC+8 instants, Malaysia day ranges, display formats |
| `whatsapp.ts` | Technician job message and `wa.me` URL |
| `price.ts` (0002) | Also `parseExtraCharges` (mirror of `_check_extra_charges`); both share one money parser |
| `completionForm.ts` | Completion form values, validation (work done, extra charges, remarks rule), live final amount, rework pre-fill |
| `attachments.ts` | Job-file types, kinds and size limits (mirror of `_job_file_kind`), storage paths (mirror of `_job_file_order`), who may change files / add receipts (mirror of `_job_file_write_error`), photo resize sizing, file sizes |
| `paymentForm.ts` | Payment method labels, receipt rule, form validation, over-balance amount, `canRecordPayment` |
| `customerMessages.ts` | 0003: customer message channels, states and audit actions, `CUSTOMER_MESSAGE_STATUSES` (Job Done / Reviewed / Closed), edited-text rule (mirror of `_check_customer_message_body`), `canManageCustomerMessage` (edit), `canConfirmCustomerMessage` (send, incl. covering Managers, 0004), `customerNotTold`, send / call / edit rules, "Sent by" / "Edited by" labels |
| `jobs.ts` | Job list tabs and statuses (mirror of `my_jobs`), Malaysia-day grouping (Overdue / Today / Upcoming / No date), area, `tel:` / maps links, customer WhatsApp greeting, notification events (mirror of the event check) and labels |
| `feedback.ts` | 0005: rating range, `FEEDBACK_LOW_RATING_MAX`, comment limit, `FEEDBACK_LINK_DAYS`, token pattern, `FEEDBACK_LINK_PLACEHOLDER`, link states and their messages (mirror of `_feedback_state_error`), sources, `isLowFeedback` (mirror of `_is_low_feedback`), `customerMessageFullText` (mirror of `_customer_message_full_text`), `validateFeedbackForm` (mirror of `_check_feedback`), `canRecordPhoneFeedback` (mirror of `_phone_feedback_error`), `EMPTY_FEEDBACK_FORM`, `ratingStars`, `feedbackSourceLabel`; `FeedbackForm` / `OrderFeedback` rows |
| `staff.ts` | 0006: `STAFF_PAGE_SIZE`, status filters, `OPEN_JOB_STATUSES`, sign-in states and labels, `checkStaffName` / `checkStaffEmail` (mirrors of `_check_staff_name` / `_check_staff_email`), `staffPhoneRoleError` (mirror of `_staff_phone_role_error`), `validateStaffForm`, `staffManageError` (mirror of `_staff_manage_error`), `assignableRoles`, `openJobsError` (mirror of `_staff_open_jobs_error`), `staffLabel` ("(inactive)"), history actions / labels, `describeStaffChanges` |
| `review.ts` | 0004: `coversBranch` (mirror of `_covers_branch`), Manager / Finance tabs and labels (`managerViewOf` / `financeViewOf`, mirrors of `manager_orders` / `finance_orders`), `NEEDS_ATTENTION_RETURNS`, `approveBlockReason`, `closeBlockReason`, `paymentNeedsVerifying`, `canVerifyPayment`, Approved / Closed / Verified labels, `customerOnBehalfMessage` (mirror of `_customer_on_behalf_message`) |
| `index.ts` | Barrel export |

## Auth (`src/features/auth/`)

| File | Purpose |
|---|---|
| `AuthContext.ts`, `AuthProvider.tsx`, `useAuth.ts` | Supabase session, staff profile state, sign in / sign out; 0006: `notice` (why signed out), live sign-out on deactivation (Realtime on the person's own staff row, re-check on focus / return / `ACCESS_LOST_EVENT`) |
| `SignInForm.tsx` | Email + password sign-in screen; shows the sign-out `notice` |
| `profile.ts` | `current_staff()` result → profile state (ready / no profile / error) |
| `errors.ts` | Maps Supabase auth errors to friendly messages; `DEACTIVATED_MESSAGE` (also for `user_banned`) |
| `api.ts` | 0006: `verifyEmailLink` (`verifyOtp` with the token hash), `setNewPassword`, `changeOwnPassword` (re-checks the current password); `LINK_EXPIRED_MESSAGE` |
| `password.ts` | 0006: `checkNewPassword` (8–72 characters, typed twice) |
| `ConfirmLinkPage.tsx` | 0006: public `/auth/confirm`: Continue → choose a password; expired / incomplete link pages; `PasswordPair` |
| `ChangePasswordPage.tsx` | 0006: `/account/password` for every signed-in staff member |
| `index.ts` | Barrel export |

## Admin Order Portal (`src/features/orders/`)

| File | Purpose |
|---|---|
| `AdminPortal.tsx` | Admin navigation and routes: `/orders`, `/orders/new`, `/orders/:orderNo`, `/orders/:orderNo/edit`, `/staff/*` (0006) (others → `/orders`) |
| `api.ts` | All portal database calls (RPCs and reads), row types; re-exports `ApiError` / `toApiError` / `OrderSummary` and `fetchOrderRecords` from `src/lib/` |
| `OrderListPage.tsx` | Search, filters, pagination over `list_orders`; `toListQuery` maps URL params |
| `NewOrderPage.tsx`, `EditOrderPage.tsx` | Create / edit pages around `OrderForm` |
| `OrderForm.tsx`, `TechnicianSelect.tsx` | Shared order form; technician dropdown grouped by branch with open-job counts |
| `OrderDetailPage.tsx` | Summary, WhatsApp, actions, history, banners (`?created`, `?updated`, `?action=reschedule`); Approved / Closed lines (0004); Customer message panel (0003), which reloads the history; "<Name> is no longer active" for an open job of an inactive technician (0006) |
| `OrderSummaryCard.tsx`, `OrderHistory.tsx`, `WhatsAppButton.tsx` | Detail page parts (history names payment methods, receipts, file events, 0003 customer message events, and 0004 payment verification) |
| `CompletionSection.tsx` | 0002: technician's record, job files (Admin add / remove while In Progress), payments with receipts; `COMPLETION_STATUSES`; 0004: `canChangeFiles`, Finance `toggleVerified` / `onPaymentsChange` for the shared order page |
| `actions/AssignDialog.tsx`, `CancelDialog.tsx` | Assign / reassign and cancel dialogs |
| `actions/RescheduleDialog.tsx` | Wraps the shared `components/RescheduleDialog.tsx` with `rescheduleOrder` |
| `index.ts` | Barrel export |

## Technician Job Portal (`src/features/jobs/`)

| File | Purpose |
|---|---|
| `TechnicianPortal.tsx` | Wraps the portal in `NotificationsProvider`; nav (My jobs, Notifications); routes `/jobs`, `/jobs/:orderNo`, `/jobs/:orderNo/complete`, `/jobs/:orderNo/payment`, `/notifications` (others → `/jobs`) |
| `api.ts` | `fetchMyJobs`, `fetchJob` (order + `fetchOrderRecords`), `acceptJob`, `startJob`, `rescheduleJob`, `submitCompletion`; `recordPayment` re-exported from `features/payments/`; `JobDetail` |
| `JobListPage.tsx`, `JobCard.tsx` | Tabs from `?tab=`, Open grouped by Malaysia day, cards; `toJobView`; Submitted cards show "Customer not told yet" (0003) |
| `JobPage.tsx`, `ContactLinks.tsx` | Approved / Closed lines (0004), customer message panel (0003), job details, Call / WhatsApp / Maps, rework and cancelled banners, files, record, payments, sticky actions, start confirmation, banners (`?submitted`, `?paid`) |
| `CompletionPage.tsx` | Brief completion form with live final amount, files, draft, no-photos confirmation, single submit, lost-answer recovery |
| `PaymentPage.tsx` | Loads the job and renders the shared `PaymentForm` (0004 moved the form to `features/payments/`) |
| `index.ts` | Barrel export |

## Job Files (`src/features/attachments/`)

| File | Purpose |
|---|---|
| `api.ts` | `fetchJobFiles`, `fetchReceipts`, `signedUrls` (1 hour), `uploadFile` (409 = already uploaded), `deleteStoredFile`, `addAttachment`, `removeAttachment`; `Attachment` |
| `resize.ts` | `preparePhoto`: canvas resize of large JPEG / PNG / WebP to 2048 px JPEG; injectable `PhotoCodec` |
| `JobFiles.tsx` | Uploader: pick → prepare → upload → register, one at a time, Retry / Remove, 6-file room; reports `JobFilesStatus` to the form |
| `FileGallery.tsx` | Tiles with signed links; photo thumbnails, video / PDF tiles; Remove with confirm |
| `ReceiptLink.tsx`, `PaymentList.tsx` | Receipt link via signed URL; payments list used by the job page and the Completion section, with verification state and Finance's Mark verified / Undo (0004) |
| `index.ts` | Barrel export |

## Notifications (`src/features/notifications/`)

| File | Purpose |
|---|---|
| `api.ts` | `fetchNotifications` (50 latest, with order number), `fetchUnreadCount`, `markNotificationRead`, `markAllNotificationsRead`, `subscribeToNotifications` (Realtime, filtered to the recipient) |
| `NotificationsProvider.tsx` | Unread count and a version for lists; live updates and refresh on return; `useNotifications` |
| `NotificationBell.tsx` | Nav link with unread badge (reusable by other portals) |
| `NotificationsPage.tsx` | List, open job and mark read, Mark all as read; `jobPath` and `goneMessage` per portal (0004) |
| `index.ts` | Barrel export |

## Customer Messages (`src/features/customer-messages/`)

| File | Purpose |
|---|---|
| `api.ts` | `fetchLatestCustomerMessage`, `fetchLatestCustomerMessages` (from `latest_customer_messages`), `editCustomerMessage`, `confirmCustomerMessage` |
| `CustomerMessagePanel.tsx` | Panel for the job page, Admin order detail and Manager / Finance order page: message, Show original, edit form, Send on WhatsApp / Call, "Have you sent it?" question, "Sent by" state; `onChange` after writes; `onBehalfBody` / `canEdit` for Managers (0004); `CustomerNotToldBadge` |
| `index.ts` | Barrel export |

## Customer Feedback (`src/features/feedback/`, 0005)

| File | Purpose |
|---|---|
| `api.ts` | `fetchFeedbackForm` (`feedback_form`), `submitFeedback` (`submit_feedback`) for the signed-out page; `fetchOrderFeedback` (`order_feedback`), `recordPhoneFeedback` (`record_phone_feedback`) for staff |
| `FeedbackPage.tsx` | Public page at `/f/:token`: job facts, the three questions, single submit, "Thank you", pages for used / replaced / expired / unknown links, retry on no signal |
| `FeedbackQuestions.tsx` | The three questions (stars, working well, comment) shared by the page and the phone dialog; clears each error when answered |
| `FeedbackCard.tsx` | "Customer feedback" card for the Admin, technician and Manager / Finance order pages (every visit, latest first; link status while waiting); `PhoneFeedbackDialog` for Admins and covering Managers |
| `index.ts` | Barrel export |

## Staff Management (`src/features/staff/`, 0006)

| File | Purpose |
|---|---|
| `api.ts` | `listStaff` (`staff_list`), `fetchStaffDetail` (`staff_detail`), `fetchBranchCover` (`branch_cover_overview`), `fetchBranchOptions` (branches / `covered_branches`), `checkStaffForm` (`staff_form_check`); `staffAccess` (every write, through the `staff-access` function); `confirmAddress` (`<app>/auth/confirm`, `localhost` for `[::1]` / `127.0.0.1`) |
| `StaffRoutes.tsx` | Routes under `/staff`: list, `new`, `:staffId`, `:staffId/edit`; `orderPath` per portal |
| `StaffListPage.tsx` | Search, role / branch / status filters and paging in the address (`toStaffQuery`), table / cards, `BranchCoverPanel` |
| `StaffFormPage.tsx` | `NewStaffPage`, `EditStaffPage`: the form, live database warnings, role / email / cover per permission, save through the function |
| `StaffPage.tsx` | Details, sign-in state, actions with confirm dialogs (deactivation blocker and open-job links), "Saved, but…" banner with retry, open jobs, history |
| `index.ts` | Barrel export (`StaffRoutes`) |

## Payments (`src/features/payments/`, 0004)

| File | Purpose |
|---|---|
| `PaymentForm.tsx` | Payment form moved from `jobs/PaymentPage`: balance pre-filled, method, receipt upload, one-time client key in the draft, over-balance confirmation; `record`, `onDone`, `backTo` per portal |
| `api.ts` | `recordPayment` (`record_payment`), `RecordPayment` type |
| `index.ts` | Barrel export |

## Order Review (`src/features/order-review/`, 0004)

| File | Purpose |
|---|---|
| `api.ts` | `OrderReview` (row of `order_review_summary`), `fetchOrderReview`, `fetchReviewFacts`, `fetchManagerOrders`, `fetchFinanceOrders`, `fetchCoveredBranches`, `fetchBranches`, `approveOrder`, `returnForRework`, `closeOrder`, `verifyPayment`, `unverifyPayment`; re-exports `fetchOrderHistory` and `recordPayment` |
| `OrderReviewPage.tsx` | One order for a Manager or Finance: details, completion, payments, history, actions card (first on a phone), return notes, customer message; flash after actions and `?paid` |
| `actions.tsx` | `ApproveDialog` (optional note), `ReturnDialog` (required note), `CloseDialog` |
| `QueueList.tsx` | `QueueTabs` (`?tab=`), `BranchFilter` (`?branch=`), `ReturnFlags` (Returned N×, Needs attention), `QueueList` (table on desktop, cards on a phone) |
| `ReviewOutcome.tsx` | "Approved by / Closed by" lines (`ReviewOutcomeLines`) and the self-loading `ReviewOutcome` for the Admin and technician pages |
| `index.ts` | Barrel export |

## Manager Portal (`src/features/review/`, 0004)

| File | Purpose |
|---|---|
| `ManagerPortal.tsx` | `NotificationsProvider`; nav (Review queue, Staff, Notifications); routes `/review`, `/review/:orderNo`, `/staff/*` (0006), `/notifications` (others → `/review`) |
| `ReviewQueuePage.tsx` | To review / Returned / Reviewed tabs and branch filter over `manager_orders` |
| `index.ts` | Barrel export |

## Finance Portal (`src/features/finance/`, 0004)

| File | Purpose |
|---|---|
| `FinancePortal.tsx` | `NotificationsProvider`; nav (Payments and closing, Notifications); routes `/finance`, `/finance/:orderNo`, `/finance/:orderNo/payment`, `/notifications` (others → `/finance`) |
| `FinanceQueuePage.tsx` | Not yet reviewed / Ready to close / Payment outstanding / Closed tabs and branch filter over `finance_orders` |
| `FinancePaymentPage.tsx` | Loads the order and renders the shared `PaymentForm` for Finance |
| `index.ts` | Barrel export |

## Shared Plumbing (`src/lib/`)

| File | Purpose |
|---|---|
| `supabase.ts`, `supabaseConfig.ts` | Supabase client and config detection |
| `api.ts` | `ApiError`, `toApiError` (fires `ACCESS_LOST_EVENT` on "no active staff profile", 0006), `NETWORK_ERROR_MESSAGE` / `isNetworkError`, `client`, `run`, `OrderSummary` / `toOrderSummary` |
| `orderRecords.ts` | `fetchOrderRecords`: completion record, payments with receipts and verification (0004), latest rework note; the staff ids behind the names (0006) |
| `staffStatus.ts` | 0006: inactive staff ids (`loadInactiveStaff`, `useInactiveStaff`, `forgetInactiveStaff`) and `staffName` ("(inactive)" tag) for staff screens |
| `useLoad.ts` | Load-on-key hook with reload; ignores stale responses (moved from `features/orders/`) |
| `useRefreshOnReturn.ts` | Calls a refresh when the page becomes visible or the connection returns |
| `drafts.ts` | Form drafts in `localStorage` (`sejuk-draft:` prefix); `clearAllDrafts` on sign-out |

## Scripts (`scripts/`)

| File | Purpose |
|---|---|
| `create-staff-logins.ts` | `npm run auth:create-staff-logins`: Admin API with `SUPABASE_SECRET_KEY`; creates confirmed accounts for active staff (`--reset-passwords` to update), then `link_staff_accounts()` |
| `lib/plan-staff-logins.ts` | Pure logic: which accounts to create / update / skip |

Since 0006 the script is for setting up a fresh project (seed / demo staff and
the first Admin); staff are added on screen afterwards.

## Server Function (`supabase/functions/staff-access/`, 0006)

| File | Purpose |
|---|---|
| `handler.ts` | Plain TypeScript (tested in `tests/functions/`): `parseStaffAccessRequest` (actions, staff fields, `redirectTo` must be an app address's `/auth/confirm`), `handleStaffAccess`: staff RPC as the caller first, then the Auth step; "Saved, but…" answers with a retry; `authProblem` / database errors → fixed sentences; `DEFAULT_APP_ORIGINS` |
| `index.ts` | Deno entry: CORS, caller token check (`auth.getUser`), caller client (publishable / anon key + token), secret-key client (`inviteUserByEmail`, `resetPasswordForEmail`, `updateUserById` email / ban, `deleteUser`, `link_invited_staff`); keys from `SUPABASE_SECRET_KEYS` / `SUPABASE_PUBLISHABLE_KEYS` or the legacy variables; extra app addresses from the `APP_ORIGINS` secret; raw errors to the function log |

Actions: `create`, `update`, `deactivate`, `reactivate`, `resend_invite`,
`reset_password`, `retry_block`, `retry_unblock`, `retry_email`. Deploy:
`npx supabase functions deploy staff-access --project-ref <ref> --no-verify-jwt --use-api`.

## Database (`supabase/`)

| File | Purpose |
|---|---|
| `migrations/20261022000001_foundation_schema.sql` | Enums, tables, `order_no` sequence, immutability and attachment-limit triggers, `order_summary` view |
| `migrations/20261022000002_foundation_rules.sql` | `order_status_transitions` + rows, `_require_actor()` (from `auth.uid()`), internal `_` helpers, RPCs, execute lockdown |
| `migrations/20261022000003_auth_link.sql` | `auth.users` trigger and `link_staff_accounts()` linking confirmed accounts to staff by email |
| `migrations/20261022000004_access_policies.sql` | RLS on every table, `authenticated` read policies (technician scoping, own notifications), grants; nothing for `anon` |
| `migrations/20261022000005_admin_order_portal.sql` | 0001: `_normalize_my_phone`, `_check_quoted_price`, `_check_order_details`; `create_order` replaced (same signature); `update_order`; `list_orders`, `technician_options`; `order_updated` notification event; execute grants |
| `migrations/20261022000006_technician_job_portal.sql` | 0002: `attachments.file_name` / `size_bytes` / unique `storage_path`, `payments.client_key` (unique); `_check_extra_charges`, `_job_file_order`, `_job_file_is_receipt`, `_job_file_write_error`, `_job_file_kind`, `_job_file_object`, `_can_access_job_file` (storage policy helper), `_payment_method_label`; `add_attachment`, `remove_attachment`; `record_payment` recreated (client key, receipt); `submit_completion` and `transition_order` replaced (same signatures); `mark_all_notifications_read`, `my_jobs`; notification events `cancelled`, `reassigned_away`, `payment_recorded`; guarded: `job-files` bucket + `storage.objects` policies, `supabase_realtime` publication |
| `migrations/20261023000001_whatsapp_notification.sql` | 0003: `_is_my_mobile`, `_malaysia_date_time`, `_customer_job_done_message`, `_check_customer_message_body`; `customer_messages` table with checks and `customer_messages_guard_trg` (no deletes, confirmed rows frozen); `orders_customer_message_trg` (Job Done → message); backfill for orders already Job Done / Reviewed / Closed; `edit_customer_message`, `confirm_customer_message`; `latest_customer_messages` view; RLS (assigned technician, Admins); grants |
| `migrations/20261023000002_review_and_close.sql` | 0004: `staff.additional_branch_ids` + `staff_additional_branches_trg`; `_covers_branch`, `_branch_has_manager`; `staff_branch_manager_trg` (constraint trigger, at commit) and `orders_branch_manager_trg` (every branch needs a Manager); `payments.verified_by` / `verified_at` + `payments_verified_check`; notification events `job_approved`, `job_closed`; `_current_staff_covers`; `orders_read` and `customer_messages_read` policies replaced (Managers: covered branches); `_can_access_job_file`, `_authorize_transition`, `submit_completion`, `transition_order`, `_customer_message_error`, `confirm_customer_message` replaced (same signatures); `verify_payment`, `unverify_payment`; `_customer_on_behalf_message`; `order_review_summary` view; `manager_orders`, `finance_orders`, `covered_branches`; grants |
| `migrations/20261023000003_customer_feedback.sql` | 0005: `app_settings` (`feedback_link_base`); `customer_messages.feedback_token` (unique, WhatsApp only) + backfill for unsent messages; `_new_feedback_token`; `customer_messages_guard` and `orders_customer_message` replaced (token frozen / set on Job Done); `_feedback_link_placeholder`, `_feedback_link`, `_customer_message_full_text`; `confirm_customer_message` replaced (audit keeps the full text); `latest_customer_messages` gains `feedback_url`, `full_body`; `customer_feedback` table + `customer_feedback_guard_trg`; `_is_low_feedback`, `_check_feedback`, `_feedback_link_state`, `_feedback_state_error`, `_notify_low_feedback`; notification event `low_feedback`; `feedback_form`, `submit_feedback` (anon + authenticated); `_phone_feedback_error`, `record_phone_feedback`; RLS `customer_feedback_read`; `order_feedback` view; `order_review_summary` gains `latest_rating`, `latest_working_well`; grants (`anon`: schema usage + the two page functions) |
| `migrations/20261023000004_staff_management.sql` | 0006: `staff.joined_at` / `left_at` (+ backfill, `staff_left_check`, `staff_left_at_trg`); `staff_history` (append-only, RLS on, no client access) + `staff_history_trg` and backfill; `_role_label`, `_branch_names`, `_check_staff_name`, `_check_staff_email`, `_staff_phone_role_error`, `_staff_phone_taken_by`, `_staff_email_taken_by`, `_staff_open_job_count`, `_staff_open_jobs_error`, `_staff_last_role_error`, `_staff_cover_error`, `_staff_manage_error`, `_staff_change_errors`; `staff_rules_trg` (stored phone, technician mobile, phone in use, email in use, open jobs), unique index `staff_active_phone_key`, `staff_last_role_trg` (deferred, advisory lock per role); `_staff_sign_in_state` (from `auth.users`); type `staff_access_target`; `create_staff`, `update_staff`, `set_staff_active`, `staff_access_check`, `staff_access_event`, `link_invited_staff` (service role); `staff_list`, `staff_detail`, `branch_cover_overview`, `staff_form_check`; `order_review_summary` gains `completion_technician_id`, `reviewed_by_id`, `closed_by_id`; RLS `staff_read_own`; `staff` in the `supabase_realtime` publication (guarded); grants |
| `seed.sql` | 5 branches, service types, staff with `@sejuk.example.com` emails (incl. Ali, John, Bala, Yusoff; one Manager per branch since 0004); no auth accounts |

### Tables

`branches`, `staff`, `service_types`, `orders`, `order_completions`,
`attachments`, `payments`, `order_reschedules`, `audit_log`, `notifications`,
`order_status_transitions`, `customer_messages` (0003), `customer_feedback`,
`app_settings` (0005; RLS on, no policy, no client access), `staff_history`
(0006; RLS on, no policy, no client access; read through `staff_detail`). Views:
`order_summary`, `latest_customer_messages` (0003; `feedback_url`,
`full_body` since 0005), `order_review_summary` (0004; `latest_rating`,
`latest_working_well` since 0005), `order_feedback` (0005). New columns
(0004): `staff.additional_branch_ids`, `payments.verified_by`, `payments.verified_at`;
(0005): `customer_messages.feedback_token`; (0006): `staff.joined_at`, `staff.left_at`.
Policies on `staff`: `staff_read` (any active staff member) and
`staff_read_own` (0006: a person's own row, even when inactive).

### RPCs

`create_order`, `update_order`, `transition_order`, `submit_completion`,
`record_payment`, `reschedule_order`, `mark_notification_read`,
`mark_all_notifications_read`, `add_attachment`, `remove_attachment`,
`technician_jobs`, `my_jobs`, `current_staff`, `edit_customer_message`,
`confirm_customer_message`, `verify_payment`, `unverify_payment`,
`manager_orders`, `finance_orders`, `covered_branches` (0004),
`record_phone_feedback` (0005), `create_staff`, `update_staff`,
`set_staff_active`, `staff_access_check`, `staff_access_event`, `staff_list`,
`staff_detail`, `branch_cover_overview`, `staff_form_check` (0006) (no actor
parameter; actor = signed-in user). Signed-out (`anon`) and signed-in:
`feedback_form`, `submit_feedback` (0005; the link token is the only key). Read functions (security invoker, RLS applies):
`list_orders`, `technician_options`. Policy helpers for
`authenticated`: `_can_access_job_file`, `_current_staff_covers` (0004);
view helpers `_feedback_link`, `_customer_message_full_text` (0005). Service-role only:
`link_staff_accounts`, `link_invited_staff` (0006).

Triggers on `orders` (0003): `orders_customer_message_trg` prepares the
customer message when the status becomes `job_done`; (0004)
`orders_branch_manager_trg` refuses a branch with no covering Manager.
Triggers on `staff` (0004): `staff_additional_branches_trg`,
`staff_branch_manager_trg` (deferred constraint trigger); (0006)
`staff_left_at_trg`, `staff_rules_trg`, `staff_history_trg`,
`staff_last_role_trg` (deferred). Trigger on `staff_history` (0006):
`staff_history_no_update_trg`. Trigger on
`customer_feedback` (0005): `customer_feedback_guard_trg` (no updates or deletes).

Notification events: `assigned`, `job_done`, `rework`, `reviewed`,
`order_updated`, `cancelled`, `reassigned_away`, `payment_recorded`,
`job_approved`, `job_closed` (0004), `low_feedback` (0005).

### Storage

Private bucket `job-files` (50 MB per file; JPEG, PNG, WebP, HEIC/HEIF, MP4,
MOV, WebM, PDF). Paths: `<order_id>/<uuid>.<ext>` (job files) and
`<order_id>/receipts/<uuid>.<ext>` (receipts). Policies `job_files_read`,
`job_files_upload`, `job_files_delete` on `storage.objects` call
`_can_access_job_file(name, 'read' | 'upload' | 'delete')`.

## Tests (`tests/`)

| File | Covers |
|---|---|
| `db/helpers.ts` | Fresh PGlite database per file: Supabase shim (`auth` schema, `auth.uid()`, roles, `storage.buckets` / `storage.objects` with RLS and the delete guard), migrations in filename order, seed; act-as / signed-out helpers; upload / Storage-API delete helpers; `holdBackMigrations` / `applyMigration` to seed data before a migration runs (0003 backfill) |
| `db/seed.test.ts` | AC1 |
| `db/auth.test.ts` | AC2, AC16, AC17, account linking, `current_staff()` |
| `db/audit.test.ts` | AC2 (actor recorded), AC12 |
| `db/transitions.test.ts` | AC3–AC8 |
| `db/money.test.ts`, `domain/money.test.ts` | AC9, AC10 |
| `db/reschedule.test.ts` | AC11 |
| `db/notifications.test.ts` | AC13 |
| `db/orders.test.ts` | AC14, AC15 |
| `db/parity.test.ts` | TS mirrors equal the database: transitions, enums, phone and price rules (shared case tables), editable and reschedulable statuses; 0002: extra charges, completion form, file types / sizes / paths, who may change files, payment methods / labels / receipt rule / statuses, job list tabs, notification events; 0003: `isMyMobile` = `_is_my_mobile`, Malaysia time format, edited-text rule, customer message states and statuses; 0004: who may send the customer message, branch cover, review / payment tabs, approve / close guards, verify rule, on-behalf text; 0005: poor rating, feedback answers, link text and placeholder, link state messages, sources, who may record a phone rating |
| `db/storage.test.ts` | 0002 AC7: `job-files` bucket and the read / upload / delete policies by role, status and path |
| `db/technician-jobs.test.ts` | 0002 AC6, AC8, AC10, AC16: `add_attachment`, `remove_attachment`, `record_payment` (client key, receipt), extra charges, cancel / reassign / payment notifications, `mark_all_notifications_read`, `my_jobs`, Realtime publication |
| `db/customer-messages.test.ts` | 0003 AC1, AC2, AC5–AC7, AC9: Job Done trigger and wording, rework, backfill, `edit_customer_message`, `confirm_customer_message` (who, when, newest only, first wins), guard trigger, RLS |
| `ui/customer-message.test.tsx` | 0003 AC3–AC8, AC10: panel states, edit, Send / Call questions, errors, badge on Submitted cards, phone-width classes |
| `db/branch-cover.test.ts` | 0004 AC2–AC4: additional branches, Manager read and review scope, Job Done notices to covering Managers, every branch needs a Manager (staff and orders) |
| `db/review.test.ts` | 0004 AC5–AC9, AC15: approve needs the customer told, on-behalf message, notices on approve and close, `order_review_summary`, `manager_orders` |
| `db/finance.test.ts` | 0004 AC10–AC13: `verify_payment` / `unverify_payment`, close guard, Finance payments with receipt, `finance_orders` |
| `ui/review-close.test.tsx` | 0004 AC5–AC15: queues, tabs, branch filters, review page, approve / return / close, verify / undo, Finance payment form, notification links, Approved / Closed lines, verification history |
| `db/feedback.test.ts` | 0005 AC1–AC13: tokens and link line, address setting, `feedback_form` states and fields, `submit_feedback` (once, answers, after Close, rework), poor-rating notices, `record_phone_feedback` rules and audit, RLS reads, Manager rating column |
| `ui/feedback.test.tsx` | 0005 AC1–AC5, AC7, AC9, AC13, AC14: public route, form validation and single submit, retry, link states, feedback card, phone dialog by role, link line and placeholder warning in the message panel |
| `domain/feedback.test.ts` | 0005 form rule, poor rating, link line, phone-rating rule, labels |
| `db/staff.test.ts` | 0006 AC1, AC7–AC17: backfill on existing staff, `create_staff` / `update_staff` / `set_staff_active` by role, self and last-role guards, open jobs, phone / email rules, "Manager first" messages, rules by plain SQL, history (incl. cleanup deletes), sign-in steps and state, `staff_list` / `staff_detail` / `branch_cover_overview` / `staff_form_check`, `order_review_summary` ids |
| `functions/staff-access.test.ts` | 0006 AC4–AC6, AC11, AC12, AC19: request checks, database-then-Auth order, partial failures and retries, unused-invite restart, error text never leaked |
| `ui/staff.test.tsx` | 0006 AC2, AC3, AC9, AC13, AC18: list query and filters in the address, paging, branch cover panel, add / edit forms by role, warnings, staff page actions, deactivation blocker, retry banner, `confirmAddress` |
| `ui/password.test.tsx` | 0006 AC5, AC6, AC11: email link page, change password, live sign-out (Realtime and re-check) |
| `domain/staff.test.ts` | 0006 form rule, who may manage whom, labels, history lines |
| `db/admin-orders.test.ts` | 0001 AC4, AC5, AC8, AC10, AC11: phone / price rules, `update_order`, `list_orders`, `technician_options` |
| `ui/*.test.tsx` | 0001 AC1–AC3, AC6, AC7, AC9, AC12, AC13: portal access, form, summary, WhatsApp link, detail actions, list, edit |
| `ui/job-list.test.tsx`, `job-page.test.tsx`, `job-files.test.tsx`, `resize.test.ts`, `completion-form.test.tsx`, `payment-form.test.tsx`, `notifications.test.tsx`, `drafts.test.ts` | 0002 AC1–AC6, AC8–AC13, AC15: technician portal screens (api modules replaced by test doubles) |
| `db/access.test.ts` | RLS and grants under `authenticated` / `anon` (AC15, AC16, AC17) |
| `domain/*.test.ts`, `auth/*.test.ts`, `scripts/*.test.ts` | Unit tests for pure helpers |

## Wiring

- `App.tsx` wraps everything in `BrowserRouter`. `AppRoutes` sends `/f/:token`
  to the public `FeedbackPage` and `/auth/confirm` to `ConfirmLinkPage` (no
  `AuthProvider`, no staff header); every other path is the staff app, where
  `/account/password` is `ChangePasswordPage` for every role. An Admin gets `AdminPortal`,
  a Technician `TechnicianPortal` (with their staff id), a Manager
  `ManagerPortal` and Finance `FinancePortal` (with their staff id and name). Screens call only their feature's `api.ts` (which builds on
  `src/lib/api.ts`).
- Job files go browser → Storage (`job-files`, policies decide) → RPC
  (`add_attachment` / `record_payment` read the stored object's real type and
  size). Viewing uses 1-hour signed URLs.
- `NotificationsProvider` subscribes to Realtime `postgres_changes` on
  `notifications` filtered to the staff id; RLS applies to the stream.
- The app reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (publishable
  or legacy anon key) in `src/lib/supabaseConfig.ts`. When either is missing,
  `App.tsx` renders `SetupNotice` instead of the app.
- `AuthProvider` wraps the app: it tracks the Supabase session, calls
  `current_staff()` after sign-in, and exposes sign in / sign out (sign-out
  first clears form drafts on the device). Supabase
  attaches the session token to every RPC, and the database resolves the actor
  from `auth.uid()`.
- `SUPABASE_SECRET_KEY` and `STAFF_DEMO_PASSWORD` are read only by
  `scripts/create-staff-logins.ts` (via `node --env-file=.env.local`); they are
  never `VITE_`-prefixed and never reach the browser bundle.
- Staff writes (0006) go browser → `supabase.functions.invoke('staff-access')`
  with the session token → the function calls the staff RPC as that person,
  then Supabase Auth with the secret key from its own environment. Invite and
  reset emails go through the project's custom SMTP and link to
  `<app>/auth/confirm`.
- `AuthProvider` (0006) also subscribes to Realtime `postgres_changes` on the
  person's own `staff` row and signs them out when it turns inactive.
- The Supabase CLI applies `supabase/migrations/*` in filename order and then
  `supabase/seed.sql`; `tests/db/helpers.ts` does the same in PGlite.

## Related Documents

| Document | Type | Relationship |
|---|---|---|
| `docs/prd/0000-system-foundation-prd.md` | Intent | Product goals behind the structures documented here |
| `docs/plan/0000-system-foundation-plan.md` | Plan | Planned architecture these structures realize |
| `docs/0000-system-foundation-workflow.md` | Workflow | Runtime behavior that uses these structures |
| `docs/prd/0001-admin-order-portal-prd.md` | Intent | Admin order portal goals |
| `docs/0001-admin-order-portal-workflow.md` | Workflow | Admin portal runtime behavior |
| `docs/prd/0002-technician-job-portal-prd.md` | Intent | Technician job portal goals |
| `docs/0002-technician-job-portal-workflow.md` | Workflow | Technician portal runtime behavior |
| `docs/prd/0003-whatsapp-notification-prd.md` | Intent | Customer WhatsApp notification goals |
| `docs/0003-whatsapp-notification-workflow.md` | Workflow | Customer message runtime behavior |
| `docs/prd/0004-review-and-close-prd.md` | Intent | Manager review and Finance close goals |
| `docs/0004-review-and-close-workflow.md` | Workflow | Review, verification, close and branch cover runtime behavior |
| `docs/prd/0005-customer-feedback-prd.md` | Intent | Customer feedback goals |
| `docs/0005-customer-feedback-workflow.md` | Workflow | Feedback link, page, card and phone rating runtime behavior |
| `docs/prd/0006-staff-management-prd.md` | Intent | Staff management goals |
| `docs/0006-staff-management-workflow.md` | Workflow | Staff screens, sign-ins and live sign-out runtime behavior |
| `docs/decisions/0001-*.md` – `0014-*.md` | Decision log | Structural changes that diverged from the plans |
