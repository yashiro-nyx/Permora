# Permora Project Progress Checklist

Audited against the working tree on 2026-10-03; resource/permission catalog, delegation/absence, institutional-identifier, analytics/reports, per-account notification-preference, and retention-management administration UIs added and verified 2026-10-10/11, along with an enhanced change-password experience (live strength indicator + requirements checklist) and a protected automatic-expiration endpoint (full unit, PostgreSQL integration, and Playwright suites green under Node 22). This status distinguishes verified UI, backend-only services, and deferred work.

Status key: **Completed**, **In progress**, **Planned**, **Blocked**.

## Current milestone

Permora has completed Stage 1, Stage 2A, and Stage 2B Milestones 1–5. Migrations `0008` (account management) and `0009` (administrator governance) add account operations and governance records. The application has real email/password accounts, revocable PostgreSQL sessions, owner-scoped request persistence, deterministic approval routing, transactional decisions, requester in-app notifications, administrator audit, user management, responsibility management, and safe assignment of pending-routing requests.

The approval decision remains `approved_pending_activation`; by itself it creates no entitlement or active access. Stage 2C adds a separate activation lifecycle and manual administrator confirmation adapter. Successful manual confirmation records an entitlement, while no university system is integrated and no background scheduler is configured.

## Stage 1 — design and requester interface

- [x] **Completed:** inventory the Figma screens and record observed, inferred, and proposed design decisions.
- [x] **Completed:** document tokens, components, layout, responsive behavior, accessibility fixes, and Tailwind CSS 4 mapping.
- [x] **Completed:** implement Permora branding without recreating the source institution logo.
- [x] **Completed:** export and store the actual login imagery locally.
- [x] **Completed:** implement responsive login, requester dashboard, request form, My Requests filters/table/details/timeline, renewal entry point, and role-aware shell.
- [x] **Completed:** add the six-resource proposed Philippine university catalog and resource-specific scopes.
- [x] **Completed:** retain legacy prototype records only as historical browser-demo data; never import them as trusted production records.
- [ ] **Planned:** perform a formal screen-reader, browser-matrix, 200% zoom, and complete WCAG 2.2 AA audit. Automated keyboard and narrow-layout checks exist but are not certification.

Figma contains desktop evidence only. Mobile drawers, stacked layouts, errors, empty states, confirmation dialogs, and focus behavior are accessible implementation proposals, not verified Figma variants.

## Stage 2A — authentication and owner-scoped persistence

- [x] **Completed:** Better Auth 1.7.5 email/password authentication with public signup and recovery endpoints unavailable.
- [x] **Completed:** Argon2id password hashing, generic login errors, database rate limiting, canonical-origin/CSRF checks, Secure production cookies, HttpOnly sessions, server expiry, logout revocation, and active-profile admission.
- [x] **Completed:** guarded account provisioning with hidden password input, explicit first-administrator bootstrap, authorized-administrator checks for later accounts, and no overwrite of an existing email.
- [x] **Completed:** administrator account directory/create/profile/role management, activation/deactivation, and invitation-based credential setup. Invitation acceptance commits the credential, invitation use, and audit event atomically; password changes commit the password update, session changes, and audit event atomically.
- [x] **Completed:** standalone Argon2id helpers in `lib/password-hash.ts` are shared by server password operations and the provisioning CLI; Argon2 parameters have one implementation.
- [x] **Completed:** PostgreSQL migrations `0001`–`0003` for authentication, identities, roles, catalog policy, assignments, entitlements, requests, submission history, audit events, and the Better Auth rate-limit schema correction.
- [x] **Completed:** server-trusted requester identity and role loading; browser-supplied owner, role, status, and grant fields are ignored.
- [x] **Completed:** owner-scoped request create, list, search/filter, counts, detail, history, and renewal-prefill reads.
- [x] **Completed:** submission validation for resource/permission eligibility, required canonical scopes, dates, policy duration, ordinary entitlements, overlaps, renewal ownership, and available approval routing.
- [x] **Completed:** transactionally persist requests, scopes, submission history, audit evidence, and routing result.
- [x] **Completed:** remove demo login, browser role switching, and localStorage fallback from the mounted application flow.
- [x] **Completed and verified (2026-10-11):** password change at `/account/password` is enforced server-side (current-password verification, length 12–128, must differ, authentication, self-only ownership, per-IP rate limiting, same-origin, Argon2id, atomic other-session revocation + immutable `account.password_changed` audit). The UI was enhanced with show/hide controls, a live four-level strength indicator (Weak/Fair/Good/Strong) using a documented local heuristic with no third-party calls, a mandatory-requirements checklist (accessible text + icons, not color alone), field-specific validation, submit disabled until client requirements are met, loading/success/error states, and responsive layout. The strength indicator is explicitly guidance only and does not block otherwise-valid passwords. Verified by `tests/password-strength.test.ts` (unit) and `tests/e2e/password-change.spec.ts` (Playwright), plus the existing password-change integration cases.
- [ ] **Planned — blocked on infrastructure:** password recovery requires a configured email-delivery service, a reset-token migration, and recovery policy (token lifetime, enumeration-safe responses); MFA requires enabling the two-factor plugin, a schema migration, and an enrollment/backup-code flow; SSO requires an institutional identity-provider integration. None are implemented, and no non-functional forgot-password page, simulated delivery, or token exposure was added.

## Stage 2B — approval workflow

### Milestone 1: approval domain and database foundation

- [x] **Completed:** migrations `0004` and `0005` add approval states, optimistic versions, full-scope responsibility mappings, one active assignment, decisions, request events, immutability triggers, indexes, and denial/return reason constraints.
- [x] **Completed:** one-stage routing selects a fully eligible non-self approver by fewest open assignments and stable UUID order.
- [x] **Completed:** partial scope coverage is rejected; unrouteable requests remain visible as `pending_routing` and cannot be decided.
- [x] **Completed:** dry-run-by-default reconciliation supports explicit `--apply` and preserves unrouteable records.

### Milestone 2: authorized approval reads

- [x] **Completed:** `requireAdmin()` and `requireApprover()` derive active identity, roles, and responsibilities from the session and PostgreSQL.
- [x] **Completed:** assignment-scoped queue and detail reads use explicit sanitized DTOs, validated filters, bounded pagination, deterministic ordering, no-store responses, and enumeration-resistant lookup.
- [x] **Completed:** administrators can view unassigned routing failures separately; administrator role alone does not grant access to another approver's queue or decisions.

### Milestone 3: transactional decisions

- [x] **Completed:** approve, deny, and return-for-revision API at `POST /api/review/requests/[id]/decision`.
- [x] **Completed:** persisted assignee, current full-scope responsibility, request version, origin, JSON body, and idempotency key are validated server-side.
- [x] **Completed:** approval revalidates current requester eligibility, assignments, resource/permission policy, requested validity, entitlements, and conflicting approved requests.
- [x] **Completed:** decision, request/version change, assignment completion, immutable request/audit events, and requester notification commit atomically.
- [x] **Completed:** migration `0006` adds decision idempotency and recipient-scoped `user_notification` records.
- [x] **Completed:** approval transitions only to `approved_pending_activation`; it creates no entitlement or activation event.

### Milestone 4: staff review interface

- [x] **Completed:** responsibility-scoped staff dashboard, `/review` queue, `/review/[id]` detail, and administrator-only `/admin/unassigned` view.
- [x] **Completed:** status/resource/date/search filters, bounded pagination, history access through All statuses, empty/loading/error states, and terminal “View details” behavior.
- [x] **Completed:** accessible approve/deny/return dialogs, required reasons, pending-state protection, stale-version refresh, duplicate-click protection, and retained idempotency key for a recoverable retry.
- [x] **Completed:** role-specific navigation while retaining server authorization as the actual boundary.

## Administrator governance and account management

- [x] **Completed:** `/users` account management with invitation-based credential setup and activation/deactivation.
- [x] **Completed:** `/admin/responsibilities` lists, adds, and ends approver responsibilities; ending requires confirmation and resource-wide scope requires explicit confirmation.
- [x] **Completed:** `/admin/unassigned` permits administrator assignment only for `pending_routing` requests and only to currently eligible approvers. No decision link or assignment bypass is exposed.
- [x] **Completed and verified (2026-10-10):** delegation/absence management UI at `/admin/delegations` lists current and past delegations with derived status (Active, Scheduled, Ended, Cancelled), records an absence delegation between two active approvers/administrators over a fixed period, and cancels an active or scheduled delegation. It reuses the existing admin-guarded, same-origin, audited delegation services (`GET`/`POST /api/admin/delegations`, `POST /api/admin/delegations/[id]/cancel`); no new tables, services, or migrations were added. Server rules still reject self, circular, and overlapping delegations and leave existing review assignments unchanged. Verified by `tests/delegation-admin-ui.test.ts` (unit) and a delegation list/circular-rejection case in `tests/integration/admin-governance.integration.test.ts`, both green under Node 22.
- [x] **Completed and verified (2026-10-10):** institutional-identifier maintenance UI at `/admin/identifiers`. Administrators search the account directory, select an account, review its student/staff numbers, and add or update an identifier for a given type and issuer. It reuses the existing admin-guarded, same-origin, audited identifier service (`GET`/`PUT /api/admin/users/[id]/identifiers`) and the account directory service; no new tables, services, or migrations were added. Server rules preserve issuer-scoped uniqueness and the one-value-per-account/type/issuer constraint, keep institutional numbers separate from internal UUIDs, and audit every change; saving an existing type and issuer replaces its value in place (there is no delete operation). Verified by `tests/identifier-admin-ui.test.ts` (unit), an identifier list/in-place-update case in `tests/integration/admin-governance.integration.test.ts`, and `tests/e2e/admin-identifiers.spec.ts` (Playwright), all green under Node 22.
- [x] **Completed and verified (2026-10-10):** analytics and operational reports UI at `/reports`. The administrator-only dashboard renders request totals, pending, approved-awaiting-activation, denied, revision-requested, and awaiting-activation counts; activation outcomes (activated, failed, activating); entitlement states (active, expired, revoked); a requests-by-status breakdown; approver workload; average approval turnaround; and account totals. All figures come from the existing admin-guarded, no-store analytics service (`getAnalyticsSummary` via `GET /api/admin/analytics`); no new tables, services, or migrations were added. The DTO is sanitized (no personal request content or identifiers), queries are bounded, approval is reported separately from successful activation, and no export was introduced. Date/resource/status filters are supported; invalid filters fall back safely to the unfiltered summary. Verified by `tests/reports-ui.test.ts` (unit), an analytics aggregation/authorization/empty-window/safe-DTO case in `tests/integration/admin-governance.integration.test.ts`, and `tests/e2e/admin-reports.spec.ts` (Playwright), all green under Node 22.
- [x] **Completed and verified (2026-10-10):** notification-preference management UI at `/account/notifications`, available to every authenticated account for its own preferences. In-app notifications can be toggled and saved; external email, SMS, and push are shown as disabled and clearly marked "Not available yet" because external delivery is not configured, and the backend rejects any attempt to enable them. It reuses the existing authenticated, same-origin, audited preference service (`GET`/`PATCH /api/notifications/preferences`); no new tables, services, or migrations were added. A pre-existing bug where `updateNotificationPreferences` returned a stale DTO (it re-read on a separate pooled connection before the transaction committed) was fixed to return the committed values. Verified by `tests/notification-preferences-ui.test.ts` (unit), a per-account persistence/ownership/external-rejection/safe-DTO case in `tests/integration/admin-governance.integration.test.ts`, and `tests/e2e/notification-preferences.spec.ts` (Playwright), all green under Node 22.
- [x] **Completed and verified (2026-10-11):** retention management UI at `/admin/retention` (administrator-only) lists the provisional retention classes with their configured periods and immutable/provisional status, and runs non-destructive dry-run previews that report how many records would match a class's window. It reuses the existing admin-guarded, same-origin retention service (`GET`/`POST /api/admin/retention`); no new tables, services, or migrations were added. Destructive archival remains disabled server-side (an apply attempt returns `409`), immutable accountability classes cannot be archived, and the UI exposes no apply/edit/delete controls. Verified by `tests/retention-ui.test.ts` (unit), a list/dry-run/no-modification/apply-disabled/safe-DTO case in `tests/integration/admin-governance.integration.test.ts` (asserts row counts are unchanged after a preview), and `tests/e2e/admin-retention.spec.ts` (Playwright), all green under Node 22.
- [x] **Completed and verified (2026-10-10):** resource and permission catalog administration UI. `/resources` lists resources with their provisional policy and scope options, toggles resource availability, and adds institutional scope options; `/permissions` lists resource-specific permissions with applicable requester roles and toggles permission availability. Both reuse the existing admin-guarded, same-origin, audited catalog services (`GET`/`PATCH /api/admin/catalog`, `GET`/`POST /api/admin/catalog/scopes`); no new tables, services, or migrations were added. Policy durations and permission–role mappings remain read-only and migration/CLI controlled; grants still require approval. Verified by `tests/catalog-admin-ui.test.ts` (unit) and a catalog read/availability-toggle/scope-creation/authorization case in `tests/integration/admin-governance.integration.test.ts`, both green under Node 22.
- [ ] **Planned:** policy-version editing UI (default/maximum duration and renewability). A `parsePolicyVersionInput` validator exists, but no service or handler currently exposes a policy-version mutation, so this remains migration/CLI controlled and is not surfaced as an editable control.

### Milestone 5: notifications and audit visibility

- [x] **Completed:** owner-scoped `/notifications` center for active student/faculty requesters with All/Unread filters, bounded pagination, owned request links, one-record mark-read, and mark-all-read.
- [x] **Completed:** notification mutations require an active requester session, same-origin JSON, and recipient ownership; another recipient's ID is indistinguishable from a missing record.
- [x] **Completed:** administrator-only `/audit` view and `GET /api/admin/audit-events` with sanitized summaries, search, event/date filters, deterministic pagination, and read-only presentation.
- [x] **Completed:** database immutability protects request decisions/events/audit events from ordinary update/delete operations.
- [x] **Completed:** per-account notification preferences UI at `/account/notifications` for the in-app channel (see the administrator governance section). External email, SMS, and push **delivery** remain deferred and unconfigured; the preferences UI shows those channels as unavailable and the backend rejects enabling them. Current notifications are PostgreSQL-backed in-app records only.
- [ ] **Planned:** audit export, redaction policy, and external security monitoring. Retention has an administrator UI for listing classes and non-destructive dry-run previews; destructive archival execution, retention-period editing, and legal-hold operations remain deferred until institutional policy is approved.

### Stage 2C: activation and lifecycle management

- [x] **Completed:** migration `0007` adds a separate activation lifecycle and immutable events; migration `0006` and earlier files remain unchanged.
- [x] **Completed:** active-admin-only activation with transaction-1 policy/eligibility/entitlement revalidation, strict requester/original-approver exclusion, adapter call outside database transactions, and atomic transaction-2 outcome writes.
- [x] **Completed:** success creates an `ordinary_entitlement`; success/failure events, audit, request events, and owner-scoped notifications are committed atomically. Approval status remains `approved_pending_activation`.
- [x] **Completed:** `/admin/activations` displays lifecycle status and allows manually attested activation/retry; requester detail, timeline, and notification center display lifecycle outcomes.
- [x] **Completed:** retryable failure requires a new per-actor idempotency key; non-retryable failures cannot be retried in place.
- [x] **Completed:** `activations:reconcile` and `activations:expire` are dry-run by default and require explicit `--apply`; reconciliation uses a 15-minute stuck threshold.
- [x] **Completed:** renewal after activation expiry creates a new `access_request` linked with `renewal_of`; the old approval/lifecycle records are not reopened.
- [x] **Completed and verified (2026-10-11):** a protected scheduled-maintenance endpoint `POST /api/maintenance/expire-activations` performs automatic access expiration by invoking the existing idempotent, concurrency-safe expiry service (`listExpiredActivationCandidates` + `expireActivatedEntitlement`, each in its own transaction). It never expires access before its authorized `expires_at`, writes `activation_event` + `audit_event`, is idempotent across repeated/concurrent runs, and leaves revoked and approved-but-not-activated records untouched. The endpoint is authorized by a shared bearer secret (`MAINTENANCE_SCHEDULER_SECRET`) compared in constant time and is **disabled (503) by default when the secret is unset**. Verified by `tests/scheduler-auth.test.ts` (unit), `tests/integration/scheduled-expiration.integration.test.ts` (before/at/after boundary, idempotent repeat, concurrent-exactly-once, revoked/approved-not-activated, auth rejection), and `tests/e2e/scheduled-maintenance.spec.ts`.
- [ ] **Planned — not enabled:** wiring the endpoint to an actual schedule (e.g. a Vercel Cron job sending the bearer secret) and monitoring. The dry-run CLIs remain available. No production cron is configured as part of this change.
- [ ] **Planned:** integrate real university provisioning/reconciliation adapters and expose revocation through an administrator UI or CLI. The current revocation operation is a guarded server service only.
- [x] **Completed:** combined lifecycle integration coverage and Stage 2C Playwright coverage; manual recovery procedures are in [activation-operations.md](activation-operations.md).

## Route and service coverage

| Route or operation | Status | Current behavior |
| --- | --- | --- |
| `/login` | **Completed** | Real email/password sign-in with generic invalid-credential, rate-limit, and service-unavailable messages. |
| `/dashboard` | **Completed** | Requester counts/recent records or staff responsibility-scoped workload from PostgreSQL. |
| `/requests/new` | **Completed** | Server-filtered catalog, canonical scopes, validation, routed submission, and renewal prefill. |
| `/requests`, `/requests/[id]` | **Completed** | Owner-scoped history, filters, details, validity, and persisted timeline. |
| `/review`, `/review/[id]` | **Completed** | Assigned queue/detail and transactional decision interface. |
| `/admin/unassigned` | **Completed** | Administrator-only `pending_routing` queue with assignment to currently eligible approvers; no decision bypass. |
| `/notifications` | **Completed** | Requester-owned in-app notification center and read-state mutations. |
| `/account/notifications` | **Completed** | Per-account notification preferences for any authenticated user: editable in-app toggle; external email/SMS/push shown disabled and marked unavailable. Server rejects enabling external channels and audits in-app changes. |
| `/admin/activations` | **Completed** | Active-administrator queue and manual activation/retry controls; requester/original approver cannot activate. |
| `POST /api/admin/activations/[id]/activate` | **Completed** | Same-origin, active-admin-only request; domain rechecks the actor and lifecycle state inside transaction 1. |
| `/audit` | **Completed** | Administrator-only sanitized, immutable, read-only audit history. |
| `/help` | **Completed** | Current account/request/stage-boundary guidance. |
| `/users` | **Completed** | Server-guarded account directory and account/profile/role management with invitations and account activation controls. |
| `/admin/responsibilities` | **Completed** | Administrator-only responsibility listing, add/end controls, and explicit resource-wide scope confirmation. |
| `/admin/delegations` | **Completed** | Administrator-only absence delegation listing with derived status, create between two active approvers over a fixed period, and cancel; server rejects self/circular/overlapping delegations and preserves existing assignments. |
| `/admin/identifiers` | **Completed** | Administrator-only institutional-identifier maintenance: account search, per-account student/staff number listing, and add/update by type and issuer with replace confirmation; server preserves issuer-scoped uniqueness and audits changes. No delete operation. |
| `/admin/retention` | **Completed** | Administrator-only retention management: lists provisional retention classes and runs non-destructive dry-run previews. Destructive archival is disabled server-side; no apply/edit/delete controls. |
| `/resources` | **Completed** | Administrator-only resource catalog: lists resources with provisional policy and scope options, toggles resource availability, and adds institutional scope options via the existing audited catalog service. Policy durations remain read-only. |
| `/permissions` | **Completed** | Administrator-only permission catalog: lists resource-specific permissions with applicable requester roles and toggles permission availability via the existing audited catalog service. Grants remain approval-controlled; entitlement activation uses the separate `/admin/activations` surface. |
| `/reports` | **Completed** | Administrator-only analytics dashboard computed from live PostgreSQL via the sanitized analytics service: request/activation/entitlement counts, status breakdown, approver workload, turnaround, and account totals, with date/resource/status filters. Read-only; no export. |
| `POST /api/maintenance/expire-activations` | **Completed** | Bearer-secret-protected scheduled endpoint for automatic access expiration; reuses the idempotent expiry service and returns a sanitized `{examined, expired}` summary. Disabled (`503`) when `MAINTENANCE_SCHEDULER_SECRET` is unset. |
| `GET /api/health` | **Completed** | Bounded `SELECT 1`; private/no-store `200` when available and generic `503` when unavailable. |

## Real, historical, and inactive behavior

| Category | Source of truth | Trust boundary |
| --- | --- | --- |
| Accounts, sessions, roles, profiles | Better Auth and PostgreSQL | Real server-enforced behavior. |
| Catalog policy, assignments, entitlements, responsibilities | PostgreSQL seeded/configured by migrations and guarded CLI tools | Real server-enforced behavior, using proposed institutional policy until approved. Successful manual activation records an `ordinary_entitlement`. |
| Requests, assignments, decisions, activation lifecycle/events, notifications, audit | PostgreSQL transactions | Real persistence and authorization; approval state and activation lifecycle are separate. |
| `lib/demo-service.ts`, older demo components/tests | Historical Stage 1 prototype | Not mounted and never a fallback or production authority. |
| Figma sample values and security checklist text | Design reference | Presentation evidence only, not proof a policy or check occurred. |
| `/resources`, `/permissions` | PostgreSQL via the admin catalog service/API | Administrator-only catalog UI for availability toggles and scope-option creation; all mutations are server-validated and audited. Policy-version editing is not yet exposed. |
| `/reports` | PostgreSQL via the admin analytics service/API | Administrator-only read-only dashboard; aggregates are computed from live records at load, returned through a sanitized DTO, and exclude personal request content. |
| Delegation/absence management | PostgreSQL via the admin delegation service/API | Administrator-only UI at `/admin/delegations` for listing, creating, and cancelling absence delegations; all mutations are server-validated and audited. |
| Institutional-identifier maintenance | PostgreSQL via the admin identifier service/API | Administrator-only UI at `/admin/identifiers` for per-account listing and add/update by type and issuer; all mutations are server-validated and audited. No delete operation. |
| Notification preferences | PostgreSQL via the preference service/API | Per-account UI at `/account/notifications` (in-app editable; external channels unavailable). Server-validated and audited. |
| Retention management | PostgreSQL via the admin retention service/API | Administrator-only UI at `/admin/retention` for listing classes and non-destructive dry-run previews only. Destructive archival disabled. |

## Testing and deployment readiness

- [x] **Completed:** Node 22 repository requirement and guarded isolated test-runner configuration.
- [x] **Completed:** integration and E2E runners require only `TEST_DATABASE_URL`, verify the database name ends in `_test`, remove development/migration variables, and use the same Neon branch/database through its pooled endpoint.
- [x] **Verified 2026-10-11 (Node 22.23.2, darwin/arm64, clean `npm ci`):** full suite green — `npm test` 109 passed / 0 failed; `npm run test:integration` 95 passed / 0 failed across the nine guarded PostgreSQL files (target database `permora_test`, `_test` suffix confirmed); `npm run test:e2e` 54 Playwright tests passed / 0 failed on Chromium; `npm run lint`, `npm run typecheck`, and `npm run build` passed; `git diff --check` was clean. The build emitted the governance admin routes plus the enhanced `/account/password` and the new `POST /api/maintenance/expire-activations` routes.
- [x] **Manual-activation flake — root cause found and fixed:** the manual-activation step ("Access activation recorded.") was intermittently failing. The cause was a client render race, not the backend: the success message was local state inside the per-row `ActivationControls`, and the post-activation `router.refresh()` transitioned the row to a terminal state and **unmounted that component**, discarding the message before it reliably painted (traces showed the activate POST returning `200` while the status text was absent). Fixed by lifting the confirmation to the persistent `AdminActivationQueue` parent (`role="status"` alert) that survives the refresh; `workflow.spec.ts` now asserts the queue-level message plus the row's `Active` state. After the fix the test passed 10 consecutive isolated runs and in two full-suite runs. **Residual caveat:** the first run immediately after a code change can still be slow because Next dev recompiles on first request, so 100% elimination under cold dev-server start is not proven; this is a dev-harness warm-up effect, not an activation-logic defect.
- [ ] **Re-run before release:** repeat the full suite in the release CI environment and record its runtime; the 2026-10-10 run above was a local developer verification.
- [ ] **Deployment state:** production has migrations `0001`–`0006`; `0007`–`0009` are pending. Migrations `0008` and `0009` were applied manually to development.
- [x] **Completed:** database CLIs require an explicit development/test/production target, reject mixed runtime/migration endpoints, and require explicit production confirmation.
- [x] **Completed:** private/no-store health endpoint and credential-safe errors.
- [ ] **In progress:** controlled prototype publication/deployment configuration, final secret scanning, branch protection, owners, preview isolation, and operational sign-off. See [HANDOFF.md](../HANDOFF.md).
- [ ] **Blocked:** complete production access-control claims are blocked by missing activation/provisioning, recovery, institutional integrations, production monitoring, retention policy, and operational ownership.

## Remaining development roadmap

1. **Completed — activation foundation and manual lifecycle:** admin authorization, adapter boundary, transactions, entitlements, events, notifications, retry/reconciliation, expiry/revocation boundaries, requester/admin status UI, browser coverage, and operator runbook.
2. **In progress — administrator maintenance:** user management, approver responsibilities, eligible assignment of pending-routing requests, resource/permission catalog administration, delegation/absence management, institutional-identifier maintenance, analytics/operational reports, per-account notification-preference management, and retention management (list + dry-run preview) have UI. Catalog policy-version editing remains the main outstanding admin-maintenance surface; this milestone is nearly complete. External notification delivery (email/SMS/push), destructive retention archival execution, and retention-period editing remain deferred by policy.
3. **Planned — revision flow:** create a new linked request from `returned_for_revision` and re-run all current validation and routing. The reviewed record remains immutable.
4. **Planned — account operations:** password recovery, optional MFA/SSO, session administration, and secured break-glass recovery. Password change and invitation-based credential setup are implemented with atomic audit/session handling.
5. **Planned — institutional integrations and scheduling:** authoritative SIS/LMS/library/lab/research adapters, automatic job scheduling/monitoring, downstream reconciliation, and source-specific failure handling.
6. **Planned — communications and governance:** external delivery, preferences, audit retention/export/redaction, analytics, alerts, backups/restore exercises, and incident runbooks.

## Unresolved policy decisions

- Approve the proposed resource matrix, canonical institutional identifiers, policy durations, renewal rules, and Student Portal exception handling.
- The current prototype uses manual administrator attestation with evidence. Still decide institutional provisioning owners, accepted evidence policy, and production retry/reconciliation ownership before pilot/production use.
- Automatic scheduling is not configured; the expiry and stuck-attempt commands currently require deliberate operator invocation.
- Decide whether high-sensitivity/grading requests need multiple stages or separation-of-duty rules beyond the current single assigned approver.
- Define escalation and approver-adjusted validity behavior. Delegation/absence management now has an administrator UI; the open decision is the institutional policy for escalation and whether a delegation should reassign in-flight assignments rather than only grant forward substitute eligibility.
- Define audit retention, export/redaction authorization, legal hold, notification delivery policy, and production monitoring ownership.

No unresolved documentation contradiction remains: approval produces the immutable request state `approved_pending_activation`; a separate activation row records `activating`, `activated`, `failed`, `expired`, or `revoked`. Only manual administrator confirmation currently creates an entitlement; this is not an external university integration or production-ready access-control service.
