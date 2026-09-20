import "server-only";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { routePendingRequest } from "../approval-domain";
import { query, transaction } from "./db";
import type { TrustedIdentity } from "./identity";
import type {
  AccessRequestDto,
  RequestableResourceDto,
  RequestCountsDto,
} from "./request-types";

export class RequestPolicyError extends Error {
  constructor(
    message: string,
    public readonly field = "form",
  ) {
    super(message);
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const toIso = (value: Date | string) => new Date(value).toISOString();

export async function getRequestableResources(
  identity: TrustedIdentity & { requesterRole: "student" | "faculty" },
): Promise<RequestableResourceDto[]> {
  const resources = await query<{
    id: string;
    name: string;
    description: string;
    owner_name: string;
    sensitivity: "Low" | "Medium" | "High";
    icon: string;
    default_days: number;
    max_days: number;
    renewable: boolean;
  }>(
    `SELECT DISTINCT r.id, r.name, r.description, r.owner_name, r.sensitivity,
            r.icon, p.default_days, p.max_days, p.renewable
       FROM catalog_resource r
       JOIN catalog_policy_version p ON p.resource_id = r.id
        AND p.effective_from <= now()
        AND (p.effective_until IS NULL OR p.effective_until > now())
       JOIN catalog_permission cp ON cp.resource_id = r.id AND cp.enabled
       JOIN catalog_permission_role pr ON pr.permission_id = cp.id
      WHERE r.available AND pr.requester_role = $1
      ORDER BY r.name`,
    [identity.requesterRole],
  );

  return Promise.all(
    resources.rows.map(async (resource) => {
      const [permissions, fields, routing] = await Promise.all([
        query<{ id: string; label: string; description: string }>(
          `SELECT cp.id, cp.label, cp.description
           FROM catalog_permission cp
           JOIN catalog_permission_role pr ON pr.permission_id = cp.id
          WHERE cp.resource_id = $1 AND cp.enabled AND pr.requester_role = $2
          ORDER BY cp.label`,
          [resource.id, identity.requesterRole],
        ),
        query<{
          field_name: string;
          label: string;
          id: string | null;
          institutional_code: string | null;
          display_name: string | null;
        }>(
          `SELECT sf.field_name, sf.label, so.id, so.institutional_code, so.display_name
           FROM catalog_scope_field sf
           LEFT JOIN requester_assignment ra ON ra.user_id = $1
            AND ra.resource_id = sf.resource_id
            AND ra.valid_from <= now() AND (ra.valid_until IS NULL OR ra.valid_until > now())
           LEFT JOIN scope_option so ON so.id = ra.scope_option_id
            AND so.field_name = sf.field_name AND so.active
            AND (so.valid_from IS NULL OR so.valid_from <= now())
            AND (so.valid_until IS NULL OR so.valid_until > now())
          WHERE sf.resource_id = $2
          ORDER BY sf.sort_order, so.display_name`,
          [identity.id, resource.id],
        ),
        query<{ count: string }>(
          `SELECT count(DISTINCT ar.id)::text AS count
           FROM approver_responsibility ar
           JOIN user_profile up ON up.user_id = ar.approver_user_id AND up.active
           JOIN user_role ur ON ur.user_id = ar.approver_user_id
            AND ur.role IN ('approver', 'admin')
          WHERE ar.resource_id = $1 AND ar.approver_user_id <> $2
            AND ar.valid_from <= now() AND (ar.valid_until IS NULL OR ar.valid_until > now())`,
          [resource.id, identity.id],
        ),
      ]);
      const grouped = new Map<
        string,
        {
          fieldName: string;
          label: string;
          options: {
            id: string;
            fieldName: string;
            label: string;
            code: string;
            displayName: string;
          }[];
        }
      >();
      for (const row of fields.rows) {
        const field = grouped.get(row.field_name) ?? {
          fieldName: row.field_name,
          label: row.label,
          options: [],
        };
        if (row.id && row.display_name && row.institutional_code)
          field.options.push({
            id: row.id,
            fieldName: row.field_name,
            label: row.label,
            code: row.institutional_code,
            displayName: row.display_name,
          });
        grouped.set(row.field_name, field);
      }
      const blockedReasons: string[] = [];
      for (const field of grouped.values()) {
        if (!field.options.length)
          blockedReasons.push(
            `No current ${field.label.toLowerCase()} assignment is recorded for your account.`,
          );
      }
      if (Number(routing.rows[0]?.count ?? 0) === 0)
        blockedReasons.push(
          "No active approver is configured for this resource.",
        );
      return {
        id: resource.id,
        name: resource.name,
        description: resource.description,
        owner: resource.owner_name,
        sensitivity: resource.sensitivity,
        icon: resource.icon,
        defaultDays: resource.default_days,
        maxDays: resource.max_days,
        renewable: resource.renewable,
        permissions: permissions.rows,
        scopeFields: [...grouped.values()],
        fixedOwnAccount: resource.id === "r-student-portal",
        blockedReasons,
      };
    }),
  );
}

type RawRequest = {
  id: string;
  display_id: string;
  resource_id: string;
  resource_name: string;
  resource_icon: string;
  sensitivity: "Low" | "Medium" | "High";
  permission_id: string;
  permission_label: string;
  purpose: string;
  starts_at: Date;
  expires_at: Date;
  submitted_at: Date;
  status:
    | "pending_routing"
    | "pending_review"
    | "approved_pending_activation"
    | "denied"
    | "returned_for_revision"
    | "expired"
    | "cancelled";
  renewable: boolean;
  renewal_of: string | null;
};

async function hydrateRequests(
  rows: RawRequest[],
): Promise<AccessRequestDto[]> {
  return Promise.all(
    rows.map(async (row) => {
      const [scopes, events] = await Promise.all([
        query<{
          field_name: string;
          label: string;
          display_snapshot: string;
          scope_option_id: string;
        }>(
          `SELECT rs.field_name, sf.label, rs.display_snapshot, rs.scope_option_id
           FROM access_request_scope rs
           JOIN catalog_scope_field sf ON sf.resource_id = $2 AND sf.field_name = rs.field_name
          WHERE rs.request_id = $1 ORDER BY sf.sort_order`,
          [row.id, row.resource_id],
        ),
        query<{
          id: string;
          event_type:
            | "submitted"
            | "renewal_submitted"
            | "request_routed"
            | "request_routing_unavailable"
            | "review_approved"
            | "review_denied"
            | "review_returned_for_revision";
          occurred_at: Date;
          actor_name: string;
          detail: string;
        }>(
          `SELECT event.id, event.event_type, event.occurred_at,
                  coalesce(u.name, 'Permora') AS actor_name, event.detail
             FROM (
               SELECT id, request_id, actor_user_id, event_type, occurred_at, detail
                 FROM request_submission_history
               UNION ALL
               SELECT id, request_id, actor_user_id, event_type, occurred_at, detail
                 FROM request_event
             ) event
             LEFT JOIN "user" u ON u.id = event.actor_user_id
            WHERE event.request_id = $1
            ORDER BY event.occurred_at, event.id`,
          [row.id],
        ),
      ]);
      return {
        id: row.id,
        displayId: row.display_id,
        resourceId: row.resource_id,
        resourceName: row.resource_name,
        resourceIcon: row.resource_icon,
        sensitivity: row.sensitivity,
        permissionId: row.permission_id,
        permissionLabel: row.permission_label,
        purpose: row.purpose,
        startsAt: toIso(row.starts_at),
        expiresAt: toIso(row.expires_at),
        submittedAt: toIso(row.submitted_at),
        status: row.status,
        renewable: row.renewable,
        renewalOf: row.renewal_of,
        scopes: scopes.rows.map((scope) => ({
          fieldName: scope.field_name,
          label: scope.label,
          value: scope.display_snapshot,
          optionId: scope.scope_option_id,
        })),
        events: events.rows.map((event) => ({
          id: event.id,
          type: event.event_type,
          at: toIso(event.occurred_at),
          actorName: event.actor_name,
          detail: event.detail,
        })),
      };
    }),
  );
}

const baseRequestSql = `SELECT ar.id, ar.display_id, ar.resource_id, r.name AS resource_name,
  r.icon AS resource_icon, r.sensitivity, ar.permission_id,
  cp.label AS permission_label, ar.purpose, ar.starts_at, ar.expires_at,
  ar.submitted_at, ar.status, pv.renewable, ar.renewal_of
  FROM access_request ar
  JOIN catalog_resource r ON r.id = ar.resource_id
  JOIN catalog_permission cp ON cp.id = ar.permission_id
  JOIN catalog_policy_version pv ON pv.id = ar.policy_version_id`;

export async function listOwnedRequests(
  userId: string,
  filters: {
    query?: string;
    status?: string;
    resource?: string;
    from?: string;
    to?: string;
  } = {},
) {
  const values: unknown[] = [userId];
  const where = ["ar.requester_user_id = $1"];
  const add = (condition: string, value: unknown) => {
    values.push(value);
    where.push(condition.replaceAll("?", `$${values.length}`));
  };
  if (
    filters.status &&
    [
      "pending",
      "pending_routing",
      "pending_review",
      "approved_pending_activation",
      "denied",
      "returned_for_revision",
      "expired",
      "cancelled",
    ].includes(filters.status)
  )
    if (filters.status === "pending")
      where.push("ar.status IN ('pending_routing', 'pending_review')");
    else add("ar.status = ?", filters.status);
  if (filters.resource) add("ar.resource_id = ?", filters.resource);
  if (filters.from && ISO_DATE.test(filters.from))
    add("ar.submitted_at >= ?::date", filters.from);
  if (filters.to && ISO_DATE.test(filters.to))
    add("ar.submitted_at < (?::date + interval '1 day')", filters.to);
  if (filters.query?.trim())
    add(
      "(ar.display_id ILIKE '%' || ? || '%' OR r.name ILIKE '%' || ? || '%' OR cp.label ILIKE '%' || ? || '%')",
      filters.query.trim(),
    );
  const result = await query<RawRequest>(
    `${baseRequestSql} WHERE ${where.join(" AND ")} ORDER BY ar.submitted_at DESC`,
    values,
  );
  return hydrateRequests(result.rows);
}

export async function getOwnedRequest(userId: string, id: string) {
  const result = await query<RawRequest>(
    `${baseRequestSql} WHERE ar.requester_user_id = $1 AND (ar.id::text = $2 OR ar.display_id = $2)`,
    [userId, id],
  );
  return (await hydrateRequests(result.rows))[0] ?? null;
}

export async function getOwnedRequestCounts(
  userId: string,
): Promise<RequestCountsDto> {
  const result = await query<{
    total: number;
    pending: number;
    denied: number;
    expired: number;
    approved: number;
  }>(
    `SELECT count(*)::int AS total,
      count(*) FILTER (WHERE status IN ('pending_routing', 'pending_review'))::int AS pending,
      count(*) FILTER (WHERE status = 'denied')::int AS denied,
      count(*) FILTER (WHERE status = 'expired')::int AS expired,
      count(*) FILTER (WHERE status = 'approved_pending_activation')::int AS approved
      FROM access_request WHERE requester_user_id = $1`,
    [userId],
  );
  const row = result.rows[0] ?? {
    total: 0,
    pending: 0,
    denied: 0,
    expired: 0,
    approved: 0,
  };
  return { ...row, active: 0 };
}

export async function listOwnedRequestResources(userId: string) {
  const result = await query<{ id: string; name: string }>(
    `SELECT DISTINCT r.id, r.name
       FROM access_request ar
       JOIN catalog_resource r ON r.id = ar.resource_id
      WHERE ar.requester_user_id = $1
      ORDER BY r.name`,
    [userId],
  );
  return result.rows;
}

async function validateAndInsert(
  client: PoolClient,
  identity: TrustedIdentity & { requesterRole: "student" | "faculty" },
  input: Record<string, string>,
) {
  const purpose = input.purpose?.trim() ?? "";
  if (purpose.length < 20 || purpose.length > 2000)
    throw new RequestPolicyError(
      "Purpose must be between 20 and 2,000 characters.",
      "purpose",
    );
  if (!ISO_DATE.test(input.startsAt ?? ""))
    throw new RequestPolicyError("Choose a valid start date.", "startsAt");
  if (!ISO_DATE.test(input.expiresAt ?? ""))
    throw new RequestPolicyError(
      "Choose a valid expiration date.",
      "expiresAt",
    );
  const startsAt = new Date(`${input.startsAt}T09:00:00.000Z`);
  const expiresAt = new Date(`${input.expiresAt}T09:00:00.000Z`);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  if (startsAt < today)
    throw new RequestPolicyError(
      "Start date cannot be in the past.",
      "startsAt",
    );
  if (expiresAt <= startsAt)
    throw new RequestPolicyError(
      "Expiration must be after the start date.",
      "expiresAt",
    );

  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `${identity.id}:${input.resourceId}`,
  ]);
  const policy = await client.query<{
    policy_id: string;
    max_days: number;
    renewable: boolean;
  }>(
    `SELECT pv.id AS policy_id, pv.max_days, pv.renewable
       FROM catalog_resource r
       JOIN catalog_policy_version pv ON pv.resource_id = r.id
        AND pv.effective_from <= now() AND (pv.effective_until IS NULL OR pv.effective_until > now())
       JOIN catalog_permission cp ON cp.resource_id = r.id AND cp.id = $2 AND cp.enabled
       JOIN catalog_permission_role pr ON pr.permission_id = cp.id AND pr.requester_role = $3
      WHERE r.id = $1 AND r.available`,
    [input.resourceId, input.permissionId, identity.requesterRole],
  );
  const current = policy.rows[0];
  if (!current)
    throw new RequestPolicyError(
      "This resource or permission is not available for your assigned requester role.",
      "resourceId",
    );
  if (
    (expiresAt.getTime() - startsAt.getTime()) / 86_400_000 >
    current.max_days
  )
    throw new RequestPolicyError(
      `The requested period exceeds the ${current.max_days}-day policy maximum.`,
      "expiresAt",
    );

  const required = await client.query<{ field_name: string; label: string }>(
    "SELECT field_name, label FROM catalog_scope_field WHERE resource_id = $1 AND required ORDER BY sort_order",
    [input.resourceId],
  );
  const scopes: { fieldName: string; optionId: string; snapshot: string }[] =
    [];
  for (const field of required.rows) {
    const optionId = input[`scope:${field.field_name}`];
    if (!optionId)
      throw new RequestPolicyError(
        `Select ${field.label.toLowerCase()}.`,
        field.field_name,
      );
    const assigned = await client.query<{ display_name: string }>(
      `SELECT so.display_name FROM scope_option so
       JOIN requester_assignment ra ON ra.scope_option_id = so.id
        AND ra.user_id = $1 AND ra.resource_id = $2
        AND (ra.permission_id IS NULL OR ra.permission_id = $3)
        AND ra.valid_from <= now() AND (ra.valid_until IS NULL OR ra.valid_until > now())
       WHERE so.id = $4 AND so.resource_id = $2 AND so.field_name = $5 AND so.active
        AND (so.valid_from IS NULL OR so.valid_from <= now())
        AND (so.valid_until IS NULL OR so.valid_until > now())`,
      [
        identity.id,
        input.resourceId,
        input.permissionId,
        optionId,
        field.field_name,
      ],
    );
    if (!assigned.rows[0])
      throw new RequestPolicyError(
        `Your current assignment does not allow the selected ${field.label.toLowerCase()}.`,
        field.field_name,
      );
    scopes.push({
      fieldName: field.field_name,
      optionId,
      snapshot: assigned.rows[0].display_name,
    });
  }
  if (
    input.resourceId === "r-student-portal" &&
    Object.keys(input).some((key) => key.startsWith("scope:"))
  )
    throw new RequestPolicyError(
      "Student Portal requests are limited to your own account.",
      "resourceId",
    );
  const fingerprint =
    input.resourceId === "r-student-portal"
      ? `own-account:${identity.id}`
      : scopes
          .map((scope) => `${scope.fieldName}:${scope.optionId}`)
          .sort()
          .join("|") || "resource-wide";

  if (input.renewalOf) {
    const previous = await client.query<{
      resource_id: string;
      permission_id: string;
      scope_fingerprint: string;
      status: string;
    }>(
      "SELECT resource_id, permission_id, scope_fingerprint, status FROM access_request WHERE id::text = $1 AND requester_user_id = $2 FOR UPDATE",
      [input.renewalOf, identity.id],
    );
    const old = previous.rows[0];
    if (!old)
      throw new RequestPolicyError(
        "The request selected for renewal is not available.",
      );
    if (!current.renewable)
      throw new RequestPolicyError(
        "This resource policy does not allow renewal.",
      );
    if (old.status !== "expired")
      throw new RequestPolicyError("Only an expired request can be renewed.");
    if (
      old.resource_id !== input.resourceId ||
      old.permission_id !== input.permissionId ||
      old.scope_fingerprint !== fingerprint
    )
      throw new RequestPolicyError(
        "Renewal resource, permission, and scope must match the expired request.",
      );
  }

  const entitlement = await client.query(
    `SELECT 1 FROM ordinary_entitlement WHERE user_id = $1 AND resource_id = $2
      AND permission_id = $3 AND scope_fingerprint = $4
      AND valid_from < $6 AND (valid_until IS NULL OR valid_until > $5) LIMIT 1`,
    [
      identity.id,
      input.resourceId,
      input.permissionId,
      fingerprint,
      startsAt,
      expiresAt,
    ],
  );
  if (entitlement.rows[0])
    throw new RequestPolicyError(
      "This access is already supplied through an existing assignment or entitlement.",
    );
  const duplicate = await client.query(
    `SELECT 1 FROM access_request WHERE requester_user_id = $1 AND resource_id = $2
      AND permission_id = $3 AND scope_fingerprint = $4
      AND status IN ('pending_routing', 'pending_review')
      AND starts_at < $6 AND expires_at > $5 LIMIT 1`,
    [
      identity.id,
      input.resourceId,
      input.permissionId,
      fingerprint,
      startsAt,
      expiresAt,
    ],
  );
  if (duplicate.rows[0])
    throw new RequestPolicyError(
      "A pending request already covers this permission, scope, and date range.",
    );

  const id = randomUUID();
  const seq = await client.query<{ value: string }>(
    "SELECT nextval('access_request_display_seq')::text AS value",
  );
  const displayId = `REQ-${new Date().getUTCFullYear()}-${String(seq.rows[0].value).padStart(6, "0")}`;
  await client.query(
    `INSERT INTO access_request (id, display_id, requester_user_id, resource_id, permission_id,
      policy_version_id, purpose, starts_at, expires_at, scope_fingerprint, renewal_of)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      id,
      displayId,
      identity.id,
      input.resourceId,
      input.permissionId,
      current.policy_id,
      purpose,
      startsAt,
      expiresAt,
      fingerprint,
      input.renewalOf || null,
    ],
  );
  for (const scope of scopes)
    await client.query(
      "INSERT INTO access_request_scope (request_id, field_name, scope_option_id, display_snapshot) VALUES ($1,$2,$3,$4)",
      [id, scope.fieldName, scope.optionId, scope.snapshot],
    );
  const eventId = randomUUID();
  const eventType = input.renewalOf ? "renewal_submitted" : "submitted";
  await client.query(
    "INSERT INTO request_submission_history (id, request_id, actor_user_id, event_type, detail) VALUES ($1,$2,$3,$4,$5)",
    [
      eventId,
      id,
      identity.id,
      eventType,
      input.renewalOf
        ? "Renewal submitted for review."
        : "Request submitted for review.",
    ],
  );
  await client.query(
    "INSERT INTO audit_event (id, actor_user_id, subject_user_id, request_id, event_type, metadata) VALUES ($1,$2,$2,$3,$4,$5::jsonb)",
    [
      randomUUID(),
      identity.id,
      id,
      eventType,
      JSON.stringify({
        displayId,
        resourceId: input.resourceId,
        permissionId: input.permissionId,
      }),
    ],
  );
  const route = await routePendingRequest(client, id, identity.id);
  return {
    id,
    displayId,
    status: route.routed ? "pending_review" : "pending_routing",
  };
}

export function createAccessRequest(
  identity: TrustedIdentity & { requesterRole: "student" | "faculty" },
  input: Record<string, string>,
) {
  return transaction((client) => validateAndInsert(client, identity, input));
}
