# Permora

Permora is a secure access-request and approval application for students, faculty, approvers, and administrators. It uses Next.js 15, React 19, TypeScript, Tailwind CSS 4, Better Auth email/password sessions, and PostgreSQL. The current application supports owner-scoped requests, deterministic full-scope approval routing, protected staff review, and transactional decisions. Approval remains separate from access activation.

Read [HANDOFF.md](HANDOFF.md) before publishing, provisioning accounts, running migrations, or preparing a deployment. Current coverage and limitations are tracked in [docs/implementation-status.md](docs/implementation-status.md).

## Local start

Use Node.js 22 LTS, pinned by `.nvmrc` and `engines.node`, with isolated development/test databases:

```sh
npm ci
cp .env.example .env.local
# Replace placeholders locally; never commit .env.local.
npm run db:migrate
npm run dev
```

Open the exact origin configured in `APP_URL`, normally `http://localhost:3000/login`. Accounts are provisioned by an authorized administrator; there is no public registration or demo login in the real application flow.

## Checks

```sh
npm test
npm run test:integration
npm run test:e2e
npm run lint
npm run typecheck
npm run build
git diff --check
```

Integration and browser tests destructively reset only a guarded `TEST_DATABASE_URL` database whose name ends in `_test`. They never fall back to development or production.
Playwright generates fresh account emails, a password, and an auth secret in memory for each run; no reusable test credential is stored in source. `GET /api/health` returns a private, non-cacheable `200` when the app and database are available, or a generic `503` otherwise.

## References

- [Project handoff and deployment guide](HANDOFF.md)
- [Implementation status](docs/implementation-status.md)
- [Resource access matrix](docs/resource-access-matrix.md)
- [Stage 2B plan](docs/stage-2b-plan.md)
- [Design system](docs/design-system.md)
- [Implementation rules](docs/design-system-rules.md)
