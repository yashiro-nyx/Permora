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
      | "stale_decision",
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
          )
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

export async function applyApprovalDecision(
  client: PoolClient,
  actorUserId: string,
  input: {
    requestId: string;
    expectedVersion: number;
    decision: ApprovalDecision;
    reason?: string;
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
  const requestResult = await client.query<{
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
  const scopes = await client.query<{ scope_option_id: string }>(
    "SELECT scope_option_id FROM access_request_scope WHERE request_id = $1",
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
       previous_status, resulting_status, previous_version, resulting_version)
     VALUES ($1,$2,$3,$4,$5,$6,'pending_review',$7,$8,$9)`,
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
    permissionId: request.permission_id,
    policyVersionId: request.policy_version_id,
    assignmentId: assignment.assignment_id,
    responsibilityId: assignment.responsibility_id,
    decisionId,
    previousState: "pending_review",
    newState: resultingStatus,
    previousVersion: request.version,
    resultingVersion,
  };
  await client.query(
    `INSERT INTO request_event
      (id, request_id, actor_user_id, event_type, detail, metadata)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
    [
      randomUUID(),
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
  return { decisionId, status: resultingStatus, version: resultingVersion };
}
