import "server-only";
import { query } from "./db";

export type AdministratorActivationItem = {
  requestId: string;
  displayId: string;
  requesterName: string;
  resourceName: string;
  permissionLabel: string;
  startsAt: string;
  expiresAt: string;
  approvalStatus: "approved_pending_activation";
  activationStatus: "activating" | "activated" | "failed" | "expired" | "revoked" | null;
  retryable: boolean | null;
  attemptCount: number;
  lastAttemptAt: string | null;
};

export async function listAdministratorActivations(): Promise<AdministratorActivationItem[]> {
  const result = await query<{
    request_id: string;
    display_id: string;
    requester_name: string;
    resource_name: string;
    permission_label: string;
    starts_at: Date | string;
    expires_at: Date | string;
    activation_status: AdministratorActivationItem["activationStatus"];
    retryable: string | null;
    attempt_count: number | null;
    last_attempt_at: Date | string | null;
  }>(
    `SELECT request.id AS request_id, request.display_id,
            requester.name AS requester_name, resource.name AS resource_name,
            permission.label AS permission_label, request.starts_at,
            request.expires_at, activation.status AS activation_status,
            failure.metadata ->> 'retryable' AS retryable,
            activation.attempt_count, activation.last_attempt_at
       FROM access_request request
       JOIN request_decision decision
         ON decision.request_id = request.id
        AND decision.action = 'approve'
        AND decision.resulting_status = 'approved_pending_activation'
       JOIN "user" requester ON requester.id = request.requester_user_id
       JOIN catalog_resource resource ON resource.id = request.resource_id
       JOIN catalog_permission permission ON permission.id = request.permission_id
       LEFT JOIN request_activation activation ON activation.request_id = request.id
       LEFT JOIN LATERAL (
         SELECT event.metadata
           FROM activation_event event
          WHERE event.activation_id = activation.id
            AND event.event_type = 'activation_failed'
          ORDER BY event.occurred_at DESC, event.id DESC
          LIMIT 1
       ) failure ON true
      WHERE request.status = 'approved_pending_activation'
      ORDER BY request.expires_at, request.submitted_at, request.id`,
  );
  return result.rows.map((row) => ({
    requestId: row.request_id,
    displayId: row.display_id,
    requesterName: row.requester_name,
    resourceName: row.resource_name,
    permissionLabel: row.permission_label,
    startsAt: new Date(row.starts_at).toISOString(),
    expiresAt: new Date(row.expires_at).toISOString(),
    approvalStatus: "approved_pending_activation",
    activationStatus: row.activation_status,
    retryable: row.retryable === null ? null : row.retryable === "true",
    attemptCount: row.attempt_count ?? 0,
    lastAttemptAt: row.last_attempt_at
      ? new Date(row.last_attempt_at).toISOString()
      : null,
  }));
}
