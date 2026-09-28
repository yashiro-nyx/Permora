# Permora Stage 2 plan

Updated 2026-09-28 after a repository-wide implementation audit. Stage 2A and Stage 2B Milestones 1–5 are implemented. The canonical checklist is [implementation-status.md](implementation-status.md); approval-domain detail remains in [stage-2b-plan.md](stage-2b-plan.md).

The earlier OIDC proposal is superseded. Permora uses its own Better Auth email/password accounts. PostgreSQL is the system of record, and browser prototype records are never imported or used as a fallback.

## Implemented Stage 2A boundary

- **Authentication:** Better Auth 1.7.5 with the Next.js handler and PostgreSQL adapter. Public signup and password-recovery endpoints are unavailable. Passwords use Argon2id with 64 MiB memory, three iterations, and one lane.
- **Sessions:** opaque database sessions expire after eight hours and refresh after 15 minutes. Cookie caching is disabled so protected reads validate the database session. Logout revokes the session. Production cookies are Secure; session cookies are HttpOnly and SameSite.
- **Abuse and request protection:** database-backed rate limiting allows five email sign-in attempts per client address per 60 seconds. Canonical-origin and CSRF checks remain enabled. Login errors do not reveal whether an account exists.
- **Admission and roles:** an active `user_profile` is required before session creation. Server code reloads active state, requester type, and roles from PostgreSQL. Requesters cannot assign themselves identities, roles, scopes, or approval authority.
- **Provisioning:** `account:provision` uses hidden password input, refuses overwrite, requires explicit first-administrator bootstrap, and requires an active authorized administrator for later accounts.
- **Requester workflow:** authenticated students and faculty can create, list, search/filter, count, and inspect only their own persisted requests. Submission and renewal validation use current catalog policy, canonical assignments, ordinary entitlements, conflicts, dates, and routing configuration.
- **Prototype cutover:** `DemoProvider` is not mounted. Login, shell, requester pages, staff pages, notifications, and audit use server data. `lib/demo-service.ts` remains historical test/prototype code only.

## Implemented Stage 2B boundary

Milestones 1–5 are complete:

1. Migrations `0004` and `0005` add approval states, versions, all-scope responsibility mappings, assignments, decisions, request events, constraints, indexes, and immutability.
2. Server guards and sanitized read models restrict queues/details to the persisted assignee with a current fully covering responsibility. Administrators have a separate unassigned-failure read and no global approval bypass.
3. Migration `0006` and the decision endpoint add idempotent, optimistic, transactional approve/deny/return operations. Decision, state, assignment, audit/request events, and notification commit together.
4. The protected staff dashboard, review queue/detail, dialogs, and administrator unassigned page are implemented.
5. Requester-owned in-app notifications and administrator-only read-only audit history are implemented.

Approval transitions to `approved_pending_activation`. It does not create an `ordinary_entitlement`, downstream account, activation event, or active access.

## Data and migration history

| Migration | Implemented schema |
| --- | --- |
| `0001_stage_2a_core.sql` | Better Auth user/account/session/verification/rate-limit tables; profiles, roles, institutional identifiers, catalog, assignments, entitlements, responsibilities, requests, scopes, submission history, and audit events. |
| `0002_catalog_v1.sql` | Proposed six-resource catalog, permission-role mappings, required scope fields, validity policies, and policy versions. |
| `0003_fix_rate_limit_schema.sql` | Better Auth-compatible non-null primary identifier for existing and future rate-limit rows. |
| `0004_stage_2b_approval_foundation.sql` | Approval states/versioning, responsibility scopes, one active review assignment, immutable decisions/request events/audit events, and review indexes. |
| `0005_enforce_approval_decision_reason.sql` | Non-empty reason enforcement for deny and return-for-revision decisions. |
| `0006_stage_2b_decision_operations.sql` | Durable decision idempotency and recipient-scoped in-app notifications. |

Applied migrations are append-only. Add a new numbered migration for future changes; never edit an applied file.

Internal user UUIDs remain distinct from student/staff numbers. Email proves login ownership only. Administrator-controlled profiles, roles, institutional identifiers, assignments, entitlements, and responsibilities remain authoritative until approved institutional integrations exist.

## Request and approval lifecycle

```text
requester submits
→ server validates current identity, policy, scopes, dates, ordinary access,
  conflicts, resource availability, and a fully eligible non-self approver
→ request becomes pending_review with exactly one assignment
  OR remains pending_routing when no fully eligible approver exists
→ persisted assignee reviews the current version
→ approve | deny with reason | return for revision with reason
→ approved_pending_activation | denied | returned_for_revision
→ requester sees persisted status, event history, and in-app notification
```

New submissions and their routing attempt commit in one transaction. Missing requester eligibility, policy, scope assignment, or resource availability rejects the submission. If no fully eligible approver exists, the request is preserved as `pending_routing` with immutable routing-unavailable evidence; it cannot be reviewed or decided. Approval revalidates current eligibility and policy, and a locked or prefilled client field never bypasses validation. A renewal opens a new owned request and repeats all checks. Return-for-revision is terminal for the reviewed record; the linked resubmission UI is still planned.

## Authorization model

- Requester pages require an active session with a server-recorded student or faculty requester role.
- Every requester query scopes by `requester_user_id`.
- Approver queue/detail/decision access requires an approver/admin role, a current approval responsibility covering every requested scope, and the persisted assignment to that user.
- Self-approval and partial responsibility matches are prohibited.
- Administrator-only routes require the server-recorded admin role. The admin role does not bypass review assignment or responsibility.
- Unauthorized and nonexistent protected detail IDs use indistinguishable responses where enumeration is a risk.
- Role-based navigation is presentation only; pages, route handlers, services, and transactions enforce authorization.

## Database CLI and local setup

Use Node.js 22 LTS. Create separate development and test databases, then copy `.env.example` to ignored `.env.local`.

```sh
npm ci
cp .env.example .env.local
npm run db:migrate -- --database-target development
npm run dev
```

Development CLI operations load `DATABASE_URL` and `DATABASE_MIGRATION_URL` and reject different protocols, normalized hosts/Neon branches, or database names. Test operations require only `TEST_DATABASE_URL` and a database name ending in `_test`. Production operations do not load URLs from `.env.local`; both URLs must be injected into the current process and `--confirm-production` is mandatory.

Bootstrap and later account/configuration examples are maintained in [HANDOFF.md](../HANDOFF.md). Run each CLI with `--help` before an operator action.

## Verification

```sh
npm test
npm run test:integration
npm run test:e2e
npm run lint
npm run typecheck
npm run build
git diff --check
```

The integration and browser runners load `.env.local`, validate only `TEST_DATABASE_URL`, require `_test`, remove development/migration variables, and recreate only the guarded test schema. The current Node 22 run passed 43 unit, 43 PostgreSQL integration, and 20 Playwright tests, plus lint, typecheck, build, and diff checks.

## Remaining work after Stage 2B Milestone 5

- **Activation and provisioning:** define an approved queue, operator permissions, entitlement/outbox model, adapters, failure/retry/reconciliation, revocation, and expiry enforcement.
- **Administrator maintenance UI:** users, assignments, entitlements, policy/catalog, and approver responsibilities remain CLI/migration maintained.
- **Account operations:** password recovery/change, MFA, SSO, session administration, and break-glass recovery.
- **Revision/resubmission:** create a new linked request from `returned_for_revision` after full current validation.
- **External delivery:** email/SMS/push and preferences are absent; current notifications are in-app database records.
- **Audit governance:** export, redaction, retention/legal hold, view-access logging policy, and external monitoring remain unresolved.
- **Institutional integrations:** SIS/LMS/library/lab/research sources are not connected.
- **Production operations:** owners, preview isolation, branch protection, secrets, backups/restore tests, monitoring, alerting, and incident runbooks require deliberate setup.

A bounded private/no-store `GET /api/health` probe exists. It is not a substitute for monitoring, and the repository must not be represented as a complete production access-control service until the remaining operational and activation boundaries are implemented.
