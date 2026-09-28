# Permora proposed resource access matrix

Updated 2026-09-28. These are proposed Permora rules for a Philippine university context, not official policy of any institution. Product, registrar, academic, library, research, laboratory, privacy, security, and IT owners must approve them before real institutional use.

PostgreSQL catalog policy seeded by [migration 0002](../db/migrations/0002_catalog_v1.sql) is authoritative for the current server workflow. The typed [prototype catalog](../lib/resource-catalog.ts) remains for historical tests only. Stable resource/permission IDs are persisted; display labels may evolve without changing meaning.

## Resources, permissions, scopes, and validity

| Resource | Eligible role and permission IDs | Required scope | Proposed validity |
| --- | --- | --- | --- |
| Learning Management System (`r-lms`) | Student: `lms:course-participation`. Faculty: `lms:assigned-teaching`. | One administrator-recorded `courseSection`. | Default 30 days, maximum 90, renewable. |
| Student Portal (`r-student-portal`) | Student: `portal:view-own-academic-information`. | Server-fixed to `own-account:<authenticated UUID>`; no editable student identifier. | Default 7 days, maximum 30, not renewable. |
| Faculty Grading System (`r-faculty-grading`) | Faculty: `grading:encode-assigned-section`, `grading:submit-assigned-section`. | One administrator-recorded `courseSection`. | Default 14 days, maximum 60, renewable after reassessment. |
| Library E-Resources (`r-library`) | Student/faculty: `library:subscribed-materials`. Faculty: `library:restricted-collections`. | No requester scope field in policy version 1; responsibility may be resource/permission wide. | Default 30 days, maximum 90, renewable. |
| Computer Laboratory Systems (`r-lab`) | Student/faculty: `lab:designated-account`, `lab:course-software`. | Administrator-recorded `laboratory` and `software` values; both are required by the seeded schema. | Default 14 days, maximum 60, renewable. |
| Research Project Workspace (`r-research-workspace`) | Student/faculty: `research:view-project`, `research:contribute-project`. Faculty: `research:manage-project-files`. | One administrator-recorded `researchProject`. | Default 30 days, maximum 90, renewable. |

All requests require an explicit start and expiration date. The server rejects a start in the past, an expiration on/before start, and duration beyond the active policy maximum. Stored timestamps currently use 09:00 UTC for submitted date-only values; final institutional timezone/valid-through semantics remain a policy decision.

## Ordinary access and requestable exceptions

Enrollment/employment access should be represented as an active `ordinary_entitlement`. A matching ordinary entitlement blocks a duplicate request. Permora is intended for missing, additional, restricted, or temporary access:

- LMS: missing/cross-listed/temporary participation or assigned teaching.
- Student Portal: an own-account exception only, never access to another student's record.
- Faculty Grading: a verified assigned-section exception during an allowed grading window.
- Library: affiliation/license-based subscribed material or faculty restricted collection.
- Laboratory: one designated laboratory account/environment and approved software.
- Research: the selected project only, bounded by current project membership/data-use approval.

Approval does not activate any of these systems. It produces `approved_pending_activation` and must later be consumed by an authorized activation/provisioning workflow that does not yet exist.

## Proposed approver responsibilities

| Resource | Proposed responsibility |
| --- | --- |
| LMS | Course owner or academic unit verifies enrollment/teaching assignment and cross-unit exception. |
| Student Portal | Registrar verifies active student status and own-account identity; IT handles account restoration. |
| Faculty Grading | Academic unit verifies teaching assignment/capability; registrar controls formal submission windows. |
| Library | Library access owner verifies affiliation, licenses, and restricted-collection eligibility. |
| Laboratory | Lab coordinator verifies activity, prerequisites, location, and license capacity. |
| Research | Project owner verifies membership/minimum privilege; data steward covers sensitive datasets and retention. |

The implemented responsibility model can constrain resource, optional permission, and all selected canonical scope options. Routing excludes the requester, requires every requested scope to be covered, selects the eligible approver with the fewest open assignments, and uses stable UUID order to break ties. Administrators have no approval bypass without their own matching responsibility.

## Implemented server enforcement

- Identity, active state, requester role, ownership, and staff roles come from Better Auth sessions and PostgreSQL.
- Available resources/permissions come from current enabled policy rows for the server-recorded requester role.
- Required scope choices come only from active `requester_assignment` plus active canonical `scope_option` rows.
- Student Portal scope is constructed from the authenticated internal UUID.
- The server validates dates, maximum duration, resource/permission availability, assignments, ordinary entitlements, duplicate/overlapping pending requests, renewal ownership, and routing inside the submission transaction.
- New submission and routing attempt commit together. A missing required requester assignment blocks submission. If no fully eligible approver exists, the request remains visibly `pending_routing` and cannot be reviewed or decided until controlled reconciliation assigns one.
- Renewals require an owned expired source, a renewable current policy, identical resource/permission/scope, and all current checks.
- Approval revalidates current requester activity/role, policy, scopes/assignments, dates, ordinary entitlements, and conflicting approved requests.
- Only the persisted assignee with current full responsibility coverage can decide. Self-approval and partial-scope approval fail closed.
- Request/decision/event/notification/audit writes are transactional. Approval creates no `ordinary_entitlement` and no activation event.

Administrator-maintained assignments and entitlements are trusted configuration until institutional integrations exist. The server can verify that a record exists and is current; it cannot independently prove the university source evidence is correct.

## Historical records

The old browser prototype migrated its localStorage schema in place and retained legacy resource IDs such as `r-vpn`, `r-records`, and `r-drive`. Those browser records and legacy placeholder scopes are not imported into PostgreSQL and must never become trusted assignments, entitlements, approvals, or audit evidence automatically.

Current PostgreSQL records use stable catalog IDs from migration `0002`. Applied migration data is preserved; future catalog changes require additive/versioned policy changes rather than silently resetting requests.

## Checks still required in future services

- Verify administrator-entered enrollment, teaching, project, laboratory, training, license, and ordinary-entitlement records against approved institutional sources.
- Enforce grading windows, semester boundaries, licenses/capacity, research data-use terms, and account recovery rules from authoritative integrations.
- Ensure activation provisions only the approved resource, permission, scopes, and validity, records evidence, and handles failure/retry/reconciliation.
- Enforce expiration/revocation in downstream systems and reconcile actual access with Permora.
- Audit administrator policy/assignment/entitlement/responsibility changes through a future maintenance UI.
- Define retention, privacy-safe labels, and redaction for institutional identifiers and scope snapshots.

Browser filtering and client validation remain usability features only; authorization is server enforced.

## Unresolved policy decisions

- Final authoritative systems and owners for enrollment, teaching, employment, project membership, laboratory training, licenses, and ordinary access.
- Whether Student Portal exceptions belong in Permora or a dedicated recovery/help-desk process.
- Whether restricted library collections need a named canonical scope.
- Whether grading submission, sensitive research, or high privilege needs multiple stages or separation of duties.
- Final default/maximum durations, grading/semester cutoffs, renewal lead time, and whether approvers may shorten requested dates.
- Canonical course/section/lab/software/project identifiers and privacy-safe display labels.
- Delegation, reassignment, escalation, out-of-office, cancellation, and emergency-access policy.
- Activation/provisioning ownership, downstream adapters, evidence, retries, revocation, and expiry behavior.
