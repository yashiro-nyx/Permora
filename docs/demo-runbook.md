# Permora local demonstration runbook

A reliable, repeatable local demo of Permora on the development database. This
runbook targets a presenter running the app locally (not the deployed Vercel
prototype, which does not yet contain the latest features).

> Scope: **local development only.** Do not run any step against the production
> Neon branch. Every database CLI requires an explicit `--database-target` and
> development commands reject mixed endpoints.

## 0. Prerequisites (verified 2026-10-11)

- **Node.js 22** (`.nvmrc` pins `22`). Activate with `nvm use` (or `nvm use 22`).
- `.env.local` present with `APP_URL`, `DATABASE_URL`, `DATABASE_MIGRATION_URL`,
  `TEST_DATABASE_URL`, `AUTH_SECRET`. The development `DATABASE_URL` points at the
  Neon development database `neondb`.
- Dependencies installed for this platform: run `npm ci` once if `node_modules`
  was created on a different OS/architecture.
- Verified state of the development database (`neondb`):
  - Migrations `0001`–`0009` are **all applied**.
  - Four active, credentialed demo accounts exist (one per role).
  - Seed data: three `pending_review` requests, one `approved_pending_activation`,
    one already `activated`, four approver responsibilities, two requester
    eligibility assignments.

## 1. Start the application

```sh
nvm use 22
npm run dev
# Open the exact origin in APP_URL, normally http://localhost:3000/login
```

Confirm readiness before presenting:

```sh
curl -s http://localhost:3000/api/health
# Expect: {"status":"ok","application":"available","database":"available"}
```

If health returns `503` on the first call, it is almost always a Neon cold
start — wait ~5–10 seconds and retry (see Recovery).

## 2. Demonstration accounts

Passwords are operator-held secrets and are **not** stored in this document.
Keep them in a password manager and have them ready before the demo.

| Role | Email | Demonstrates |
| --- | --- | --- |
| Student (requester) | `student@permora.ph` | Submission, My Requests, notifications, password change |
| Faculty (requester) | `faculty@permora.ph` | Faculty-eligible requests (optional) |
| Approver | `approver@permora.ph` | Review queue and approve/deny/return decisions |
| Administrator | `admin@permora.ph` | Activation, all admin maintenance pages, audit |

Open the demo in two browser profiles/windows (one requester, one admin/approver)
so you can show both sides of the workflow without re-logging-in.

## 3. Demonstration sequence and expected outcomes

Each step lists what to click and what the audience should see.

1. **Login (any account).** `/login` → sign in. Expected: redirect to
   `/dashboard` with role-appropriate navigation. A wrong password shows a
   generic "invalid credentials" message (no account enumeration).

2. **Requester submits a request (student).** `/requests/new` → choose a
   resource/permission/scope, purpose, start and expiration dates → submit.
   Expected: the request is created and routed; it appears in `/requests` as
   `Pending review` (or `Pending configuration` if no fully eligible approver).

3. **My Requests + details (student).** `/requests` → open the new request.
   Expected: owner-scoped list, filters, status badge, and a persisted timeline.

4. **Approval decision (approver).** `/review` → open a `pending_review` request
   → Approve (or Deny/Return with a reason). Expected: a confirmation dialog,
   then the request becomes `Approved — awaiting activation`. The decision and an
   immutable audit event are recorded. (Three `pending_review` requests are
   pre-seeded if you prefer not to submit a new one.)

5. **Administrator activation (admin).** `/admin/activations` → find the
   `approved_pending_activation` request → "Start activation" → check the
   confirmation box, enter an external reference → "Record activation".
   Expected: a queue-level "Access activation recorded." status and the row moves
   to `Active`. **Emphasize: approval alone did not grant access; activation is a
   separate, server-checked step and the admin cannot activate their own or an
   already-approved request.**

6. **Active access (requester).** As the requester, open the activated request
   (one is pre-seeded as `activated`). Expected: the request shows `Active`, and
   the notification center shows an "Access activated" entry.

7. **Expiration (admin, conceptual + safe demo).** Explain that activated access
   expires automatically at its authorized `expires_at`. Two safe ways to show
   it without editing production:
   - **CLI dry run:** `npm run activations:expire -- --database-target development --confirm-database-name neondb`
     (dry run by default; shows how many would expire, changes nothing). Add
     `--apply` only if you want to demonstrate a real local expiry.
   - **Endpoint (optional):** `POST /api/maintenance/expire-activations` is a
     protected scheduled endpoint; it is disabled (`503`) unless
     `MAINTENANCE_SCHEDULER_SECRET` is set, so mention it as the automation path
     rather than triggering it live.
   Expected (if `--apply`): the activation moves to `expired` with an immutable
   event; revoked and approved-but-not-activated records are untouched.

8. **Password change (any account).** `/account/password` → enter current
   password, type a new one. Expected: the live four-level strength indicator
   (Weak/Fair/Good/Strong) updates as you type, the requirements checklist ticks
   off (≥12 chars, ≤128, differs, matches), Show/Hide reveals the fields, and the
   Change button stays disabled until all mandatory requirements are met. On
   submit, other sessions are revoked and a success message appears.
   > Tip: if you change a demo account's password live, note the new value — the
   > old one no longer works and other sessions are signed out.

9. **Notification preferences (any account).** `/account/notifications` → toggle
   in-app notifications and Save. Expected: in-app is editable; email/SMS/push are
   shown disabled and marked "Not available yet" (external delivery is not
   configured and the server rejects enabling it).

10. **Administrator maintenance pages (admin).** Visit each and show live data:
    - `/users` — account directory, create/edit, activate/deactivate, invitations.
    - `/admin/responsibilities` — approver responsibilities (add/end, resource-wide confirmation).
    - `/admin/unassigned` — eligible assignment of pending-routing requests.
    - `/resources` and `/permissions` — catalog availability toggles and scope-option creation.
    - `/admin/delegations` — absence delegations (create/cancel).
    - `/admin/identifiers` — per-account institutional identifier maintenance.
    - `/reports` — read-only analytics dashboard (request/activation/entitlement metrics).
    - `/admin/retention` — retention classes and non-destructive dry-run previews only.
    - `/audit` — sanitized, read-only audit history.

11. **Role boundary (optional).** As the approver or student, visit an admin URL
    (e.g. `/admin/retention`). Expected: redirect to
    `/dashboard?unavailable=administrator` — the server enforces authorization, not
    the hidden navigation.

## 4. Recovery procedures

- **Failed login / forgotten demo password.** There is no self-service password
  recovery (deferred — no email delivery). Re-provision or reset a demo account's
  password from a secured operator machine against development only, e.g.
  `npm run account:provision -- --help` for usage, or change it after logging in
  via `/account/password`. Never run provisioning against production.

- **Cold database connection (health `503`, slow first request).** Neon
  development compute may be suspended. Wait ~5–10 seconds and retry
  `curl http://localhost:3000/api/health`. The first request after idle wakes the
  compute; subsequent requests are fast. Pre-warm by loading `/login` and
  `/api/health` a minute before presenting.

- **Interrupted demo / server stopped.** Restart with `npm run dev` and re-open
  `APP_URL`. Server sessions persist in PostgreSQL, so you remain logged in across
  a restart unless the session expired (8-hour expiry). If a port 3000 conflict
  occurs, update `APP_URL` to the alternate origin and run
  `npm run dev -- --port <port>` (Better Auth trusts exactly `APP_URL`).

- **Accidental data change during the demo.** All demo mutations are on the
  development database only; nothing touches production. To reset to a clean demo
  state, re-seed development deliberately (do not run fixtures against prod/test).

- **"Invalid origin" after changing ports.** Match the browser scheme/host/port
  to `APP_URL` exactly and restart `npm run dev`.

## 5. What is NOT in this demo (be transparent)

- The deployed Vercel site does **not** yet contain the latest features (this
  session's work is local only). Demo locally.
- Password recovery, MFA, and SSO are deferred (require email/IdP infrastructure).
- External email/SMS/push notification delivery is not implemented (in-app only).
- Automatic expiration runs via a protected endpoint but is not wired to a live
  schedule; the dry-run CLI is the safe demonstration path.
- Real university data integrations are not connected; catalog policy values are
  provisional.
