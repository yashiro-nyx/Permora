# Permora Project Progress Checklist

Last updated: September 29, 2026
Repository: `yashiro-nyx/Permora`  
Production prototype: <https://permora.vercel.app>  
Current development branch: `develop`  
Milestone 5 branch: `feature/stage-2b-milestone-5`

## Project status summary

Permora is a university access-request and approval system built with Next.js, React, TypeScript, Tailwind CSS, Better Auth, PostgreSQL, Neon, and Vercel.

The requester workflow, database-backed authentication, approval routing, protected staff review, requester notifications, administrator audit, and Stage 2C manual activation lifecycle are implemented. Automatic expiry scheduling and real university provisioning integrations remain outstanding.

Stage 2B Milestone 5 is **complete**. Stage 2C lifecycle slices 1–7 are implemented for manual administrator operation. `approved_pending_activation` remains the approval decision; activation is stored separately and only successful manual confirmation creates an entitlement. No live university provisioning adapter or automatic job schedule exists.

## 1. Foundation and design

- [x] Analyze the original university access-request requirements.
- [x] Select the system name **Permora**.
- [x] Remove dependency on a fictional university identity.
- [x] Create the Figma prototype and extract its design system.
- [x] Document design tokens and implementation rules.
- [x] Build responsive layouts for desktop, tablet, and mobile.
- [x] Restore the original login-page imagery as local assets.
- [x] Adopt semantic HTML and accessible interaction patterns.
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
- [x] Limit Student Portal requests to the requester’s own account.
- [x] Preserve compatible resource, permission, and scope values during renewal.
- [x] Reject duplicate requests with overlapping validity periods.
- [ ] Replace proposed policy values with officially approved institutional policies if the system is adopted by a real university.
- [ ] Connect canonical course, laboratory, project, enrollment, and staff-assignment data to authoritative university sources.

## 4. Stage 2A — Authentication and PostgreSQL persistence

- [x] Implement email/password authentication using Better Auth.
- [x] Hash passwords using Argon2id.
- [x] Store sessions in PostgreSQL.
- [x] Support server-side session revocation and expiration.
- [x] Enforce trusted-origin and CSRF protections.
- [x] Add database-backed authentication rate limiting.
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
- [ ] Add a password-change interface for institution-provisioned users.
- [ ] Add secure password recovery and reset delivery.
- [ ] Add optional or required MFA according to final university policy.
- [ ] Build an administrator account-management interface to replace routine terminal provisioning.

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

Status: **Completed**

### Requester notification center

- [x] Inspect the notification records created by approval decisions.
- [x] Create an owner-scoped notification read service.
- [x] Add a requester-only notification API or server action.
- [x] Display notification type, safe message, date/time, and related request.
- [x] Add all-notification and unread-only filters.
- [x] Add bounded pagination and deterministic ordering.
- [x] Add read/unread status.
- [x] Implement idempotent “mark as read.”
- [x] Implement owner-scoped “mark all as read.”
- [x] Enforce active session, requester role, ownership, input validation, and same-origin protection.
- [x] Use private, no-store caching.
- [x] Do not expose another requester’s notifications.
- [x] Keep email, SMS, and push delivery outside this milestone.

### Administrator audit-log viewer

- [x] Create an administrator-only audit read service.
- [x] Return only sanitized, presentation-safe audit fields.
- [x] Display event time, action type, safe actor information, target information, and summary.
- [x] Add search, event-type, date-range, and pagination filters where supported.
- [x] Keep ordering deterministic.
- [x] Keep the interface read-only.
- [x] Do not add audit update or delete operations.
- [x] Reject requesters, approvers without admin role, inactive users, and unauthenticated users.
- [x] Do not expose password hashes, sessions, tokens, credentials, database URLs, raw errors, or unnecessary metadata.

### Milestone 5 testing and documentation

- [x] Add unit tests for filters, parsing, display mapping, and safe error mapping.
- [x] Test notification ownership isolation.
- [x] Test requester-role enforcement.
- [x] Test mark-one and mark-all idempotency and ownership.
- [x] Test administrator-only audit access.
- [x] Test audit DTO sanitization.
- [x] Test filtering, pagination, and deterministic ordering.
- [x] Add Playwright coverage for requester notifications.
- [x] Add Playwright coverage for administrator audit logs.
- [x] Verify desktop, tablet, 390 px, and 320 px layouts.
- [x] Update `docs/stage-2b-plan.md`.
- [x] Update `docs/implementation-status.md`.
- [x] Update `HANDOFF.md` for the current operational boundary.
- [x] Verify under Node.js 22.23.2.
- [x] Pass 43 unit tests.
- [x] Pass 43 PostgreSQL integration tests against the guarded `_test` database.
- [x] Pass 20 Playwright E2E tests.
- [x] Pass ESLint, TypeScript checking, the production build, and `git diff --check`.
- [x] Push `feature/stage-2b-milestone-5` and open a pull request into `develop`.

## 10. Stage 2C — Activation and lifecycle management

Status: **In progress — manual lifecycle implemented; integration and scheduling deferred**

- [x] Define activation as manual active-administrator confirmation behind the `ActivationAdapter` interface; no university system is integrated yet.
- [x] Design the separation between approval and actual provisioning; approval state stays on `access_request`, lifecycle state is separate.
- [x] Add an authorized activation operation; requester and original approver are forbidden, including an original approver with admin role.
- [x] Require current eligibility, policy version, scope assignment, validity, entitlement/conflict revalidation before the adapter call.
- [x] Create `ordinary_entitlement` only after successful provisioning confirmation.
- [x] Record activation success/failure and lifecycle changes as immutable events.
- [x] Notify the requester of success/failure through owner-scoped in-app notifications.
- [ ] Configure automatic expiration scheduling; `activations:expire` exists and is dry-run by default but currently requires operator invocation.
- [x] Expire or revoke entitlement lifecycles safely and terminally; the revocation service is not yet exposed as UI/CLI.
- [x] Implement renewal as a new linked request rather than extending/reactivating the old request.
- [x] Add retryable failure and 15-minute stuck-activation reconciliation with dry-run default.
- [x] Prevent duplicate activation/replay effects and terminal expiry/revocation overwrites.
- [x] Add combined lifecycle integration coverage and admin/requester Playwright coverage.
- [x] Document manual recovery procedures in [docs/activation-operations.md](activation-operations.md).

## 11. Future administrator capabilities

- [ ] Build user-account creation and maintenance UI.
- [ ] Add user activation and deactivation controls.
- [ ] Add secure temporary-password or invitation workflows.
- [ ] Add resource and permission policy management.
- [ ] Add approver-responsibility management.
- [ ] Add safe reassignment for unassigned requests.
- [ ] Add approver delegation and absence handling.
- [ ] Add institutional identifier maintenance.
- [ ] Add analytics and operational reports.
- [ ] Add notification preferences when external delivery is introduced.
- [ ] Define retention and archival policies.

## 12. Deployment and environments

- [x] Create the GitHub repository.
- [x] Push `main` to GitHub.
- [x] Create and push `develop`.
- [x] Create and push `feature/stage-2b-milestone-5`.
- [x] Deploy the production prototype to Vercel.
- [x] Configure Node.js 22.
- [x] Create a production health endpoint.
- [x] Verify production application and database availability.
- [x] Create Neon production, development, and test branches.
- [x] Apply migrations `0001`–`0006` to production using a controlled operator environment.
- [x] Provision production prototype accounts.
- [x] Verify the live request-to-approval workflow.
- [x] Confirm that approval does not activate access.
- [x] Add explicit database-target safety controls to operational CLI scripts.
- [x] Push the completed Milestone 5 feature branch.
- [x] Open the Milestone 5 pull request into `develop`.
- [ ] Complete teammate review of the Milestone 5 pull request.
- [ ] Merge Milestone 5 into `develop`.
- [ ] Confirm that the Vercel `develop` Preview deployment uses only the Neon development branch.
- [ ] Confirm that Preview uses a separate `AUTH_SECRET` from Production.
- [ ] Confirm that Preview `APP_URL` exactly matches its stable Preview URL.
- [ ] Keep `TEST_DATABASE_URL` and migration credentials out of Vercel deployments.
- [ ] Add monitoring and operational alerting appropriate for a production system.
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

- [x] All unit tests pass (53 tests).
- [x] All PostgreSQL integration tests pass against the guarded `_test` database (60 tests).
- [x] All Playwright tests pass against isolated test fixtures (20 tests).
- [x] ESLint passes.
- [x] TypeScript checking passes.
- [ ] Re-run the production build after Stage 2C changes.
- [ ] Re-run the verification suite under the repository-pinned Node.js 22 runtime (latest Stage 2C run used Node 24.21).
- [x] `git diff --check` reports no formatting errors.
- [x] The working tree contains only intended changes.
- [x] No secrets, `.env.local`, database URLs, credentials, or generated test artifacts are staged.
- [x] Database migrations remain versioned; migration `0007` was validated on `_test` before any development apply; existing migrations were not rewritten.
- [x] Documentation matches actual behavior.
- [ ] A teammate reviews authorization, ownership, and database-target boundaries.

## 15. Git workflow for remaining work

Use the following flow for each remaining milestone:

1. Start from the latest `develop` branch.
2. Create a dedicated feature branch.
3. Implement and verify the milestone locally.
4. Push the feature branch.
5. Open a pull request into `develop`, not directly into `main`.
6. Require review and passing checks before merging.
7. Verify the Vercel Preview deployment against the Neon development branch.
8. Merge `develop` into `main` only for a reviewed production release.
9. Run production migrations manually from the controlled operator environment when a release includes new migrations.
10. Perform post-deployment health and workflow checks.

## 16. Current system boundary

The following statements must remain clear to developers, reviewers, and evaluators:

- Permora authenticates real database-backed accounts.
- Request records are owner-scoped and persisted in PostgreSQL.
- Approval routing and decisions are server-authorized and auditable.
- Requesters can view PostgreSQL-backed in-app notifications and mark them as read.
- Administrators can view sanitized read-only audit records and the activation lifecycle queue.
- Request approval does **not by itself** provision or activate access; manual admin confirmation is a separate lifecycle step.
- External email, SMS, and push notifications are not implemented.
- Institutional enrollment, staff assignment, course, laboratory, and research systems are not yet integrated.
- The deployed application is a controlled functional prototype, not a complete university production access-control service.

## Team handoff notes

Before starting work, every teammate should read:

- `README.md`
- `HANDOFF.md`
- `docs/implementation-status.md`
- `docs/stage-2-plan.md`
- `docs/stage-2b-plan.md`
- `docs/resource-access-matrix.md`

Never place credentials in source code, Git history, screenshots, issue comments, or pull-request descriptions. Never run fixtures against development or production. When the database target is uncertain, stop and verify it before running the command.
