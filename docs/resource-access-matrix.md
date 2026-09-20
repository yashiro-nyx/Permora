# Permora proposed resource access matrix

Updated 2026-09-14. These are **proposed Permora workflow rules for a Philippine university context**. They are not official policies of any university. Product, registrar, academic, library, research, laboratory, privacy, and IT owners must approve the final rules.

The original typed prototype catalog remains in [`lib/resource-catalog.ts`](../lib/resource-catalog.ts) for historical UI/tests. Stage 2A seeds the server policy from [`db/migrations/0002_catalog_v1.sql`](../db/migrations/0002_catalog_v1.sql); PostgreSQL policy, role, assignment, entitlement, and routing records are authoritative for new real requests. Stable permission IDs are stored on requests; visible labels may evolve without changing their meaning. Stage 2A authenticates and validates request submission but does not approve, provision, activate, or expire access in target systems.

## Resources and permission scopes

| Stable resource ID     | Resource                    | Eligible requester roles | Permission IDs and meaning                                                                                                                                                                                                     | Required request scope                                                                              | Ordinary access versus requestable exception                                                                                                                                                           |
| ---------------------- | --------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `r-lms`                | Learning Management System  | Student, Faculty         | `lms:course-participation`: participate in one named course section. `lms:assigned-teaching`: manage learning activities for one assigned teaching section.                                                                    | Course code and section                                                                             | Enrollment and assigned teaching should normally provision access. Permora is for missing, additional, cross-listed, or temporary course access.                                                       |
| `r-student-portal`     | Student Portal              | Student                  | `portal:view-own-academic-information`: view the signed-in requester's own academic information.                                                                                                                               | Fixed to the authenticated user's account; no editable student identifier                           | Active enrollment should normally provision own-account access. Permora is for an approved own-account exception, not access to another student's records.                                             |
| `r-faculty-grading`    | Faculty Grading System      | Faculty                  | `grading:encode-assigned-section`: create and revise grades before submission. `grading:submit-assigned-section`: formally submit grades for registrar processing.                                                             | Assigned course code and section                                                                    | Standard grading access should follow a verified teaching assignment. Permora is for missing assignment access, additional submission authority, or a time-limited exception.                          |
| `r-library`            | Library E-Resources         | Student, Faculty         | `library:subscribed-materials`: use subscribed journals, ebooks, and databases. `library:restricted-collections`: use specifically approved controlled collections; Faculty only in this proposal.                             | No extra free-form scope for subscribed access; license/collection scope must be resolved by policy | Standard subscriptions should follow enrollment or employment. Permora is for missing remote access or an additional restricted collection.                                                            |
| `r-lab`                | Computer Laboratory Systems | Student, Faculty         | `lab:designated-account`: use the named laboratory account environment. `lab:course-software`: use named approved software in the selected laboratory.                                                                         | Laboratory and software/environment                                                                 | General lab access and standard course software should follow course assignment. Permora is for designated accounts, additional licensed software, or temporary laboratory access.                     |
| `r-research-workspace` | Research Project Workspace  | Student, Faculty         | `research:view-project`: read one project's files/datasets. `research:contribute-project`: create or revise content in one project. `research:manage-project-files`: manage files and membership in one project; Faculty only. | Approved project name or stable project ID                                                          | Base access should follow verified project membership. Permora is for missing membership, higher project-specific capability, or temporary work. Permission never applies to every research workspace. |

The real request form derives eligible resources and permissions from the server-assigned requester role and canonical current assignments. It has no control for choosing or elevating that identity. The server repeats every check independently of submitted form values.

## Proposed approval and validity responsibilities

| Resource                    | Proposed approver responsibilities                                                                                                           | Proposed validity policy                                                                                                             |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Learning Management System  | Course owner confirms enrollment/assignment; academic-unit approver handles cross-unit exceptions.                                           | Default 30 days, maximum 90; end no later than the verified course/assignment period; renewable while still eligible.                |
| Student Portal              | Registrar confirms active student status and account ownership; IT resolves the account issue without exposing another record.               | Default 7 days, maximum 30; exception only; non-renewable in this proposal because unresolved account issues require a fresh review. |
| Faculty Grading System      | Academic-unit approver verifies teaching assignment and requested capability; registrar controls formal submission and grading windows.      | Default 14 days, maximum 60; bound to the section and grading window; renewable only after reassessment.                             |
| Library E-Resources         | Library access approver checks affiliation, subscription terms, and restricted-collection eligibility.                                       | Default 30 days, maximum 90; no longer than affiliation/license/project eligibility; renewable.                                      |
| Computer Laboratory Systems | Laboratory coordinator checks course need, prerequisites, lab designation, and license availability; IT provisions the exact approved scope. | Default 14 days, maximum 60; bound to course/activity/project period; renewable.                                                     |
| Research Project Workspace  | Project owner confirms membership and minimum permission; data steward reviews sensitive datasets and sharing/retention limits.              | Default 30 days, maximum 90; no later than verified membership/data-use approval; renewable within the same project scope.           |

All policies require an explicit expiration date. Defaults prefill the prototype form; maximums are validated locally. Neither is authoritative until Stage 2 validates the same versioned policy on the server.

## Existing records and migration

Browser state moves from schema 1 to schema 2 in place under the existing `permora-demo-v1` key. Request IDs, audit events, notifications, and resource foreign keys are retained. Loading old data writes the migrated value back; it does not reset the workspace.

| Existing ID | Schema-2 treatment                                                                                                                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `r-lms`     | Same ID; catalog name becomes Learning Management System. Historical generic levels map to course participation and receive an explicit “section not captured” legacy scope when needed.                     |
| `r-library` | Same ID; catalog name becomes Library E-Resources. Historical generic read access maps to subscribed materials.                                                                                              |
| `r-lab`     | Same ID; catalog name becomes Computer Laboratory Systems. Historical read/standard levels map to designated-account/course-software permissions and receive explicit legacy scope placeholders when needed. |
| `r-vpn`     | Retained as legacy Research VPN Gateway so requests and audit references continue to resolve. It is absent from the new-request catalog.                                                                     |
| `r-records` | Retained as legacy Student Records DB. It is not the Student Portal and remains absent from the new-request catalog.                                                                                         |
| `r-drive`   | Retained as legacy Faculty Shared Drive and absent from the new-request catalog.                                                                                                                             |
| New IDs     | `r-student-portal`, `r-faculty-grading`, and `r-research-workspace` are added without replacing history.                                                                                                     |

Legacy placeholder scope is evidence that the old prototype never captured the value. It must not be treated as verified assignment data or silently converted into a production entitlement.

## Stage 2 server enforcement checklist

- Derive user ID, active state, and roles from a verified session. Ignore submitted owner IDs and roles.
- Load the versioned resource and permission policy on the server; reject unknown, retired, unavailable, or role-incompatible IDs even if a client submits them directly.
- Query authoritative enrollment/employment entitlements before accepting a duplicate request. Direct users to their already-provisioned access when it exists.
- Verify an LMS course section against current enrollment or teaching assignment.
- Restrict Student Portal scope to the authenticated student's internal account ID. Reject every supplied alternate account identifier.
- Verify Faculty Grading System requests against the faculty member's assigned section and the applicable grade-entry/submission window. Students must fail at the authorization layer.
- Resolve laboratory and software identifiers to approved records; check training prerequisites and license availability.
- Resolve the selected research project to a stable internal ID, verify membership and data-use approval, and provision only that project.
- Recheck eligibility, current assignment, duplicate/overlap state, policy version, validity, and resource availability in the same transaction that inserts the request and immutable submission event.
- Link renewals to an owned prior request and keep the same resource, permission, and scope unless a new non-renewal request is submitted. A renewal never reactivates a grant directly.
- Snapshot historical resource, permission, and scope labels where audit readability requires them. Retired and legacy resource references must remain resolvable.
- Keep approval decisions separate from provisioning and grant activation. Downstream systems must receive only the approved scope and enforce expiration.
- Authorize every read, filter, export, detail lookup, decision, and administrative mutation on the server. Passing current browser tests is not evidence of these controls.

## Unresolved policy decisions

- Which university systems are authoritative for enrollment, teaching assignment, employment, project membership, laboratory training, and ordinary entitlements.
- Whether library restricted collections need a named collection field rather than approver-side resolution.
- Whether Faculty Grading System encoding and submission require sequential approvals or distinct approver groups.
- Whether Student Portal exception access should be handled in Permora at all, or routed to account recovery/help desk with no renewable access grant.
- Maximum/default durations, semester and grading-window cutoffs, renewal lead times, and whether approvers may shorten but never extend requested validity.
- Canonical course, section, laboratory, software, and research-project identifiers and the privacy-safe labels shown to requesters.
- Which roles may approve each resource, delegation/escalation rules, separation of duties, and whether self-approval is prohibited for every resource.
