import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

export type StartActivationInput = {
  requestId: string;
  idempotencyKey: string;
};

export type ActivationStartResult = {
  activationId: string;
  status: "activating" | "activated" | "failed" | "expired" | "revoked";
  attemptCount: number;
  replayed: boolean;
  failureCode: string | null;
  retryable: boolean | null;
};

export class ActivationDomainError extends Error {
  constructor(
    message: string,
    readonly code:
      | "request_unavailable"
      | "invalid_transition"
      | "activation_in_progress"
      | "idempotency_conflict"
      | "not_authorized"
      | "activation_forbidden"
      | "activation_revalidation_failed"
      | "activation_conflict"
      | "invalid_outcome"
      | "activation_attempt_not_current",
  ) {
    super(message);
    this.name = "ActivationDomainError";
  }
}

const MANUAL_ADAPTER_NAME = "manual-admin";

export async function startActivationAttempt(
  client: PoolClient,
  actorUserId: string,
  input: StartActivationInput,
): Promise<ActivationStartResult> {
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
    [`${actorUserId}:${input.idempotencyKey}`],
  );

  const priorAttempt = await client.query<{
    activation_id: string;
    request_id: string;
    attempt_count: string;
    outcome_status: ActivationStartResult["status"];
    outcome_failure_code: string | null;
    outcome_retryable: string | null;
  }>(
    `SELECT event.activation_id, activation.request_id,
            event.metadata ->> 'attemptCount' AS attempt_count,
            coalesce(
              (SELECT CASE outcome.event_type
                        WHEN 'activation_succeeded' THEN 'activated'
                        WHEN 'activation_failed' THEN 'failed'
                      END
                 FROM activation_event outcome
                WHERE outcome.activation_id = event.activation_id
                  AND outcome.idempotency_key = event.idempotency_key
                  AND outcome.event_type IN ('activation_succeeded', 'activation_failed')
                ORDER BY outcome.occurred_at DESC, outcome.id DESC
                LIMIT 1),
              CASE
                WHEN activation.idempotency_key = event.idempotency_key
                  THEN activation.status
                ELSE 'activating'
              END
            ) AS outcome_status,
            (SELECT outcome.metadata ->> 'failureCode'
               FROM activation_event outcome
              WHERE outcome.activation_id = event.activation_id
                AND outcome.idempotency_key = event.idempotency_key
                AND outcome.event_type = 'activation_failed'
              ORDER BY outcome.occurred_at DESC, outcome.id DESC
              LIMIT 1) AS outcome_failure_code,
            (SELECT outcome.metadata ->> 'retryable'
               FROM activation_event outcome
              WHERE outcome.activation_id = event.activation_id
                AND outcome.idempotency_key = event.idempotency_key
                AND outcome.event_type = 'activation_failed'
              ORDER BY outcome.occurred_at DESC, outcome.id DESC
              LIMIT 1) AS outcome_retryable
       FROM activation_event event
       JOIN request_activation activation ON activation.id = event.activation_id
      WHERE event.actor_user_id = $1
        AND event.idempotency_key = $2
        AND event.event_type = 'activation_started'`,
    [actorUserId, input.idempotencyKey],
  );
  const prior = priorAttempt.rows[0];
  if (prior) {
    if (prior.request_id !== input.requestId)
      throw new ActivationDomainError(
        "This idempotency key was already used for another activation request.",
        "idempotency_conflict",
      );
    return {
      activationId: prior.activation_id,
      status: prior.outcome_status,
      attemptCount: Number(prior.attempt_count),
      replayed: true,
      failureCode: prior.outcome_failure_code,
      retryable:
        prior.outcome_retryable === null
          ? null
          : prior.outcome_retryable === "true",
    };
  }

  const requestResult = await client.query<{
    decision_id: string;
    expires_at: Date;
  }>(
    `SELECT decision.id AS decision_id, request.expires_at
       FROM access_request request
       JOIN request_decision decision
         ON decision.request_id = request.id
        AND decision.action = 'approve'
        AND decision.resulting_status = 'approved_pending_activation'
      WHERE request.id = $1
        AND request.status = 'approved_pending_activation'
      FOR UPDATE OF request`,
    [input.requestId],
  );
  const request = requestResult.rows[0];
  if (!request)
    throw new ActivationDomainError(
      "The approved request is not available for activation.",
      "request_unavailable",
    );

  const activationResult = await client.query<{
    id: string;
    status: "activating" | "activated" | "failed" | "expired" | "revoked";
    attempt_count: number;
    failure_retryable: string | null;
  }>(
    `SELECT activation.id, activation.status, activation.attempt_count,
            (SELECT event.metadata ->> 'retryable'
               FROM activation_event event
              WHERE event.activation_id = activation.id
                AND event.event_type = 'activation_failed'
              ORDER BY event.occurred_at DESC, event.id DESC
              LIMIT 1) AS failure_retryable
       FROM request_activation activation
      WHERE activation.request_id = $1
      FOR UPDATE OF activation`,
    [input.requestId],
  );
  const existing = activationResult.rows[0];
  if (existing?.status === "activating")
    throw new ActivationDomainError(
      "An activation attempt is already in progress for this request.",
      "activation_in_progress",
    );
  if (
    existing &&
    (existing.status !== "failed" || existing.failure_retryable !== "true")
  )
    throw new ActivationDomainError(
      "This activation lifecycle cannot be started from its current state.",
      "invalid_transition",
    );

  const activationId = existing?.id ?? randomUUID();
  const attemptCount = (existing?.attempt_count ?? 0) + 1;
  if (existing) {
    await client.query(
      `UPDATE request_activation
          SET status = 'activating', adapter_name = $1,
              actor_user_id = $2, idempotency_key = $3,
              attempt_count = $4, started_at = now(), last_attempt_at = now(),
              activated_at = NULL, external_reference = NULL,
              failure_code = NULL, updated_at = now()
        WHERE id = $5`,
      [
        MANUAL_ADAPTER_NAME,
        actorUserId,
        input.idempotencyKey,
        attemptCount,
        activationId,
      ],
    );
  } else {
    await client.query(
      `INSERT INTO request_activation
        (id, request_id, decision_id, status, adapter_name, actor_user_id,
         idempotency_key, attempt_count, expires_at)
       VALUES ($1,$2,$3,'activating',$4,$5,$6,$7,$8)`,
      [
        activationId,
        input.requestId,
        request.decision_id,
        MANUAL_ADAPTER_NAME,
        actorUserId,
        input.idempotencyKey,
        attemptCount,
        request.expires_at,
      ],
    );
  }

  await client.query(
    `INSERT INTO activation_event
      (id, activation_id, actor_user_id, event_type, idempotency_key,
       adapter_name, detail, metadata)
     VALUES ($1,$2,$3,'activation_started',$4,$5,$6,$7::jsonb)`,
    [
      randomUUID(),
      activationId,
      actorUserId,
      input.idempotencyKey,
      MANUAL_ADAPTER_NAME,
      existing ? "Activation retry started." : "Activation started.",
      JSON.stringify({ requestId: input.requestId, attemptCount }),
    ],
  );

  return {
    activationId,
    status: "activating",
    attemptCount,
    replayed: false,
    failureCode: null,
    retryable: null,
  };
}
