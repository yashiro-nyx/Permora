# Permora Project Progress Checklist

Audited against the working tree on 2026-10-03. This status distinguishes implemented UI, backend-only services, and deferred work.

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
- [ ] **Planned:** password recovery, MFA, and institutional SSO. Password change is implemented; no fake recovery success is displayed.

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
- [ ] **Backend only:** delegation/absence management and institutional-identifier maintenance have services/APIs and integration tests; no admin UI exists.
- [ ] **Backend only:** analytics service/API exists, but `/reports` is a deferred page and matching integration-test coverage was not found.
- [ ] **Backend only:** notification-preference service/handler exists; a preferences route, matching integration-test coverage, and UI were not found. External delivery remains unconfigured.
- [ ] **Backend only:** provisional retention policy and dry-run service/API exist; matching integration-test coverage and an admin UI were not found. Destructive archival is disabled.
- [ ] **Planned:** resource/permission policy administration UI. Server-side catalog-management operations exist, but `/resources` and `/permissions` remain deferred pages.

### Milestone 5: notifications and audit visibility

- [x] **Completed:** owner-scoped `/notifications` center for active student/faculty requesters with All/Unread filters, bounded pagination, owned request links, one-record mark-read, and mark-all-read.
- [x] **Completed:** notification mutations require an active requester session, same-origin JSON, and recipient ownership; another recipient's ID is indistinguishable from a missing record.
- [x] **Completed:** administrator-only `/audit` view and `GET /api/admin/audit-events` with sanitized summaries, search, event/date filters, deterministic pagination, and read-only presentation.
- [x] **Completed:** database immutability protects request decisions/events/audit events from ordinary update/delete operations.
- [ ] **Planned:** external email, SMS, or push delivery and user notification preferences. Current notifications are PostgreSQL-backed in-app records only.
- [ ] **Planned:** audit export, retention/legal-hold operations, redaction policy, and external security monitoring.

### Stage 2C: activation and lifecycle management

- [x] **Completed:** migration `0007` adds a separate activation lifecycle and immutable events; migration `0006` and earlier files remain unchanged.
- [x] **Completed:** active-admin-only activation with transaction-1 policy/eligibility/entitlement revalidation, strict requester/original-approver exclusion, adapter call outside database transactions, and atomic transaction-2 outcome writes.
- [x] **Completed:** success creates an `ordinary_entitlement`; success/failure events, audit, request events, and owner-scoped notifications are committed atomically. Approval status remains `approved_pending_activation`.
- [x] **Completed:** `/admin/activations` displays lifecycle status and allows manually attested activation/retry; requester detail, timeline, and notification center display lifecycle outcomes.
- [x] **Completed:** retryable failure requires a new per-actor idempotency key; non-retryable failures cannot be retried in place.
- [x] **Completed:** `activations:reconcile` and `activations:expire` are dry-run by default and require explicit `--apply`; reconciliation uses a 15-minute stuck threshold.
- [x] **Completed:** renewal after activation expiry creates a new `access_request` linked with `renewal_of`; the old approval/lifecycle records are not reopened.
- [ ] **Planned:** configure and monitor an automatic schedule for expiry/reconciliation. The scripts currently require a deliberate operator invocation.
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
| `/admin/activations` | **Completed** | Active-administrator queue and manual activation/retry controls; requester/original approver cannot activate. |
| `POST /api/admin/activations/[id]/activate` | **Completed** | Same-origin, active-admin-only request; domain rechecks the actor and lifecycle state inside transaction 1. |
| `/audit` | **Completed** | Administrator-only sanitized, immutable, read-only audit history. |
| `/help` | **Completed** | Current account/request/stage-boundary guidance. |
| `/users` | **Completed** | Server-guarded account directory and account/profile/role management with invitations and account activation controls. |
| `/admin/responsibilities` | **Completed** | Administrator-only responsibility listing, add/end controls, and explicit resource-wide scope confirmation. |
| `/resources` | **Planned** | Server-guarded deferred page; catalog administration remains migration/CLI controlled. |
| `/permissions` | **Planned** | Server-guarded deferred entitlement/policy administration page; activation uses the separate `/admin/activations` surface. |
| `/reports` | **Planned** | Deferred UI; an administrator analytics service/API exists, but matching integration-test coverage was not found. |
| `GET /api/health` | **Completed** | Bounded `SELECT 1`; private/no-store `200` when available and generic `503` when unavailable. |

## Real, historical, and inactive behavior

| Category | Source of truth | Trust boundary |
| --- | --- | --- |
| Accounts, sessions, roles, profiles | Better Auth and PostgreSQL | Real server-enforced behavior. |
| Catalog policy, assignments, entitlements, responsibilities | PostgreSQL seeded/configured by migrations and guarded CLI tools | Real server-enforced behavior, using proposed institutional policy until approved. Successful manual activation records an `ordinary_entitlement`. |
| Requests, assignments, decisions, activation lifecycle/events, notifications, audit | PostgreSQL transactions | Real persistence and authorization; approval state and activation lifecycle are separate. |
| `lib/demo-service.ts`, older demo components/tests | Historical Stage 1 prototype | Not mounted and never a fallback or production authority. |
| Figma sample values and security checklist text | Design reference | Presentation evidence only, not proof a policy or check occurred. |
| `/resources`, `/permissions` | Deferred pages | No catalog-management UI; administrator catalog service/API operations exist. |
| `/reports` | Deferred page | No reports UI; administrator analytics service/API exists. |
| Delegation, identifier, notification-preference, retention services | PostgreSQL and server-side services/handlers | Backend behavior only; UI/test coverage varies by capability as noted above. |

## Testing and deployment readiness

- [x] **Completed:** Node 22 repository requirement and guarded isolated test-runner configuration.
- [x] **Completed:** integration and E2E runners require only `TEST_DATABASE_URL`, verify the database name ends in `_test`, remove development/migration variables, and use the same Neon branch/database through its pooled endpoint.
- [x] **Completed:** last verified `npm test` run passed 63 tests; the runtime version was not recorded. `npm run typecheck` and targeted ESLint passed after the workflow fixture change.
- [ ] **Re-run before release:** integration suite, full lint, production build, `git diff --check`, and complete verification under Node 22.
- [ ] **Re-run before release:** Playwright suite. The latest Node 22 result reported was 24 passed, 1 failed, 0 skipped, before workflow repeat-fixture isolation was added.
- [ ] **Deployment state:** production has migrations `0001`–`0006`; `0007`–`0009` are pending. Migrations `0008` and `0009` were applied manually to development.
- [x] **Completed:** database CLIs require an explicit development/test/production target, reject mixed runtime/migration endpoints, and require explicit production confirmation.
- [x] **Completed:** private/no-store health endpoint and credential-safe errors.
- [ ] **In progress:** controlled prototype publication/deployment configuration, final secret scanning, branch protection, owners, preview isolation, and operational sign-off. See [HANDOFF.md](../HANDOFF.md).
- [ ] **Blocked:** complete production access-control claims are blocked by missing activation/provisioning, recovery, institutional integrations, production monitoring, retention policy, and operational ownership.

## Remaining development roadmap

1. **Completed — activation foundation and manual lifecycle:** admin authorization, adapter boundary, transactions, entitlements, events, notifications, retry/reconciliation, expiry/revocation boundaries, requester/admin status UI, browser coverage, and operator runbook.
2. **In progress — administrator maintenance:** user management, approver responsibilities, and eligible assignment of pending-routing requests have UI. Catalog policy UI, delegation UI, identifier UI, and other governance interfaces remain outstanding.
3. **Planned — revision flow:** create a new linked request from `returned_for_revision` and re-run all current validation and routing. The reviewed record remains immutable.
4. **Planned — account operations:** password recovery, optional MFA/SSO, session administration, and secured break-glass recovery. Password change and invitation-based credential setup are implemented with atomic audit/session handling.
5. **Planned — institutional integrations and scheduling:** authoritative SIS/LMS/library/lab/research adapters, automatic job scheduling/monitoring, downstream reconciliation, and source-specific failure handling.
6. **Planned — communications and governance:** external delivery, preferences, audit retention/export/redaction, analytics, alerts, backups/restore exercises, and incident runbooks.

## Unresolved policy decisions

- Approve the proposed resource matrix, canonical institutional identifiers, policy durations, renewal rules, and Student Portal exception handling.
- The current prototype uses manual administrator attestation with evidence. Still decide institutional provisioning owners, accepted evidence policy, and production retry/reconciliation ownership before pilot/production use.
- Automatic scheduling is not configured; the expiry and stuck-attempt commands currently require deliberate operator invocation.
- Decide whether high-sensitivity/grading requests need multiple stages or separation-of-duty rules beyond the current single assigned approver.
- Define escalation and approver-adjusted validity behavior; delegation/absence service behavior exists, but there is no administrator UI.
- Define audit retention, export/redaction authorization, legal hold, notification delivery policy, and production monitoring ownership.

No unresolved documentation contradiction remains: approval produces the immutable request state `approved_pending_activation`; a separate activation row records `activating`, `activated`, `failed`, `expired`, or `revoked`. Only manual administrator confirmation currently creates an entitlement; this is not an external university integration or production-ready access-control service.
