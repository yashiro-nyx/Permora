import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

export type ApprovalDecision = "approve" | "deny" | "return_for_revision";
export type ApprovalRequestStatus =
  | "pending_routing"
  | "pending_review"
  | "approved_pending_activation"
  | "denied"
  | "returned_for_revision"
  | "expired"
  | "cancelled";

export class ApprovalDomainError extends Error {
  constructor(
    message: string,
    readonly code:
      | "invalid_reason"
      | "not_assigned"
      | "invalid_transition"
      | "stale_decision"
      | "idempotency_conflict"
      | "approval_revalidation_failed",
  ) {
    super(message);
    this.name = "ApprovalDomainError";
  }
}

type RouteCandidate = {
  approver_user_id: string;
  responsibility_id: string;
};

async function routeCandidate(
  client: PoolClient,
  request: {
    requesterUserId: string;
    resourceId: string;
    permissionId: string;
    scopeOptionIds: string[];
  },
) {
  const responsibilityScopeMatch = `
          AND (
            NOT EXISTS (
              SELECT 1 FROM approver_responsibility_scope configured
               WHERE configured.responsibility_id = ar.id
            )
            OR (
              cardinality($4::uuid[]) > 0
              AND NOT EXISTS (
                SELECT 1 FROM unnest($4::uuid[]) requested(scope_option_id)
                 WHERE NOT EXISTS (
                   SELECT 1 FROM approver_responsibility_scope configured
                    WHERE configured.responsibility_id = ar.id
                      AND configured.scope_option_id = requested.scope_option_id
                 )
              )
            )
          )`;
  const result = await client.query<RouteCandidate>(
    `WITH matching_responsibilities AS (
       SELECT ar.id AS responsibility_id, ar.approver_user_id
         FROM approver_responsibility ar
         JOIN user_profile profile
           ON profile.user_id = ar.approver_user_id AND profile.active
        WHERE ar.resource_id = $1
          AND (ar.permission_id IS NULL OR ar.permission_id = $2)
          AND ar.approver_user_id <> $3
          AND ar.valid_from <= now()
          AND (ar.valid_until IS NULL OR ar.valid_until > now())
          AND EXISTS (
            SELECT 1 FROM user_role role
             WHERE role.user_id = ar.approver_user_id
               AND role.role IN ('approver', 'admin')
          )
          ${responsibilityScopeMatch}
       UNION ALL
       SELECT ar.id AS responsibility_id, delegation.substitute_user_id AS approver_user_id
         FROM approver_responsibility ar
         JOIN approver_delegation delegation
           ON delegation.delegator_user_id = ar.approver_user_id
          AND delegation.valid_from <= now()
          AND delegation.valid_until > now()
          AND delegation.cancelled_at IS NULL
         JOIN user_profile substitute
           ON substitute.user_id = delegation.substitute_user_id AND substitute.active
        WHERE ar.resource_id = $1
          AND (ar.permission_id IS NULL OR ar.permission_id = $2)
          AND delegation.substitute_user_id <> $3
          AND ar.valid_from <= now()
          AND (ar.valid_until IS NULL OR ar.valid_until > now())
          AND EXISTS (
            SELECT 1 FROM user_role role
             WHERE role.user_id = delegation.substitute_user_id
               AND role.role IN ('approver', 'admin')
          )
          ${responsibilityScopeMatch}
     ), approvers AS (
       SELECT DISTINCT ON (approver_user_id)
              approver_user_id, responsibility_id
         FROM matching_responsibilities
        ORDER BY approver_user_id, responsibility_id
     )
     SELECT eligible.approver_user_id, eligible.responsibility_id
       FROM approvers eligible
       LEFT JOIN request_review_assignment open_assignment
         ON open_assignment.approver_user_id = eligible.approver_user_id
        AND open_assignment.status = 'assigned'
      GROUP BY eligible.approver_user_id, eligible.responsibility_id
      ORDER BY count(open_assignment.id), eligible.approver_user_id
      LIMIT 1`,
    [
      request.resourceId,
      request.permissionId,
      request.requesterUserId,
      request.scopeOptionIds,
    ],
  );
  return result.rows[0] ?? null;
}

export async function previewRequestRoute(
  client: PoolClient,
  requestId: string,
) {
  const request = await client.query<{
    requester_user_id: string;
    resource_id: string;
    permission_id: string;
    status: ApprovalRequestStatus;
  }>(
    `SELECT requester_user_id, resource_id, permission_id, status
       FROM access_request WHERE id = $1`,
    [requestId],
  );
  const row = request.rows[0];
  if (!row || row.status !== "pending_routing") return null;
  const scopes = await client.query<{ scope_option_id: string }>(
    "SELECT scope_option_id FROM access_request_scope WHERE request_id = $1 ORDER BY field_name",
    [requestId],
  );
  return routeCandidate(client, {
    requesterUserId: row.requester_user_id,
    resourceId: row.resource_id,
    permissionId: row.permission_id,
    scopeOptionIds: scopes.rows.map((scope) => scope.scope_option_id),
  });
}

export async function routePendingRequest(
  client: PoolClient,
  requestId: string,
  actorUserId: string | null,
) {
  const locked = await client.query<{
    requester_user_id: string;
    resource_id: string;
    permission_id: string;
    policy_version_id: string;
    display_id: string;
    status: ApprovalRequestStatus;
  }>(
    `SELECT requester_user_id, resource_id, permission_id, policy_version_id,
            display_id, status
       FROM access_request WHERE id = $1 FOR UPDATE`,
    [requestId],
  );
  const request = locked.rows[0];
  if (!request || request.status !== "pending_routing")
    return { routed: false as const, reason: "not_pending_routing" as const };
  await client.query("SELECT pg_advisory_xact_lock(73020422)");
  const existing = await client.query(
    "SELECT 1 FROM request_review_assignment WHERE request_id = $1",
    [requestId],
  );
  if (existing.rows[0])
    return { routed: false as const, reason: "already_assigned" as const };
  const scopes = await client.query<{ scope_option_id: string }>(
    "SELECT scope_option_id FROM access_request_scope WHERE request_id = $1 ORDER BY field_name",
    [requestId],
  );
  const candidate = await routeCandidate(client, {
    requesterUserId: request.requester_user_id,
    resourceId: request.resource_id,
    permissionId: request.permission_id,
    scopeOptionIds: scopes.rows.map((scope) => scope.scope_option_id),
  });
  if (!candidate) {
    const alreadyRecorded = await client.query(
      `SELECT 1 FROM request_event
        WHERE request_id = $1 AND event_type = 'request_routing_unavailable'`,
      [requestId],
    );
    if (!alreadyRecorded.rows[0]) {
      await client.query(
        `INSERT INTO request_event
          (id, request_id, actor_user_id, event_type, detail, metadata)
         VALUES ($1,$2,$3,'request_routing_unavailable',$4,$5::jsonb)`,
        [
          randomUUID(),
          requestId,
          actorUserId,
          "No fully eligible approver was available; the request remains unassigned.",
          JSON.stringify({
            previousState: "pending_routing",
            newState: "pending_routing",
            policyVersionId: request.policy_version_id,
          }),
        ],
      );
      await client.query(
        `INSERT INTO audit_event
          (id, actor_user_id, subject_user_id, request_id, event_type, metadata)
         VALUES ($1,$2,$3,$4,'request_routing_unavailable',$5::jsonb)`,
        [
          randomUUID(),
          actorUserId,
          request.requester_user_id,
          requestId,
          JSON.stringify({
            displayId: request.display_id,
            resourceId: request.resource_id,
            permissionId: request.permission_id,
            previousState: "pending_routing",
            newState: "pending_routing",
            policyVersionId: request.policy_version_id,
          }),
        ],
      );
    }
    return { routed: false as const, reason: "no_eligible_approver" as const };
  }
  const assignmentId = randomUUID();
  await client.query(
    `INSERT INTO request_review_assignment
      (id, request_id, approver_user_id, responsibility_id)
     VALUES ($1,$2,$3,$4)`,
    [
      assignmentId,
      requestId,
      candidate.approver_user_id,
      candidate.responsibility_id,
    ],
  );
  await client.query(
    `UPDATE access_request
        SET status = 'pending_review', version = version + 1, updated_at = now()
      WHERE id = $1`,
    [requestId],
  );
  const metadata = {
    displayId: request.display_id,
    resourceId: request.resource_id,
    permissionId: request.permission_id,
    policyVersionId: request.policy_version_id,
    assignmentId,
    responsibilityId: candidate.responsibility_id,
    previousState: "pending_routing",
    newState: "pending_review",
  };
  await client.query(
    `INSERT INTO request_event
      (id, request_id, actor_user_id, event_type, detail, metadata)
     VALUES ($1,$2,$3,'request_routed',$4,$5::jsonb)`,
    [
      randomUUID(),
      requestId,
      actorUserId,
      "Request assigned to an eligible approver.",
      JSON.stringify(metadata),
    ],
  );
  await client.query(
    `INSERT INTO audit_event
      (id, actor_user_id, subject_user_id, request_id, event_type, metadata)
     VALUES ($1,$2,$3,$4,'request_routed',$5::jsonb)`,
    [
      randomUUID(),
      actorUserId,
      request.requester_user_id,
      requestId,
      JSON.stringify(metadata),
    ],
  );
  return {
    routed: true as const,
    assignmentId,
    approverUserId: candidate.approver_user_id,
    responsibilityId: candidate.responsibility_id,
  };
}

export type EligibleResponsibilityOption = {
  responsibilityId: string;
  approverUserId: string;
  approverName: string;
  viaDelegation: boolean;
  delegatorName: string | null;
};

export async function listEligibleResponsibilitiesForRequest(
  client: PoolClient,
  requestId: string,
): Promise<EligibleResponsibilityOption[]> {
  const request = await client.query<{
    requester_user_id: string;
    resource_id: string;
    permission_id: string;
    status: ApprovalRequestStatus;
  }>(
    `SELECT requester_user_id, resource_id, permission_id, status
       FROM access_request WHERE id = $1`,
    [requestId],
  );
  const row = request.rows[0];
  if (!row || row.status !== "pending_routing") return [];
  const scopes = await client.query<{ scope_option_id: string }>(
    "SELECT scope_option_id FROM access_request_scope WHERE request_id = $1 ORDER BY field_name",
    [requestId],
  );
  const scopeOptionIds = scopes.rows.map((scope) => scope.scope_option_id);
  const responsibilityScopeMatch = `
          AND (
            NOT EXISTS (
              SELECT 1 FROM approver_responsibility_scope configured
               WHERE configured.responsibility_id = ar.id
            )
            OR (
              cardinality($4::uuid[]) > 0
              AND NOT EXISTS (
                SELECT 1 FROM unnest($4::uuid[]) requested(scope_option_id)
                 WHERE NOT EXISTS (
                   SELECT 1 FROM approver_responsibility_scope configured
                    WHERE configured.responsibility_id = ar.id
                      AND configured.scope_option_id = requested.scope_option_id
                 )
              )
            )
          )`;
  const result = await client.query<{
    responsibility_id: string;
    approver_user_id: string;
    approver_name: string;
    via_delegation: boolean;
    delegator_name: string | null;
  }>(
    `WITH matching_responsibilities AS (
       SELECT ar.id AS responsibility_id, ar.approver_user_id,
              false AS via_delegation, NULL::text AS delegator_name
         FROM approver_responsibility ar
         JOIN user_profile profile
           ON profile.user_id = ar.approver_user_id AND profile.active
        WHERE ar.resource_id = $1
          AND (ar.permission_id IS NULL OR ar.permission_id = $2)
          AND ar.approver_user_id <> $3
          AND ar.valid_from <= now()
          AND (ar.valid_until IS NULL OR ar.valid_until > now())
          AND EXISTS (
            SELECT 1 FROM user_role role
             WHERE role.user_id = ar.approver_user_id
               AND role.role IN ('approver', 'admin')
          )
          ${responsibilityScopeMatch}
       UNION ALL
       SELECT ar.id, delegation.substitute_user_id, true, delegator.name
         FROM approver_responsibility ar
         JOIN approver_delegation delegation
           ON delegation.delegator_user_id = ar.approver_user_id
          AND delegation.valid_from <= now()
          AND delegation.valid_until > now()
          AND delegation.cancelled_at IS NULL
         JOIN user_profile substitute
           ON substitute.user_id = delegation.substitute_user_id AND substitute.active
         JOIN "user" delegator ON delegator.id = delegation.delegator_user_id
        WHERE ar.resource_id = $1
          AND (ar.permission_id IS NULL OR ar.permission_id = $2)
          AND delegation.substitute_user_id <> $3
          AND ar.valid_from <= now()
          AND (ar.valid_until IS NULL OR ar.valid_until > now())
          AND EXISTS (
            SELECT 1 FROM user_role role
             WHERE role.user_id = delegation.substitute_user_id
               AND role.role IN ('approver', 'admin')
          )
          ${responsibilityScopeMatch}
     )
     SELECT responsibility_id, approver_user_id, approver.name AS approver_name,
            via_delegation, delegator_name
       FROM matching_responsibilities match
       JOIN "user" approver ON approver.id = match.approver_user_id
      ORDER BY lower(approver.name), responsibility_id`,
    [row.resource_id, row.permission_id, row.requester_user_id, scopeOptionIds],
  );
  return result.rows.map((entry) => ({
    responsibilityId: entry.responsibility_id,
    approverUserId: entry.approver_user_id,
    approverName: entry.approver_name,
    viaDelegation: entry.via_delegation,
    delegatorName: entry.delegator_name,
  }));
}

export class AdministratorRoutingError extends Error {
  constructor(
    message: string,
    readonly code:
      | "not_found"
      | "not_pending_routing"
      | "stale_request"
      | "already_assigned"
      | "invalid_responsibility"
      | "self_assignment",
  ) {
    super(message);
    this.name = "AdministratorRoutingError";
  }
}

export async function administratorAssignPendingRequest(
  client: PoolClient,
  input: {
    requestId: string;
    responsibilityId: string;
    expectedVersion: number;
    actorUserId: string;
  },
) {
  await client.query("SELECT pg_advisory_xact_lock(73020422)");
  const locked = await client.query<{
    requester_user_id: string;
    resource_id: string;
    permission_id: string;
    policy_version_id: string;
    display_id: string;
    status: ApprovalRequestStatus;
    version: number;
  }>(
    `SELECT requester_user_id, resource_id, permission_id, policy_version_id,
            display_id, status, version
       FROM access_request WHERE id = $1 FOR UPDATE`,
    [input.requestId],
  );
  const request = locked.rows[0];
  if (!request) throw new AdministratorRoutingError("The request was not found.", "not_found");
  if (request.status !== "pending_routing")
    throw new AdministratorRoutingError(
      "Only unassigned requests can be manually routed.",
      "not_pending_routing",
    );
  if (request.version !== input.expectedVersion)
    throw new AdministratorRoutingError(
      "This request changed after it was loaded.",
      "stale_request",
    );
  const existing = await client.query(
    "SELECT 1 FROM request_review_assignment WHERE request_id = $1",
    [input.requestId],
  );
  if (existing.rows[0])
    throw new AdministratorRoutingError(
      "This request already has a review assignment.",
      "already_assigned",
    );
  const eligible = await listEligibleResponsibilitiesForRequest(
    client,
    input.requestId,
  );
  const selected = eligible.find(
    (option) => option.responsibilityId === input.responsibilityId,
  );
  if (!selected)
    throw new AdministratorRoutingError(
      "The selected approver responsibility is not eligible for this request.",
      "invalid_responsibility",
    );
  if (selected.approverUserId === request.requester_user_id)
    throw new AdministratorRoutingError(
      "Self-approval is not permitted.",
      "self_assignment",
    );

  const assignmentId = randomUUID();
  await client.query(
    `INSERT INTO request_review_assignment
      (id, request_id, approver_user_id, responsibility_id)
     VALUES ($1,$2,$3,$4)`,
    [
      assignmentId,
      input.requestId,
      selected.approverUserId,
      selected.responsibilityId,
    ],
  );
  await client.query(
    `UPDATE access_request
        SET status = 'pending_review', version = version + 1, updated_at = now()
      WHERE id = $1`,
    [input.requestId],
  );
  const metadata = {
    displayId: request.display_id,
    resourceId: request.resource_id,
    permissionId: request.permission_id,
    policyVersionId: request.policy_version_id,
    assignmentId,
    responsibilityId: selected.responsibilityId,
    previousState: "pending_routing",
    newState: "pending_review",
    assignmentMode: "administrator",
    viaDelegation: selected.viaDelegation,
    delegatorName: selected.delegatorName,
  };
  await client.query(
    `INSERT INTO request_event
      (id, request_id, actor_user_id, event_type, detail, metadata)
     VALUES ($1,$2,$3,'request_administrator_assigned',$4,$5::jsonb)`,
    [
      randomUUID(),
      input.requestId,
      input.actorUserId,
      "Administrator assigned an eligible approver for review.",
      JSON.stringify(metadata),
    ],
  );
  await client.query(
    `INSERT INTO audit_event
      (id, actor_user_id, subject_user_id, request_id, event_type, metadata)
     VALUES ($1,$2,$3,$4,'request_administrator_assigned',$5::jsonb)`,
    [
      randomUUID(),
      input.actorUserId,
      request.requester_user_id,
      input.requestId,
      JSON.stringify(metadata),
    ],
  );
  return {
    assignmentId,
    approverUserId: selected.approverUserId,
    responsibilityId: selected.responsibilityId,
    version: input.expectedVersion + 1,
  };
}

export async function reconcilePendingReviewsForInactiveApprover(
  client: PoolClient,
  approverUserId: string,
  actorUserId: string,
) {
  const assignments = await client.query<{
    assignment_id: string;
    request_id: string;
    requester_user_id: string;
    display_id: string;
  }>(
    `SELECT assignment.id AS assignment_id, request.id AS request_id,
            request.requester_user_id, request.display_id
       FROM request_review_assignment assignment
       JOIN access_request request ON request.id = assignment.request_id
      WHERE assignment.approver_user_id = $1
        AND assignment.status = 'assigned'
        AND request.status = 'pending_review'
      ORDER BY request.id
      FOR UPDATE OF assignment, request`,
    [approverUserId],
  );
  let routed = 0;
  let unassigned = 0;

  for (const assignment of assignments.rows) {
    await client.query(
      `UPDATE access_request
          SET status = 'pending_routing', version = version + 1, updated_at = now()
        WHERE id = $1 AND status = 'pending_review'`,
      [assignment.request_id],
    );
    const removed = await client.query(
      `DELETE FROM request_review_assignment
        WHERE id = $1 AND status = 'assigned'`,
      [assignment.assignment_id],
    );
    if (removed.rowCount !== 1)
      throw new Error("The review assignment changed during account reconciliation.");

    const route = await routePendingRequest(
      client,
      assignment.request_id,
      actorUserId,
    );
    if (route.routed) routed++;
    else unassigned++;

    await client.query(
      `INSERT INTO audit_event
        (id, actor_user_id, subject_user_id, request_id, event_type, metadata)
       VALUES ($1,$2,$3,$4,'request_approver_reconciled',$5::jsonb)`,
      [
        randomUUID(),
        actorUserId,
        assignment.requester_user_id,
        assignment.request_id,
        JSON.stringify({
          displayId: assignment.display_id,
          previousApproverUserId: approverUserId,
          newApproverUserId: route.routed ? route.approverUserId : null,
          previousState: "pending_review",
          newState: route.routed ? "pending_review" : "pending_routing",
        }),
      ],
    );
  }

  return { routed, unassigned };
}

export async function applyApprovalDecision(
  client: PoolClient,
  actorUserId: string,
  input: {
    requestId: string;
    expectedVersion: number;
    decision: ApprovalDecision;
    reason?: string;
    idempotencyKey: string;
  },
) {
  const reason = input.reason?.trim() || null;
  if (
    (input.decision === "deny" || input.decision === "return_for_revision") &&
    !reason
  )
    throw new ApprovalDomainError(
      "A reason is required for denial or return for revision.",
      "invalid_reason",
    );
  if (reason && reason.length > 2000)
    throw new ApprovalDomainError(
      "The decision reason must be 2,000 characters or fewer.",
      "invalid_reason",
    );
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
    [`${actorUserId}:${input.idempotencyKey}`],
  );
  const replay = await client.query<{
    id: string;
    request_id: string;
    action: ApprovalDecision;
    reason: string | null;
    previous_version: number;
    resulting_status: Exclude<ApprovalRequestStatus, "pending_routing" | "pending_review" | "expired" | "cancelled">;
    resulting_version: number;
  }>(
    `SELECT id, request_id, action, reason, previous_version,
            resulting_status, resulting_version
       FROM request_decision
      WHERE actor_user_id = $1 AND idempotency_key = $2`,
    [actorUserId, input.idempotencyKey],
  );
  const prior = replay.rows[0];
  if (prior) {
    if (
      prior.request_id !== input.requestId ||
      prior.action !== input.decision ||
      prior.reason !== reason ||
      prior.previous_version !== input.expectedVersion
    )
      throw new ApprovalDomainError(
        "This idempotency key was already used for another decision command.",
        "idempotency_conflict",
      );
    return {
      decisionId: prior.id,
      status: prior.resulting_status,
      version: prior.resulting_version,
      replayed: true,
    };
  }
  const requestResult = await client.query<{
    requester_user_id: string;
    resource_id: string;
    permission_id: string;
    resource_name: string;
    permission_label: string;
    policy_version_id: string;
    display_id: string;
    starts_at: Date;
    expires_at: Date;
    scope_fingerprint: string;
    status: ApprovalRequestStatus;
    version: number;
  }>(
    `SELECT request.requester_user_id, request.resource_id,
            request.permission_id, request.policy_version_id,
            resource.name AS resource_name,
            permission.label AS permission_label,
            display_id, starts_at, expires_at, scope_fingerprint, status, version
       FROM access_request request
       JOIN catalog_resource resource ON resource.id = request.resource_id
       JOIN catalog_permission permission ON permission.id = request.permission_id
      WHERE request.id = $1 FOR UPDATE OF request`,
    [input.requestId],
  );
  const request = requestResult.rows[0];
  if (!request)
    throw new ApprovalDomainError(
      "The assigned request is not available.",
      "not_assigned",
    );
  if (request.version !== input.expectedVersion)
    throw new ApprovalDomainError(
      "This request changed after it was loaded.",
      "stale_decision",
    );
  if (request.status !== "pending_review")
    throw new ApprovalDomainError(
      "This request is not awaiting a decision.",
      "invalid_transition",
    );
  if (request.requester_user_id === actorUserId)
    throw new ApprovalDomainError(
      "Self-approval is not permitted.",
      "not_assigned",
    );
  const scopes = await client.query<{
    scope_option_id: string;
    field_name: string;
    display_snapshot: string;
  }>(
    `SELECT scope_option_id, field_name, display_snapshot
       FROM access_request_scope WHERE request_id = $1 ORDER BY field_name`,
    [input.requestId],
  );
  const assignmentResult = await client.query<{
    assignment_id: string;
    responsibility_id: string;
  }>(
    `SELECT assignment.id AS assignment_id,
            assignment.responsibility_id
       FROM request_review_assignment assignment
       JOIN approver_responsibility responsibility
         ON responsibility.id = assignment.responsibility_id
        AND responsibility.approver_user_id = assignment.approver_user_id
       JOIN user_profile profile
         ON profile.user_id = assignment.approver_user_id AND profile.active
      WHERE assignment.request_id = $1
        AND assignment.approver_user_id = $2
        AND assignment.status = 'assigned'
        AND responsibility.resource_id = $3
        AND (responsibility.permission_id IS NULL OR responsibility.permission_id = $4)
        AND responsibility.valid_from <= now()
        AND (responsibility.valid_until IS NULL OR responsibility.valid_until > now())
        AND EXISTS (
          SELECT 1 FROM user_role role
           WHERE role.user_id = assignment.approver_user_id
             AND role.role IN ('approver', 'admin')
        )
        AND (
          NOT EXISTS (
            SELECT 1 FROM approver_responsibility_scope configured
             WHERE configured.responsibility_id = responsibility.id
          )
          OR (
            cardinality($5::uuid[]) > 0
            AND NOT EXISTS (
              SELECT 1 FROM unnest($5::uuid[]) requested(scope_option_id)
               WHERE NOT EXISTS (
                 SELECT 1 FROM approver_responsibility_scope configured
                  WHERE configured.responsibility_id = responsibility.id
                    AND configured.scope_option_id = requested.scope_option_id
               )
            )
          )
        )`,
    [
      input.requestId,
      actorUserId,
      request.resource_id,
      request.permission_id,
      scopes.rows.map((scope) => scope.scope_option_id),
    ],
  );
  const assignment = assignmentResult.rows[0];
  if (!assignment)
    throw new ApprovalDomainError(
      "Only the currently assigned eligible approver may decide this request.",
      "not_assigned",
    );
  let currentPolicyVersionId = request.policy_version_id;
  if (input.decision === "approve") {
    const eligible = await client.query<{
      policy_version_id: string;
      max_days: number;
      requester_role: "student" | "faculty";
    }>(
      `SELECT policy.id AS policy_version_id, policy.max_days,
              profile.requester_role
         FROM user_profile profile
         JOIN catalog_resource resource ON resource.id = $2 AND resource.available
         JOIN catalog_permission permission
           ON permission.id = $3 AND permission.resource_id = resource.id
          AND permission.enabled
         JOIN catalog_permission_role permitted
           ON permitted.permission_id = permission.id
          AND permitted.requester_role = profile.requester_role
         JOIN catalog_policy_version policy ON policy.resource_id = resource.id
          AND policy.effective_from <= now()
          AND (policy.effective_until IS NULL OR policy.effective_until > now())
        WHERE profile.user_id = $1 AND profile.active
          AND profile.requester_role IS NOT NULL
        ORDER BY policy.version DESC
        LIMIT 1`,
      [request.requester_user_id, request.resource_id, request.permission_id],
    );
    const current = eligible.rows[0];
    const requestedDays =
      (request.expires_at.getTime() - request.starts_at.getTime()) / 86_400_000;
    if (
      !current ||
      request.expires_at <= new Date() ||
      requestedDays > current.max_days
    )
      throw new ApprovalDomainError(
        "The request no longer satisfies the current access policy.",
        "approval_revalidation_failed",
      );
    currentPolicyVersionId = current.policy_version_id;

    const requiredScopes = await client.query<{
      field_name: string;
      request_scope_id: string | null;
      active_option: boolean;
      active_assignment: boolean;
    }>(
      `SELECT field.field_name,
              requested.scope_option_id AS request_scope_id,
              (option.id IS NOT NULL) AS active_option,
              EXISTS (
                SELECT 1 FROM requester_assignment assigned
                 WHERE assigned.user_id = $1
                   AND assigned.resource_id = $2
                   AND assigned.scope_option_id = requested.scope_option_id
                   AND (assigned.permission_id IS NULL OR assigned.permission_id = $3)
                   AND assigned.valid_from <= now()
                   AND (assigned.valid_until IS NULL OR assigned.valid_until > now())
              ) AS active_assignment
         FROM catalog_scope_field field
         LEFT JOIN access_request_scope requested
           ON requested.request_id = $4 AND requested.field_name = field.field_name
         LEFT JOIN scope_option option
           ON option.id = requested.scope_option_id
          AND option.resource_id = field.resource_id
          AND option.field_name = field.field_name
          AND option.active
          AND (option.valid_from IS NULL OR option.valid_from <= now())
          AND (option.valid_until IS NULL OR option.valid_until > now())
        WHERE field.resource_id = $2 AND field.required`,
      [
        request.requester_user_id,
        request.resource_id,
        request.permission_id,
        input.requestId,
      ],
    );
    if (
      requiredScopes.rows.some(
        (scope) =>
          !scope.request_scope_id ||
          !scope.active_option ||
          !scope.active_assignment,
      ) ||
      (request.resource_id === "r-student-portal" &&
        request.scope_fingerprint !== `own-account:${request.requester_user_id}`)
    )
      throw new ApprovalDomainError(
        "The requester no longer holds every assignment required for this scope.",
        "approval_revalidation_failed",
      );

    const conflict = await client.query(
      `SELECT 1
         FROM ordinary_entitlement entitlement
        WHERE entitlement.user_id = $1
          AND entitlement.resource_id = $2
          AND entitlement.permission_id = $3
          AND entitlement.scope_fingerprint = $4
          AND entitlement.valid_from < $6
          AND (entitlement.valid_until IS NULL OR entitlement.valid_until > $5)
       UNION ALL
       SELECT 1
         FROM access_request other
        WHERE other.id <> $7
          AND other.requester_user_id = $1
          AND other.resource_id = $2
          AND other.permission_id = $3
          AND other.scope_fingerprint = $4
          AND other.status = 'approved_pending_activation'
          AND other.starts_at < $6 AND other.expires_at > $5
       LIMIT 1`,
      [
        request.requester_user_id,
        request.resource_id,
        request.permission_id,
        request.scope_fingerprint,
        request.starts_at,
        request.expires_at,
        input.requestId,
      ],
    );
    if (conflict.rows[0])
      throw new ApprovalDomainError(
        "The requested access now conflicts with existing or approved access.",
        "approval_revalidation_failed",
      );
  }
  const resultingStatus =
    input.decision === "approve"
      ? "approved_pending_activation"
      : input.decision === "deny"
        ? "denied"
        : "returned_for_revision";
  const eventType =
    input.decision === "approve"
      ? "review_approved"
      : input.decision === "deny"
        ? "review_denied"
        : "review_returned_for_revision";
  const resultingVersion = request.version + 1;
  const decisionId = randomUUID();
  await client.query(
    `INSERT INTO request_decision
      (id, request_id, assignment_id, actor_user_id, action, reason,
       previous_status, resulting_status, previous_version, resulting_version,
       idempotency_key)
     VALUES ($1,$2,$3,$4,$5,$6,'pending_review',$7,$8,$9,$10)`,
    [
      decisionId,
      input.requestId,
      assignment.assignment_id,
      actorUserId,
      input.decision,
      reason,
      resultingStatus,
      request.version,
      resultingVersion,
      input.idempotencyKey,
    ],
  );
  const updated = await client.query(
    `UPDATE access_request
        SET status = $1, version = $2, updated_at = now()
      WHERE id = $3 AND status = 'pending_review' AND version = $4`,
    [resultingStatus, resultingVersion, input.requestId, request.version],
  );
  if (updated.rowCount !== 1)
    throw new ApprovalDomainError(
      "This request changed before the decision was saved.",
      "stale_decision",
    );
  await client.query(
    `UPDATE request_review_assignment
        SET status = 'completed', completed_at = now()
      WHERE id = $1 AND status = 'assigned'`,
    [assignment.assignment_id],
  );
  const metadata = {
    displayId: request.display_id,
    resourceId: request.resource_id,
    resourceName: request.resource_name,
    permissionId: request.permission_id,
    permissionLabel: request.permission_label,
    scopes: scopes.rows.map((scope) => ({
      fieldName: scope.field_name,
      value: scope.display_snapshot,
    })),
    policyVersionId: request.policy_version_id,
    currentPolicyVersionId,
    idempotencyKey: input.idempotencyKey,
    assignmentId: assignment.assignment_id,
    responsibilityId: assignment.responsibility_id,
    decisionId,
    previousState: "pending_review",
    newState: resultingStatus,
    previousVersion: request.version,
    resultingVersion,
  };
  const requestEventId = randomUUID();
  await client.query(
    `INSERT INTO request_event
      (id, request_id, actor_user_id, event_type, detail, metadata)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
    [
      requestEventId,
      input.requestId,
      actorUserId,
      eventType,
      reason ?? "Request approved; activation has not occurred.",
      JSON.stringify(metadata),
    ],
  );
  await client.query(
    `INSERT INTO audit_event
      (id, actor_user_id, subject_user_id, request_id, event_type, metadata)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
    [
      randomUUID(),
      actorUserId,
      request.requester_user_id,
      input.requestId,
      eventType,
      JSON.stringify(metadata),
    ],
  );
  const notification =
    input.decision === "approve"
      ? {
          type: "request_approved_pending_activation",
          title: "Request approved — awaiting activation",
          body: "Your request was approved. Access is not active until activation is completed.",
        }
      : input.decision === "deny"
        ? {
            type: "request_denied",
            title: "Access request denied",
            body: reason as string,
          }
        : {
            type: "request_returned_for_revision",
            title: "Revision requested",
            body: reason as string,
          };
  await client.query(
    `INSERT INTO user_notification
      (id, recipient_user_id, request_id, request_event_id,
       notification_type, title, body)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      randomUUID(),
      request.requester_user_id,
      input.requestId,
      requestEventId,
      notification.type,
      notification.title,
      notification.body,
    ],
  );
  return {
    decisionId,
    status: resultingStatus,
    version: resultingVersion,
    replayed: false,
  };
}
