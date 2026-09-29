import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

export type StuckActivationCandidate = {
  activationId: string;
  requestId: string;
  lastAttemptAt: string;
};

export type ReconciledActivation = {
  activationId: string;
  action: "failed" | "recovered" | "skipped";
  status: "activated" | "failed" | "activating";
  retryable: boolean | null;
};

export type ExpiredActivationCandidate = {
  activationId: string;
  requestId: string;
  expiresAt: string;
};

export type ExpiredActivationResult = {
  activationId: string;
  expired: boolean;
};

const STUCK_MINUTES = 15;

async function revalidationFailure(client: PoolClient, requestId: string) {
  const requestResult = await client.query<{
    requester_user_id: string;
    resource_id: string;
    permission_id: string;
    policy_version_id: string;
    scope_fingerprint: string;
    starts_at: Date;
    expires_at: Date;
    status: string;
  }>(
    `SELECT requester_user_id, resource_id, permission_id, policy_version_id,
            scope_fingerprint, starts_at, expires_at, status
       FROM access_request WHERE id = $1`,
    [requestId],
  );
  const request = requestResult.rows[0];
  if (!request || request.status !== "approved_pending_activation")
    return "The request is no longer approved for activation.";

  const current = await client.query<{
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
  const policy = current.rows[0];
  if (!policy)
    return "The requester or requested resource is no longer eligible.";
  if (policy.policy_id !== request.policy_version_id)
    return "The approved policy version is no longer current.";
  const durationDays =
    (request.expires_at.getTime() - request.starts_at.getTime()) / 86_400_000;
  if (
    request.expires_at <= new Date() ||
    !Number.isFinite(durationDays) ||
    durationDays <= 0 ||
    durationDays > policy.max_days
  )
    return "The requested dates no longer satisfy the active policy.";

  const scopes = await client.query<{
    scope_option_id: string | null;
    active_option: boolean;
    active_assignment: boolean;
  }>(
    `SELECT requested.scope_option_id,
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
    [request.requester_user_id, request.resource_id, request.permission_id, requestId],
  );
  if (
    scopes.rows.some(
      (scope) =>
        !scope.scope_option_id || !scope.active_option || !scope.active_assignment,
    ) ||
    (request.resource_id === "r-student-portal" &&
      request.scope_fingerprint !== `own-account:${request.requester_user_id}`)
  )
    return "The requester no longer holds every required scope assignment.";

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
      request.starts_at,
      request.expires_at,
      requestId,
    ],
  );
  return conflict.rows[0]
    ? "The request now conflicts with an entitlement or another approved request."
    : null;
}

export async function listStuckActivationCandidates(
  client: PoolClient,
): Promise<StuckActivationCandidate[]> {
  const result = await client.query<{
    activation_id: string;
    request_id: string;
    last_attempt_at: Date;
  }>(
    `SELECT activation.id AS activation_id, activation.request_id,
            activation.last_attempt_at
       FROM request_activation activation
      WHERE activation.status = 'activating'
        AND activation.last_attempt_at <= now() - interval '15 minutes'
      ORDER BY activation.last_attempt_at, activation.id`,
  );
  return result.rows.map((row) => ({
    activationId: row.activation_id,
    requestId: row.request_id,
    lastAttemptAt: row.last_attempt_at.toISOString(),
  }));
}

export async function reconcileStuckActivation(
  client: PoolClient,
  activationId: string,
): Promise<ReconciledActivation> {
  const locked = await client.query<{
    request_id: string;
    requester_user_id: string;
    status: string;
    last_attempt_at: Date;
    idempotency_key: string;
    actor_user_id: string;
    adapter_name: string;
    attempt_count: number;
  }>(
    `SELECT activation.request_id, request.requester_user_id,
            activation.status, activation.last_attempt_at,
            activation.idempotency_key, activation.actor_user_id,
            activation.adapter_name, activation.attempt_count
       FROM request_activation activation
       JOIN access_request request ON request.id = activation.request_id
      WHERE activation.id = $1
      FOR UPDATE OF activation`,
    [activationId],
  );
  const activation = locked.rows[0];
  if (!activation || activation.status !== "activating")
    return { activationId, action: "skipped", status: "activating", retryable: null };
  if (activation.last_attempt_at.getTime() > Date.now() - STUCK_MINUTES * 60_000)
    return { activationId, action: "skipped", status: "activating", retryable: null };

  const previousOutcome = await client.query<{
    event_type: "activation_succeeded" | "activation_failed";
    retryable: string | null;
  }>(
    `SELECT event_type, metadata ->> 'retryable' AS retryable
       FROM activation_event
      WHERE activation_id = $1 AND idempotency_key = $2
        AND event_type IN ('activation_succeeded', 'activation_failed')
      ORDER BY occurred_at DESC, id DESC
      LIMIT 1`,
    [activationId, activation.idempotency_key],
  );
  if (previousOutcome.rows[0]) {
    const prior = previousOutcome.rows[0];
    const status = prior.event_type === "activation_succeeded" ? "activated" : "failed";
    await client.query(
      `UPDATE request_activation
          SET status = $1,
              activated_at = CASE WHEN $1 = 'activated' THEN coalesce(activated_at, now()) ELSE NULL END,
              failure_code = CASE WHEN $1 = 'failed' THEN 'recorded_outcome_recovered' ELSE NULL END,
              updated_at = now()
        WHERE id = $2 AND status = 'activating'`,
      [status, activationId],
    );
    return {
      activationId,
      action: "recovered",
      status,
      retryable: prior.retryable === null ? null : prior.retryable === "true",
    };
  }

  const invalidReason = await revalidationFailure(client, activation.request_id);
  const retryable = invalidReason === null;
  const failureCode = retryable
    ? "activation_attempt_timeout"
    : "activation_revalidation_failed";
  const detail =
    invalidReason ??
    "The activation attempt exceeded 15 minutes without a durable adapter result. Verify the manual provisioning state before starting a new attempt.";
  const metadata = {
    attemptCount: activation.attempt_count,
    failureCode,
    retryable,
    reason: detail,
    adapterName: activation.adapter_name,
  };
  const requestEventId = randomUUID();
  await client.query(
    `INSERT INTO activation_event
      (id, activation_id, actor_user_id, event_type, idempotency_key,
       adapter_name, detail, metadata)
     VALUES ($1,$2,NULL,'activation_failed',$3,$4,$5,$6::jsonb)`,
    [randomUUID(), activationId, activation.idempotency_key, activation.adapter_name, detail, JSON.stringify(metadata)],
  );
  await client.query(
    `INSERT INTO request_event
      (id, request_id, actor_user_id, event_type, detail, metadata)
     VALUES ($1,$2,NULL,'activation_failed',$3,$4::jsonb)`,
    [requestEventId, activation.request_id, detail, JSON.stringify(metadata)],
  );
  await client.query(
    `INSERT INTO audit_event
      (id, actor_user_id, subject_user_id, request_id, event_type, metadata)
     VALUES ($1,NULL,$2,$3,'activation_failed',$4::jsonb)`,
    [randomUUID(), activation.requester_user_id, activation.request_id, JSON.stringify(metadata)],
  );
  const updated = await client.query(
    `UPDATE request_activation
        SET status = 'failed', failure_code = $1, updated_at = now()
      WHERE id = $2 AND status = 'activating'
        AND idempotency_key = $3`,
    [failureCode, activationId, activation.idempotency_key],
  );
  if (updated.rowCount !== 1)
    return { activationId, action: "skipped", status: "activating", retryable: null };
  await client.query(
    `INSERT INTO user_notification
      (id, recipient_user_id, request_id, request_event_id,
       notification_type, title, body)
     VALUES ($1,$2,$3,$4,'activation_failed','Access activation requires attention',$5)`,
    [
      randomUUID(),
      activation.requester_user_id,
      activation.request_id,
      requestEventId,
      retryable
        ? "We could not confirm the activation result. An administrator will verify the provisioning state before retrying."
        : "Your access request no longer meets current eligibility or policy requirements. Contact an administrator.",
    ],
  );
  return { activationId, action: "failed", status: "failed", retryable };
}

export async function listExpiredActivationCandidates(
  client: PoolClient,
): Promise<ExpiredActivationCandidate[]> {
  const result = await client.query<{
    activation_id: string;
    request_id: string;
    expires_at: Date;
  }>(
    `SELECT activation.id AS activation_id, activation.request_id,
            activation.expires_at
       FROM request_activation activation
      WHERE activation.status = 'activated'
        AND activation.expires_at <= now()
      ORDER BY activation.expires_at, activation.id`,
  );
  return result.rows.map((row) => ({
    activationId: row.activation_id,
    requestId: row.request_id,
    expiresAt: row.expires_at.toISOString(),
  }));
}

export async function expireActivatedEntitlement(
  client: PoolClient,
  activationId: string,
): Promise<ExpiredActivationResult> {
  const result = await client.query<{
    request_id: string;
    requester_user_id: string;
    status: string;
    expires_at: Date;
  }>(
    `SELECT activation.request_id, request.requester_user_id,
            activation.status, activation.expires_at
       FROM request_activation activation
       JOIN access_request request ON request.id = activation.request_id
      WHERE activation.id = $1
      FOR UPDATE OF activation`,
    [activationId],
  );
  const activation = result.rows[0];
  if (
    !activation ||
    activation.status !== "activated" ||
    activation.expires_at > new Date()
  )
    return { activationId, expired: false };

  const metadata = { activationId, expiredAt: activation.expires_at.toISOString() };
  await client.query(
    `INSERT INTO activation_event
      (id, activation_id, event_type, detail, metadata)
     VALUES ($1,$2,'activation_expired','The approved access validity window ended.',$3::jsonb)`,
    [randomUUID(), activationId, JSON.stringify(metadata)],
  );
  await client.query(
    `INSERT INTO audit_event
      (id, subject_user_id, request_id, event_type, metadata)
     VALUES ($1,$2,$3,'activation_expired',$4::jsonb)`,
    [randomUUID(), activation.requester_user_id, activation.request_id, JSON.stringify(metadata)],
  );
  const updated = await client.query(
    `UPDATE request_activation
        SET status = 'expired', updated_at = now()
      WHERE id = $1 AND status = 'activated' AND expires_at <= now()`,
    [activationId],
  );
  return { activationId, expired: updated.rowCount === 1 };
}

export async function revokeActivatedEntitlement(
  client: PoolClient,
  actorUserId: string,
  activationId: string,
  reason: string,
) {
  const normalizedReason = reason.trim();
  if (!normalizedReason || normalizedReason.length > 2000)
    throw new Error("A revocation reason between 1 and 2,000 characters is required.");
  const administrator = await client.query(
    `SELECT 1 FROM user_profile profile
      WHERE profile.user_id = $1 AND profile.active
        AND EXISTS (SELECT 1 FROM user_role role
                     WHERE role.user_id = profile.user_id AND role.role = 'admin')`,
    [actorUserId],
  );
  if (!administrator.rows[0])
    throw new Error("An active administrator is required to revoke access.");

  const result = await client.query<{
    request_id: string;
    requester_user_id: string;
    status: string;
    entitlement_id: string | null;
  }>(
    `SELECT activation.request_id, request.requester_user_id,
            activation.status,
            success.metadata ->> 'entitlementId' AS entitlement_id
       FROM request_activation activation
       JOIN access_request request ON request.id = activation.request_id
       LEFT JOIN LATERAL (
         SELECT event.metadata
           FROM activation_event event
          WHERE event.activation_id = activation.id
            AND event.event_type = 'activation_succeeded'
          ORDER BY event.occurred_at DESC, event.id DESC
          LIMIT 1
       ) success ON true
      WHERE activation.id = $1
      FOR UPDATE OF activation`,
    [activationId],
  );
  const activation = result.rows[0];
  if (!activation || activation.status !== "activated")
    return false;
  if (!activation.entitlement_id)
    throw new Error("The activated entitlement record is unavailable for revocation.");

  await client.query(
    `DELETE FROM ordinary_entitlement
      WHERE id = $1 AND valid_from >= now()`,
    [activation.entitlement_id],
  );
  await client.query(
    `UPDATE ordinary_entitlement
        SET valid_until = now()
      WHERE id = $1 AND valid_from < now()
        AND (valid_until IS NULL OR valid_until > now())`,
    [activation.entitlement_id],
  );

  const metadata = { activationId, reason: normalizedReason };
  await client.query(
    `INSERT INTO activation_event
      (id, activation_id, actor_user_id, event_type, detail, metadata)
     VALUES ($1,$2,$3,'activation_revoked',$4,$5::jsonb)`,
    [randomUUID(), activationId, actorUserId, normalizedReason, JSON.stringify(metadata)],
  );
  await client.query(
    `INSERT INTO audit_event
      (id, actor_user_id, subject_user_id, request_id, event_type, metadata)
     VALUES ($1,$2,$3,$4,'activation_revoked',$5::jsonb)`,
    [randomUUID(), actorUserId, activation.requester_user_id, activation.request_id, JSON.stringify(metadata)],
  );
  const updated = await client.query(
    `UPDATE request_activation SET status = 'revoked', updated_at = now()
      WHERE id = $1 AND status = 'activated'`,
    [activationId],
  );
  return updated.rowCount === 1;
}
