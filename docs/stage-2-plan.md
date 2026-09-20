# Permora Stage 2 plan

> **Stage 2B Milestone 2 update — 2026-09-20:** the server-authorized approval read model is implemented. Active approvers and administrators need a current approval responsibility; normal queue/detail reads are restricted to the persisted assignee and re-check full requested-scope coverage. Administrators can inspect unassigned `pending_routing` failures only through a separate admin-only endpoint and receive no general review bypass. Explicit sanitized DTOs, validated filters, bounded deterministic pagination, private/no-store responses, and enumeration-resistant detail responses are tested. Decision mutations, the final staff UI, activation, and provisioning remain deferred. No migration was needed for this milestone; see [stage-2b-plan.md](stage-2b-plan.md).

> **Stage 2B Milestone 1 update — 2026-09-20:** migrations `0004` and `0005`, transactional routing/decision domain services, and guarded legacy-pending reconciliation are implemented. Approval produces `approved_pending_activation` only and creates no entitlement. The administrator read model, routes, controls, requester notifications, activation, and downstream provisioning remain later milestones; see [stage-2b-plan.md](stage-2b-plan.md).

Updated 2026-09-20. Stage 2A now uses Permora-owned email/password accounts. The earlier OIDC proposal is obsolete. PostgreSQL is the system of record; browser prototype records are never imported or used as a fallback.

## Implemented Stage 2A boundary

- **Authentication:** Better Auth 1.7 with its documented Next.js handler and PostgreSQL adapter. Public signup is disabled. Passwords use Argon2id (`argon2` 0.45) with 64 MiB memory, three iterations, and one lane. Better Auth stores opaque, revocable database sessions with an eight-hour server expiry and 15-minute refresh interval. Cookie caching is disabled so protected reads validate the database session. Production cookies are Secure; library session cookies are HttpOnly and SameSite. The canonical origin is the only trusted origin, so origin/CSRF checks remain enabled.
- **Abuse control:** the auth endpoint stores rate-limit counters in PostgreSQL. Email sign-in allows five attempts per IP per 60 seconds. Login UI always shows the same invalid-account/invalid-password message. Inactive profiles cannot create a new session.
- **Provisioning:** `npm run account:provision -- …` is a server-side, hidden-password command. There is no registration endpoint or default password. `--bootstrap-admin` is explicit and is refused after an active administrator exists. Every later account needs `--authorized-admin <internal UUID>`. Existing email accounts are never overwritten.
- **Requests:** authenticated Student/Faculty requester roles are loaded from server records. Request creation, owner-scoped list/filter/count/detail, canonical scope assignments, duplicate/entitlement/conflict checks, validity, current policy, and approval routing run in PostgreSQL. Request plus submission history plus audit metadata commit together. New records are `pending`; Stage 2A creates no decision or grant.
- **Cutover:** `DemoProvider` is removed from the application root. Login, shell, dashboard, request form/list/detail no longer use localStorage, sessionStorage, demo role switching, or browser seeds. Deferred routes render an explicit unavailable state rather than a mock workflow.

Official compatibility references: [Better Auth Next.js integration](https://better-auth.com/docs/integrations/next), [PostgreSQL adapter](https://better-auth.com/docs/adapters/postgresql), [email/password options](https://better-auth.com/docs/authentication/email-password), [sessions](https://better-auth.com/docs/concepts/session-management), and [rate limiting](https://better-auth.com/docs/concepts/rate-limit). The installed application remains Next.js 15.5 / React 19; dependencies were not upgraded.

## Data and authorization model

Migration [`0001_stage_2a_core.sql`](../db/migrations/0001_stage_2a_core.sql) creates Better Auth users/accounts/sessions/verifications/rate limits plus profiles, roles, institutional identifiers, policy versions, canonical scope options, requester assignments, ordinary entitlements, approver responsibilities, access requests, request scopes, submission history, and audit events. [`0002_catalog_v1.sql`](../db/migrations/0002_catalog_v1.sql) seeds the proposed six-resource catalog. Applying that seed records proposed configuration; it does not represent an approved university policy.

Internal UUIDs remain distinct from student/staff numbers. `institutional_identifier` stores the identifier type, issuer, and normalized value. Email is a login address, not proof of student/faculty status. The non-editable `user_profile.requester_role`, active roles, assignments, entitlements, and approver responsibility come only from administrator-controlled records.

All requester reads include `requester_user_id` before search or filters. Detail lookup accepts an internal UUID or display ID only within that owner scope. Request actions ignore submitted owner, role, status, decision, and grant fields. Student Portal scope is derived as `own-account:<authenticated UUID>`. Other scopes must match a current administrator-maintained canonical option and requester assignment.

Submission uses a per-requester/resource PostgreSQL advisory transaction lock, then rechecks role, availability, policy, permission, required assignments, approver routing, ordinary entitlements, overlapping pending requests, renewal ownership, and dates. A missing assignment or route fails closed and inserts nothing. Renewals must refer to an owned expired record, remain renewable under the current policy, and preserve resource/permission/scope; the same current checks still apply.

## Exact local setup

Create separate development and test databases. The role names below are examples; choose private passwords outside shell history and set them through your PostgreSQL administration tool.

```sql
CREATE ROLE permora_migrator LOGIN;
CREATE ROLE permora_app LOGIN;
CREATE ROLE permora_test LOGIN;
CREATE DATABASE permora_dev OWNER permora_migrator;
CREATE DATABASE permora_test OWNER permora_test;
```

After running migrations as `permora_migrator`, grant only runtime DML in `permora_dev`:

```sql
GRANT CONNECT ON DATABASE permora_dev TO permora_app;
GRANT USAGE ON SCHEMA public TO permora_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO permora_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO permora_app;
ALTER DEFAULT PRIVILEGES FOR ROLE permora_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO permora_app;
ALTER DEFAULT PRIVILEGES FOR ROLE permora_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO permora_app;
```

1. Copy `.env.example` to ignored `.env.local`.
2. Set `DATABASE_URL` to the restricted `permora_app` development connection.
3. Set `DATABASE_MIGRATION_URL` to the `permora_migrator` development connection.
4. Set `TEST_DATABASE_URL` to the isolated `permora_test` database. The integration guard refuses a name that does not end in `_test`, or a URL equal to development/migration.
5. Generate `AUTH_SECRET` locally with `openssl rand -base64 48`. Never paste its value into docs, chat, browser variables, or source.
6. Keep `APP_URL=http://localhost:3000` for `npm run dev`. Login is `http://localhost:3000/login`; the library endpoint is `http://localhost:3000/api/auth/sign-in/email`. Email/password authentication has no callback URL.
7. Apply additive migrations explicitly: `npm run db:migrate`.
8. Bootstrap the first administrator in a private terminal. The command prompts twice without echo: `npm run account:provision -- --email <admin-email> --name "<name>" --role admin --department "<department>" --bootstrap-admin`.
9. Save the printed internal administrator UUID. Create an approver and requester with `--authorized-admin <admin-uuid>`. For requesters, optionally add `--identifier-type student_number|staff_number --identifier <value> --issuer <institution-namespace>`.
10. Configure at least one approver route before allowing submission: `npm run access:configure -- approver --actor <admin-uuid> --approver <approver-uuid> --resource r-library`.
11. For scoped resources, create a canonical option and assign it: `npm run access:configure -- scope --actor <admin-uuid> --resource r-lms --field courseSection --code <official-code> --name "<display label>"`, then `npm run access:configure -- assignment --actor <admin-uuid> --user <requester-uuid> --resource r-lms --scope <scope-uuid> --evidence "<approved reason>"`.
12. Record already-provided access with the `entitlement` command so duplicate requests fail. Accepted configuration commands are `scope`, `assignment`, `approver`, and `entitlement`.

Migration and administrator commands require `DATABASE_MIGRATION_URL`; the web runtime does not. Commands print record IDs and outcomes but never passwords or hashes. They refuse invalid administrator actors and roll back the transaction on error.

For any later production environment, `APP_URL` must be an exact HTTPS origin. The reverse proxy must replace untrusted forwarding headers before traffic reaches Next.js so IP-based login limits cannot be bypassed with a client-supplied `X-Forwarded-For` value.

## Verification commands

- `npm test` runs isolated unit/domain tests and does not touch PostgreSQL.
- `npm run test:integration` uses `TEST_DATABASE_URL`, drops only that database's `public` schema after strict URL/name checks, reapplies migrations, and creates synthetic fixtures. It covers valid/invalid login, server expiration, logout revocation, owner isolation, forged identity/role/status fields, incompatible permission rejection, and persistence through a new sign-in.
- `npm run lint`, `npm run typecheck`, and `npm run build` are required before merge.

Without configured PostgreSQL URLs, migration and live/integration verification are blocked by setup, while compilation and unit tests remain available. The runtime returns authentication unavailable rather than switching to localStorage.

## Required policy decisions before real personal data

- Approve or disable each proposed catalog resource, permission ID, default/maximum validity, renewable flag, and Student Portal handling.
- Define retention/deletion for accounts, sessions, assignments, requests, and audit history.
- Name administrators authorized to maintain roles, assignments, entitlements, and approval authority, including separation-of-duty and second-administrator recovery rules.
- Approve canonical course/section, laboratory/software, project, and any restricted-library collection identifiers and display labels.
- Confirm whether users may hold both Student and Faculty requester identities. Stage 2A assigns one non-editable requester role per account.

## Deferred after Stage 2A

Approval decisions and reasons, multi-stage routing, self-approval rules, access grants, downstream provisioning, activation, expiration/revocation workers, notifications/recovery email, MFA, password reset/change UI, administrator dashboards, integration sync, and protected audit/report screens remain Stage 2B or later. Approval and activation must stay separate. No later worker may treat a pending request as a grant.
