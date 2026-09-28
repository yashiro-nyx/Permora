# Permora Project Progress Checklist

Last updated: September 28, 2026

## Project Foundation

- [x] Define the university access-request problem.
- [x] Create the Permora identity and interface design.
- [x] Document the resource-access policy matrix.
- [x] Configure GitHub, Neon PostgreSQL, and Vercel.
- [x] Deploy the controlled prototype.
- [x] Add a database-aware health endpoint.
- [x] Pin the project to Node.js 22.

## Stage 1 — Requester Prototype

- [x] Build requester dashboard and request history.
- [x] Add combined search and filters.
- [x] Add expandable and full request details.
- [x] Display denial reasons.
- [x] Support expiration and renewal navigation.
- [x] Restore the original Figma login images.
- [x] Verify desktop and mobile layouts.

**Status:** Complete.

## Stage 2A — Authentication and Persistence

- [x] Replace the browser demo with email-and-password authentication.
- [x] Store users, sessions, profiles, roles, and requests in PostgreSQL.
- [x] Hash passwords using Argon2id.
- [x] Add server-side session expiration and revocation.
- [x] Add trusted-origin validation and database rate limiting.
- [x] Add secure CLI account provisioning.
- [x] Implement owner-scoped request access.
- [x] Add the Philippine university resource catalog.
- [x] Add role, permission, scope, entitlement, and assignment validation.
- [x] Add safe, versioned database migrations.

**Status:** Complete.

## Stage 2B — Approval Workflow

### Milestone 1 — Approval Foundation

- [x] Add approval states and optimistic request versioning.
- [x] Add review assignments and approver responsibilities.
- [x] Add immutable decisions, events, and audit records.
- [x] Implement full-scope deterministic routing.
- [x] Add controlled routing reconciliation.

**Status:** Complete.

### Milestone 2 — Authorized Read Model

- [x] Add server-side administrator and approver guards.
- [x] Add assignment-scoped review queue and request details.
- [x] Add sanitized DTOs, filtering, and pagination.
- [x] Hide unauthorized and nonexistent records consistently.
- [x] Add an administrator view for unassigned routing failures.

**Status:** Complete.

### Milestone 3 — Transactional Decisions

- [x] Add approve, deny, and return-for-revision operations.
- [x] Require expected request versions.
- [x] Add idempotency keys.
- [x] Revalidate current eligibility before decisions.
- [x] Write decisions, events, notifications, and audits atomically.
- [x] Keep approval separate from activation.

**Status:** Complete.

### Milestone 4 — Protected Staff Interface

- [x] Add role-specific staff navigation.
- [x] Add live approver and administrator dashboards.
- [x] Add the protected review queue and detail interface.
- [x] Add confirmation dialogs and reason validation.
- [x] Handle stale, duplicate, loading, empty, and failure states.
- [x] Verify responsive and accessible layouts.

**Status:** Complete.

### Stage 2B Milestone 5 — Notifications and Audit Visibility

- [x] Add PostgreSQL-backed requester notifications.
- [x] Add All and Unread filtering with pagination.
- [x] Link notifications to their corresponding requests.
- [x] Add idempotent mark-one-as-read and mark-all-as-read operations.
- [x] Add administrator-only, read-only audit logs.
- [x] Add audit search, event, and date filters.
- [x] Add sanitized audit summaries and pagination.
- [x] Add loading, empty, error, responsive, and accessible states.
- [x] Verify authorization and same-origin notification mutations.
- [x] Resolve Neon integration-test connection lifecycle issues.
- [x] Verify the milestone under Node.js 22.23.2.
- [x] Pass 43 unit tests.
- [x] Pass 43 PostgreSQL integration tests.
- [x] Pass 20 Playwright E2E tests.
- [x] Pass ESLint.
- [x] Pass TypeScript type checking.
- [x] Pass the production build.
- [x] Pass `git diff --check`.
- [x] Confirm automated database tests use only the guarded PostgreSQL test database ending in `_test`.
- [x] Confirm the diff contains the intended Milestone 5 changes.
- [x] Confirm credentials, database URLs, tokens, and other secrets are absent from test output and tracked Milestone 5 changes.
- [x] Confirm migrations `0001`–`0006` remain ordered and no additional Milestone 5 migration is required.
- [x] Update the implementation, Stage 2B, handoff, and project-progress documentation.

**Status:** Completed.

## Stage 2C — Activation and Access Lifecycle

- [ ] Define the activation queue and authorized activation roles.
- [ ] Design the entitlement and outbox transaction boundary.
- [ ] Implement activation without confusing approval with granted access.
- [ ] Add retry-safe downstream provisioning.
- [ ] Add activation failure and manual-intervention states.
- [ ] Add requester-visible activation outcomes.
- [ ] Add automated expiration and revocation.
- [ ] Add external email, SMS, and push notification delivery.
- [ ] Add monitoring and operational recovery procedures.
- [ ] Add integration and browser coverage.

**Status:** Not started.

## Remaining Administration and Account Work

- [ ] Add administrator account-management screens.
- [ ] Add secure first-login password-change workflow.
- [ ] Add password recovery.
- [ ] Add MFA.
- [ ] Add approver responsibility-management screens.
- [ ] Add assignment, entitlement, and catalog-maintenance screens.
- [ ] Add reassignment and delegation controls.
- [ ] Finalize authoritative university integrations.

## Deployment and Team Handoff

- [x] Publish the repository to GitHub.
- [x] Deploy the prototype to Vercel.
- [x] Connect the production application to Neon.
- [x] Apply production database migrations.
- [x] Bootstrap the first production administrator.
- [x] Verify the production health endpoint.
- [x] Add `HANDOFF.md`.
- [x] Create `develop` and feature-branch workflow.
- [x] Push the Milestone 5 feature branch.
- [x] Open the Milestone 5 pull request into `develop`.
- [ ] Complete teammate review of the Milestone 5 pull request.
- [ ] Review and merge Milestone 5 into `develop`.
- [ ] Verify the merged `develop` preview deployment.
- [ ] Promote an approved release from `develop` to `main`.

## Current Boundary

Permora supports database-backed authentication and owner-scoped requests,
auditable approval routing and decisions, PostgreSQL-backed requester in-app
notifications, and administrator-only, read-only audit-log visibility.
Approval ends at `approved_pending_activation` and does not provision access.

The system does not yet activate, provision, expire, or revoke real access
in downstream university systems.
