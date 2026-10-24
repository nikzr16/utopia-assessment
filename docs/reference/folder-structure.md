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
and including feature 0009 (AI advanced challenges).

## Directory Layout

```text
.
├── index.html                  Vite entry HTML
├── package.json                Scripts: dev, build, test, typecheck, auth:create-staff-logins; `recharts` + `react-is` pinned exact (0007)
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
│   ├── features/kpi/           KPI dashboard (0007): dashboard, technician drill-down, My week, Recharts charts (loaded on demand)
│   ├── features/ask/           AI operations query (0008): Ask chat bubble and panel on every portal, answer tables, saved chats, Admin AI log (0009)
│   ├── features/supervisor/    Workflow Supervisor (0009): Warnings box on order pages, warning counts for the review queue
│   └── lib/                    Supabase client and config, shared API plumbing, order records, inactive-staff tags, hooks, drafts
├── scripts/
│   ├── create-staff-logins.ts  Creates/links Supabase Auth accounts for staff (secret key)
│   └── lib/                    Pure planning logic for the script
├── supabase/
│   ├── config.toml             Supabase CLI: `staff-access` (0006), `ask` (0008) and `ai-assist` (0009) deploy with the JWT check off
│   ├── functions/staff-access/ Edge Function (0006): creates / changes sign-ins with the secret key
│   ├── functions/ask/          Edge Function (0008): the AI operations query (OpenAI key; secret key for saving only)
│   ├── functions/ai-assist/    Edge Function (0009): supervisor AI check, Read from photo, insight wording
│   ├── functions/_shared/      Code shared by the Edge Functions (key helper, secret compare)
│   ├── migrations/             Ordered SQL migrations (Supabase CLI layout)
│   └── seed.sql                Reference data and staff (with emails)
├── tests/
│   ├── domain/                 Unit tests for src/domain
│   ├── auth/                   Unit tests for auth helpers
│   ├── scripts/                Unit tests for the login script's planning logic
│   ├── ui/                     Component tests (jsdom + Testing Library; api.ts replaced by test doubles)
│   ├── functions/              Edge Function logic tests (fake database, Auth and AI clients, 0006, 0008, 0009)
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
| `attachments.ts` | Job-file types, kinds and size limits (mirror of `_job_file_kind`), storage paths (mirror of `_job_file_order`), who may change files / add receipts (mirror of `_job_file_write_error`), photo resize sizing, file sizes; 0009 order form file: `ORDER_FORM_TYPES` / `checkOrderFormFile` (photo or PDF, 10 MB, 3 pages), `orderFormPath` / `orderFormOrder` (mirror of `_order_form_order`), `canChangeOrderForm` (mirror of `_order_form_write_error`) |
| `paymentForm.ts` | Payment method labels, receipt rule, form validation, over-balance amount, `canRecordPayment` |
| `customerMessages.ts` | 0003: customer message channels, states and audit actions, `CUSTOMER_MESSAGE_STATUSES` (Job Done / Reviewed / Closed), edited-text rule (mirror of `_check_customer_message_body`), `canManageCustomerMessage` (edit), `canConfirmCustomerMessage` (send, incl. covering Managers, 0004), `customerNotTold`, send / call / edit rules, "Sent by" / "Edited by" labels |
| `jobs.ts` | Job list tabs and statuses (mirror of `my_jobs`), Malaysia-day grouping (Overdue / Today / Upcoming / No date), area, `tel:` / maps links, customer WhatsApp greeting, notification events (mirror of the event check) and labels |
| `feedback.ts` | 0005: rating range, `FEEDBACK_LOW_RATING_MAX`, comment limit, `FEEDBACK_LINK_DAYS`, token pattern, `FEEDBACK_LINK_PLACEHOLDER`, link states and their messages (mirror of `_feedback_state_error`), sources, `isLowFeedback` (mirror of `_is_low_feedback`), `customerMessageFullText` (mirror of `_customer_message_full_text`), `validateFeedbackForm` (mirror of `_check_feedback`), `canRecordPhoneFeedback` (mirror of `_phone_feedback_error`), `EMPTY_FEEDBACK_FORM`, `ratingStars`, `feedbackSourceLabel`; `FeedbackForm` / `OrderFeedback` rows |
| `staff.ts` | 0006: `STAFF_PAGE_SIZE`, status filters, `OPEN_JOB_STATUSES`, sign-in states and labels, `checkStaffName` / `checkStaffEmail` (mirrors of `_check_staff_name` / `_check_staff_email`), `staffPhoneRoleError` (mirror of `_staff_phone_role_error`), `validateStaffForm`, `staffManageError` (mirror of `_staff_manage_error`), `assignableRoles`, `openJobsError` (mirror of `_staff_open_jobs_error`), `staffLabel` ("(inactive)"), history actions / labels, `describeStaffChanges` |
| `kpi.ts` | 0007: `KPI_VIEWS` (week / month), `KPI_TREND_COUNTS` (8 / 6), `KPI_MAX_PERIOD_DAYS` (400); Malaysia-day helpers (`malaysiaToday`, `addDays`, `weekStartOf`, `monthStartOf`, mirrors of `_kpi_day_start` periods), `periodRange`, `shiftPeriod`, `canShowNextPeriod`, labels, `isoWeekCode` / `periodCode` (CSV names), `emptyPeriodMessage`; address `parseKpiAddress` / `kpiAddress`; `compareLeaderboard`, `competitionRanks` / `rankLeaderboard` (mirror of the SQL `rank()`), sortable columns, `ariaSort`, `nextSort`; rating labels; CSV building (BOM, quoted fields) |
| `review.ts` | 0004: `coversBranch` (mirror of `_covers_branch`), Manager / Finance tabs and labels (`managerViewOf` / `financeViewOf`, mirrors of `manager_orders` / `finance_orders`), `NEEDS_ATTENTION_RETURNS`, `approveBlockReason`, `closeBlockReason`, `paymentNeedsVerifying`, `canVerifyPayment`, Approved / Closed / Verified labels, `customerOnBehalfMessage` (mirror of `_customer_on_behalf_message`) |
| `supervisor.ts` | 0009: `SUPERVISOR_LIMITS`, `WARNING_RULES` / labels, `isOverQuote` (mirror of `_supervisor_over_quote`), `checkNoteError` (mirror of `check_order_warning`), `approveWarningsBlock` (mirror of the approve guard), `supervisorRunText` |
| `insights.ts` | 0009: `INSIGHT_LIMITS`, `isBusy` / `isQuiet` / `reschedulesUp` / `ratingDropped` (mirrors of the `_insight_*` functions), `InsightFact`, `insightSentence` (fixed sentences, same as `ai-assist/insights.ts`), `insightNumbers`, `insightPeriodPhrase` |
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
| `AdminPortal.tsx` | Admin navigation and routes: `/orders`, `/orders/new`, `/orders/:orderNo`, `/orders/:orderNo/edit`, `/staff/*` (0006), `/dashboard/*` (0007), `/ai-log` (0008 Question log, nav AI log since 0009; `/question-log` redirects) (others → `/orders`); the Ask bubble (0008) |
| `api.ts` | All portal database calls (RPCs and reads), row types; re-exports `ApiError` / `toApiError` / `OrderSummary` and `fetchOrderRecords` from `src/lib/`; `createOrder` returns id and number (0009); `readOrderFormPhoto` (`ai-assist` `read_form`, 40 s) |
| `OrderListPage.tsx` | Search, filters, pagination over `list_orders`; `toListQuery` maps URL params |
| `NewOrderPage.tsx`, `EditOrderPage.tsx` | Create / edit pages around `OrderForm`; 0009: Read from photo above the new form (the kept file is uploaded after saving, Try again if it fails); the Paper order form panel on Edit |
| `ReadFromPhoto.tsx` | 0009: "Read from photo": pick, check, shrink, read with the AI, fill the five fields (`filledValues`; no time → 09:00), keep the file until Save, Remove photo |
| `OrderFormEditor.tsx` | 0009: Edit order's Paper order form panel: open, Replace (old file deleted), Remove |
| `OrderForm.tsx`, `TechnicianSelect.tsx` | Shared order form (0009: `fill` applies values read from a photo); technician dropdown grouped by branch with open-job counts |
| `OrderDetailPage.tsx` | Summary, WhatsApp, actions, history, banners (`?created`, `?updated`, `?action=reschedule`); Approved / Closed lines (0004); Customer message panel (0003), which reloads the history; "<Name> is no longer active" for an open job of an inactive technician (0006); Warnings box, read-only (0009) |
| `OrderSummaryCard.tsx`, `OrderHistory.tsx`, `WhatsAppButton.tsx` | Detail page parts (history names payment methods, receipts, file events, 0003 customer message events, 0004 payment verification, and 0009 order form events); the summary links the paper order form (0009) |
| `CompletionSection.tsx` | 0002: technician's record, job files (Admin add / remove while In Progress), payments with receipts; `COMPLETION_STATUSES`; 0004: `canChangeFiles`, Finance `toggleVerified` / `onPaymentsChange` for the shared order page |
| `actions/AssignDialog.tsx`, `CancelDialog.tsx` | Assign / reassign and cancel dialogs |
| `actions/RescheduleDialog.tsx` | Wraps the shared `components/RescheduleDialog.tsx` with `rescheduleOrder` |
| `index.ts` | Barrel export |

## Technician Job Portal (`src/features/jobs/`)

| File | Purpose |
|---|---|
| `TechnicianPortal.tsx` | Wraps the portal in `NotificationsProvider`; nav (My jobs, Notifications); routes `/jobs`, `/jobs/:orderNo`, `/jobs/:orderNo/complete`, `/jobs/:orderNo/payment`, `/notifications`, `/my-week` (0007, nav My week) (others → `/jobs`); the Ask bubble (0008) |
| `api.ts` | `fetchMyJobs`, `fetchJob` (order + `fetchOrderRecords`), `acceptJob`, `startJob`, `rescheduleJob`, `submitCompletion`; `recordPayment` re-exported from `features/payments/`; `JobDetail` |
| `JobListPage.tsx`, `JobCard.tsx` | Tabs from `?tab=`, Open grouped by Malaysia day, cards; `toJobView`; Submitted cards show "Customer not told yet" (0003) |
| `JobPage.tsx`, `ContactLinks.tsx` | Approved / Closed lines (0004), customer message panel (0003), job details (with the paper order form link, 0009), Call / WhatsApp / Maps, rework and cancelled banners, files, record, payments, sticky actions, start confirmation, banners (`?submitted`, `?paid`) |
| `CompletionPage.tsx` | Brief completion form with live final amount, files, draft, no-photos confirmation, single submit, lost-answer recovery |
| `PaymentPage.tsx` | Loads the job and renders the shared `PaymentForm` (0004 moved the form to `features/payments/`) |
| `index.ts` | Barrel export |

## Job Files (`src/features/attachments/`)

| File | Purpose |
|---|---|
| `api.ts` | `fetchJobFiles` (not the order form), `fetchReceipts`, `signedUrls` (1 hour), `uploadFile` (409 = already uploaded), `deleteStoredFile`, `addAttachment`, `removeAttachment`; 0009 `fetchOrderForm`, `saveOrderForm` (upload + `set_order_form`, then delete the replaced file), `removeOrderForm`; `Attachment` |
| `OrderFormLink.tsx` | 0009: `useOrderForm` and "Open the paper order form (photo / PDF)" for every order page (shows nothing when there is none) |
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

## KPI Dashboard (`src/features/kpi/`, 0007)

| File | Purpose |
|---|---|
| `api.ts` | `fetchKpiSummary` (`kpi_summary`), `fetchKpiTechnicians` (`kpi_technicians`), `fetchKpiBranches` (`kpi_branches`), `fetchKpiTrend` (`kpi_trend`), `fetchKpiTechnicianEvents` (`kpi_technician_events`), `fetchKpiBranchOptions` (branches / `covered_branches`); 0009 `fetchInsightFacts` (`insight_facts`), `fetchInsightWording` (`ai-assist` `word_insights`, 20 s); row types |
| `lazy.tsx` | `DashboardRoutes` (`/dashboard/*`) and `MyWeek` (`/my-week`): `React.lazy` chunks with "Loading the dashboard…" and a reload notice if the chunk fails; the only importer of the pages |
| `KpiRoutes.tsx` | Routes under `/dashboard`: index → `DashboardPage`, `technicians/:technicianId` → `TechnicianKpiPage`; `orderPath` per portal |
| `DashboardPage.tsx` | Period and branch filters, Insights card (Managers and Admins, 0009), cards, leaderboard, CSV, charts, branch comparison |
| `TechnicianKpiPage.tsx` | One technician: cards, trend, event list |
| `MyWeekPage.tsx` | The technician's own numbers (no rank, no other names) |
| `useKpiAddress.ts` | `view` / `start` / `branch` kept in the address |
| `download.ts` | `downloadTextFile` (CSV save) |
| `components/` | `PeriodPicker`, `BranchFilter`, `SummaryCards`, `Leaderboard` (table ≥ 768 px, cards below, sort), `BranchComparison`, `EventList`, `KpiState` (loading / error / Try again); `InsightsCard` (0009: facts at once, then the AI wording and tip) |
| `charts/` | `theme.ts` (palette, axis / grid styles), `ChartPanel` ("Show as table"), `DataTable`, `ChartTooltip`, `useReducedMotion`, `JobsByTechnicianChart` (max 15 bars), `TrendChart`, `ReschedulesByReasonChart`, `BranchBarChart` |
| `index.ts` | Barrel export (`DashboardRoutes`, `MyWeek`) |

## AI Operations Query (`src/features/ask/`, 0008)

| File | Purpose |
|---|---|
| `api.ts` | `askQuestion` (`fetch` to `/functions/v1/ask` with the session token; reads the newline-separated JSON events: step, result, error; 404 → not set up), `fetchChats` / `fetchChatMessages` (`ask_chats`, `ask_messages`, RLS: own, 7 days), `renameChat` (`ask_rename_chat`), `deleteChat` (`ask_delete_chat`), `fetchQuestionLog` (`ask_log_entries`, Admins; 0009 adds `feature` and `order_no`) |
| `types.ts` | Type-only re-exports of the `ask` function's `AskResult`, `AskEvent`, `AskTable`, `DashboardLink` (one source for browser and server) |
| `AskAssistant.tsx` | `AskAssistant`: the floating **Ask** bubble (above sticky action bars on phones) and the panel: chat list (open, rename, delete), conversation, example questions, step text while waiting, 20-second limit, error with Try again / Dashboard link; full screen below 640 px, a 420 px (or wider) panel above |
| `AnswerCard.tsx` | One answer: sentence, choice / example buttons, **Open ORDER…**, tables, **Open in Dashboard** / **My week** (`dashboardPath`), "How I found this" in plain words |
| `RecordTable.tsx` | The records per lookup kind (events, jobs, payments, technicians, branches, trend, summary, insights (0009)): table from 640 px, cards below, empty columns left out, order links |
| `QuestionLogPage.tsx` | Admin AI log at `/ai-log` (0009; was the Question log): last 7 days of every AI use, filter by type (Ask, Job check, Order form, Insights), person and result, lookups in plain words, time and tokens |
| `examples.ts` | Example questions per role |
| `index.ts` | Barrel export (`AskAssistant`, `QuestionLogPage`) |

## Workflow Supervisor (`src/features/supervisor/`, 0009)

| File | Purpose |
|---|---|
| `api.ts` | `fetchOrderWarnings` (open and checked `order_warnings` with the checker's name, latest `supervisor_runs`; RLS), `fetchOpenWarningCounts` (review queue), `checkWarning` (`check_order_warning`), `recheckOrder` (`request_supervisor_recheck`, then `ai-assist` `supervisor_check`), `subscribeToWarnings` (Realtime on both tables for one order) |
| `WarningsBox.tsx` | `useOrderWarnings` (Realtime, 5-second refresh while a check runs, refresh on return), `openWarnings`, `WarningsBox`: labels (rule / AI), Mark as checked with a note, checked-by lines, AI check state, Re-check with AI; reports the open count to hold Approve |
| `index.ts` | Barrel export |

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
| `OrderReviewPage.tsx` | One order for a Manager or Finance: details, completion, payments, history, actions card (first on a phone), return notes, customer message; flash after actions and `?paid`; Warnings box and Approve held while warnings are open (0009) |
| `actions.tsx` | `ApproveDialog` (optional note), `ReturnDialog` (required note), `CloseDialog` |
| `QueueList.tsx` | `QueueTabs` (`?tab=`), `BranchFilter` (`?branch=`), `ReturnFlags` (Returned N×, Needs attention), `QueueList` (table on desktop, cards on a phone) |
| `ReviewOutcome.tsx` | "Approved by / Closed by" lines (`ReviewOutcomeLines`) and the self-loading `ReviewOutcome` for the Admin and technician pages |
| `index.ts` | Barrel export |

## Manager Portal (`src/features/review/`, 0004)

| File | Purpose |
|---|---|
| `ManagerPortal.tsx` | `NotificationsProvider`; nav (Review queue, Staff, Dashboard, Notifications); routes `/review`, `/review/:orderNo`, `/staff/*` (0006), `/dashboard/*` (0007), `/notifications` (others → `/review`); the Ask bubble (0008) |
| `ReviewQueuePage.tsx` | To review / Returned / Reviewed tabs and branch filter over `manager_orders`; 0009: Warnings column and "Only jobs with warnings" (`?warnings=1`) on To review |
| `index.ts` | Barrel export |

## Finance Portal (`src/features/finance/`, 0004)

| File | Purpose |
|---|---|
| `FinancePortal.tsx` | `NotificationsProvider`; nav (Payments and closing, Dashboard, Notifications); routes `/finance`, `/finance/:orderNo`, `/finance/:orderNo/payment`, `/dashboard/*` (0007), `/notifications` (others → `/finance`); the Ask bubble (0008) |
| `FinanceQueuePage.tsx` | Not yet reviewed / Ready to close / Payment outstanding / Closed tabs and branch filter over `finance_orders` |
| `FinancePaymentPage.tsx` | Loads the order and renders the shared `PaymentForm` for Finance |
| `index.ts` | Barrel export |

## Shared Plumbing (`src/lib/`)

| File | Purpose |
|---|---|
| `supabase.ts`, `supabaseConfig.ts` | Supabase client and config detection; `supabaseConfig` (URL and public key for the streamed `ask` call, 0008) |
| `api.ts` | `ApiError`, `toApiError` (fires `ACCESS_LOST_EVENT` on "no active staff profile", 0006), `NETWORK_ERROR_MESSAGE` / `isNetworkError`, `client`, `run`, `OrderSummary` / `toOrderSummary` |
| `orderRecords.ts` | `fetchOrderRecords`: completion record, payments with receipts and verification (0004), latest rework note; the staff ids behind the names (0006) |
| `staffStatus.ts` | 0006: inactive staff ids (`loadInactiveStaff`, `useInactiveStaff`, `forgetInactiveStaff`) and `staffName` ("(inactive)" tag) for staff screens |
| `useLoad.ts` | Load-on-key hook with reload; ignores stale responses (moved from `features/orders/`) |
| `useRefreshOnReturn.ts` | Calls a refresh when the page becomes visible or the connection returns |
| `drafts.ts` | Form drafts in `localStorage` (`sejuk-draft:` prefix); `clearAllDrafts` on sign-out |
| `aiAssist.ts` | 0009: `callAiAssist` (POST to `/functions/v1/ai-assist` with the session token, time limit, refusals as `ApiError`) |

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

## Server Function (`supabase/functions/ask/`, 0008)

| File | Purpose |
|---|---|
| `handler.ts` | Plain TypeScript (tested in `tests/functions/`): `parseAskRequest` (question ≤ 1,000 characters, chat id), `loadPerson`, `handleAsk`: OpenAI picks up to 3 lookups (max 4 AI calls), the server checks and runs them, reply tools → fixed sentences, step events, `ask_record` (chat + Question log); `AiClient` interface, `ERROR_MESSAGES`, 18-second limit |
| `lookups.ts` | The menu: `kpi_summary`, `technician_leaderboard`, `branch_comparison`, `workload_insights` (0009, `insight_facts`), `trend`, `technician_events`, `job_list`, `payment_list` (strict JSON schemas, database function, columns the AI may see, table kind, plain "Looked up" line, Dashboard link); `REPLY_TOOLS`; `checkInput`; name resolution (`ask_find_people`); database refusals → fixed sentences |
| `periods.ts` | Named periods → Malaysia days `[start, end)` and labels; parity-tested against `src/domain/kpi.ts` |
| `prompt.ts` | `INSTRUCTIONS` (fixed) and `contextMessage` (person, today, branches) |
| `index.ts` | Deno entry: CORS, caller token check, caller client (lookups, chat turns, branches), secret-key client (`ask_record` only), OpenAI client (`openai@7.32.0`, Responses API, `store: false`, encrypted reasoning, `OPENAI_MODEL` / `OPENAI_EFFORT`), newline-separated JSON stream |

Secrets: `OPENAI_API_KEY` (required), `OPENAI_MODEL` (default `gpt-6-luna`),
`OPENAI_EFFORT` (default `medium`). Deploy:
`npx supabase functions deploy ask --project-ref <ref> --no-verify-jwt --use-api`.

## Server Function (`supabase/functions/ai-assist/`, 0009)

| File | Purpose |
|---|---|
| `handler.ts` | Plain TypeScript (tested in `tests/functions/ai-assist.test.ts`): `parseRequest` (`supervisor_check`, `read_form`, `word_insights`), `handleAiAssist`: caller checks per action (shared secret or a Manager's own run; Admins; Managers / Admins), database refusals passed on in plain words only |
| `ai.ts` | `JsonAiClient` (Responses API with strict `text.format` JSON, no tools), `askJson` (time limit, JSON parse), `AiError` / `AiTimeout` → AI log outcomes, schema helpers, `clean` |
| `supervisor.ts` | `runSupervisorCheck`: `supervisor_ai_input` → the model → `readIssues` (≤ 3, ≤ 200 characters) → `supervisor_save_ai`; failures close the run (`failed` / `not_set_up`); AI log |
| `formReader.ts` | `readOrderForm`: real type from the bytes (`sniffType`), 10 MB, PDF pages (≤ 3), `formInput` (image or file + service types + today), `FORM_SCHEMA` (five fields, no phone / address), `readForm` (all or nothing; `readAmount`, `readDate`, service type match); `FORM_MESSAGES` |
| `insights.ts` | `toFact`, fixed `insightSentence` (same as `src/domain/insights.ts`), `checkWording` (numbers per fact, tip), `wordingHash`, `wordInsights` (saved wording or a new one; fixed sentences when the AI is down) |
| `prompts.ts` | `SUPERVISOR_INSTRUCTIONS`, `FORM_INSTRUCTIONS`, `INSIGHT_INSTRUCTIONS` (business text is data, never instructions) |
| `index.ts` | Deno entry: CORS, `x-ai-trigger` secret check (`AI_TRIGGER_SECRET`, constant-time), caller token → `current_staff`, caller client (service types, `insight_facts`, branch name), secret-key client (`supervisor_ai_input`, `supervisor_save_ai`, `ai_log_record`, `insight_wording_get` / `_put`), OpenAI client (`openai@7.32.0`, `store: false`), `pdf-lib@1.17.1` page count |

`supabase/functions/_shared/keys.ts`: `supabaseKey` (new key lists or legacy
variables; used by `ask` and `ai-assist`) and `sameSecret`. Secrets:
`OPENAI_API_KEY` (from 0008), `AI_TRIGGER_SECRET` (same value as the Vault
secret `ai_trigger_secret`). Deploy:
`npx supabase functions deploy ai-assist --project-ref <ref> --no-verify-jwt --use-api`.

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
| `migrations/20261023000005_kpi_dashboard.sql` | 0007: `order_reschedules.technician_id` + `order_reschedules_technician_trg` and backfill; indexes `order_reschedules_technician_idx`, `audit_log_reviewed_idx`, `audit_log_returned_idx` (partial), `order_reschedules_created_idx`, `payments_recorded_idx`, `staff_history_staff_created_idx`; private `_kpi_day_start`, `_kpi_period`, `_kpi_visible_branches`, `_kpi_needs_attention`, `_kpi_completed_jobs`, `_kpi_events`, `_kpi_active_technicians`, `_kpi_metrics`; read functions `kpi_summary`, `kpi_technicians`, `kpi_branches`, `kpi_trend`, `kpi_technician_events` (documented with `comment on function`); grants (authenticated only) |
| `migrations/20261024000001_ai_ops_query.sql` | 0008: `pg_trgm` (schema `extensions`); `_ask_scope` (visible branches, period, own-only rule; granted), `_ask_contains_pattern`; read functions `ask_jobs`, `ask_payments` (security invoker, RLS) and `ask_find_people` (definer; `_ask_normalize_name`, `_ask_name_score`); tables `ask_chats`, `ask_messages`, `ask_log` (RLS: own chats, Admins read the log, 7 days) and view `ask_log_entries`; `ask_rename_chat`, `ask_delete_chat`; `ask_record`, `ask_purge_old` (service role); `pg_cron` job `ask-purge-old` (guarded); grants |
| `migrations/20261024000002_ai_advanced.sql` | 0009: `ask_log.feature` / `order_id`, wider outcome check, `ask_log_entries` recreated (feature, order number), `ai_log_record` (service role); `supervisor_runs`, `order_warnings` (`seq`, guard: no deletes while the order exists, text never changes; one live warning per rule) + RLS (Admins, Finance, covering Managers); `_supervisor_over_quote`, `_supervisor_money`, `_supervisor_apply`, `_supervisor_rules`; `app_settings.ai_assist_url`; `_supervisor_post` (`pg_net` + Vault secret, guarded), `_supervisor_start_run`; triggers `orders_supervisor_job_done_trg`, `customer_feedback_supervisor_trg`, `order_reschedules_supervisor_trg`, `orders_open_warnings_guard_trg` (approve guard); `supervisor_retry_pending` (`pg_cron` `supervisor-retry`, every 5 min), `supervisor_ai_input`, `supervisor_save_ai` (service role); `check_order_warning`, `request_supervisor_recheck`; `attachments.is_order_form` (+ check, one per order), `attachments_limit` (order form not counted), `_order_form_order`, `_order_form_write_error`, `_can_access_job_file` replaced, `set_order_form`, `remove_order_form`; `_insight_busy`, `_insight_quiet`, `_insight_reschedules_up`, `_insight_rating_drop`, `insight_facts`; `insight_wordings` + `insight_wording_get` / `_put` (service role); `ask_purge_old` replaced (also wordings); `pg_net` / `pg_cron` extensions and Realtime publication (guarded); grants |
| `seed.sql` | 5 branches, service types, staff with `@sejuk.example.com` emails (incl. Ali, John, Bala, Yusoff; one Manager per branch since 0004); no auth accounts |

### Tables

`branches`, `staff`, `service_types`, `orders`, `order_completions`,
`attachments`, `payments`, `order_reschedules`, `audit_log`, `notifications`,
`order_status_transitions`, `customer_messages` (0003), `customer_feedback`,
`app_settings` (0005; RLS on, no policy, no client access), `staff_history`
(0006; RLS on, no policy, no client access; read through `staff_detail`),
`ask_chats`, `ask_messages`, `ask_log` (0008; read under RLS, written only by
`ask_record`; `ai_log_record` since 0009), `order_warnings`, `supervisor_runs`
(0009; read under RLS, written only by functions), `insight_wordings` (0009;
RLS on, no policy, service role through functions). Views:
`order_summary`, `latest_customer_messages` (0003; `feedback_url`,
`full_body` since 0005), `order_review_summary` (0004; `latest_rating`,
`latest_working_well` since 0005), `order_feedback` (0005), `ask_log_entries` (0008). New columns
(0004): `staff.additional_branch_ids`, `payments.verified_by`, `payments.verified_at`;
(0005): `customer_messages.feedback_token`; (0006): `staff.joined_at`, `staff.left_at`;
(0007): `order_reschedules.technician_id`; (0009): `attachments.is_order_form`,
`ask_log.feature`, `ask_log.order_id`.
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
`staff_detail`, `branch_cover_overview`, `staff_form_check` (0006), `kpi_summary`,
`kpi_technicians`, `kpi_branches`, `kpi_trend`, `kpi_technician_events` (0007, read-only),
`ask_find_people`, `ask_rename_chat`, `ask_delete_chat` (0008),
`check_order_warning`, `request_supervisor_recheck`, `set_order_form`,
`remove_order_form`, `insight_facts` (0009) (no actor
parameter; actor = signed-in user). Signed-out (`anon`) and signed-in:
`feedback_form`, `submit_feedback` (0005; the link token is the only key). Read functions (security invoker, RLS applies):
`list_orders`, `technician_options`, `ask_jobs`, `ask_payments` (0008; with
`_ask_scope`, `_ask_contains_pattern`). Policy helpers for
`authenticated`: `_can_access_job_file`, `_current_staff_covers` (0004);
view helpers `_feedback_link`, `_customer_message_full_text` (0005). Service-role only:
`link_staff_accounts`, `link_invited_staff` (0006), `ask_record`,
`ask_purge_old` (0008), `ai_log_record`, `supervisor_ai_input`,
`supervisor_save_ai`, `supervisor_retry_pending`, `insight_wording_get`,
`insight_wording_put` (0009).

Triggers on `orders` (0003): `orders_customer_message_trg` prepares the
customer message when the status becomes `job_done`; (0004)
`orders_branch_manager_trg` refuses a branch with no covering Manager;
(0009) `orders_supervisor_job_done_trg` runs the supervisor rules and starts
the AI check at Job Done, `orders_open_warnings_guard_trg` refuses Approve
while a warning is open. Triggers on `customer_feedback` and
`order_reschedules` (0009) re-run the rules; `order_warnings_guard_trg`.
Triggers on `staff` (0004): `staff_additional_branches_trg`,
`staff_branch_manager_trg` (deferred constraint trigger); (0006)
`staff_left_at_trg`, `staff_rules_trg`, `staff_history_trg`,
`staff_last_role_trg` (deferred). Trigger on `staff_history` (0006):
`staff_history_no_update_trg`. Trigger on `order_reschedules` (0007):
`order_reschedules_technician_trg`. Trigger on
`customer_feedback` (0005): `customer_feedback_guard_trg` (no updates or deletes).

Notification events: `assigned`, `job_done`, `rework`, `reviewed`,
`order_updated`, `cancelled`, `reassigned_away`, `payment_recorded`,
`job_approved`, `job_closed` (0004), `low_feedback` (0005).

### Storage

Private bucket `job-files` (50 MB per file; JPEG, PNG, WebP, HEIC/HEIF, MP4,
MOV, WebM, PDF). Paths: `<order_id>/<uuid>.<ext>` (job files) and
`<order_id>/receipts/<uuid>.<ext>` (receipts), `<order_id>/form/<uuid>.<ext>`
(the paper order form, 0009; written by Admins while New / Assigned /
Acknowledged). Policies `job_files_read`,
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
| `db/parity.test.ts` | TS mirrors equal the database: transitions, enums, phone and price rules (shared case tables), editable and reschedulable statuses; 0002: extra charges, completion form, file types / sizes / paths, who may change files, payment methods / labels / receipt rule / statuses, job list tabs, notification events; 0003: `isMyMobile` = `_is_my_mobile`, Malaysia time format, edited-text rule, customer message states and statuses; 0004: who may send the customer message, branch cover, review / payment tabs, approve / close guards, verify rule, on-behalf text; 0005: poor rating, feedback answers, link text and placeholder, link state messages, sources, who may record a phone rating; 0007: week / month starts, tie ranking, needs attention; 0009: over-quote limit, warning rules and approve message, busy / quiet / reschedules / rating limits, order form paths and who may change it |
| `db/storage.test.ts` | 0002 AC7: `job-files` bucket and the read / upload / delete policies by role, status and path |
| `db/technician-jobs.test.ts` | 0002 AC6, AC8, AC10, AC16: `add_attachment`, `remove_attachment`, `record_payment` (client key, receipt), extra charges, cancel / reassign / payment notifications, `mark_all_notifications_read`, `my_jobs`, Realtime publication |
| `db/customer-messages.test.ts` | 0003 AC1, AC2, AC5–AC7, AC9: Job Done trigger and wording, rework, backfill, `edit_customer_message`, `confirm_customer_message` (who, when, newest only, first wins), guard trigger, RLS |
| `ui/customer-message.test.tsx` | 0003 AC3–AC8, AC10: panel states, edit, Send / Call questions, errors, badge on Submitted cards, phone-width classes |
| `db/branch-cover.test.ts` | 0004 AC2–AC4: additional branches, Manager read and review scope, Job Done notices to covering Managers, every branch needs a Manager (staff and orders) |
| `db/review.test.ts` | 0004 AC5–AC9, AC15: approve needs the customer told, on-behalf message, notices on approve and close, `order_review_summary`, `manager_orders` |
| `db/finance.test.ts` | 0004 AC10–AC13: `verify_payment` / `unverify_payment`, close guard, Finance payments with receipt, `finance_orders` |
| `ui/review-close.test.tsx` | 0004 AC5–AC15: queues, tabs, branch filters, review page, approve / return / close, verify / undo, Finance payment form, notification links, Approved / Closed lines, verification history; 0009 Warnings box (check, Re-check, read-only for Finance), Approve held, queue counts and filter |
| `db/feedback.test.ts` | 0005 AC1–AC13: tokens and link line, address setting, `feedback_form` states and fields, `submit_feedback` (once, answers, after Close, rework), poor-rating notices, `record_phone_feedback` rules and audit, RLS reads, Manager rating column |
| `ui/feedback.test.tsx` | 0005 AC1–AC5, AC7, AC9, AC13, AC14: public route, form validation and single submit, retry, link states, feedback card, phone dialog by role, link line and placeholder warning in the message panel |
| `domain/feedback.test.ts` | 0005 form rule, poor rating, link line, phone-rating rule, labels |
| `db/staff.test.ts` | 0006 AC1, AC7–AC17: backfill on existing staff, `create_staff` / `update_staff` / `set_staff_active` by role, self and last-role guards, open jobs, phone / email rules, "Manager first" messages, rules by plain SQL, history (incl. cleanup deletes), sign-in steps and state, `staff_list` / `staff_detail` / `branch_cover_overview` / `staff_form_check`, `order_review_summary` ids |
| `functions/staff-access.test.ts` | 0006 AC4–AC6, AC11, AC12, AC19: request checks, database-then-Auth order, partial failures and retries, unused-invite restart, error text never leaked |
| `ui/staff.test.tsx` | 0006 AC2, AC3, AC9, AC13, AC18: list query and filters in the address, paging, branch cover panel, add / edit forms by role, warnings, staff page actions, deactivation blocker, retry banner, `confirmAddress` |
| `ui/password.test.tsx` | 0006 AC5, AC6, AC11: email link page, change password, live sign-out (Realtime and re-check) |
| `domain/staff.test.ts` | 0006 form rule, who may manage whom, labels, history lines |
| `db/kpi.test.ts`, `db/kpi-views.test.ts`, `db/kpiHelpers.ts` | 0007 AC2–AC11, AC15, AC16: each metric counted / not counted (approval day, Job Done / rework / cancelled, final amount, collected, reschedule vs postpone and its technician, returns, latest rating, late rating), credit after reassign / branch move / deactivation, listed technicians from the staff history, ties, Malaysia midnight edges, trend, branches, events |
| `db/kpi-scope.test.ts` | 0007 AC1, AC9: every function as Admin, Finance, covering / other Manager, technician, inactive, signed out; bad periods |
| `db/kpi-volume.test.ts` | 0007 AC17: a generated year (45 technicians, ~25,000 orders) within the time budgets |
| `domain/kpi.test.ts` | 0007 periods across month / year ends, labels, address, ranking and sorting, CSV |
| `db/ask.test.ts` | 0008 AC1, AC3–AC5, AC11: `ask_jobs` / `ask_payments` / `ask_find_people` per role, filters, Malaysia day edges and KPI parity, name matching (slips, titles, two Alis, inactive), chats and log visibility, service-role-only saving, 7-day hiding and purge |
| `functions/ask.test.ts`, `functions/ask-periods.test.ts` | 0008 AC2, AC3, AC5–AC10, AC12: the AI loop with a scripted fake model (menu, strict schemas, max 3 lookups, reply tools, refusals, Did you mean, own-only, no phone / address / notes sent, follow-up context, errors and timeout); named periods and parity with `src/domain/kpi.ts` |
| `ui/ask.test.tsx` | 0008 AC7, AC9, AC11, AC12, AC14: bubble per role, examples, steps, answer card and links, plain "How I found this", choice buttons, errors and 20-second limit, saved chats, Question log (AI log since 0009, with the Type filter), phone layout |
| `db/supervisor.test.ts` | 0009 AC1–AC5, AC15: each rule and its limits, resolve / reopen, AI runs at Job Done and resubmission, approve guard, who may check / re-check, notes, RLS (no technicians), delete / change guard, the function-side input (no customer details) and save, retry sweep, AI log |
| `db/order-form.test.ts` | 0009 AC8: `set_order_form` / `remove_order_form` (Admin, statuses, types, paths, retry, replace), not one of the 6 files, no photo rule, Storage read / write / delete by role |
| `db/insights.test.ts` | 0009 AC10, AC12: every insight kind, numbers equal `kpi_technicians` / `kpi_branches`, role scope, empty period, saved wordings and the 7-day purge |
| `functions/ai-assist.test.ts` | 0009 AC2, AC5–AC7, AC13, AC14: request checks, caller checks per action, supervisor save / failures / timeout, form all-or-nothing, file checks, no phone / address, insight number check, saved wording, AI down, fixed sentences equal the domain |
| `ui/read-from-photo.test.tsx` | 0009 AC6–AC9: fill, unclear, bad type, save then attach, Try again, Remove photo |
| `domain/supervisor.test.ts` | 0009 limits, notes, insight rules and sentences, period phrase, order form file rules |
| `ui/kpi.test.tsx` | 0007 AC1, AC8–AC14, AC16: address kept, period picker, branch filter per role, cards, leaderboard sort and ties, tags, empty period, CSV, drill-down, My week, table views of the charts |
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
- The KPI pages (0007) are `React.lazy` chunks (`src/features/kpi/lazy.tsx`):
  Recharts is bundled only into them, so the other screens do not download
  it. Every number comes from the five `kpi_*` RPCs.
- The Ask assistant (0008) is mounted by each portal. A question goes browser
  → `fetch('/functions/v1/ask')` with the session token → the function asks
  OpenAI which lookups to run, runs them with the person's token (RLS and the
  read functions' rules apply), sends steps and the result back as
  newline-separated JSON, and saves the turn with `ask_record` (secret key).
  The OpenAI key lives only in the function's secrets.
- 0009: at Job Done the database itself posts `{action: 'supervisor_check',
  run_id}` to `ai-assist` (`pg_net`, header `x-ai-trigger` from Vault); the
  function reads the job record and saves AI warnings with the secret key.
  The browser calls `ai-assist` with the session token for Re-check, Read from
  photo and the insight wording (`src/lib/aiAssist.ts`). Warnings reach open
  order pages through Realtime on `order_warnings` / `supervisor_runs`.
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
| `docs/prd/0007-kpi-dashboard-prd.md` | Intent | KPI dashboard goals |
| `docs/0007-kpi-dashboard-workflow.md` | Workflow | KPI definitions, scope, screens and the read functions for 0008 |
| `docs/prd/0008-ai-ops-query-prd.md` | Intent | AI operations query goals |
| `docs/0008-ai-ops-query-workflow.md` | Workflow | Lookups, limits, saving and screens of the Ask assistant |
| `docs/prd/0009-ai-advanced-prd.md` | Intent | AI advanced challenges goals |
| `docs/0009-ai-advanced-workflow.md` | Workflow | Supervisor warnings, Read from photo, insights and the AI log |
| `docs/decisions/0001-*.md` – `0016-*.md` | Decision log | Structural changes that diverged from the plans |
