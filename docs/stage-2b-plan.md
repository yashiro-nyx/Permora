# Permora Stage 2B plan: approval workflow

Updated 2026-09-29. Stage 2B Milestones 1–5 and the Stage 2C activation foundation/lifecycle/UI slices are implemented. This document records approval and activation evidence while preserving the boundary that a manual attestation is not a university-system integration.

## 1. Current administrator and approver implementation audit

| Area | Status | Implemented evidence |
| --- | --- | --- |
| Authentication and admission | **Completed** | Better Auth email/password, Argon2id, revocable PostgreSQL sessions, active-profile admission, origin/CSRF checks, and database rate limiting. |
| Server role guards | **Completed** | `requireAdmin()` and `requireApprover()` load identity, active state, roles, and responsibilities from the server session/database. |
| Staff dashboard | **Completed** | `/dashboard` shows responsibility-scoped counts/recent assignments; administrators also see unassigned-routing count. |
| Assigned review queue | **Completed** | `/review` supports validated search/status/resource/date filters, bounded pagination, deterministic ordering, empty/loading/error states, and terminal history. |
| Review details and decisions | **Completed** | `/review/[id]` exposes sanitized details/history and accessible approve, deny, and return dialogs backed by the transactional decision endpoint. |
| Unassigned routing failures | **Completed, read-only** | `/admin/unassigned` and `GET /api/admin/unassigned-requests` are administrator-only; unassigned requests cannot be decided. |
| Requester decision visibility | **Completed** | Owner-scoped request list/detail/count/timeline expose persisted results and requested validity. |
| Requester notifications | **Completed, in-app only** | `/notifications` and its APIs support owner-scoped All/Unread reads and read-state mutations. No external delivery exists. |
| Administrator audit history | **Completed, read-only** | `/audit` and `GET /api/admin/audit-events` provide sanitized filters/pagination; update/delete/export are unavailable. |
| Activation lifecycle | **Completed, manual adapter** | `/admin/activations`, `POST /api/admin/activations/[id]/activate`, transactional eligibility revalidation, separate activation state, entitlement/event/notification outcome, dry-run reconciliation and expiry scripts. No external university adapter or automatic scheduler is configured. |
| Requester activation status | **Completed** | Owner-scoped request detail joins activation lifecycle state; activation success/failure is shown in the timeline and in-app notification center. Approval status remains unchanged. |
| User/resource/policy administration | **Planned** | `/users` and `/resources` are guarded deferred pages. Current maintenance uses controlled CLI/migrations. |
| Entitlement administration | **Planned** | `/permissions` remains deferred. Activation is handled separately through `/admin/activations`; approval alone creates no entitlement or active access. |
| Reports/analytics | **Planned** | `/reports` is a guarded deferred page. |
| Revision resubmission | **Planned** | Return is persisted as a terminal decision, but a linked revise-and-resubmit UI is not implemented. |

Historical Figma frames `7:5`, `7:447`, `3:1257`, `3:2061`, and `7:1998` supplied desktop visual language. They do not prove mobile behavior, real security checks, external delivery, or activation. Implemented mobile layouts, dialogs, error states, and keyboard behavior are proposed accessibility adaptations.

## 2. Administrator routes and components

| Route/API | Server access | Current purpose |
| --- | --- | --- |
| `/dashboard` | Active identity; staff data additionally responsibility/admin scoped | Staff workload summary and recent assigned reviews. |
| `/review` | Active approver/admin with a current responsibility | Assigned review queue. |
| `/review/[id]` | Same role plus persisted assignment and full current responsibility coverage | Sanitized detail and decisions while `pending_review`; terminal records remain read-only. |
| `GET /api/review/requests` | Same as queue | Private/no-store queue DTOs. |
| `GET /api/review/requests/[id]` | Same as detail | Private/no-store enumeration-resistant detail DTO. |
| `POST /api/review/requests/[id]/decision` | Persisted assignee with current full coverage | Transactional approve, deny, or return. |
| `/admin/unassigned` | Active administrator | Read-only routing failures. |
| `GET /api/admin/unassigned-requests` | Active administrator | Private/no-store unassigned DTOs. |
| `/admin/activations` | Active administrator | Approved request lifecycle queue, manual provisioning confirmation, activation status and retryable failures. |
| `POST /api/admin/activations/[id]/activate` | Active administrator; actor cannot be requester or original approver | Same-origin manual confirmation; core validation in transaction 1, adapter outside transactions, atomic outcome in transaction 2. |
| `/audit` | Active administrator | Sanitized immutable event history. |
| `GET /api/admin/audit-events` | Active administrator | Private/no-store audit DTOs. |
| `/notifications` | Active student/faculty requester | Owner-scoped in-app notification center. |
| `GET/POST /api/notifications/*` | Active requester; mutations also same-origin JSON | Notification reads and idempotent read-state changes. |
| `/users`, `/resources`, `/permissions`, `/reports` | Active administrator | Explicit deferred feature pages with no simulated success. |

Implemented component boundaries include `StaffDashboard`, `StaffReviewQueue`, `StaffReviewDetail`, `ReviewDecisionPanel`, `RequesterNotifications`, and `AdministratorAuditLog`. Server Components load protected data; Client Components handle disclosures, filters, dialogs, pending state, and read-state mutations. DTOs exclude credentials, sessions, password data, raw audit metadata, internal policy/responsibility identifiers not needed by the client, and unrelated personal information.

## 3. Approval state machine, including Start and End states

```mermaid
stateDiagram-v2
  [*] --> SubmissionValidation: requester submits
  SubmissionValidation --> [*]: invalid identity, policy, scope, dates, entitlement, or conflict\nsubmission rolls back
  SubmissionValidation --> PendingRouting: no fully eligible approver\nrequest and unavailable evidence commit
  SubmissionValidation --> PendingReview: request, route, history, audit commit
  PendingRouting --> PendingReview: controlled reconciliation assigns approver
  PendingRouting --> PendingRouting: no fully eligible approver
  PendingReview --> ApprovedPendingActivation: approve
  PendingReview --> Denied: deny with reason
  PendingReview --> ReturnedForRevision: return with reason
  ApprovedPendingActivation --> Activating: transaction 1 commits lifecycle start
  Activating --> Activated: manual adapter confirms provisioned; transaction 2 commits
  Activating --> Failed: adapter or revalidation failure; transaction 2 commits
  Failed --> Activating: retryable only; new actor idempotency key
  Activated --> Expired: expiry script after validity window
  Activated --> Revoked: deliberate administrator service operation
  Expired --> [*]
  Revoked --> [*]
  Denied --> [*]: end
  ReturnedForRevision --> [*]: reviewed version remains immutable
```

`access_request.status` remains `approved_pending_activation` after activation starts, succeeds, fails, expires, or is revoked: it records the immutable approval decision. The separate `request_activation.status` is authoritative for lifecycle state (`activating`, `activated`, `failed`, `expired`, or `revoked`). Requester/admin status views join the activation record rather than rewriting the approval status. Legacy request status `expired` remains valid for historical/renewal-compatible records.

A returned request is not reopened. Future revision work must create a new `revision_of` request and repeat current validation/routing. Renewals similarly create a new `renewal_of` request and never reactivate an old record.

## 4. Authorization rules

1. Every protected operation begins with the Better Auth session and active PostgreSQL profile.
2. Requester reads/mutations derive the owner from the session and always scope by requester user ID.
3. Review access requires an approver/admin role, a current responsibility covering the resource, permission, and every requested scope, and the persisted assignment to that user.
4. Administrator role grants administrator routes only. It does not grant a global review or decision bypass.
5. Self-approval and partial responsibility matches are prohibited.
6. Browser-supplied actor, requester, role, status, scope, assignee, responsibility, policy, entitlement, or activation authority is ignored or rejected.
7. Denial and return require a trimmed non-empty reason. Approval may omit a comment.
8. Approval revalidates requester activity/role/assignments, resource/permission/policy, dates, scopes, ordinary entitlements, and overlapping approved requests.
9. Unauthorized and nonexistent detail IDs use equivalent responses where revealing existence would permit enumeration.
10. Notification reads and mutations are recipient scoped. Audit reads are administrator-only and return sanitized summaries.
11. Activation requires a server-derived active administrator checked inside transaction 1. Neither the requester nor the original approver may activate, even if the original approver also has an administrator role.

## 5. Approver routing rules

The initial release uses exactly one persisted approver assignment.

1. Load active approver/admin candidates with a current responsibility for the exact resource.
2. Apply any permission constraint and require responsibility coverage for every requested scope.
3. Exclude the requester.
4. Select the candidate with the fewest open assignments.
5. Use stable approver UUID ordering as the tie-breaker.
6. Persist the selected assignment and route event in the submission transaction.
7. Preserve every unrouteable request as `pending_routing`; it remains visible to administrators and cannot be decided.
8. Reconciliation is dry-run by default and changes data only with explicit `--apply`.

Delegation, reassignment, escalation, pooled review, unanimous review, and multi-stage review are deferred.

## 6. Database changes implemented

- `0004_stage_2b_approval_foundation.sql`: status/version/revision fields, responsibility-scope junction, one active review assignment, decision table, request events, immutable triggers, and review indexes.
- `0005_enforce_approval_decision_reason.sql`: consistent denial/return reason constraints.
- `0006_stage_2b_decision_operations.sql`: UUID idempotency keys and recipient-scoped `user_notification` records/indexes.
- `0007_stage_2c_activation_foundation.sql`: separate request activation lifecycle and immutable activation events; extends request-event/notification outcome types. It was applied first to guarded `_test`; earlier migrations remain unchanged.

The migration sequence is append-only. Approval still creates no entitlement; only successful activation writes an `ordinary_entitlement`.

## 7. Transaction and concurrency strategy

Submission takes a requester/resource advisory transaction lock, validates canonical data, inserts the request/scopes/history/audit evidence, attempts route selection, and persists an assignment when available. Invalid eligibility/policy/conflict data rolls back without a partial request. If no candidate exists, the transaction preserves `pending_routing` plus routing-unavailable request/audit events; the record remains non-actionable.

Decision processing:

1. validates same-origin JSON, decision input, positive expected version, and UUID idempotency key;
2. serializes an actor/idempotency pair and returns the prior stored result only for an identical replay;
3. locks the request and loads the current assignment/responsibility;
4. checks `pending_review`, persisted assignee, full responsibility coverage, and version;
5. revalidates approval-specific eligibility/policy/conflicts;
6. inserts the decision, updates state/version, completes the assignment, and inserts request event, audit event, and requester notification;
7. commits all effects together or rolls all of them back.

A stale or competing decision receives a conflict response and cannot duplicate state, events, or notifications. Database connection retries are bounded to recognized transient acquisition failures; write transactions are never replayed automatically.

Activation is split across two database transactions with the adapter call between them. Transaction 1 verifies the active administrator/separation-of-duties rule, approved state, current requester role/assignment, resource/permission/scope and policy version, dates, entitlement/approved-request conflicts, then commits `activating` plus actor-scoped idempotency key. The adapter runs outside the transaction. Transaction 2 records success (entitlement, immutable activation/request/audit events, requester notification, activated state) or failure (immutable events, notification, failed state) atomically. Replays of the same actor/key return the stored attempt outcome. A failure is retryable only when its immutable event says so; retry uses a fresh per-actor key.

## 8. Audit-event requirements

Implemented decision transactions record actor, requester subject, request, event type, prior/new state, policy/assignment/responsibility evidence, and minimal metadata in the same transaction. Request decisions, request events, and audit events are protected by database immutability triggers.

The audit API returns only event ID/time/type, safe actor display, optional request/resource target, and a human-readable summary. It excludes raw metadata, credentials, sessions, hashes, secrets, database details, and unrelated personal information.

Still unresolved: retention and deletion authority, legal hold, redaction, export format/authorization, whether reads require access logging, and external monitoring integration.

## 9. Requester-visible status behavior

| Stored state | Requester label and behavior |
| --- | --- |
| `pending_routing` | Pending configuration. Preserved but not reviewable until a fully eligible approver is assigned. |
| `pending_review` | Pending review. Timeline shows persisted submission and assignment events. |
| `approved_pending_activation` with no activation row | Approved — awaiting activation. Approval state remains stored here; no active access is implied. |
| activation `activating` | Activation in progress. The request approval status remains `approved_pending_activation`. |
| activation `activated` | Active. Requester detail shows lifecycle status and validity; success appears in the timeline and owner-scoped in-app notification. |
| activation `failed` | Activation failed. Retry is offered only if the stored failure is retryable; the requester receives an in-app failure notification. |
| activation `expired` / `revoked` | Terminal lifecycle result; old approval state remains unchanged. Renewal creates a new linked request, not an extension in place. |
| `denied` | Denied. Shows the persisted public reason and timestamp. |
| `returned_for_revision` | Revision requested. Shows the reason; linked resubmission remains planned. |
| `cancelled` | Read-only terminal history. Cancellation operation is not implemented. |
| `expired` | Historical/renewal-compatible state. Current Stage 2B does not fabricate expiration from approval. |

Expiration is recorded only when the dry-run-first expiry script is applied after the validity end; the CLI is not automatically scheduled. Notification records distinguish approval from activation outcomes and never claim external delivery.

## 10. Test strategy and current coverage

Current automated coverage includes:

- routing full-scope/partial-scope behavior, deterministic load balancing, self-exclusion, no-approver handling, reconciliation, transitions, optimistic concurrency, and atomic audit creation;
- authentication, rate limiting, session expiration/revocation, owner isolation, forged client input, catalog validation, renewal persistence, and database failure mapping;
- queue/detail authorization, admin boundaries, enumeration resistance, sanitized DTOs, filters, pagination, deterministic ordering, and unavailable-service responses;
- decision origin/role/assignment/scope checks, reasons, idempotency, stale/concurrent decisions, revalidation, atomic notification/audit rollback, and no entitlement creation;
- notification ownership/read state and administrator audit filtering/sanitization;
- Playwright requester, staff, manual admin activation/requester status and notification, audit, health, desktop, 768px, 390px, and 320px paths.
- combined PostgreSQL lifecycle flow: retryable failure, new-key retry, successful entitlement/event/notification, expiry, new linked renewal request, and separate revocation branch.

The latest repository verification on 2026-10-09 passed 63 unit tests, 83 isolated PostgreSQL integration tests, and 26 Playwright tests, plus lint, typecheck, the production build, and `git diff --check`, under Node.js 24.21.0. Repeat the suite under the pinned Node.js 22 runtime before release. Integration/E2E data comes only from the guarded `_test` database.

Still required before a production claim: screen-reader/browser-matrix accessibility work, load/resilience testing, backup/restore exercise, security review, monitoring/alerting, automatic job scheduling, and integration with real university systems.

## 11. Ordered implementation milestones

1. **Completed — approval domain and database foundation.**
2. **Completed — server authorization and read model.**
3. **Completed — transactional decisions.**
4. **Completed — staff review UI.**
5. **Completed — requester notifications and administrator audit visibility.**
6. **Completed — activation lifecycle foundation, manual adapter, revalidation/outcome transactions, retry/reconciliation, expiry/revocation boundary, administrator controls, and requester lifecycle visibility.**
7. **Completed — combined lifecycle integration/browser coverage and [manual recovery runbook](activation-operations.md).**
8. **Planned — administrator maintenance and institutional integrations:** user/assignment/policy UI, external notification delivery, audit governance, real provisioning adapters, scheduled job infrastructure, monitoring, and operational ownership.

## 12. Risks, assumptions, and unresolved policy decisions

Approved initial policies reflected in code: one stage; one fully eligible persisted assignee; every scope must be covered; self-approval prohibited; no administrator review bypass; fewest-open/stable-UUID routing; unassigned fail-closed; denial/return reason required; optimistic concurrency; approval stops before activation.

Unresolved decisions:

- named university provisioning owners, real adapter behavior, production evidence policy, and automatic job scheduling/monitoring;
- whether grading/high-sensitivity resources require additional stages or separation of duties;
- delegation, reassignment, escalation deadlines, out-of-office handling, cancellation, and approver-adjusted dates;
- revision/resubmission behavior and any minimum denial/return reason length beyond non-empty;
- institutional sources for enrollment, teaching assignments, employment, projects, lab training, licenses, and ordinary entitlements;
- audit retention/export/redaction/legal hold and external notification delivery/preferences;
- final catalog durations, renewal limits, Student Portal exception handling, and canonical institutional labels.

Material boundary: current institutional data is administrator-maintained. Approval is a decision only. No code may infer entitlement or active access from `approved_pending_activation`.
