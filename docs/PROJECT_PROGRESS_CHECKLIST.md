# Permora Project Progress Checklist

Last reconciled: October 15, 2026  
Reconciled against: local working tree on `feature/ui-ux-modernization` (HEAD `d1f260f`), Node.js 22.23.2, isolated `permora_test` database.  
Repository: `yashiro-nyx/Permora`  
Production prototype: <https://permora.vercel.app>

## Branch and commit status (as of October 15, 2026)

| Branch | HEAD commit | Notes |
|---|---|---|
| `feature/ui-ux-modernization` (current) | `d1f260f` | All feature work through UI/UX modernization; 21 commits ahead of `develop`, 2 ahead of `main` |
| `origin/main` | `43d0a9e` | Docs-only commits since the last feature merge; does **not** contain Stage 2C, 2D, migrations 0007–0010, or UI/UX work |
| `origin/develop` | `fedc270` | Frozen at Stage 2B Milestone 5; does **not** contain anything merged after Milestone 5 |
| `feature/permora-preview-readiness` | `eca432d` | Contains catalog expansion (migrations 0010, new resources, dedup fix) but not the UI/UX modernization |

**Critical gap:** The two most recent feature commits (`eca432d` and `d1f260f`) are on an unmerged feature branch. They have not been reviewed, merged into `develop`, or deployed to production. A PR to `develop` must be opened, reviewed, and merged before these changes can be considered released.

**Working tree:** clean (`git diff --check` passed; no uncommitted changes).

## Project status summary

Permora is a university access-request and approval system built with Next.js 15, React 19, TypeScript 5, Tailwind CSS 4, Better Auth 1.7, Argon2id, PostgreSQL via pg, Neon, and Vercel.

All implementation through Stage 2C manual activation and Stage 2D administrator governance is complete and verified locally. The UI/UX has been modernized with a collapsible sidebar, improved metric displays (active access now reads real data), consistent button components, and improved accessibility. Automatic expiry scheduling, real university provisioning integrations, password recovery, MFA, and SSO remain deferred. Production deployment has not received migrations 0007–0010.

Stage 2B Milestone 5 is **complete and in develop**. Stage 2C and 2D are **complete locally but not yet merged to develop or main**. UI/UX modernization is **on a feature branch pending PR review**.

## 1. Foundation and design

- [x] Analyze the original university access-request requirements.
- [x] Select the system name **Permora**.
- [x] Remove dependency on a fictional university identity.
- [x] Create the Figma prototype and extract its design system.
- [x] Document design tokens and implementation rules.
- [x] Build responsive layouts for desktop, tablet, and mobile.
- [x] Restore the original login-page imagery as local assets.
- [x] Adopt semantic HTML and accessible interaction patterns.
- [x] Platform-wide UI/UX modernization: collapsible sidebar, improved typography, consistent buttons, toast system, notification bell, skeleton loading screens, `TablePagination` with 10/25/50 options, active-access metric backed by real data, improved badge colors, and login page refinement. (`d1f260f` — not yet in `develop`.)
- [ ] Perform a final design comparison against every Figma frame before the final presentation.

## 2. Stage 1 — Requester prototype

- [x] Build the requester dashboard.
- [x] Build the My Requests page.
- [x] Add request summary cards.
- [x] Add combined search and filtering.
- [x] Add request details and expandable history.
- [x] Show denial reasons.
- [x] Show requested validity and scheduled expiration.
- [x] Add expired-request renewal navigation.
- [x] Correct expired-row actions and button placement.
- [x] Verify desktop and mobile layouts.
- [x] Replace browser-demo request behavior with server-backed records during Stage 2A.

## 3. Philippine university resource catalog

- [x] Define stable resource and permission identifiers.
- [x] Add Learning Management System access.
- [x] Add Student Portal access.
- [x] Add Faculty Grading System access.
- [x] Add Library E-Resources access.
- [x] Add Computer Laboratory Systems access.
- [x] Add Research Project Workspace access.
- [x] Filter resources and permissions by requester role.
- [x] Add course/section, laboratory, software, and research-project scopes.
- [x] Prevent students from selecting faculty grading permissions.
- [x] Limit Student Portal requests to the requester's own account.
- [x] Preserve compatible resource, permission, and scope values during renewal.
- [x] Reject duplicate requests with overlapping validity periods.
- [x] Add Campus Network & Wi-Fi Access resource (`r-network-access`) with eduroam, VPN, and device-registration permissions, network-zone scope, and migration `0010`. (`eca432d` — not yet in `develop`.)
- [x] Add Department Shared Resources resource (`r-dept-shared`) with shared-drive and print-services permissions, department scope, and migration `0010`. (`eca432d` — not yet in `develop`.)
- [x] Fix duplicate React key bug in scope dropdown when a requester has overlapping assignments for the same scope option (`eca432d`).
- [x] Enrich synthetic dev demo data: multiple sections, labs, software, research projects per role; idempotent seed script (`scripts/seed-dev-demo-access.ts`). (`eca432d`)
- [ ] Replace proposed policy values with officially approved institutional policies if the system is adopted by a real university.
- [ ] Connect canonical course, laboratory, project, enrollment, and staff-assignment data to authoritative university sources.

## 4. Stage 2A — Authentication and PostgreSQL persistence

- [x] Implement email/password authentication using Better Auth.
- [x] Hash passwords using Argon2id.
- [x] Store sessions in PostgreSQL.
- [x] Support server-side session revocation and expiration.
- [x] Enforce trusted-origin and CSRF protections.
- [x] Add database-backed authentication rate limiting.
- [x] Fix Better Auth rate-limit key issue: `trustedProxies: ["127.0.0.1", "::1", "::ffff:127.0.0.1", "::/128"]` and `max: 10` for `/sign-in/email` in dev to prevent localhost shared-bucket blocking. (`d1f260f`)
- [x] Remove demo login and role-switching behavior.
- [x] Implement owner-scoped requester records.
- [x] Implement server-derived roles and identities.
- [x] Add secure administrator bootstrap provisioning.
- [x] Add authorized account provisioning for students, faculty, approvers, and administrators.
- [x] Keep institutional identifiers separate from internal UUIDs.
- [x] Add versioned migrations `0001` through `0003`.
- [x] Fix the Better Auth `rateLimit` schema incompatibility.
- [x] Add guarded PostgreSQL integration tests.
- [x] Prevent integration fixtures from using a database whose name does not end in `_test`.
- [x] Add a password-change interface (`/account/password`) with current-password verification, 12–128 length, must differ, self-only, rate limiting, session revocation, audit, show/hide controls, live four-level strength indicator, and requirements checklist.
- [x] Build an administrator account-management interface (`/users`): creation, profile editing, role management, invitation-based credentials, activation/deactivation.
- [ ] Add secure password recovery and reset delivery (blocked: requires email-delivery service, reset-token migration, and recovery policy).
- [ ] Add optional or required MFA according to final university policy (blocked: requires two-factor plugin, schema migration, and enrollment/backup-code flow).
- [ ] Add institutional SSO (blocked: requires institutional identity-provider integration).

## 5. Stage 2B Milestone 1 — Approval foundation

- [x] Add approval workflow states.
- [x] Add optimistic request versioning.
- [x] Add multi-scope approver responsibilities.
- [x] Persist exactly one review assignment per routed request.
- [x] Add immutable decision, request-event, and audit-event records.
- [x] Prevent updates or deletion of immutable event records.
- [x] Implement full-scope responsibility matching.
- [x] Reject partial-scope matches.
- [x] Exclude self-approval.
- [x] Implement deterministic routing by workload and approver UUID.
- [x] Preserve unrouteable requests as `pending_routing`.
- [x] Add controlled routing reconciliation.
- [x] Add versioned migrations `0004` and `0005`.

## 6. Stage 2B Milestone 2 — Authorized read model

- [x] Add active-session administrator and approver guards.
- [x] Add assignment-scoped review queue queries.
- [x] Add responsibility-scoped request-detail queries.
- [x] Return identical not-found responses for unknown and unauthorized request IDs.
- [x] Sanitize queue and detail DTOs.
- [x] Add validated filters and bounded pagination.
- [x] Add the administrator-only unassigned-routing query.
- [x] Keep administrator review access subject to assignment and responsibility rules.

## 7. Stage 2B Milestone 3 — Approval decisions

- [x] Add transactional approve, deny, and return-for-revision operations.
- [x] Require the persisted, fully eligible assignee.
- [x] Revalidate current eligibility, scope, responsibility, validity, and conflicts.
- [x] Require reasons for denial and return-for-revision.
- [x] Add expected-version concurrency checks.
- [x] Add per-actor idempotency keys.
- [x] Prevent duplicate and competing decisions.
- [x] Create decision, request event, audit event, notification, assignment completion, and state transition atomically.
- [x] Add versioned migration `0006`.
- [x] Stop successful approval at `approved_pending_activation`.
- [x] Confirm that approval creates no active entitlement.

## 8. Stage 2B Milestone 4 — Protected staff interface

- [x] Add role-specific server-authorized navigation.
- [x] Add live approver and administrator dashboard summaries.
- [x] Build the assignment-scoped review queue.
- [x] Build sanitized staff request details.
- [x] Add confirmation dialogs for approval, denial, and revision.
- [x] Add reason validation and duplicate-submit protection.
- [x] Handle stale versions safely.
- [x] Add the administrator unassigned-routing page.
- [x] Show terminal requests as history instead of actionable reviews.
- [x] Remove approval controls from terminal request details.
- [x] Verify responsive staff layouts at desktop, tablet, 390 px, and 320 px.

## 9. Stage 2B Milestone 5 — Notifications and Audit Visibility

Status: **Completed and merged into `develop`**

### Requester notification center

- [x] Create an owner-scoped notification read service.
- [x] Add a requester-only notification API.
- [x] Display notification type, safe message, date/time, and related request.
- [x] Add all-notification and unread-only filters.
- [x] Add bounded pagination and deterministic ordering.
- [x] Add read/unread status.
- [x] Implement idempotent "mark as read."
- [x] Implement owner-scoped "mark all as read."
- [x] Enforce active session, requester role, ownership, input validation, and same-origin protection.
- [x] Use private, no-store caching.
- [x] Do not expose another requester's notifications.
- [x] Add notification bell in header with unread count, popover, and mark-as-read controls. (`d1f260f` — not yet in `develop`.)

### Staff (approver/administrator) notifications — `feature/notification-system`

- [x] Migration `0011`: drop `UNIQUE(request_event_id)` → composite `UNIQUE(request_event_id, recipient_user_id)`; widen `notification_type` CHECK to include `request_assigned_for_review` and `routing_unavailable`.
- [x] Approver receives `request_assigned_for_review` notification on automatic routing (`routePendingRequest`) and administrator manual assignment (`administratorAssignPendingRequest`).
- [x] All active administrators receive `routing_unavailable` notification when routing fails and no approver can be found.
- [x] Staff notification API: `GET /api/notifications/staff`, `POST /api/notifications/staff/:id/read`, `POST /api/notifications/staff/read-all` — enforces approver/admin role; requesters receive 403.
- [x] Staff notification bell (`StaffNotificationBell`) in the portal header for approver and administrator roles; requester bell unchanged.
- [x] Staff notification center at `/notifications/staff`: all/unread filter, paginated list, mark-as-read, deep links to `/review/:id` or `/admin/unassigned`, in-app-only disclaimer.
- [x] Requester notification queries exclude staff notification types via `NOT ALL` filter; staff unread counts are separate.
- [x] Bell polls every 15 s (reduced from 60 s), pauses when tab is hidden, resumes on tab focus, and refreshes immediately when the panel is opened.
- [x] Request submission form dispatches `permora-notification-refresh` custom event to trigger immediate bell refresh without component coupling.
- [x] `requireStaff()` server guard added to `lib/server/identity.ts`; `/notifications/staff` redirects non-staff to `/dashboard?unavailable=staff`.
- [x] Toast stack cap: `MAX_TOASTS = 3` enforced in `upsertToast`; oldest dismissible toast evicted first; sticky errors survive; progress/countdown bar added to `ToastItem`.

### Administrator audit-log viewer

- [x] Create an administrator-only audit read service.
- [x] Return only sanitized, presentation-safe audit fields.
- [x] Display event time, action type, safe actor information, target information, and summary.
- [x] Add search, event-type, date-range, and pagination filters.
- [x] Keep ordering deterministic.
- [x] Keep the interface read-only.
- [x] Do not add audit update or delete operations.
- [x] Reject non-administrator, inactive, and unauthenticated users.

### Milestone 5 testing

- [x] Unit tests for filters, parsing, display mapping, and safe error mapping.
- [x] Notification ownership isolation tests.
- [x] Requester-role enforcement tests.
- [x] Mark-one and mark-all idempotency and ownership tests.
- [x] Administrator-only audit access tests.
- [x] Audit DTO sanitization tests.
- [x] Playwright coverage for requester notifications and administrator audit logs.
- [x] Verified desktop, tablet, 390 px, and 320 px layouts.

## 10. Stage 2C — Activation and lifecycle management

Status: **Implemented locally; not yet merged into `develop` or `main`**

- [x] Define activation as manual active-administrator confirmation behind the `ActivationAdapter` interface.
- [x] Design separation between approval (`access_request`) and lifecycle state (`request_activation`).
- [x] Add authorized activation operation; requester and original approver are excluded.
- [x] Require current eligibility, policy version, scope assignment, validity, entitlement/conflict revalidation before adapter call.
- [x] Create `ordinary_entitlement` only after successful provisioning confirmation.
- [x] Record activation success/failure as immutable events.
- [x] Notify requester via owner-scoped in-app notifications.
- [x] Implement automatic access expiration via protected endpoint (`POST /api/maintenance/expire-activations`, bearer-secret-protected, disabled by default).
- [x] Expire or revoke entitlement lifecycles safely and terminally; revocation service not yet exposed as UI/CLI.
- [x] Implement renewal as a new linked request.
- [x] Add retryable failure and 15-minute stuck-activation reconciliation with dry-run default.
- [x] Prevent duplicate activation/replay effects and terminal overwrites.
- [x] Add versioned migration `0007`.
- [x] Combined lifecycle integration coverage and Playwright coverage.
- [x] Document manual recovery procedures in `docs/activation-operations.md`.
- [ ] Wire the automatic-expiration endpoint to an actual schedule with monitoring. Not enabled in production.

## 11. Stage 2D — Administrator capabilities

Status: **Implemented locally; not yet merged into `develop` or `main`**

- [x] Build user-account creation and maintenance UI (`/users`).
- [x] Add user activation and deactivation controls.
- [x] Add secure temporary-password or invitation workflows.
- [x] Add resource and permission policy management UI (`/resources`, `/permissions`): availability toggles and scope-option creation; policy-version/duration editing remains migration/CLI controlled.
- [x] Add approver-responsibility management UI (`/admin/responsibilities`): list, add, confirmed end, explicit resource-wide confirmation.
- [x] Add safe reassignment for unassigned requests (`/admin/unassigned`): `pending_routing` only, no decision bypass.
- [x] Add approver delegation and absence handling UI (`/admin/delegations`): list/create/cancel; server rejects self/circular/overlapping.
- [x] Add institutional identifier maintenance UI (`/admin/identifiers`): account search, per-account list, add/update; no delete.
- [x] Add analytics and operational reports UI (`/reports`): read-only, sanitized, with date/resource/status filters.
- [x] Add per-account notification preferences UI (`/account/notifications`): in-app editable; external delivery unavailable.
- [x] Add retention management UI (`/admin/retention`): list + dry-run preview only; destructive archival deferred.
- [x] Add migrations `0008` (account management) and `0009` (administrator governance).

### Known issues

- Administrators without an approval responsibility who open Review Requests are redirected to `/dashboard?unavailable=approver`. Intentional but UX could be clearer.
- Repeating a request assignment returns `409` rather than replaying the original success.
- `admin-governance-service.ts` `listDelegations` previously returned all delegations (no pagination) — this was paginated in `d1f260f` with server-side `count(*) OVER()`.

## 12. Deployment and environments

- [x] Create the GitHub repository, push `main` and `develop`.
- [x] Create and push all feature branches.
- [x] Deploy the production prototype to Vercel.
- [x] Configure Node.js 22.
- [x] Create a production health endpoint.
- [x] Create Neon production, development, and test branches.
- [x] Apply migrations `0001`–`0006` to production.
- [ ] **PENDING:** Apply migrations `0007`–`0010` to production from a controlled operator environment. Production currently runs with only `0001`–`0006`. Development (`neondb`) has `0001`–`0010` applied.
- [x] Provision production prototype accounts.
- [x] Verify the live request-to-approval workflow.
- [x] Add explicit database-target safety controls to operational CLI scripts.
- [ ] Merge `feature/ui-ux-modernization` into `develop` (PR open; peer review pending).
- [ ] Confirm Milestone 5 PR into `develop` was completed (currently `develop` is at Milestone 5 checklist update only).
- [ ] Confirm the Vercel `develop` Preview deployment uses only the Neon development branch.
- [ ] Confirm Preview uses a separate `AUTH_SECRET` from Production.
- [ ] Confirm Preview `APP_URL` exactly matches its stable Preview URL.
- [ ] Keep `TEST_DATABASE_URL` and migration credentials out of Vercel deployments.
- [ ] Add monitoring and operational alerting.
- [ ] Complete a formal security review before using real university records.

## 13. Database CLI safety

- [x] Require `--database-target development`, `test`, or `production`.
- [x] Reject unstated database targets.
- [x] Validate protocol, database name, normalized Neon hostname, and port.
- [x] Treat matching Neon direct and pooler hosts as the same branch.
- [x] Permit separate runtime and migration usernames.
- [x] Require `_test` for test database operations.
- [x] Require `--confirm-production` for production operations.
- [x] Require both production runtime and migration URLs in the current process.
- [x] Prevent production database URLs from being loaded from `.env.local`.
- [x] Avoid printing credentials and database URLs in failures.

## 14. Final verification checklist

Run these checks before merging a feature branch:

```bash
npm test
npm run test:integration
npm run test:e2e
npm run lint
npm run typecheck
npm run build
git diff --check
```

**Verified October 15, 2026** — `feature/ui-ux-modernization` HEAD `d1f260f`, Node.js 22.23.2, isolated `permora_test` database:

- [x] `npm test`: **120 passed / 0 failed**.
- [x] `npm run test:integration`: **96 passed / 0 failed** (9 files, all against `permora_test` with `_test` suffix confirmed).
- [x] `npm run test:e2e`: **55 passed / 0 failed** on Chromium (Playwright), including responsive layout checks at 320/390/768/1440px, notification bell, full request→approval→activation workflow.
- [x] `npm run lint`: **passed, 0 warnings**.
- [x] `npm run typecheck`: **passed**.
- [x] `npm run build`: **passed** (all routes compiled).
- [x] `git diff --check`: **clean**.
- [ ] Run in CI against the final reviewed commit before merging.
- [ ] A teammate reviews authorization, ownership, and database-target boundaries before merge.

**Previous baseline (October 11, 2026):** 109 unit / 95 integration / 54 e2e — all have grown due to new test coverage for pagination, toast logic, and resource catalog additions.

## 15. Remaining work — priority order

### Immediate (blocks PR merge and deployment)

1. **Open and review the `feature/ui-ux-modernization` → `develop` PR.** The branch was pushed but the PR has not been reviewed or merged. This is the prerequisite for all deployment work.
2. **Apply migrations `0007`–`0010` to production.** Production is 4 migrations behind. These must be applied from the controlled operator environment before deploying new code.

### Near-term (required before production use with real users)

3. **Wire the automatic expiration endpoint** to a schedule (e.g. Vercel Cron) with monitoring and alerting.
4. **~~Propose and implement migration `0011`~~** — **completed** on `feature/notification-system`. Staff notifications (approver assignment, routing failure) now use the `user_notification` table via a composite uniqueness constraint. Apply migration `0011` to the development database after `feature/notification-system` is reviewed and merged into `develop`.
5. **Active-access filter:** the metric links to `/requests` (all). Add a dedicated active-access view or filter once the `request_activation` JOIN is established in the list service.
6. **Production environment verification:** confirm `AUTH_SECRET` isolation between Preview and Production, `APP_URL` correctness, `TEST_DATABASE_URL` exclusion from Vercel deployments.

### Deferred (institutional dependency)

7. Password recovery / MFA / SSO — blocked on email delivery, institutional IdP.
8. Real university provisioning adapters — blocked on institutional systems.
9. Catalog policy approval and canonical data integration.
10. Audit export, redaction, legal-hold, and external notification delivery.
11. Formal WCAG 2.2 AA audit and final Figma design comparison.
12. Policy-version editing UI (duration/renewability).

## 16. Current system boundary

- Permora authenticates real database-backed accounts.
- Request records are owner-scoped and persisted in PostgreSQL.
- Approval routing and decisions are server-authorized and auditable.
- Requesters can view PostgreSQL-backed in-app notifications and mark them as read.
- Approvers receive a `request_assigned_for_review` notification when a request is routed or manually assigned to them; the staff bell and `/notifications/staff` page show the unread count and full history.
- Administrators receive `routing_unavailable` notifications when automatic routing fails; the same staff bell and page surface all staff notifications.
- The notification bell polls every 15 s while the tab is visible; pauses when hidden; refreshes on tab focus and immediately after local mutations.
- Administrators can view sanitized read-only audit records and the activation lifecycle queue.
- Request approval does **not by itself** provision or activate access; manual admin confirmation is a separate lifecycle step.
- The requester dashboard active-access metric is now backed by real `request_activation` data (activated + not expired), not a hardcoded `0`.
- External email, SMS, and push notifications are not implemented.
- Institutional enrollment, staff assignment, course, laboratory, and research systems are not yet integrated.
- The deployed application is a controlled functional prototype, not a complete university production access-control service.
- **Production deployment:** only reflects code through `bc2bdc9`. All Stage 2C, 2D, UI/UX, and catalog work is undeployed.

## 17. Git workflow for remaining work

1. Open the `feature/ui-ux-modernization` → `develop` PR and get a teammate review.
2. Once approved, merge to `develop`.
3. Verify the Vercel Preview deployment against the Neon development branch with migrations `0007`–`0010` applied.
4. For each subsequent feature: branch from `develop`, implement, verify, open PR to `develop`, review, merge.
5. Merge `develop` → `main` only for a reviewed production release.
6. Apply production migrations manually from the controlled operator environment before deploying.
7. Perform post-deployment health and workflow verification.

## Team handoff notes

Before starting work, every teammate should read:

- `README.md`
- `HANDOFF.md`
- `docs/implementation-status.md`
- `docs/stage-2-plan.md`
- `docs/stage-2b-plan.md`
- `docs/resource-access-matrix.md`

Never place credentials in source code, Git history, screenshots, issue comments, or pull-request descriptions. Never run fixtures against development or production. When the database target is uncertain, stop and verify before running the command.

**Verified October 18, 2026** — `feature/notification-system` branched from `feature/ui-ux-modernization` HEAD `2dbbcc0`, Node.js 22.23.2, isolated `permora_test` database:

- [x] `npm test`: **125 passed / 0 failed** (up from 120; +5 toast MAX\_TOASTS eviction tests, +2 staff notification presentation tests).
- [x] `npm run test:integration`: **106 passed / 0 failed** (10 files; +10 staff notification integration tests).
- [x] `npm run test:e2e`: **59 passed / 0 failed** (+4 staff notification bell, page, redirect, and overflow Playwright tests).
- [x] `npm run lint`: **passed, 0 warnings**.
- [x] `npm run typecheck`: **passed**.
- [x] `git diff --check`: **clean**.
- [ ] `npm run build`: pending (run before merging).
- [ ] Run in CI against the final reviewed commit before merging.
- [ ] A teammate reviews authorization, ownership, and database-target boundaries before merge.

**Verified October 18, 2026** — `feature/notification-system`, Node.js 22.23.2, isolated `permora_test` database:

- [x] `npm test`: **129 passed / 0 failed** (up from 125; +4 toast auto-dismiss duration tests).
- [x] `npm run test:integration`: **113 passed / 0 failed** (11 files; +7 request-form duplicate overlap tests including the new `approved_pending_activation` gap fix).
- [x] `npm run test:e2e`: **68 passed / 0 failed** (up from 59; +9 request-form UX tests: field reset, scroll, toast, validation, responsive layout).
- [x] `npm run lint`: **passed, 0 warnings**.
- [x] `npm run typecheck`: **passed**.
- [x] `npm run build`: **passed**.

### Form and toast fixes verified in this run

- Toast auto-dismiss: all variants dismiss (success/info 5 s, warning 7 s, error 8 s); `prefers-reduced-motion` hides bar but JS timer still fires.
- Scroll: `router.refresh()` removed from success path; `ErrorSummary` (which called `focus()`) removed from form.
- Field reset: purpose textarea now controlled; resets on resource change.
- Duplicate message: includes conflicting request display\_id; `approved_pending_activation` now checked.
- Validation UX: one toast per error, inline field errors persist after toast dismisses.

**Verified October 18, 2026 (final form fixes)** — `feature/notification-system`, Node.js 22.23.2:

- [x] `npm test`: **129 passed / 0 failed**.
- [x] `npm run test:integration`: **113 passed / 0 failed** (11 files).
- [x] `npm run test:e2e`: **70 passed / 0 failed** (+2 from discard-confirmation dialog and start-date reset).
- [x] `npm run lint`: **passed, 0 warnings**.
- [x] `npm run typecheck`: **passed**.
- [x] `npm run build`: **passed**.

### Additional form fix in this run

- Resource switch now resets `startsAt` (previously kept). Total reset on switch: permission, scopes, purpose, `startsAt`, `expiresAt`.
- Discard confirmation dialog (`Confirm` component with `danger` styling) appears when the user has entered a non-empty purpose, changed the start date, or selected a scope, before overwriting those values.
- Cancelling the dialog restores the original resource selection and preserves all entered values.
- Confirmation (`"Switch resource"` button) clears all resource-specific fields and resets to the new resource&apos;s defaults.
- Renewals are exempt — the resource selector is disabled on the renewal form.
