import "server-only";
import type { QueryResultRow } from "pg";
import type { TrustedIdentity } from "@/lib/auth-types";
import { query } from "./db";
import type {
  ApprovalListFilters,
  PaginatedDto,
  ReviewQueueItemDto,
  ReviewQueueStatus,
  ReviewRequestDetailDto,
  ReviewTimelineEventDto,
  UnassignedRequestDto,
} from "./approval-read-types";

const REVIEW_STATUSES = new Set<ReviewQueueStatus>([
  "pending_review",
  "approved_pending_activation",
  "denied",
  "returned_for_revision",
  "expired",
  "cancelled",
]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const RESOURCE_ID = /^[a-z0-9][a-z0-9:-]{0,79}$/;

export class ApprovalQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApprovalQueryError";
  }
}

function validDate(value: string) {
  if (!ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function positiveInteger(value: string | null, fallback: number, maximum: number) {
  if (value === null || value === "") return fallback;
  if (!/^\d+$/.test(value))
    throw new ApprovalQueryError("Pagination values must be positive integers.");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1)
    throw new ApprovalQueryError("Pagination values must be positive integers.");
  return Math.min(parsed, maximum);
}

export function parseApprovalListFilters(
  searchParams: URLSearchParams,
  mode: "assigned" | "unassigned",
): ApprovalListFilters {
  const status = searchParams.get("status")?.trim() || undefined;
  if (
    status &&
    (mode === "assigned"
      ? !REVIEW_STATUSES.has(status as ReviewQueueStatus)
      : status !== "pending_routing")
  )
    throw new ApprovalQueryError("The status filter is not supported.");
  const resource = searchParams.get("resource")?.trim() || undefined;
  if (resource && !RESOURCE_ID.test(resource))
    throw new ApprovalQueryError("The resource filter is invalid.");
  const from = searchParams.get("from")?.trim() || undefined;
  const to = searchParams.get("to")?.trim() || undefined;
  if (from && !validDate(from))
    throw new ApprovalQueryError("The start date filter is invalid.");
  if (to && !validDate(to))
    throw new ApprovalQueryError("The end date filter is invalid.");
  if (from && to && from > to)
    throw new ApprovalQueryError("The date filter range is invalid.");
  const search = searchParams.get("search")?.trim() || undefined;
  if (search && search.length > 100)
    throw new ApprovalQueryError("Search must be 100 characters or fewer.");
  return {
    status: status as ApprovalListFilters["status"],
    resource,
    from,
    to,
    search,
    page: positiveInteger(searchParams.get("page"), 1, 10_000),
    pageSize: positiveInteger(searchParams.get("pageSize"), 20, 100),
  };
}

const fullScopeResponsibilitySql = `(
  NOT EXISTS (
    SELECT 1 FROM approver_responsibility_scope configured
     WHERE configured.responsibility_id = responsibility.id
  )
  OR (
    EXISTS (SELECT 1 FROM access_request_scope requested_any WHERE requested_any.request_id = request.id)
    AND NOT EXISTS (
      SELECT 1 FROM access_request_scope requested
       WHERE requested.request_id = request.id
         AND NOT EXISTS (
           SELECT 1 FROM approver_responsibility_scope configured
            WHERE configured.responsibility_id = responsibility.id
              AND configured.scope_option_id = requested.scope_option_id
         )
    )
  )
)`;

type QueueRow = QueryResultRow & {
  id: string;
  display_id: string;
  requester_name: string;
  requester_role: "student" | "faculty";
  resource_id: string;
  resource_name: string;
  permission_id: string;
  permission_label: string;
  starts_at: Date | string;
  expires_at: Date | string;
  submitted_at: Date | string;
  assigned_at: Date | string;
  status: ReviewQueueStatus;
  version: number;
  total_count: number;
};

const iso = (value: Date | string) => new Date(value).toISOString();

function pagination<T>(
  rows: Array<T & { total_count: number }>,
  filters: ApprovalListFilters,
): PaginatedDto<T> {
  const total = Number(rows[0]?.total_count ?? 0);
  return {
    items: rows.map((row) => {
      const item: Partial<T & { total_count: number }> = { ...row };
      delete item.total_count;
      return item as T;
    }),
    pagination: {
      page: filters.page,
      pageSize: filters.pageSize,
      total,
      pageCount: Math.ceil(total / filters.pageSize),
    },
  };
}

function addFilters(
  values: unknown[],
  where: string[],
  filters: ApprovalListFilters,
  aliases: { request: string; resource: string; permission: string; user: string },
) {
  const add = (sql: string, value: unknown) => {
    values.push(value);
    where.push(sql.replaceAll("?", `$${values.length}`));
  };
  if (filters.status) add(`${aliases.request}.status = ?`, filters.status);
  if (filters.resource) add(`${aliases.request}.resource_id = ?`, filters.resource);
  if (filters.from) add(`${aliases.request}.submitted_at >= ?::date`, filters.from);
  if (filters.to)
    add(`${aliases.request}.submitted_at < (?::date + interval '1 day')`, filters.to);
  if (filters.search)
    add(
      `(${aliases.request}.display_id ILIKE '%' || ? || '%'
        OR ${aliases.user}.name ILIKE '%' || ? || '%'
        OR ${aliases.resource}.name ILIKE '%' || ? || '%'
        OR ${aliases.permission}.label ILIKE '%' || ? || '%')`,
      filters.search,
    );
}

export async function listAssignedReviewRequests(
  identity: TrustedIdentity,
  filters: ApprovalListFilters,
): Promise<PaginatedDto<ReviewQueueItemDto>> {
  const values: unknown[] = [identity.id];
  const where = [
    "assignment.approver_user_id = $1",
    "request.status <> 'pending_routing'",
    "responsibility.valid_from <= now()",
    "(responsibility.valid_until IS NULL OR responsibility.valid_until > now())",
    fullScopeResponsibilitySql,
  ];
  addFilters(values, where, filters, {
    request: "request",
    resource: "resource",
    permission: "permission",
    user: "requester",
  });
  values.push(filters.pageSize, (filters.page - 1) * filters.pageSize);
  const result = await query<QueueRow>(
    `SELECT request.id, request.display_id, requester.name AS requester_name,
            profile.requester_role, request.resource_id,
            resource.name AS resource_name, request.permission_id,
            permission.label AS permission_label, request.starts_at,
            request.expires_at, request.submitted_at, assignment.assigned_at,
            request.status, request.version, count(*) OVER()::int AS total_count
       FROM access_request request
       JOIN request_review_assignment assignment ON assignment.request_id = request.id
       JOIN approver_responsibility responsibility
         ON responsibility.id = assignment.responsibility_id
        AND responsibility.approver_user_id = assignment.approver_user_id
       JOIN "user" requester ON requester.id = request.requester_user_id
       JOIN user_profile profile ON profile.user_id = requester.id
       JOIN catalog_resource resource ON resource.id = request.resource_id
       JOIN catalog_permission permission ON permission.id = request.permission_id
      WHERE ${where.join(" AND ")}
      ORDER BY request.submitted_at DESC, request.id DESC
      LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );
  const mapped = result.rows.map((row) => ({
    requestId: row.id,
    displayId: row.display_id,
    requester: { name: row.requester_name, requesterRole: row.requester_role },
    resource: { id: row.resource_id, name: row.resource_name },
    permission: { id: row.permission_id, label: row.permission_label },
    requestedValidity: {
      startsAt: iso(row.starts_at),
      expiresAt: iso(row.expires_at),
    },
    submittedAt: iso(row.submitted_at),
    assignedAt: iso(row.assigned_at),
    status: row.status,
    version: row.version,
    total_count: row.total_count,
  }));
  return pagination(mapped, filters);
}

type UnassignedRow = QueryResultRow & {
  id: string;
  display_id: string;
  requester_name: string;
  requester_role: "student" | "faculty";
  resource_id: string;
  resource_name: string;
  permission_id: string;
  permission_label: string;
  submitted_at: Date | string;
  status: "pending_routing";
  version: number;
  total_count: number;
};

export async function listUnassignedRoutingFailures(
  filters: ApprovalListFilters,
): Promise<PaginatedDto<UnassignedRequestDto>> {
  const values: unknown[] = [];
  const where = [
    "request.status = 'pending_routing'",
    "assignment.id IS NULL",
  ];
  addFilters(values, where, filters, {
    request: "request",
    resource: "resource",
    permission: "permission",
    user: "requester",
  });
  values.push(filters.pageSize, (filters.page - 1) * filters.pageSize);
  const result = await query<UnassignedRow>(
    `SELECT request.id, request.display_id, requester.name AS requester_name,
            profile.requester_role, request.resource_id,
            resource.name AS resource_name, request.permission_id,
            permission.label AS permission_label, request.submitted_at,
            request.status, request.version, count(*) OVER()::int AS total_count
       FROM access_request request
       LEFT JOIN request_review_assignment assignment ON assignment.request_id = request.id
       JOIN "user" requester ON requester.id = request.requester_user_id
       JOIN user_profile profile ON profile.user_id = requester.id
       JOIN catalog_resource resource ON resource.id = request.resource_id
       JOIN catalog_permission permission ON permission.id = request.permission_id
      WHERE ${where.join(" AND ")}
      ORDER BY request.submitted_at DESC, request.id DESC
      LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );
  const mapped = result.rows.map((row) => ({
    requestId: row.id,
    displayId: row.display_id,
    requester: { name: row.requester_name, requesterRole: row.requester_role },
    resource: { id: row.resource_id, name: row.resource_name },
    permission: { id: row.permission_id, label: row.permission_label },
    submittedAt: iso(row.submitted_at),
    status: row.status,
    version: row.version,
    total_count: row.total_count,
  }));
  return pagination(mapped, filters);
}

type DetailRow = QueryResultRow & {
  id: string;
  display_id: string;
  requester_name: string;
  requester_email: string;
  department: string;
  requester_role: "student" | "faculty";
  resource_id: string;
  resource_name: string;
  sensitivity: "Low" | "Medium" | "High";
  permission_id: string;
  permission_label: string;
  purpose: string;
  starts_at: Date | string;
  expires_at: Date | string;
  submitted_at: Date | string;
  assigned_at: Date | string;
  status: ReviewQueueStatus;
  version: number;
  scopes: unknown;
  timeline: unknown;
  decision_action: "approve" | "deny" | "return_for_revision" | null;
  decision_reason: string | null;
  decided_at: Date | string | null;
};

function objectArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : [];
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

export async function getAssignedReviewRequest(
  identity: TrustedIdentity,
  id: string,
): Promise<ReviewRequestDetailDto | null> {
  if (!id || id.length > 80) return null;
  const result = await query<DetailRow>(
    `SELECT request.id, request.display_id, requester.name AS requester_name,
            requester.email AS requester_email, profile.department,
            profile.requester_role, request.resource_id,
            resource.name AS resource_name, resource.sensitivity,
            request.permission_id, permission.label AS permission_label,
            request.purpose, request.starts_at, request.expires_at,
            request.submitted_at, assignment.assigned_at, request.status,
            request.version,
            coalesce((
              SELECT jsonb_agg(jsonb_build_object(
                'fieldName', scope.field_name,
                'label', field.label,
                'value', scope.display_snapshot
              ) ORDER BY field.sort_order)
                FROM access_request_scope scope
                JOIN catalog_scope_field field
                  ON field.resource_id = request.resource_id
                 AND field.field_name = scope.field_name
               WHERE scope.request_id = request.id
            ), '[]'::jsonb) AS scopes,
            coalesce((
              SELECT jsonb_agg(jsonb_build_object(
                'type', event.event_type,
                'at', event.occurred_at,
                'actorName', coalesce(actor.name, 'Permora'),
                'detail', event.detail
              ) ORDER BY event.occurred_at, event.id)
                FROM (
                  SELECT id, request_id, actor_user_id, event_type, occurred_at, detail
                    FROM request_submission_history
                  UNION ALL
                  SELECT id, request_id, actor_user_id, event_type, occurred_at, detail
                    FROM request_event
                ) event
                LEFT JOIN "user" actor ON actor.id = event.actor_user_id
               WHERE event.request_id = request.id
            ), '[]'::jsonb) AS timeline,
            decision.action AS decision_action, decision.reason AS decision_reason,
            decision.decided_at
       FROM access_request request
       JOIN request_review_assignment assignment ON assignment.request_id = request.id
       JOIN approver_responsibility responsibility
         ON responsibility.id = assignment.responsibility_id
        AND responsibility.approver_user_id = assignment.approver_user_id
       JOIN "user" requester ON requester.id = request.requester_user_id
       JOIN user_profile profile ON profile.user_id = requester.id
       JOIN catalog_resource resource ON resource.id = request.resource_id
       JOIN catalog_permission permission ON permission.id = request.permission_id
       LEFT JOIN request_decision decision ON decision.request_id = request.id
      WHERE assignment.approver_user_id = $1
        AND (request.id::text = $2 OR request.display_id = $2)
        AND responsibility.valid_from <= now()
        AND (responsibility.valid_until IS NULL OR responsibility.valid_until > now())
        AND ${fullScopeResponsibilitySql}
      LIMIT 1`,
    [identity.id, id],
  );
  const row = result.rows[0];
  if (!row) return null;
  const scopes = objectArray(row.scopes)
    .map((scope) => ({
      fieldName: stringValue(scope.fieldName),
      label: stringValue(scope.label),
      value: stringValue(scope.value),
    }))
    .filter((scope) => scope.fieldName && scope.label && scope.value);
  const timeline: ReviewTimelineEventDto[] = objectArray(row.timeline)
    .map((event) => ({
      type: stringValue(event.type),
      at: event.at ? iso(String(event.at)) : "",
      actorName: stringValue(event.actorName),
      detail: stringValue(event.detail),
    }))
    .filter((event) => event.type && event.at && event.detail);
  return {
    requestId: row.id,
    displayId: row.display_id,
    requester: {
      name: row.requester_name,
      email: row.requester_email,
      department: row.department,
      requesterRole: row.requester_role,
    },
    resource: {
      id: row.resource_id,
      name: row.resource_name,
      sensitivity: row.sensitivity,
    },
    permission: { id: row.permission_id, label: row.permission_label },
    scopes,
    purpose: row.purpose,
    requestedValidity: {
      startsAt: iso(row.starts_at),
      expiresAt: iso(row.expires_at),
    },
    submittedAt: iso(row.submitted_at),
    assignment: { assignedAt: iso(row.assigned_at) },
    status: row.status,
    version: row.version,
    timeline,
    decision: row.decision_action
      ? {
          action: row.decision_action,
          reason: row.decision_reason,
          decidedAt: iso(row.decided_at as Date | string),
        }
      : null,
  };
}
