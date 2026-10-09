# Permora

Permora is a secure access-request and approval application for students, faculty, approvers, and administrators. It uses Next.js 15, React 19, TypeScript, Tailwind CSS 4, Better Auth 1.7.5 email/password authentication, Argon2id, and PostgreSQL.

The current application implements owner-scoped requests and renewals, deterministic full-scope routing, protected staff review, transactional approve/deny/return decisions, requester in-app notifications, and administrator read-only audit history. Approval ends at `approved_pending_activation`; it does not provision or activate access.

Read [HANDOFF.md](HANDOFF.md) before database operations, publication, or deployment. The canonical progress checklist is [docs/implementation-status.md](docs/implementation-status.md).

## Current feature boundary

Implemented:

- real administrator-provisioned accounts and revocable database sessions;
- server-trusted roles, requester identities, assignments, entitlements, and approval responsibilities;
- six-resource proposed university catalog with role/permission/scope policy;
- requester dashboard, form, My Requests filters/details/timeline, and renewal prefill;
- one-stage non-self routing to one fully covering approver;
- responsibility- and assignment-scoped staff queue/detail/decisions;
- owner-scoped in-app notifications and administrator-only sanitized audit history;
- guarded database CLIs, private health endpoint, and isolated PostgreSQL/browser test runners.

Deferred:

- actual access activation/provisioning, downstream adapters, expiration/revocation workers;
- users/resources/permissions/reports administration UI;
- linked revision resubmission, multi-stage approval, delegation, and reassignment;
- password recovery/change, MFA, SSO, and institutional integrations;
- external notification delivery, audit export/retention, full monitoring, and production operations.

Historical browser-demo code remains unmounted and is never a fallback or trusted data source.

## Local setup

Use Node.js 22 LTS, pinned by `.nvmrc` and `engines.node`.

```sh
npm ci
cp .env.example .env.local
# Replace placeholders locally; never commit .env.local.
npm run db:migrate -- --database-target development
npm run dev
```

Open the exact origin configured in `APP_URL`, normally `http://localhost:3000/login`. There is no public registration or demo login. Use the guarded provisioning command to create accounts; see [HANDOFF.md](HANDOFF.md#f-local-setup) or `npm run account:provision -- --help`.

## Database CLI safety

Every database CLI requires `--database-target development`, `test`, or `production`.

- Development may load `DATABASE_URL` and `DATABASE_MIGRATION_URL` from `.env.local` and verifies that both identify the same protocol, database, and normalized host/Neon branch.
- Test uses only `TEST_DATABASE_URL` and requires the database name to end in `_test`.
- Production does not load database URLs from `.env.local`. Both production URLs must be supplied by the current process and `--confirm-production` is required.

Neon pooled and direct hostnames for the same branch are treated as one target; database usernames may differ. CLIs reject mixed targets before connecting and never print connection strings or credentials.

```sh
npm run db:migrate -- --database-target production --confirm-production
npm run account:provision -- --database-target production --confirm-production <account-flags>
```

Inject production values through an approved secret manager. Do not place them in repository files.

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

Integration and Playwright runs destructively recreate only the guarded `TEST_DATABASE_URL` database after confirming its name ends in `_test`. They remove inherited development/migration variables and never fall back to development or production. Playwright generates fresh synthetic account emails, password, and auth secret in memory per run.

The latest October 9, 2026 verification under Node.js 24.21.0 passed 63 unit tests, 83 guarded PostgreSQL integration tests, and 26 Playwright tests. Lint, typecheck, production build, and diff checks also passed. Re-run the suite under the repository-pinned Node.js 22 runtime before release.

## Health endpoint

`GET /api/health` performs a bounded database `SELECT 1`:

- HTTP 200: `{"status":"ok","application":"available","database":"available"}`
- HTTP 503: `{"status":"unavailable"}`

Responses are private/no-store and expose no database host, URL, version, schema, counts, environment values, or stack traces. The endpoint is an availability probe, not complete monitoring.

## Documentation

- [Project progress checklist](docs/implementation-status.md)
- [Operational handoff and deployment guide](HANDOFF.md)
- [Stage 2 architecture](docs/stage-2-plan.md)
- [Stage 2B approval plan and status](docs/stage-2b-plan.md)
- [Resource access matrix](docs/resource-access-matrix.md)
- [Design system](docs/design-system.md)
- [Implementation rules](docs/design-system-rules.md)
- [Historical prototype notes](docs/implementation-notes.md)
