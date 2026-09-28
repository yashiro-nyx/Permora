# Permora Project Progress Checklist

Audited against the working tree on 2026-09-28. This is the canonical progress checklist. A checked item means working code and relevant verification exist; a planning document alone is not completion.

Status key: **Completed**, **In progress**, **Planned**, **Blocked**.

## Current milestone

Permora has completed Stage 1, Stage 2A, and Stage 2B Milestones 1–5. The application has real email/password accounts, revocable PostgreSQL sessions, owner-scoped request persistence, deterministic approval routing, transactional decisions, requester in-app notifications, and an administrator read-only audit view.

The current terminal approval result is `approved_pending_activation`. It records an approval decision and notification, but it does not create an entitlement, provision a downstream system, or activate access.

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
- [x] **Completed:** PostgreSQL migrations `0001`–`0003` for authentication, identities, roles, catalog policy, assignments, entitlements, requests, submission history, audit events, and the Better Auth rate-limit schema correction.
- [x] **Completed:** server-trusted requester identity and role loading; browser-supplied owner, role, status, and grant fields are ignored.
- [x] **Completed:** owner-scoped request create, list, search/filter, counts, detail, history, and renewal-prefill reads.
- [x] **Completed:** submission validation for resource/permission eligibility, required canonical scopes, dates, policy duration, ordinary entitlements, overlaps, renewal ownership, and available approval routing.
- [x] **Completed:** transactionally persist requests, scopes, submission history, audit evidence, and routing result.
- [x] **Completed:** remove demo login, browser role switching, and localStorage fallback from the mounted application flow.
- [ ] **Planned:** password recovery/change, MFA, and institutional SSO. No fake recovery success is displayed.

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

### Milestone 5: notifications and audit visibility

- [x] **Completed:** owner-scoped `/notifications` center for active student/faculty requesters with All/Unread filters, bounded pagination, owned request links, one-record mark-read, and mark-all-read.
- [x] **Completed:** notification mutations require an active requester session, same-origin JSON, and recipient ownership; another recipient's ID is indistinguishable from a missing record.
- [x] **Completed:** administrator-only `/audit` view and `GET /api/admin/audit-events` with sanitized summaries, search, event/date filters, deterministic pagination, and read-only presentation.
- [x] **Completed:** database immutability protects request decisions/events/audit events from ordinary update/delete operations.
- [ ] **Planned:** external email, SMS, or push delivery and user notification preferences. Current notifications are PostgreSQL-backed in-app records only.
- [ ] **Planned:** audit export, retention/legal-hold operations, redaction policy, and external security monitoring.

## Route and service coverage

| Route or operation | Status | Current behavior |
| --- | --- | --- |
| `/login` | **Completed** | Real email/password sign-in with generic invalid-credential, rate-limit, and service-unavailable messages. |
| `/dashboard` | **Completed** | Requester counts/recent records or staff responsibility-scoped workload from PostgreSQL. |
| `/requests/new` | **Completed** | Server-filtered catalog, canonical scopes, validation, routed submission, and renewal prefill. |
| `/requests`, `/requests/[id]` | **Completed** | Owner-scoped history, filters, details, validity, and persisted timeline. |
| `/review`, `/review/[id]` | **Completed** | Assigned queue/detail and transactional decision interface. |
| `/admin/unassigned` | **Completed** | Administrator-only read view of preserved routing failures; no decision/reassignment bypass. |
| `/notifications` | **Completed** | Requester-owned in-app notification center and read-state mutations. |
| `/audit` | **Completed** | Administrator-only sanitized, immutable, read-only audit history. |
| `/help` | **Completed** | Current account/request/stage-boundary guidance. |
| `/users` | **Planned** | Server-guarded deferred page; provisioning remains CLI-only. |
| `/resources` | **Planned** | Server-guarded deferred page; catalog administration remains migration/CLI controlled. |
| `/permissions` | **Planned** | Server-guarded deferred page; no activation or provisioning operation exists. |
| `/reports` | **Planned** | Server-guarded deferred page; no analytics/export workflow exists. |
| `GET /api/health` | **Completed** | Bounded `SELECT 1`; private/no-store `200` when available and generic `503` when unavailable. |

## Real, historical, and inactive behavior

| Category | Source of truth | Trust boundary |
| --- | --- | --- |
| Accounts, sessions, roles, profiles | Better Auth and PostgreSQL | Real server-enforced behavior. |
| Catalog policy, assignments, entitlements, responsibilities | PostgreSQL seeded/configured by migrations and guarded CLI tools | Real server-enforced behavior, using proposed institutional policy until approved. |
| Requests, assignments, decisions, events, notifications, audit | PostgreSQL transactions | Real persistence and authorization. |
| `lib/demo-service.ts`, older demo components/tests | Historical Stage 1 prototype | Not mounted and never a fallback or production authority. |
| Figma sample values and security checklist text | Design reference | Presentation evidence only, not proof a policy or check occurred. |
| `/users`, `/resources`, `/permissions`, `/reports` controls | Deferred pages | Inactive; no hidden success path or simulated mutation. |

## Testing and deployment readiness

- [x] **Completed:** Node 22 repository requirement, lint, typecheck, production build, unit tests, isolated PostgreSQL tests, and deterministic single-worker Playwright coverage.
- [x] **Completed:** integration and E2E runners require only `TEST_DATABASE_URL`, verify the database name ends in `_test`, remove development/migration variables, and use the same Neon branch/database through its pooled endpoint.
- [x] **Completed:** latest Node 22 verification: 43 unit tests, 43 PostgreSQL integration tests, and 20 Playwright tests passed; lint, typecheck, build, and `git diff --check` passed.
- [x] **Completed:** database CLIs require an explicit development/test/production target, reject mixed runtime/migration endpoints, and require explicit production confirmation.
- [x] **Completed:** private/no-store health endpoint and credential-safe errors.
- [ ] **In progress:** controlled prototype publication/deployment configuration, final secret scanning, branch protection, owners, preview isolation, and operational sign-off. See [HANDOFF.md](../HANDOFF.md).
- [ ] **Blocked:** complete production access-control claims are blocked by missing activation/provisioning, recovery, institutional integrations, production monitoring, retention policy, and operational ownership.

## Remaining development roadmap

1. **Planned — activation foundation:** define the approved-awaiting-activation queue, operator authorization, entitlement/provisioning transaction or outbox, failure/retry/reconciliation states, revocation, expiry enforcement, and requester-visible activation result.
2. **Planned — administrator maintenance:** authenticated UI for users, assignments, ordinary entitlements, catalog policy, and approver responsibilities with audit and separation of duties.
3. **Planned — revision flow:** create a new linked request from `returned_for_revision` and re-run all current validation and routing. The reviewed record remains immutable.
4. **Planned — account operations:** password recovery/change, optional MFA/SSO, session administration, and secured break-glass recovery.
5. **Planned — institutional integrations:** authoritative SIS/LMS/library/lab/research synchronization, health/reconciliation, and source-specific failure handling.
6. **Planned — communications and governance:** external delivery, preferences, audit retention/export/redaction, analytics, alerts, backups/restore exercises, and incident runbooks.

## Unresolved policy decisions

- Approve the proposed resource matrix, canonical institutional identifiers, policy durations, renewal rules, and Student Portal exception handling.
- Decide activation owners, automatic versus manually attested provisioning, evidence requirements, retry policy, and downstream adapters.
- Decide whether high-sensitivity/grading requests need multiple stages or separation-of-duty rules beyond the current single assigned approver.
- Define delegation, reassignment, escalation, out-of-office, cancellation, and approver-adjusted validity behavior.
- Define audit retention, export/redaction authorization, legal hold, notification delivery policy, and production monitoring ownership.

No unresolved documentation contradiction remains about the implemented lifecycle: submission produces `pending_review` or preserved `pending_routing`; one assigned approver may approve, deny, or return; approval produces `approved_pending_activation`; actual activation is future work.
