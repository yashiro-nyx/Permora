import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type {
  ActivationAdapterContext,
  ActivationAdapterResult,
} from "./activation-adapter";
import {
  ActivationDomainError,
  startActivationAttempt,
  type ActivationStartResult,
  type StartActivationInput,
} from "./activation-domain";

export type PreparedActivationAttempt = {
  result: ActivationStartResult;
  adapterContext: ActivationAdapterContext | null;
};

export type ActivationCompletionResult = {
  activationId: string;
  status: "activated" | "failed";
  attemptCount: number;
  replayed: boolean;
  failureCode: string | null;
  retryable: boolean | null;
};

function asDate(value: Date | string) {
  return value instanceof Date ? value : new Date(value);
}

export async function prepareApprovedActivation(
  client: PoolClient,
  actorUserId: string,
  input: StartActivationInput,
): Promise<PreparedActivationAttempt> {
  const administrator = await client.query(
    `SELECT 1
       FROM user_profile profile
      WHERE profile.user_id = $1 AND profile.active
        AND EXISTS (
          SELECT 1 FROM user_role role
           WHERE role.user_id = profile.user_id AND role.role = 'admin'
        )`,
    [actorUserId],
  );
  if (!administrator.rows[0])
    throw new ActivationDomainError(
      "An active administrator is required to activate access.",
      "not_authorized",
    );

  const result = await startActivationAttempt(client, actorUserId, input);
  const requestResult = await client.query<{
    requester_user_id: string;
    original_approver_user_id: string;
    resource_id: string;
    permission_id: string;
    policy_version_id: string;
    scope_fingerprint: string;
    starts_at: Date | string;
    expires_at: Date | string;
    status: string;
  }>(
    `SELECT request.requester_user_id, decision.actor_user_id AS original_approver_user_id,
            request.resource_id, request.permission_id, request.policy_version_id,
            request.scope_fingerprint,
            request.starts_at, request.expires_at, request.status
       FROM access_request request
       JOIN request_decision decision
         ON decision.request_id = request.id
        AND decision.action = 'approve'
        AND decision.resulting_status = 'approved_pending_activation'
      WHERE request.id = $1
      FOR UPDATE OF request`,
    [input.requestId],
  );
  const request = requestResult.rows[0];
  if (!request)
    throw new ActivationDomainError(
      "The approved request is not available for activation.",
      "request_unavailable",
    );
  if (
    actorUserId === request.requester_user_id ||
    actorUserId === request.original_approver_user_id
  )
    throw new ActivationDomainError(
      "The requester and original approver cannot activate this request.",
      "activation_forbidden",
    );

  if (result.replayed)
    return { result, adapterContext: null };

  const eligibility = await client.query<{
    policy_id: string;
    max_days: number;
  }>(
    `SELECT policy.id AS policy_id, policy.max_days
       FROM user_profile profile
       JOIN catalog_resource resource
         ON resource.id = $2 AND resource.available
       JOIN catalog_permission permission
         ON permission.id = $3 AND permission.resource_id = resource.id
        AND permission.enabled
       JOIN catalog_permission_role permitted
         ON permitted.permission_id = permission.id
        AND permitted.requester_role = profile.requester_role
       JOIN catalog_policy_version policy
         ON policy.resource_id = resource.id
        AND policy.effective_from <= now()
        AND (policy.effective_until IS NULL OR policy.effective_until > now())
      WHERE profile.user_id = $1 AND profile.active
        AND profile.requester_role IS NOT NULL
      ORDER BY policy.version DESC
      LIMIT 1`,
    [request.requester_user_id, request.resource_id, request.permission_id],
  );
  const currentPolicy = eligibility.rows[0];
  const startsAt = asDate(request.starts_at);
  const expiresAt = asDate(request.expires_at);
  const durationDays = (expiresAt.getTime() - startsAt.getTime()) / 86_400_000;
  if (
    !currentPolicy ||
    currentPolicy.policy_id !== request.policy_version_id ||
    request.status !== "approved_pending_activation" ||
    !Number.isFinite(durationDays) ||
    durationDays <= 0 ||
    durationDays > currentPolicy.max_days ||
    expiresAt <= new Date()
  )
    throw new ActivationDomainError(
      "The request no longer satisfies current eligibility, policy, or date requirements.",
      "activation_revalidation_failed",
    );

  const requiredScopes = await client.query<{
    request_scope_id: string | null;
    active_option: boolean;
    active_assignment: boolean;
  }>(
    `SELECT requested.scope_option_id AS request_scope_id,
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
    [request.requester_user_id, request.resource_id, request.permission_id, input.requestId],
  );
  if (
    requiredScopes.rows.some(
      (scope) =>
        !scope.request_scope_id || !scope.active_option || !scope.active_assignment,
    ) ||
    (request.resource_id === "r-student-portal" &&
      request.scope_fingerprint !== `own-account:${request.requester_user_id}`)
  )
    throw new ActivationDomainError(
      "The requester no longer holds every assignment required for this scope.",
      "activation_revalidation_failed",
    );

  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
    [`${request.requester_user_id}:${request.resource_id}`],
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
       LEFT JOIN request_activation other_activation
         ON other_activation.request_id = other.id
      WHERE other.id <> $7
        AND other.requester_user_id = $1
        AND other.resource_id = $2
        AND other.permission_id = $3
        AND other.scope_fingerprint = $4
        AND other.status = 'approved_pending_activation'
        AND other.starts_at < $6 AND other.expires_at > $5
        AND (other_activation.id IS NULL OR
             other_activation.status IN ('activating', 'activated'))
     LIMIT 1`,
    [
      request.requester_user_id,
      request.resource_id,
      request.permission_id,
      request.scope_fingerprint,
      startsAt,
      expiresAt,
      input.requestId,
    ],
  );
  if (conflict.rows[0])
    throw new ActivationDomainError(
      "The requested access now conflicts with an existing entitlement or approved request.",
      "activation_conflict",
    );

  return {
    result,
    adapterContext: {
      activationId: result.activationId,
      requestId: input.requestId,
      actorUserId,
      resourceId: request.resource_id,
      permissionId: request.permission_id,
      scopeFingerprint: request.scope_fingerprint,
      startsAt: startsAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    },
  };
}

export async function recordActivationOutcome(
  client: PoolClient,
  actorUserId: string,
  activationId: string,
  idempotencyKey: string,
  outcome: ActivationAdapterResult,
): Promise<ActivationCompletionResult> {
  const priorOutcome = await client.query<{
    event_type: "activation_succeeded" | "activation_failed";
    attempt_count: string;
    failure_code: string | null;
    retryable: string | null;
  }>(
    `SELECT event.event_type,
            event.metadata ->> 'attemptCount' AS attempt_count,
            event.metadata ->> 'failureCode' AS failure_code,
            event.metadata ->> 'retryable' AS retryable
       FROM activation_event event
      WHERE event.activation_id = $1
        AND event.idempotency_key = $2
        AND event.actor_user_id = $3
        AND event.event_type IN ('activation_succeeded', 'activation_failed')
      ORDER BY event.occurred_at DESC, event.id DESC
      LIMIT 1`,
    [activationId, idempotencyKey, actorUserId],
  );
  if (priorOutcome.rows[0]) {
    const prior = priorOutcome.rows[0];
    return {
      activationId,
      status: prior.event_type === "activation_succeeded" ? "activated" : "failed",
      attemptCount: Number(prior.attempt_count),
      replayed: true,
      failureCode: prior.failure_code,
      retryable: prior.retryable === null ? null : prior.retryable === "true",
    };
  }

  const activationResult = await client.query<{
    request_id: string;
    requester_user_id: string;
    resource_id: string;
    permission_id: string;
    scope_fingerprint: string;
    starts_at: Date | string;
    expires_at: Date | string;
    status: string;
    attempt_count: number;
    actor_user_id: string;
    idempotency_key: string;
    adapter_name: string;
  }>(
    `SELECT activation.request_id, request.requester_user_id,
            request.resource_id, request.permission_id,
            request.scope_fingerprint, request.starts_at, request.expires_at,
            activation.status, activation.attempt_count,
            activation.actor_user_id, activation.idempotency_key,
            activation.adapter_name
       FROM request_activation activation
       JOIN access_request request ON request.id = activation.request_id
      WHERE activation.id = $1
      FOR UPDATE OF activation`,
    [activationId],
  );
  const activation = activationResult.rows[0];
  if (
    !activation ||
    activation.status !== "activating" ||
    activation.actor_user_id !== actorUserId ||
    activation.idempotency_key !== idempotencyKey
  )
    throw new ActivationDomainError(
      "This activation attempt is no longer current.",
      "activation_attempt_not_current",
    );

  const succeeded = outcome.outcome === "success";
  if (succeeded && !outcome.externalReference && !outcome.evidence)
    throw new ActivationDomainError(
      "A successful activation must include a reference or evidence.",
      "invalid_outcome",
    );

  const eventType = succeeded ? "activation_succeeded" : "activation_failed";
  const eventDetail = succeeded
    ? "An administrator confirmed that access was provisioned."
    : outcome.message;
  const entitlementId = succeeded ? randomUUID() : null;
  const metadata = succeeded
    ? {
        activationId,
        entitlementId,
        attemptCount: activation.attempt_count,
        adapterName: activation.adapter_name,
        externalReference: outcome.externalReference,
        evidence: outcome.evidence,
      }
    : {
        activationId,
        attemptCount: activation.attempt_count,
        adapterName: activation.adapter_name,
        failureCode: outcome.failureCode,
        retryable: outcome.retryable,
      };

  if (succeeded) {
    const evidence = [
      "Manual administrator confirmation",
      outcome.externalReference
        ? `External reference: ${outcome.externalReference}`
        : null,
      outcome.evidence,
    ]
      .filter((part): part is string => Boolean(part))
      .join("\n");
    await client.query(
      `INSERT INTO ordinary_entitlement
        (id, user_id, resource_id, permission_id, scope_fingerprint,
         source, evidence, valid_from, valid_until, recorded_by)
       VALUES ($1,$2,$3,$4,$5,'manual',$6,$7,$8,$9)`,
      [
        entitlementId,
        activation.requester_user_id,
        activation.resource_id,
        activation.permission_id,
        activation.scope_fingerprint,
        evidence,
        asDate(activation.starts_at),
        asDate(activation.expires_at),
        actorUserId,
      ],
    );
  }

  const requestEventId = randomUUID();
  await client.query(
    `INSERT INTO request_event
      (id, request_id, actor_user_id, event_type, detail, metadata)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
    [
      requestEventId,
      activation.request_id,
      actorUserId,
      eventType,
      eventDetail,
      JSON.stringify(metadata),
    ],
  );
  await client.query(
    `INSERT INTO activation_event
      (id, activation_id, actor_user_id, event_type, idempotency_key,
       adapter_name, external_reference, detail, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
    [
      randomUUID(),
      activationId,
      actorUserId,
      eventType,
      idempotencyKey,
      activation.adapter_name,
      succeeded ? outcome.externalReference : null,
      eventDetail,
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
      activation.requester_user_id,
      activation.request_id,
      eventType,
      JSON.stringify(metadata),
    ],
  );

  const status = succeeded ? "activated" : "failed";
  const updated = await client.query(
    `UPDATE request_activation
        SET status = $1,
            activated_at = CASE WHEN $1 = 'activated' THEN now() ELSE NULL END,
            external_reference = $2,
            failure_code = $3,
            updated_at = now()
      WHERE id = $4 AND status = 'activating'
        AND actor_user_id = $5 AND idempotency_key = $6`,
    [
      status,
      succeeded ? outcome.externalReference : null,
      succeeded ? null : outcome.failureCode,
      activationId,
      actorUserId,
      idempotencyKey,
    ],
  );
  if (updated.rowCount !== 1)
    throw new ActivationDomainError(
      "This activation attempt is no longer current.",
      "activation_attempt_not_current",
    );

  await client.query(
    `INSERT INTO user_notification
      (id, recipient_user_id, request_id, request_event_id,
       notification_type, title, body)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      randomUUID(),
      activation.requester_user_id,
      activation.request_id,
      requestEventId,
      succeeded ? "activation_succeeded" : "activation_failed",
      succeeded ? "Access activated" : "Access activation failed",
      succeeded
        ? "Your approved access has been activated."
        : outcome.retryable
          ? "Your approved access could not be activated. An administrator may retry or contact you."
          : "Your approved access could not be activated because current requirements are not satisfied. Contact an administrator.",
    ],
  );

  return {
    activationId,
    status,
    attemptCount: activation.attempt_count,
    replayed: false,
    failureCode: succeeded ? null : outcome.failureCode,
    retryable: succeeded ? null : outcome.retryable,
  };
}
