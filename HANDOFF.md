# Permora project handoff

This is the operational handoff for the current Permora repository. Product and design details remain in [`docs/`](docs/).

## A. Project overview

Permora is an access-request and approval application for a proposed Philippine university context. Students and faculty request additional, restricted, or temporary access; assigned approvers review requests; administrators maintain trusted identities, assignments, entitlements, and approval responsibilities. Target users are students, faculty, approvers, and authorized administrators.

The stack is Next.js 15 App Router, React 19, TypeScript 5, Tailwind CSS 4, Better Auth 1.7 email/password authentication, Argon2id, PostgreSQL through `pg`, and Neon. The design source is [University Access Request in Figma](https://www.figma.com/design/eP1FKbWJWPSCL3f34tM0Wt/University-Access-Request?node-id=0-1); code uses the Permora name and no invented logo.

The project has completed **Stage 2B Milestones 1–5 and Stage 2C activation/lifecycle implementation slices 1–7, plus Stage 2D staff notifications**. Real accounts, owner-scoped requests, approval reads/decisions, requester notifications, staff (approver/admin) notifications, administrator audit, manual activation, lifecycle status, retry/reconciliation, expiry/revocation boundaries, and an operator runbook exist. Administrator pages include user management at `/users`, responsibility management at `/admin/responsibilities`, eligible assignment of `pending_routing` requests at `/admin/unassigned`, resource/permission catalog administration at `/resources` and `/permissions`, delegation/absence management at `/admin/delegations`, institutional-identifier maintenance at `/admin/identifiers`, analytics/operational reports at `/reports`, and retention management (list + non-destructive dry-run preview) at `/admin/retention`. Every authenticated account can also manage its own notification preferences at `/account/notifications` (in-app only; external delivery is unavailable). Approvers and administrators have a real-time notification bell and full notification center at `/notifications/staff`. Real university-system integration and automatic job scheduling remain deferred.

The October 19, 2026 toast/sidebar reliability fix is verified on `feature/notification-system`: toast timers are scheduled from committed provider state (5/7/8 seconds by variant), repeated keyed failures receive fresh feedback, and desktop/mobile sidebars keep Logout outside the independently scrolling navigation region. The development database has migrations `0001`–`0013`; migration `0013` only widens the notification type constraint and production was not changed.

The same-day approver visibility audit confirmed that the three inspected requests (`REQ-2026-000031`, `REQ-2026-000030`, and `REQ-2026-000016`) are correctly assigned to `admin@permora.ph`, not `approver@permora.ph`, under the responsibility-based load-balancing rules. The first two have staff assignment notifications; the oldest request predates migration `0011` and has no historical staff notification. Do not reassign or backfill these development records without explicit review.

The activation queue audit confirmed that `/admin/activations` reads approved decisions by request status, not by an existing activation row; future-dated approvals are included. Successful approval remains separate from activation and the original approver cannot activate the request. A desktop grid/sticky-sidebar correction was added after confirming the former absolute positioning allowed long-page scrolling to move the sidebar out of view.

The October 20 lifecycle verification confirmed `REQ-2026-000035` is provisioned for a future validity window (`approved_pending_activation` + `request_activation=activated`), not currently Active. Migration `0014_activation_approver_notifications.sql` is applied to development only. Successful Admin provisioning notifies the active original Approver once with an authorized review deep link; the transaction and existing requester notification remain atomic and idempotent.

Activation-ready staff notifications link to `/admin/activations?requestId=<request-uuid>`. The Admin-only page validates the request target, highlights and scrolls to a visible row, and reports the current lifecycle state when the request is no longer awaiting activation. The Admin dashboard prioritizes activation, routing intervention, operational failures, and staff notifications. With the default `dedicated_only` routing policy, Admin Review Requests navigation is intentionally hidden; explicit fallback preserves only the existing assignment/responsibility-authorized review path.

Security goals are server-trusted identity and roles, owner isolation, least privilege, full-scope fail-closed routing, revocable sessions, CSRF/origin protection, database rate limiting, transactional immutable evidence, optimistic concurrency, idempotency, and strict separation of approval from activation.

## B. User roles

One shared `/login` page verifies email/password credentials. The server loads active roles, requester type, and responsibilities from PostgreSQL; browser-supplied identity or role fields are never trusted.

| Role | Current access | Excluded access |
| --- | --- | --- |
| Student | Own dashboard, eligible request form, own list/details | Other users' requests, grading, staff/admin routes, another student's portal record |
| Faculty | Owner-scoped requester workflow and eligible faculty resources/scopes | Unassigned sections/projects and staff/admin operations unless separately trusted |
| Approver | Own assigned queue/details and decisions within current full-scope responsibility | Other assignments, unassigned failures, self/partial-scope approval, activation |
| Administrator | Admin dashboard, user management, responsibility management, eligible assignment of unassigned requests, resource/permission catalog availability and scope administration, absence delegation management, institutional-identifier maintenance, read-only analytics/operational reports, activation queue/status, manual activation/retry, audit; review decisions only with explicit responsibility | Automatic access to all reviews, responsibility bypass, activation of own request or a request they originally approved, external provisioning integration, policy-version/duration editing, preferences/retention UI, report export |

Navigation is presentation. Server layouts, services, and handlers enforce authorization.

## C. Functional workflow

```text
Start
→ administrator provisions an account and trusted assignments
→ administrator configures approver responsibilities
→ requester signs in and submits resource, permission, scopes, purpose, dates
→ server validates identity, eligibility, policy, availability, assignments,
  dates, duplicates, conflicts, and routing
→ routing requires one non-self approver covering every requested scope;
  lowest open workload wins, then stable UUID order
→ pending_review, or preserved pending_routing when nobody is fully eligible
→ persisted assignee reviews the current version
→ approve | deny with reason | return for revision with reason
→ approved_pending_activation | denied | returned_for_revision
→ requester sees decision; immutable events, requester notification, and (on approval) eligible Admin activation-ready notifications are recorded atomically
→ approved request enters separate activation lifecycle
→ active administrator revalidates and commits `activating`
→ manual adapter receives explicit confirmation outside the transaction
→ outcome transaction records entitlement + success, or failure event/notification
→ expiry reconciliation or deliberate revocation closes activated access
→ End (no live university adapter or automatic job scheduler)
```

`access_request.status = approved_pending_activation` remains the immutable approval outcome. Activation state lives in `request_activation`; screens join both. Approval alone is not active access. The prototype manual adapter succeeds only after an active administrator explicitly confirms external provisioning and supplies a reference or evidence. Unassigned requests cannot be decided. Revision/resubmission is not yet complete.

## D. Architecture

- `app/`: App Router pages, Server Actions, route handlers, loading/error boundaries.
- `app/(portal)/layout.tsx`: loads server-trusted identity before the shared shell.
- `app/actions/requests.ts`: requester submission Server Action.
- `app/api/auth/[...all]/route.ts`: Better Auth endpoint.
- `app/api/review/requests/*`: sanitized queue/detail reads and transactional decisions.
- `app/api/admin/unassigned-requests/route.ts`: administrator-only routing failures.
- `app/api/admin/unassigned-requests/[id]/assign/route.ts`: administrator assignment of eligible approvers to pending-routing requests.
- `app/api/admin/activations/[id]/activate/route.ts`: same-origin active-admin manual activation entrypoint.
- `app/(portal)/admin/responsibilities/`: responsibility list/add/end UI with explicit confirmation for resource-wide scope.
- `app/(portal)/admin/unassigned/`: pending-routing queue and eligible-assignee controls.
- `app/(portal)/resources/` and `app/(portal)/permissions/`: administrator catalog UI for resource/permission availability toggles and scope-option creation, backed by the existing `/api/admin/catalog` and `/api/admin/catalog/scopes` handlers.
- `app/(portal)/admin/delegations/`: administrator absence-delegation UI (list/create/cancel) backed by the existing `/api/admin/delegations` and `/api/admin/delegations/[id]/cancel` handlers; it grants forward substitute eligibility only and never reassigns existing assignments.
- `app/(portal)/admin/identifiers/`: administrator institutional-identifier maintenance UI (account search, per-account list, add/update) backed by the existing `GET`/`PUT /api/admin/users/[id]/identifiers` handlers; it preserves issuer-scoped uniqueness and offers no delete operation.
- `app/(portal)/reports/`: administrator read-only analytics dashboard rendered server-side from `getAnalyticsSummary` (also exposed at `GET /api/admin/analytics`); it shows sanitized request/activation/entitlement aggregates with date/resource/status filters and no export. The demo-only `components/reports.tsx` and `components/charts.tsx` remain unmounted and are not used by this page.
- `app/(portal)/account/notifications/`: per-account notification-preference page (any authenticated user) backed by `GET`/`PATCH /api/notifications/preferences`; it edits the in-app channel only and marks external channels unavailable. The update service returns the committed DTO (a prior stale-read-before-commit bug was fixed).
- `app/(portal)/admin/retention/`: administrator retention-management page backed by `GET`/`POST /api/admin/retention`; it lists provisional retention classes and runs non-destructive dry-run previews only. Destructive archival apply is refused server-side (`409`), and the UI exposes no apply/edit/delete controls.
- `app/(portal)/account/password/` + `components/password-change-form.tsx` + `lib/password-strength.ts`: enhanced change-password UI with show/hide, a live four-level strength indicator (local documented heuristic, no third-party calls, guidance-only), and a mandatory-requirements checklist. The server contract (`POST /api/account/password`) is unchanged.
- `app/api/maintenance/expire-activations/route.ts` + `lib/server/maintenance-handlers.ts` + `lib/server/scheduled-maintenance.ts` + `lib/scheduler-auth.ts`: a bearer-secret-protected `POST` endpoint that runs automatic access expiration by invoking the existing `expireActivatedEntitlement` service per candidate transaction. It is disabled (`503`) unless `MAINTENANCE_SCHEDULER_SECRET` is set. No production cron is configured.
- `components/admin-activation-queue.tsx`: the manual-activation confirmation ("Access activation recorded.") is surfaced at the queue level, not inside the per-row control, so it survives the `router.refresh()` that transitions the row to a terminal state (this fixed an intermittent E2E failure).
- `app/(portal)/users/`: account directory and account creation/profile/role management; invitations are separate from profile editing.
- `components/`: shared UI, requester screens, staff queue/detail/decision UI.
- `lib/server/auth.ts`: Better Auth, Argon2id, sessions, rate limits, admission.
- `lib/password-hash.ts`: standalone Argon2 hash/verify helpers shared with server password flows; it does not import the server-only database module.
- `lib/server/invitation-service.ts` and `lib/server/password.ts`: invitation acceptance and password/session/audit updates with transactional atomicity.
- `lib/server/admin-governance-service.ts`: responsibility management, unassigned assignment, delegation, identifiers, analytics, notification preferences, and retention dry-run services; UI and integration coverage vary by capability.
- `lib/server/identity*.ts`: identity and role/responsibility guards.
- `lib/server/request-service.ts`: owner-scoped request reads/writes and policy.
- `lib/server/approval-read-service.ts`: explicit sanitized DTOs.
- `lib/server/approval-service.ts` and `lib/approval-domain.ts`: routing/state/decisions.
- `lib/server/activation-service.ts`, `lib/activation-lifecycle.ts`, and `lib/activation-maintenance.ts`: separated activation transactions, lifecycle outcome/maintenance logic.
- `lib/activation-adapter.ts`: manual adapter contract; no live university integration.
- `lib/server/db.ts`: server-only pool and transaction wrapper.
- `lib/resource-catalog.ts`: typed product catalog; database policy is runtime authority.
- `scripts/`: migrations, provisioning, access configuration, reconciliation, test runner.
- `db/migrations/`: ordered, append-only SQL migrations `0001`–`0011` (`0008` account management; `0009` administrator governance; `0010` catalog v2; `0011` staff notifications — composite event-recipient uniqueness and new notification types).
- `scripts/reconcile-activations.ts`, `scripts/expire-activations.ts`: dry-run-by-default lifecycle commands.
- `docs/activation-operations.md`: manual activation, recovery, expiry, and escalation runbook.
- `tests/`: unit, isolated PostgreSQL integration, route authorization, Playwright.
- `docs/`: design system, access matrix, implementation audit, backend plans.

The app requires Node runtime APIs (`pg`, native Argon2). Do not move database/auth routes to Edge without a compatibility review.

## E. Current implementation status

**Completed:** no-public-registration email/password accounts; Argon2id; revocable HttpOnly sessions; database rate limiting; active-account admission; server roles; owner-scoped request workflow; deterministic full-scope non-self routing; transactional approval; admin/requester activation status UI; server-checked active-admin activation with requester/original-approver exclusion; separate transaction 1 / adapter / transaction 2; successful `ordinary_entitlement` creation; immutable outcome events and notifications; dry-run retry reconciliation and expiry commands; terminal revocation/expiry boundaries; linked new-request renewals; guarded migrations and isolated lifecycle tests; staff (approver/admin) in-app notification bell and full notification center backed by `user_notification` via migration `0011`.

**Partial:** in-app notification presentation/read state and read-only audit presentation are implemented; external delivery is absent. Per-account notification-preference management now has a verified UI at `/account/notifications` (in-app toggle only; external channels are shown unavailable and the backend rejects enabling them). Retention management now has a verified administrator UI at `/admin/retention` for listing provisional classes and non-destructive dry-run previews; destructive archival remains disabled and retention-period editing is not exposed. Delegation/absence management now has an administrator UI at `/admin/delegations`, and institutional-identifier maintenance now has an administrator UI at `/admin/identifiers`. Analytics now has a verified administrator reports UI at `/reports` backed by the analytics service and a new integration test. Renewal revalidation exists but revision/resubmission policy is incomplete.

**Deferred:** live university provisioning adapters; wiring the protected automatic-expiration endpoint to an actual schedule and monitoring (the endpoint and the idempotent expiry service exist; a bearer-secret-protected `POST /api/maintenance/expire-activations` performs it, but no production cron is enabled) plus automatic reconciliation scheduling; revocation UI/CLI (the guarded server service exists); password recovery, MFA and SSO (recovery needs an email-delivery service + reset-token migration + policy; MFA needs the two-factor plugin + migration + enrollment/backup-code flow; SSO needs an institutional identity provider); multi-stage approval; external notification delivery (email/SMS/push), destructive retention archival execution and retention-period editing, catalog policy-version/duration editing, and report export (resource and permission availability and scope-option administration now have an admin UI at `/resources` and `/permissions`, absence delegation management at `/admin/delegations`, institutional-identifier maintenance at `/admin/identifiers`, read-only analytics/operational reports at `/reports`, per-account notification preferences at `/account/notifications`, and retention listing/dry-run preview at `/admin/retention`); external notifications, audit exports/redaction, and monitoring; institutional integrations.

**Demo/test-only:** historical `lib/demo-service.ts` and older demo components are not mounted in the real flow. Playwright recreates only a guarded `_test` database and seeds synthetic accounts. Its configuration generates a cryptographically random run namespace, password, and auth secret in memory for each invocation; optional dedicated `PERMORA_E2E_*` inputs are validated and never fall back to development/production credentials. Browser/localStorage records are never trusted or imported.

**Known boundary:** this is suitable only as a clearly labeled, access-controlled prototype/pilot after deliberate configuration. It is not a complete production access-control service. Manual activation, retry/expiry commands, and lifecycle status are implemented, but no university provisioning adapter, automatic job schedule, revocation UI/CLI, or broad monitoring exists. Review Requests redirects administrators without an approval responsibility to `/dashboard?unavailable=approver`; this is intentional, though the UX could be clearer. Repeating a request assignment returns `409` instead of replaying the original success.

## F. Local setup

Use **Node.js 22 LTS** and npm. The repository pins `22` in `.nvmrc` and `22.x` in `package.json`/`package-lock.json`.

```sh
git clone <repository-url>
cd Permora
npm ci
cp .env.example .env.local
# Replace placeholders locally; never commit this file.
npm run db:migrate -- --database-target development
```

Bootstrap the first administrator; the command requests a hidden password twice and refuses overwrite:

```sh
npm run account:provision -- --database-target development \
  --email <admin-email> --name "<admin-name>" \
  --role admin --department "<department>" --bootstrap-admin
```

Provision later accounts using the internal administrator UUID:

```sh
npm run account:provision -- --database-target development \
  --email <student-email> --name "<student-name>" \
  --role student --department "<department>" --identifier-type student_number \
  --identifier <student-number> --issuer <institution-namespace> \
  --authorized-admin <admin-internal-uuid>

npm run account:provision -- --database-target development \
  --email <approver-email> --name "<approver-name>" \
  --role approver --department "<department>" --identifier-type staff_number \
  --identifier <staff-number> --issuer <institution-namespace> \
  --authorized-admin <admin-internal-uuid>
```

Faculty uses `--role faculty`. Internal UUIDs remain separate from institutional numbers. See `npm run account:provision -- --help`.

Configure scoped eligibility and approval responsibility with placeholders:

```sh
npm run access:configure -- scope --database-target development \
  --actor <admin-uuid> --resource <resource-id> \
  --field <scope-field> --code <institutional-code> --name "<display-name>"

npm run access:configure -- assignment --database-target development \
  --actor <admin-uuid> --user <requester-uuid> \
  --resource <resource-id> --scope <scope-option-uuid> \
  --permission <permission-id> --evidence "<verified-evidence>"

npm run access:configure -- approver --database-target development \
  --actor <admin-uuid> --approver <approver-uuid> \
  --resource <resource-id> --permission <permission-id> \
  --scopes <comma-separated-scope-option-uuids>
```

Omit `--scopes` only for genuinely resource-wide responsibility. Start on the exact `APP_URL` origin:

```sh
npm run dev
# Normally http://localhost:3000/login
```

If port 3000 is occupied, update `APP_URL` to the exact alternate origin, then use `npm run dev -- --port <port>`.

## G. Environment variables

Never use `NEXT_PUBLIC_` for secrets.

| Variable | Purpose and placement |
| --- | --- |
| `DATABASE_URL` | Restricted pooled runtime connection. Development branch locally; unique production/preview pooled connection on Vercel. |
| `DATABASE_MIGRATION_URL` | Direct schema-owner connection for explicit migrations and admin CLIs. Keep outside the Vercel app runtime where possible; inject into a controlled operator/CI job. |
| `TEST_DATABASE_URL` | Destructive isolated test connection. Required for tests; parsed database name must end in `_test`. Never configure in Vercel Production/Preview. |
| `AUTH_SECRET` | Better Auth secret, minimum 32 high-entropy characters. Required at runtime and unique for development, preview, and production. |
| `APP_URL` | Canonical Better Auth base URL and trusted origin. Exact local origin or exact deployed HTTPS origin. |
| `PERMORA_E2E_DATABASE` | Internal Playwright opt-in set by test config only. Never set in normal development or deployment. |
| `PERMORA_E2E_PASSWORD` | Optional ephemeral CI override; otherwise generated securely for each Playwright run. Never use a development/production password. |
| `PERMORA_E2E_AUTH_SECRET` | Optional ephemeral CI override; otherwise generated securely for each Playwright run and mapped to the test server's `AUTH_SECRET`. |
| `PERMORA_E2E_RUN_ID` | Optional validated run namespace; otherwise randomly generated so synthetic account emails are unique per run. |
| `MAINTENANCE_SCHEDULER_SECRET` | Optional shared bearer secret (≥16 chars) for `POST /api/maintenance/expire-activations`. When unset the endpoint is disabled (`503`) and never open. Set only where the automatic expiration job runs and send it as `Authorization: Bearer <secret>` (e.g. a Vercel Cron job). Not enabled in production as part of this change. |
| `NODE_ENV` | Managed by Next.js/test runners/Vercel. Production mode enforces HTTPS `APP_URL`. |

Commented SIS/LMS/research names in `.env.example` are future placeholders and are not currently read.

Every database CLI requires `--database-target development`, `test`, or
`production`. Development may load the two development URLs from `.env.local`,
but it rejects different protocols, database names, or normalized hosts. Neon
direct and `-pooler` hostnames for the same branch match; database usernames may
differ. Test uses only `TEST_DATABASE_URL` and retains the `_test` suffix guard.
Production never loads database URLs from `.env.local`: both URLs must already
exist in the current process and `--confirm-production` is mandatory.

## H. Neon topology

```text
production
└── development
    └── test
```

Local development uses development. Automated tests use only `permora_test` on test. Production uses only production. Preview deployments require a separate non-production branch. Never put test credentials in Vercel Production; never run development/test fixtures or migrations against production. Use a pooled URL for serverless runtime and a direct schema-owner URL for explicit migrations. Configure Neon backup/PITR and test restore into an isolated branch.

## I. Testing

```sh
npm test                  # unit/domain/CLI tests
npm run test:integration  # isolated PostgreSQL integration/route tests
npm run test:e2e          # Playwright requester/staff/workflow tests
npm run lint
npm run typecheck
npm run build
npm run db:migrate -- --database-target development # applies pending migrations; not a dry run
git diff --check
```

All package scripts and their intended use:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Local Next.js development server |
| `npm run build` | Optimized production build with framework lint/type validation |
| `npm start` | Serve an already-built application |
| `npm run lint` | ESLint over the repository |
| `npm run typecheck` | TypeScript validation without emit |
| `npm test` | Unit/domain/CLI safety suite |
| `npm run test:integration` | Guarded isolated PostgreSQL integration suite |
| `npm run test:e2e` | Guarded Playwright browser suite on port 3200 |
| `npm run db:migrate -- --database-target <target>` | Apply append-only migrations after target validation |
| `npm run account:provision -- --help` | Account-provisioning usage without database access |
| `npm run account:provision -- --database-target <target> <flags>` | Transactionally provision one account with hidden password input |
| `npm run access:configure -- <command> --database-target <target> <flags>` | Administrator-controlled scope, assignment, responsibility, or entitlement record |
| `npm run approvals:reconcile -- --database-target <target> <flags>` | Dry-run-by-default pending-routing reconciliation; `--apply` is explicit |
| `npm run activations:reconcile -- --database-target <target> <flags>` | Dry-run-by-default 15-minute stuck activation reconciliation; `--apply` is explicit |
| `npm run activations:expire -- --database-target <target> <flags>` | Dry-run-by-default activated entitlement expiry; `--apply` is explicit |

Integration tests load local configuration, require only `TEST_DATABASE_URL`, delete inherited development/migration variables, validate PostgreSQL plus `_test`, recreate only the test schema, and run sequentially. Playwright has the same guard, uses port 3200, and one worker. Both are destructive to the configured test database.

Latest verified full run (2026-10-11, Node 22.23.2): `npm test` 98 passed, `npm run test:integration` 89 passed across the eight guarded files, `npm run test:e2e` 47 passed on Chromium, plus lint, typecheck, build, and `git diff --check`. The `test` script previously referenced a non-existent `tests/resource-catalog.test.ts`; that stale entry was removed, and unit suites were added for the catalog, delegation, identifier, reports, and notification-preference UIs. The governance integration suite was extended with authorization/aggregation/persistence cases for each.

**Browser-test connection pool:** `lib/server/db.ts` now gives the Playwright web server (`PERMORA_E2E_DATABASE=isolated-test`) a pool `max` of 4; the sequential integration runner keeps `max` 1 and production keeps 10. The former single-connection test pool self-contended (a mutation's transaction overlapping a concurrent page render timed out acquiring the one connection), producing intermittent `503`s.

**Manual-activation flake — root cause found and fixed (2026-10-11):** `tests/e2e/workflow.spec.ts` intermittently failed at the manual-activation assertion ("Access activation recorded." not visible). Playwright traces showed the activate `POST` returning `200` while the status text was absent, which ruled out a backend failure. The cause was a **client render race**: the success message was local state inside the per-row `ActivationControls`, and the post-activation `router.refresh()` transitioned the row to a terminal state and unmounted that component before the message reliably painted. The fix lifts the confirmation to the persistent `AdminActivationQueue` parent (`role="status"` alert) that survives the refresh; the test now asserts the queue-level message plus the row's `Active` state. After the fix it passed 10 consecutive isolated runs and in two full-suite runs. The earlier browser-test pool `max 1 -> 4` change also reduced a contributing connection-contention timeout. **Residual caveat (honest):** the first request after a code change triggers a Next dev recompile that can be slow, so 100% elimination under a cold dev server is not proven; this is a dev-harness warm-up effect rather than an activation-logic defect. Neon connects in ~1.2s standalone. The latest Node 22 Playwright result reported was 24 passed, 1 failed, and 0 skipped, before the workflow repeat-fixture isolation change; rerun before release. Targeted ESLint and `npm run typecheck` passed after the latest workflow fixture change; full lint and production build need rerunning before release. Integration and browser runners use only the guarded `_test` database and remove development/migration URLs from child processes.

`db:migrate` validates the selected target before using its migration connection, takes an advisory transaction lock, applies files lexically, and tracks `schema_migration`. Development and production require a matching runtime/migration pair; test uses only its guarded test URL. Inspect status safely with:

```sh
psql "$DATABASE_MIGRATION_URL" -c \
  'SELECT version, applied_at FROM schema_migration ORDER BY version;'
```

## J. Git workflow

- Protect `main`; use `feature/<topic>`, `fix/<topic>`, or `docs/<topic>` branches.
- Prefer conventional commits: `feat:`, `fix:`, `docs:`, `test:`, `chore:`.
- Use reviewed pull requests with security/database effects and validation documented.
- Synchronize with `git switch main`, `git pull --ff-only`, create a branch, then rebase/merge current `main` according to team policy. Coordinate any force push.
- Review migrations for locks, compatibility, backfills, ownership, constraints, indexes, and recovery.
- Never edit, reorder, or delete an applied migration. Add a numbered forward fix. For an already-applied defect, deploy a corrective migration rather than rewriting history.
- Never commit `.env.local`, `.kiro/`, `.vercel/`, outputs, exports, or credentials.

## K. GitHub publication checklist

Security audit recorded on 2026-09-21: `.env.local` and `.kiro/` were ignored; no live database URL, password, private key, session token, or production secret was found in the tracked-file scan. The full-history category scan found only superseded synthetic E2E literals. History was not rewritten. Re-run the publication checks on the exact commit to be published.

- [x] Current source contains no fixed E2E username, password, or auth secret; each guarded run generates ephemeral values or accepts explicitly test-only overrides.
- [x] Full-history filename/category audit completed without printing values. Earlier commits contain the superseded deterministic synthetic E2E credential category in `playwright.config.ts` and `tests/e2e/staff-fixture.ts`; no live-system credential was identified. History was not rewritten.
- [ ] Run a reviewed secret scanner over full Git history without printing values to shared logs.
- [ ] Confirm visibility, branch protection, required checks, ownership, and issue policy.

For a new fork or replacement repository, create an empty repository in the GitHub UI, then run:

```sh
git branch -M main
git remote add origin git@github.com:<owner>/<repository>.git
git remote -v
git push -u origin main
```

Or manually use authenticated GitHub CLI:

```sh
gh repo create <owner>/<repository> --private --source=. --remote=origin
git branch -M main
git push -u origin main
```

Use public visibility only after approval. Do not rewrite history. The repository now has an `origin`; the preparation task did not create it or run these publication commands.

## Deployment-readiness audit

| Check | Current result |
| --- | --- |
| Git | Existing repository; publication must use a reviewed clean commit. Confirm the active branch and worktree state at release time. |
| Sensitive local files | `.env.local` and `.kiro/` are present locally and ignored. Recheck ignored/tracked status and the complete working tree immediately before publication. |
| Tracked-secret scan | No likely live secret found; placeholder URLs exist in `.env.example`, an unreachable fallback exists in `lib/server/db.ts`, and historical synthetic test literals are categorized above. Current E2E credentials are ephemeral |
| Node/package configuration | npm with lockfile; Node 22 pinned in `.nvmrc` and `engines`; Next 15.5.25, React 19.3, TypeScript 5.9, Tailwind 4.3, Better Auth 1.7.5 |
| Build configuration | Standard Next.js defaults; no `next.config.*` or `vercel.json`; rerun the production build before release |
| Vercel compatibility | App Router and Node runtime are compatible; native Argon2 and `pg` require Node functions. Preview origin/database isolation and serverless connection sizing need deliberate configuration |
| Build-time variables | The build does not intentionally connect to PostgreSQL. Current fallbacks allow compilation without live credentials, but deployment environments should still define runtime variables before release validation |
| Runtime variables | `DATABASE_URL`, `AUTH_SECRET`, and exact `APP_URL`; production/preview values must be isolated. Migration and test variables are operational, not browser/runtime configuration |
| Localhost assumptions | `APP_URL` defaults to `http://localhost:3000` only when unset; tests/docs contain explicit local origins. Production validation requires an explicit HTTPS URL |
| Production migrations | Dedicated `npm run db:migrate` exists and is intentionally separate from build; production needs a protected manual/CI migration procedure |
| Health check | `GET /api/health` performs bounded `SELECT 1`; returns small generic `200`/`503` JSON with private/no-store headers and no infrastructure detail |
| Deferred-feature impact | Does not block a clearly labeled prototype preview. It blocks claiming a complete production access-control service because activation, recovery, notification delivery, admin maintenance, and monitoring are incomplete |

## L. Vercel deployment guide

1. Import the reviewed GitHub repository in Vercel; select the repository root.
2. Accept Next.js detection. Use `npm ci`, `npm run build`, and Node 22. Do not add migrations to the build command.
3. Configure Production `DATABASE_URL`, unique `AUTH_SECRET`, and exact HTTPS `APP_URL` against a dedicated production Neon branch.
4. Isolate Preview with its own non-production Neon branch and secret. Never share production/test databases.
5. Better Auth trusts exactly `APP_URL`. Use a stable preview alias/project or set the exact origin per deployment; arbitrary preview URLs otherwise fail origin checks.
6. Generate a unique production secret through an approved secret manager.
7. Use pooled Neon `DATABASE_URL` for Vercel runtime.
8. Use direct `DATABASE_MIGRATION_URL` only in a protected migration/provisioning environment, preferably not the Vercel runtime. Never expose it to browser code.
9. Back up production, validate on non-production, review pending SQL, inject both production database URLs into the current operator process, and explicitly run `npm run db:migrate -- --database-target production --confirm-production` once. Inspect `schema_migration`. Never run migrations on every Vercel build.
10. Bootstrap one production administrator from a secured operator machine using hidden password entry and `npm run account:provision -- --database-target production --confirm-production <account-flags>`. Never provision demo student/approver accounts in production.
11. Verify `/api/health`, login errors, logout revocation, ownership, assignee isolation, admin-only unassigned access, routing, decisions, audit history, `approved_pending_activation`, rate limiting, and absence of an active entitlement after approval.
12. Roll back application code through the Vercel dashboard or `vercel rollback <deployment-id>`/`vercel promote <previous-url>`. Migrations are forward-only: deploy a corrective migration or use authorized Neon PITR/restore, and keep application/schema versions compatible.

The health route is an availability probe, not a disclosure endpoint or substitute for monitoring. Deferred recovery, notification delivery, catalog-policy and governance UIs, and full observability block a complete production service. Production remains unchanged at the previously verified `0001`–`0006`; `0007`–`0013` remain pending there. The configured development database `neondb` is verified at `0001`–`0013`. Apply pending production migrations only through the controlled operator procedure before releasing this branch. Do not deploy until variables and databases are deliberately configured.

## M. Operational and security rules

- Passwords use hidden prompts and Argon2id; never pass, store, or log plaintext.
- No public registration. Bootstrap creates only the first administrator; later provisioning requires an active administrator UUID.
- Keep internal UUIDs separate from institutional identifiers. Users cannot self-assign roles, scopes, sections, projects, entitlements, or authority.
- Enforce identity, ownership, assignment, and full responsibility on the server.
- Preserve Better Auth CSRF/origin checks and database rate limiting. A reverse proxy must replace untrusted forwarding headers.
- Preserve the Better Auth 1.7.5 `rateLimit.id` schema.
- Commit decision, request version/status, assignment completion, immutable events, and notification atomically.
- Preserve optimistic versions and UUID idempotency; reject stale, duplicate, unauthorized, self, partial, and unassigned decisions.
- Activation is separate from approval: leave `access_request.status` at `approved_pending_activation`; use `request_activation` for lifecycle state.
- Activation must be initiated by a server-derived active administrator, never by the requester or the original approver (even if that approver is also an administrator).
- Keep the manual adapter call outside database transactions. Never treat `activating` as proof of downstream success; inspect external state before retrying.
- Use the dry-run-first lifecycle commands and the [activation operations runbook](docs/activation-operations.md). Do not directly mutate lifecycle/event tables to recover an attempt.
- Redact database URLs, secrets, passwords/hashes, cookies, tokens, institutional IDs, and unnecessary personal data from logs.
- Require an explicit database target for every database CLI. Production requires both process-level URLs plus `--confirm-production`; development still rejects mixed endpoints.
- Define backup retention, RPO/RTO, restore authority, and periodic isolated restore tests.

## N. Troubleshooting

| Problem | Resolution |
| --- | --- |
| Better Auth `Invalid origin` locally | Match browser scheme/host/port to `APP_URL`; restart Next.js. |
| Missing `TEST_DATABASE_URL` | Add it to local/CI secrets; tests never fall back. |
| Test database does not end `_test` | Create/select an isolated `_test` database; never bypass the guard. |
| Neon cold start/transient closure | Confirm branch/compute, then retry once. Diagnose persistent failures; do not start with broad retries, sleeps, or larger pools. |
| Migration failure | Confirm intended direct URL and schema-owner rights; inspect sanitized error and tracking table; fix with a new migration. |
| Database endpoints do not match | Supply runtime and migration URLs for the same protocol, database, and Neon branch. Different database roles are allowed; values are never echoed. |
| `pending_routing` | Configure a non-self full-scope responsibility; run reconciliation dry-run first, then explicitly add `--apply` after review. |
| Activation stuck in `activating` | Follow [activation-operations.md](docs/activation-operations.md); preview `activations:reconcile`, verify the target system, and apply only after review. Never blindly repeat provisioning. |
| Activation failed | Check whether the failure is retryable and current policy still permits access. Verify downstream state before the UI retry; definitive failures require a new eligibility review/request. |
| Activated access is past validity | Preview `activations:expire`, review candidates, then explicitly apply. The CLI is not automatically scheduled yet. |
| Port 3000 occupied | Pick another port and update `APP_URL` to the exact origin. |
| Admin/approver navigation limited | Confirm active profile, trusted role, and current responsibility. Admin alone does not grant review scope. |
| Vercel origin mismatch | Set exact HTTPS `APP_URL` for that deployment and redeploy. Ensure preview isolation. |
| `/api/health` returns 503 | Confirm the runtime database variable, Neon branch/compute, and connectivity. The response intentionally omits internal details; use protected server/Neon logs. |

Development reconciliation example: `npm run approvals:reconcile -- --database-target development --confirm-database-name <development-database-name>`; add `--apply` only after inspecting the dry run. Production also requires `--confirm-production` and both URLs in the current process.

## Current handoff — dedicated-first routing

- Default routing policy: `dedicated_only`; do not enable Admin fallback without documented policy approval.
- Reassignment endpoint: `POST /api/admin/review-requests/[id]/reassign`; body uses `responsibilityId` and `expectedVersion`.
- Reassignment is intentionally not bulk-applied. Review the dry-run report before any individual development operation.
- Development migration status is `0001`–`0012`; migration `0012_request_reassignment_event.sql` was applied transactionally to verified database `neondb` on October 19, 2026. It remains unapplied in production.
- Activation queue clarification: `REQ-2026-000032` was present in the database and returned by the Admin activation read service after approval; the missing display was caused by an already-open stale Admin tab. The queue now refreshes on focus, visibility change, and a 15-second visible interval. Do not infer missing approval from an unchanged tab; reload or wait for the refresh before investigating data.
- The October 19 read-only dry run found four `pending_review` requests: three already assigned to `approver@permora.ph` (no-op conflicts), and `REQ-2026-000016` assigned to `admin@permora.ph`, with `approver@permora.ph` eligible as the proposed replacement. No records changed.
- Full E2E stabilization (October 19): the two setup failures were caused by a transient `ECONNRESET` on the first Better Auth sign-in POST while Next.js dev compilation/HMR was active. The bounded shared fixture sign-in retry preserves the real UI and auth assertion; the complete suite passed 71/71 with no skips. The isolated `_test` database was reset only by the existing browser global setup.
- Activation lifecycle consistency (October 19): `REQ-2026-000034` is internally approved plus activated/provisioned, but its February 27–28, 2027 validity is future-dated. All role surfaces now show `Provisioned — scheduled start`; only the requested start date controls present usability. The Admin activation form expands full-width beneath its row. No migration or request mutation was needed. Verification passed: 133 unit, 114 integration, and 71 Playwright tests.

## O. Team handoff checklist

- [ ] GitHub access granted with least privilege.
- [ ] Neon production/development/test roles and least-privilege access assigned.
- [ ] Vercel team/project access assigned.
- [ ] Figma access confirmed.
- [ ] Environment values transferred through a secret manager, never chat/Git.
- [ ] Local install, migration, login, and requester flow confirmed.
- [ ] Migration versions confirmed per environment.
- [ ] Unit, integration, E2E, lint, typecheck, build, and diff checks pass.
- [ ] Administrator, requester, approver responsibility, ownership, and routing verified.
- [ ] Owners named for auth, DB/migrations, policy, activation, security, operations, design, and next milestone.
- [x] Current fixed E2E credentials removed and full-history filename/category audit completed without exposing values.
- [ ] Production readiness explicitly approved and pilot limitations communicated.
