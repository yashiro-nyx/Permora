import "server-only";
import { randomUUID } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import {
  GovernanceError,
  parseCreateDelegationInput,
  parseCreateResponsibilityInput,
  parseIdentifierInput,
  parseManualAssignInput,
  parseNotificationPreferenceInput,
  parsePolicyToggleInput,
  parseReportFilters,
  parseResponsibilityListFilters,
  parseRetentionDryRunInput,
  parseScopeOptionInput,
} from "@/lib/admin-governance";
import {
  administratorAssignPendingRequest,
  AdministratorRoutingError,
  listEligibleResponsibilitiesForRequest,
} from "@/lib/approval-domain";
import { query, transaction } from "./db";
import type { TrustedIdentity } from "@/lib/auth-types";
import type {
  AnalyticsSummaryDto,
  ApproverResponsibilityDto,
  CatalogResourceDto,
  DelegationDto,
  InstitutionalIdentifierDto,
  NotificationPreferenceDto,
  RetentionDryRunDto,
  RetentionPolicyDto,
} from "./admin-governance-types";

const GOVERNANCE_LOCK = 73020424;

interface GovernanceDependencies {
  requireAdmin: () => Promise<TrustedIdentity>;
  requireIdentity: () => Promise<TrustedIdentity>;
}

type Overrides = Partial<GovernanceDependencies>;

async function requireActiveAdmin(dependencies: Overrides) {
  if (dependencies.requireAdmin) return dependencies.requireAdmin();
  const { requireAdmin } = await import("./identity");
  return requireAdmin();
}

async function requireActiveIdentity(dependencies: Overrides) {
  if (dependencies.requireIdentity) return dependencies.requireIdentity();
  const { requireIdentity } = await import("./identity");
  return requireIdentity();
}

function iso(value: Date | string) {
  return new Date(value).toISOString();
}

async function insertAudit(
  client: PoolClient,
  actorUserId: string,
  eventType: string,
  metadata: Record<string, unknown>,
  subjectUserId?: string,
  requestId?: string,
) {
  await client.query(
    `INSERT INTO audit_event
      (id, actor_user_id, subject_user_id, request_id, event_type, metadata)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
    [
      randomUUID(),
      actorUserId,
      subjectUserId ?? null,
      requestId ?? null,
      eventType,
      JSON.stringify(metadata),
    ],
  );
}

async function lockGovernance(client: PoolClient) {
  await client.query("SELECT pg_advisory_xact_lock($1)", [GOVERNANCE_LOCK]);
}

function isUniqueViolation(error: unknown) {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "23505"
  );
}

export async function listApproverOptions(dependencies: Overrides = {}) {
  await requireActiveAdmin(dependencies);
  const result = await query<{ id: string; name: string }>(
    `SELECT u.id, u.name
       FROM "user" u
       JOIN user_profile profile ON profile.user_id = u.id AND profile.active
      WHERE EXISTS (
        SELECT 1 FROM user_role role
         WHERE role.user_id = u.id AND role.role IN ('approver', 'admin')
      )
      ORDER BY lower(u.name), u.id`,
  );
  return result.rows;
}
export async function listCatalogResources(): Promise<CatalogResourceDto[]> {
  const [resources, permissions, roles, fields, scopes, policies] = await Promise.all([
    query<{
      id: string;
      name: string;
      description: string;
      sensitivity: "Low" | "Medium" | "High";
      available: boolean;
    }>(
      `SELECT id, name, description, sensitivity, available
         FROM catalog_resource ORDER BY name`,
    ),
    query<{
      id: string;
      resource_id: string;
      label: string;
      enabled: boolean;
    }>(
      `SELECT id, resource_id, label, enabled FROM catalog_permission ORDER BY label`,
    ),
    query<{ permission_id: string; requester_role: "student" | "faculty" }>(
      "SELECT permission_id, requester_role FROM catalog_permission_role",
    ),
    query<{ resource_id: string; field_name: string; label: string; required: boolean }>(
      `SELECT resource_id, field_name, label, required
         FROM catalog_scope_field ORDER BY sort_order`,
    ),
    query<{
      id: string;
      resource_id: string;
      field_name: string;
      institutional_code: string;
      display_name: string;
      active: boolean;
    }>(
      `SELECT id, resource_id, field_name, institutional_code, display_name, active
         FROM scope_option ORDER BY field_name, display_name`,
    ),
    query<{
      id: string;
      resource_id: string;
      version: number;
      effective_from: Date | string;
      effective_until: Date | string | null;
      default_days: number;
      max_days: number;
      renewable: boolean;
      policy_note: string;
    }>(
      `SELECT DISTINCT ON (resource_id)
              id, resource_id, version, effective_from, effective_until,
              default_days, max_days, renewable, policy_note
         FROM catalog_policy_version
        WHERE effective_from <= now()
          AND (effective_until IS NULL OR effective_until > now())
        ORDER BY resource_id, version DESC`,
    ),
  ]);
  const rolesByPermission = new Map<string, Array<"student" | "faculty">>();
  for (const row of roles.rows) {
    const existing = rolesByPermission.get(row.permission_id) ?? [];
    existing.push(row.requester_role);
    rolesByPermission.set(row.permission_id, existing);
  }
  return resources.rows.map((resource) => ({
    id: resource.id,
    name: resource.name,
    description: resource.description,
    sensitivity: resource.sensitivity,
    available: resource.available,
    permissions: permissions.rows
      .filter((permission) => permission.resource_id === resource.id)
      .map((permission) => ({
        id: permission.id,
        label: permission.label,
        enabled: permission.enabled,
        requesterRoles: rolesByPermission.get(permission.id) ?? [],
      })),
    scopeFields: fields.rows
      .filter((field) => field.resource_id === resource.id)
      .map((field) => ({
        fieldName: field.field_name,
        label: field.label,
        required: field.required,
      })),
    scopeOptions: scopes.rows
      .filter((scope) => scope.resource_id === resource.id)
      .map((scope) => ({
        id: scope.id,
        fieldName: scope.field_name,
        institutionalCode: scope.institutional_code,
        displayName: scope.display_name,
        active: scope.active,
      })),
    currentPolicy: (() => {
      const policy = policies.rows.find((row) => row.resource_id === resource.id);
      return policy
        ? {
            id: policy.id,
            version: policy.version,
            effectiveFrom: iso(policy.effective_from),
            effectiveUntil: policy.effective_until ? iso(policy.effective_until) : null,
            defaultDays: policy.default_days,
            maxDays: policy.max_days,
            renewable: policy.renewable,
            policyNote: policy.policy_note,
            provisional: true as const,
          }
        : null;
    })(),
  }));
}

export async function listScopeOptions(resourceId: string) {
  const result = await query<{
    id: string;
    field_name: string;
    institutional_code: string;
    display_name: string;
    active: boolean;
  }>(
    `SELECT id, field_name, institutional_code, display_name, active
       FROM scope_option
      WHERE resource_id = $1
      ORDER BY field_name, display_name`,
    [resourceId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    fieldName: row.field_name,
    institutionalCode: row.institutional_code,
    displayName: row.display_name,
    active: row.active,
  }));
}

export async function toggleCatalogAvailability(
  input: unknown,
  dependencies: Overrides = {},
) {
  const identity = await requireActiveAdmin(dependencies);
  const data = parsePolicyToggleInput(input);
  return transaction(async (client) => {
    await lockGovernance(client);
    if (data.kind === "resource") {
      const result = await client.query<{ id: string; available: boolean }>(
        `UPDATE catalog_resource
            SET available = $2
          WHERE id = $1
          RETURNING id, available`,
        [data.id, data.enabled],
      );
      if (!result.rows[0]) throw new GovernanceError("not_found", "The resource was not found.");
    } else {
      const result = await client.query<{ id: string; enabled: boolean }>(
        `UPDATE catalog_permission
            SET enabled = $2
          WHERE id = $1
          RETURNING id, enabled`,
        [data.id, data.enabled],
      );
      if (!result.rows[0]) throw new GovernanceError("not_found", "The permission was not found.");
    }
    await insertAudit(client, identity.id, "catalog.availability_updated", {
      kind: data.kind,
      id: data.id,
      enabled: data.enabled,
    });
    return { kind: data.kind, id: data.id, enabled: data.enabled };
  });
}

export async function createScopeOption(
  input: unknown,
  dependencies: Overrides = {},
) {
  const identity = await requireActiveAdmin(dependencies);
  const data = parseScopeOptionInput(input);
  try {
    return await transaction(async (client) => {
      await lockGovernance(client);
      const id = randomUUID();
      const inserted = await client.query(
        `INSERT INTO scope_option
          (id, resource_id, field_name, institutional_code, display_name, valid_from)
         SELECT $1,$2,$3,$4,$5,now()
          WHERE EXISTS (
            SELECT 1 FROM catalog_scope_field
             WHERE resource_id = $2 AND field_name = $3
          )
         RETURNING id`,
        [id, data.resourceId, data.fieldName, data.institutionalCode, data.displayName],
      );
      if (!inserted.rows[0])
        throw new GovernanceError(
          "invalid_input",
          "The resource does not define that scope field.",
        );
      await insertAudit(client, identity.id, "catalog.scope_option_created", {
        resourceId: data.resourceId,
        fieldName: data.fieldName,
        scopeOptionId: id,
      });
      return { id };
    });
  } catch (error) {
    if (isUniqueViolation(error))
      throw new GovernanceError("conflict", "That institutional code already exists.");
    throw error;
  }
}

export async function listResponsibilities(
  searchParams: URLSearchParams,
  dependencies: Overrides = {},
) {
  await requireActiveAdmin(dependencies);
  const filters = parseResponsibilityListFilters(searchParams);
  const values: unknown[] = [];
  const where: string[] = ["true"];
  if (filters.approver) {
    values.push(filters.approver);
    where.push(`responsibility.approver_user_id = $${values.length}`);
  }
  if (filters.resource) {
    values.push(filters.resource);
    where.push(`responsibility.resource_id = $${values.length}`);
  }
  values.push(filters.pageSize, (filters.page - 1) * filters.pageSize);
  const result = await query<
    QueryResultRow & {
      id: string;
      approver_id: string;
      approver_name: string;
      approver_active: boolean;
      resource_id: string;
      resource_name: string;
      permission_id: string | null;
      permission_label: string | null;
      valid_from: Date | string;
      valid_until: Date | string | null;
      scopes: { id: string; display_name: string; field_name: string }[] | null;
      total_count: number;
    }
  >(
    `SELECT responsibility.id, approver.id AS approver_id, approver.name AS approver_name,
            profile.active AS approver_active, resource.id AS resource_id,
            resource.name AS resource_name, permission.id AS permission_id,
            permission.label AS permission_label,
            responsibility.valid_from, responsibility.valid_until,
            coalesce((
              SELECT json_agg(json_build_object(
                'id', option.id,
                'display_name', option.display_name,
                'field_name', option.field_name
              ) ORDER BY option.field_name)
                FROM approver_responsibility_scope mapping
                JOIN scope_option option ON option.id = mapping.scope_option_id
               WHERE mapping.responsibility_id = responsibility.id
            ), '[]'::json) AS scopes,
            count(*) OVER()::int AS total_count
       FROM approver_responsibility responsibility
       JOIN "user" approver ON approver.id = responsibility.approver_user_id
       JOIN user_profile profile ON profile.user_id = approver.id
       JOIN catalog_resource resource ON resource.id = responsibility.resource_id
       LEFT JOIN catalog_permission permission
         ON permission.id = responsibility.permission_id
      WHERE ${where.join(" AND ")}
      ORDER BY lower(approver.name), responsibility.valid_from DESC, responsibility.id
      LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );
  const items: ApproverResponsibilityDto[] = result.rows.map((row) => ({
    id: row.id,
    approver: {
      id: row.approver_id,
      name: row.approver_name,
      active: row.approver_active,
    },
    resource: { id: row.resource_id, name: row.resource_name },
    permission: row.permission_id
      ? { id: row.permission_id, label: row.permission_label ?? row.permission_id }
      : null,
    scopes: (Array.isArray(row.scopes) ? row.scopes : []).map((scope) => ({
      id: scope.id,
      label: scope.display_name,
      fieldName: scope.field_name,
    })),
    validFrom: iso(row.valid_from),
    validUntil: row.valid_until ? iso(row.valid_until) : null,
    active:
      row.approver_active &&
      new Date(row.valid_from) <= new Date() &&
      (!row.valid_until || new Date(row.valid_until) > new Date()),
  }));
  const total = Number(result.rows[0]?.total_count ?? 0);
  return {
    items,
    pagination: {
      page: filters.page,
      pageSize: filters.pageSize,
      total,
      pageCount: Math.ceil(total / filters.pageSize),
    },
  };
}

export async function createResponsibility(
  input: unknown,
  dependencies: Overrides = {},
) {
  const identity = await requireActiveAdmin(dependencies);
  const data = parseCreateResponsibilityInput(input);
  return transaction(async (client) => {
    await lockGovernance(client);
    const approver = await client.query<{
      id: string;
      active: boolean;
      role: string | null;
    }>(
      `SELECT profile.user_id AS id, profile.active,
              (SELECT role FROM user_role
                WHERE user_id = profile.user_id AND role IN ('approver','admin')
                LIMIT 1) AS role
         FROM user_profile profile
        WHERE profile.user_id = $1
        FOR UPDATE OF profile`,
      [data.approverUserId],
    );
    if (!approver.rows[0]?.active || !approver.rows[0].role)
      throw new GovernanceError(
        "invalid_input",
        "The selected user is not an active approver or administrator.",
      );
    const resource = await client.query(
      "SELECT 1 FROM catalog_resource WHERE id = $1",
      [data.resourceId],
    );
    if (!resource.rows[0])
      throw new GovernanceError("not_found", "The resource was not found.");
    if (data.permissionId) {
      const permission = await client.query(
        "SELECT 1 FROM catalog_permission WHERE id = $1 AND resource_id = $2",
        [data.permissionId, data.resourceId],
      );
      if (!permission.rows[0])
        throw new GovernanceError(
          "invalid_input",
          "The permission does not belong to this resource.",
        );
    }
    if (data.scopeOptionIds.length) {
      const scopes = await client.query<{ id: string }>(
        `SELECT id FROM scope_option
          WHERE id = ANY($1::uuid[]) AND resource_id = $2 AND active`,
        [data.scopeOptionIds, data.resourceId],
      );
      if (scopes.rows.length !== data.scopeOptionIds.length)
        throw new GovernanceError(
          "invalid_input",
          "One or more scopes are invalid for this resource.",
        );
    }
    const overlap = await client.query(
      `SELECT 1 FROM approver_responsibility existing
        WHERE existing.approver_user_id = $1
          AND existing.resource_id = $2
          AND existing.permission_id IS NOT DISTINCT FROM $3
          AND (existing.valid_until IS NULL OR existing.valid_until > now())
          AND existing.valid_from <= now()`,
      [data.approverUserId, data.resourceId, data.permissionId],
    );
    if (overlap.rows[0])
      throw new GovernanceError(
        "conflict",
        "An overlapping current responsibility already exists for this approver, resource, and permission.",
      );
    const id = randomUUID();
    await client.query(
      `INSERT INTO approver_responsibility
        (id, approver_user_id, resource_id, permission_id, scope_option_id, valid_from, assigned_by)
       VALUES ($1,$2,$3,$4,$5,now(),$6)`,
      [
        id,
        data.approverUserId,
        data.resourceId,
        data.permissionId,
        data.scopeOptionIds[0] ?? null,
        identity.id,
      ],
    );
    for (const scopeId of data.scopeOptionIds) {
      await client.query(
        `INSERT INTO approver_responsibility_scope
          (responsibility_id, resource_id, scope_option_id)
         VALUES ($1,$2,$3)`,
        [id, data.resourceId, scopeId],
      );
    }
    await insertAudit(
      client,
      identity.id,
      "approver_responsibility.created",
      {
        responsibilityId: id,
        resourceId: data.resourceId,
        permissionId: data.permissionId,
        scopeCount: data.scopeOptionIds.length,
      },
      data.approverUserId,
    );
    return { id };
  });
}

export async function endResponsibility(
  responsibilityId: string,
  dependencies: Overrides = {},
) {
  const identity = await requireActiveAdmin(dependencies);
  return transaction(async (client) => {
    await lockGovernance(client);
    const result = await client.query<{
      id: string;
      approver_user_id: string;
      valid_until: Date | string | null;
    }>(
      `UPDATE approver_responsibility
          SET valid_until = now()
        WHERE id = $1
          AND (valid_until IS NULL OR valid_until > now())
        RETURNING id, approver_user_id, valid_until`,
      [responsibilityId],
    );
    if (!result.rows[0])
      throw new GovernanceError("not_found", "The responsibility is not currently active.");
    await insertAudit(
      client,
      identity.id,
      "approver_responsibility.ended",
      { responsibilityId },
      result.rows[0].approver_user_id,
    );
    return { id: result.rows[0].id };
  });
}

export async function listDelegations(dependencies: Overrides = {}) {
  await requireActiveAdmin(dependencies);
  const result = await query<{
    id: string;
    delegator_id: string;
    delegator_name: string;
    substitute_id: string;
    substitute_name: string;
    valid_from: Date | string;
    valid_until: Date | string;
    cancelled_at: Date | string | null;
  }>(
    `SELECT delegation.id,
            delegator.id AS delegator_id, delegator.name AS delegator_name,
            substitute.id AS substitute_id, substitute.name AS substitute_name,
            delegation.valid_from, delegation.valid_until, delegation.cancelled_at
       FROM approver_delegation delegation
       JOIN "user" delegator ON delegator.id = delegation.delegator_user_id
       JOIN "user" substitute ON substitute.id = delegation.substitute_user_id
      ORDER BY delegation.valid_from DESC, delegation.id`,
  );
  return result.rows.map((row): DelegationDto => ({
    id: row.id,
    delegator: { id: row.delegator_id, name: row.delegator_name },
    substitute: { id: row.substitute_id, name: row.substitute_name },
    validFrom: iso(row.valid_from),
    validUntil: iso(row.valid_until),
    cancelledAt: row.cancelled_at ? iso(row.cancelled_at) : null,
    active:
      !row.cancelled_at &&
      new Date(row.valid_from) <= new Date() &&
      new Date(row.valid_until) > new Date(),
  }));
}

async function assertEligibleApprover(client: PoolClient, userId: string) {
  const result = await client.query(
    `SELECT 1 FROM user_profile profile
      WHERE profile.user_id = $1 AND profile.active
        AND EXISTS (
          SELECT 1 FROM user_role role
           WHERE role.user_id = profile.user_id
             AND role.role IN ('approver', 'admin')
        )
      FOR UPDATE OF profile`,
    [userId],
  );
  if (!result.rows[0])
    throw new GovernanceError(
      "invalid_input",
      "Both the absent approver and substitute must be active approvers or administrators.",
    );
}

export async function createDelegation(
  input: unknown,
  dependencies: Overrides = {},
) {
  const identity = await requireActiveAdmin(dependencies);
  const data = parseCreateDelegationInput(input);
  return transaction(async (client) => {
    await lockGovernance(client);
    await assertEligibleApprover(client, data.delegatorUserId);
    await assertEligibleApprover(client, data.substituteUserId);
    const reverse = await client.query(
      `SELECT 1 FROM approver_delegation
        WHERE delegator_user_id = $1
          AND substitute_user_id = $2
          AND cancelled_at IS NULL
          AND valid_from < $4::timestamptz
          AND valid_until > $3::timestamptz`,
      [
        data.substituteUserId,
        data.delegatorUserId,
        data.validFrom,
        data.validUntil,
      ],
    );
    if (reverse.rows[0])
      throw new GovernanceError(
        "circular_delegation",
        "Circular overlapping delegations are not permitted.",
      );
    const overlap = await client.query(
      `SELECT 1 FROM approver_delegation
        WHERE delegator_user_id = $1
          AND cancelled_at IS NULL
          AND valid_from < $3::timestamptz
          AND valid_until > $2::timestamptz`,
      [data.delegatorUserId, data.validFrom, data.validUntil],
    );
    if (overlap.rows[0])
      throw new GovernanceError(
        "conflict",
        "An overlapping absence period already exists for this approver.",
      );
    const id = randomUUID();
    await client.query(
      `INSERT INTO approver_delegation
        (id, delegator_user_id, substitute_user_id, valid_from, valid_until, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        id,
        data.delegatorUserId,
        data.substituteUserId,
        data.validFrom,
        data.validUntil,
        identity.id,
      ],
    );
    await insertAudit(
      client,
      identity.id,
      "approver_delegation.created",
      {
        delegationId: id,
        validFrom: data.validFrom,
        validUntil: data.validUntil,
        existingAssignmentsUnchanged: true,
      },
      data.delegatorUserId,
    );
    return { id };
  });
}

export async function cancelDelegation(
  delegationId: string,
  dependencies: Overrides = {},
) {
  const identity = await requireActiveAdmin(dependencies);
  return transaction(async (client) => {
    await lockGovernance(client);
    const result = await client.query<{
      id: string;
      delegator_user_id: string;
    }>(
      `UPDATE approver_delegation
          SET cancelled_at = now(), cancelled_by = $2
        WHERE id = $1 AND cancelled_at IS NULL AND valid_until > now()
        RETURNING id, delegator_user_id`,
      [delegationId, identity.id],
    );
    if (!result.rows[0])
      throw new GovernanceError("not_found", "The delegation is not currently cancellable.");
    await insertAudit(
      client,
      identity.id,
      "approver_delegation.cancelled",
      { delegationId },
      result.rows[0].delegator_user_id,
    );
    return { id: result.rows[0].id };
  });
}

export async function listEligibleAssignees(requestId: string) {
  return transaction(async (client) =>
    listEligibleResponsibilitiesForRequest(client, requestId),
  );
}

export async function assignUnassignedRequest(
  requestId: string,
  input: unknown,
  dependencies: Overrides = {},
) {
  const identity = await requireActiveAdmin(dependencies);
  const data = parseManualAssignInput(input);
  try {
    return await transaction(async (client) =>
      administratorAssignPendingRequest(client, {
        requestId,
        responsibilityId: data.responsibilityId,
        expectedVersion: data.expectedVersion,
        actorUserId: identity.id,
      }),
    );
  } catch (error) {
    if (error instanceof AdministratorRoutingError)
      throw new GovernanceError(
        error.code === "not_found" ? "not_found" : "conflict",
        error.message,
      );
    throw error;
  }
}

export async function getAnalyticsSummary(
  searchParams: URLSearchParams,
  dependencies: Overrides = {},
): Promise<AnalyticsSummaryDto> {
  await requireActiveAdmin(dependencies);
  const filters = parseReportFilters(searchParams);
  const values: unknown[] = [];
  const requestWhere = ["true"];
  if (filters.from) {
    values.push(filters.from);
    requestWhere.push(`request.created_at >= $${values.length}::date`);
  }
  if (filters.to) {
    values.push(filters.to);
    requestWhere.push(
      `request.created_at < ($${values.length}::date + interval '1 day')`,
    );
  }
  if (filters.resource) {
    values.push(filters.resource);
    requestWhere.push(`request.resource_id = $${values.length}`);
  }
  if (filters.status) {
    values.push(filters.status);
    requestWhere.push(`request.status = $${values.length}`);
  }
  const whereSql = requestWhere.join(" AND ");
  const [users, requestGroups, entitlements, activations, turnaround, workload] =
    await Promise.all([
      query<{ total: number; active: number; inactive: number }>(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE active)::int AS active,
                count(*) FILTER (WHERE NOT active)::int AS inactive
           FROM user_profile`,
      ),
      query<{ status: string; status_count: number }>(
        `SELECT request.status, count(*)::int AS status_count
           FROM access_request request
          WHERE ${whereSql}
          GROUP BY request.status`,
        values,
      ),
      query<{ active: number; expired: number }>(
        `SELECT
            count(*) FILTER (
              WHERE valid_until IS NULL OR valid_until > now()
            )::int AS active,
            count(*) FILTER (
              WHERE valid_until IS NOT NULL AND valid_until <= now()
            )::int AS expired
           FROM ordinary_entitlement`,
      ),
      query<{ activated: number; failed: number; activating: number; revoked: number }>(
        `SELECT
            count(*) FILTER (WHERE activation.status = 'activated')::int AS activated,
            count(*) FILTER (WHERE activation.status = 'failed')::int AS failed,
            count(*) FILTER (WHERE activation.status = 'activating')::int AS activating,
            count(*) FILTER (WHERE activation.status = 'revoked')::int AS revoked
           FROM request_activation activation`,
      ),
      query<{ hours: number | null }>(
        `SELECT avg(extract(epoch FROM decision.decided_at - request.created_at) / 3600)
                AS hours
           FROM request_decision decision
           JOIN access_request request ON request.id = decision.request_id
          WHERE ${whereSql}`,
        values,
      ),
      query<{ approver_name: string; open_assignments: number }>(
        `SELECT approver.name AS approver_name, count(*)::int AS open_assignments
           FROM request_review_assignment assignment
           JOIN "user" approver ON approver.id = assignment.approver_user_id
          WHERE assignment.status = 'assigned'
          GROUP BY approver.name
          ORDER BY open_assignments DESC, lower(approver.name)
          LIMIT 20`,
      ),
    ]);
  const byStatus: Record<string, number> = {};
  let total = 0;
  for (const row of requestGroups.rows) {
    byStatus[row.status] = row.status_count;
    total += row.status_count;
  }
  const entitlementRow = entitlements.rows[0];
  const activationRow = activations.rows[0];
  const awaitingActivation = await query<{ count: number }>(
    `SELECT count(*)::int AS count
       FROM access_request request
       LEFT JOIN request_activation activation ON activation.request_id = request.id
      WHERE request.status = 'approved_pending_activation'
        AND activation.id IS NULL`,
  );
  return {
    generatedAt: new Date().toISOString(),
    filters,
    users: users.rows[0],
    requests: {
      total,
      byStatus,
      pendingReview: byStatus.pending_review ?? 0,
      pendingRouting: byStatus.pending_routing ?? 0,
      approvedPendingActivation: byStatus.approved_pending_activation ?? 0,
      awaitingActivation: Number(awaitingActivation.rows[0]?.count ?? 0),
    },
    entitlements: {
      active: Number(entitlementRow?.active ?? 0),
      expired: Number(entitlementRow?.expired ?? 0),
      revoked: Number(activationRow?.revoked ?? 0),
    },
    activation: {
      activated: Number(activationRow?.activated ?? 0),
      failed: Number(activationRow?.failed ?? 0),
      activating: Number(activationRow?.activating ?? 0),
    },
    approvalTurnaroundHours:
      turnaround.rows[0]?.hours === null || turnaround.rows[0]?.hours === undefined
        ? null
        : Number(turnaround.rows[0].hours),
    approverWorkload: workload.rows.map((row) => ({
      approverName: row.approver_name,
      openAssignments: row.open_assignments,
    })),
  };
}

export async function getNotificationPreferences(
  userId: string,
): Promise<NotificationPreferenceDto> {
  const result = await query<{
    in_app_enabled: boolean;
    external_email_enabled: boolean;
    external_sms_enabled: boolean;
    external_push_enabled: boolean;
    updated_at: Date | string;
  }>(
    `SELECT in_app_enabled, external_email_enabled, external_sms_enabled,
            external_push_enabled, updated_at
       FROM user_notification_preference
      WHERE user_id = $1`,
    [userId],
  );
  const row = result.rows[0];
  return {
    inAppEnabled: row?.in_app_enabled ?? true,
    externalEmailEnabled: row?.external_email_enabled ?? false,
    externalSmsEnabled: row?.external_sms_enabled ?? false,
    externalPushEnabled: row?.external_push_enabled ?? false,
    externalDeliveryConfigured: false,
    updatedAt: row ? iso(row.updated_at) : new Date(0).toISOString(),
  };
}

export async function updateNotificationPreferences(
  input: unknown,
  dependencies: Overrides = {},
) {
  const identity = await requireActiveIdentity(dependencies);
  const data = parseNotificationPreferenceInput(input);
  return transaction(async (client) => {
    const current = await getNotificationPreferences(identity.id);
    const next = {
      inAppEnabled: data.inAppEnabled ?? current.inAppEnabled,
      externalEmailEnabled: false,
      externalSmsEnabled: false,
      externalPushEnabled: false,
    };
    if (
      data.externalEmailEnabled === true ||
      data.externalSmsEnabled === true ||
      data.externalPushEnabled === true
    )
      throw new GovernanceError(
        "invalid_input",
        "External notification delivery is not configured.",
      );
    await client.query(
      `INSERT INTO user_notification_preference
        (user_id, in_app_enabled, external_email_enabled, external_sms_enabled,
         external_push_enabled, updated_at)
       VALUES ($1,$2,false,false,false,now())
       ON CONFLICT (user_id) DO UPDATE
         SET in_app_enabled = excluded.in_app_enabled,
             external_email_enabled = false,
             external_sms_enabled = false,
             external_push_enabled = false,
             updated_at = now()`,
      [identity.id, next.inAppEnabled],
    );
    await insertAudit(client, identity.id, "notification_preference.updated", {
      inAppEnabled: next.inAppEnabled,
    });
    return getNotificationPreferences(identity.id);
  });
}

export async function listUserIdentifiers(
  userId: string,
): Promise<InstitutionalIdentifierDto[]> {
  const result = await query<{
    id: string;
    identifier_type: "student_number" | "staff_number";
    issuer: string;
    normalized_value: string;
  }>(
    `SELECT id, identifier_type, issuer, normalized_value
       FROM institutional_identifier
      WHERE user_id = $1
      ORDER BY identifier_type, issuer`,
    [userId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    identifierType: row.identifier_type,
    issuer: row.issuer,
    identifier: row.normalized_value,
  }));
}

export async function upsertUserIdentifier(
  userId: string,
  input: unknown,
  dependencies: Overrides = {},
) {
  const identity = await requireActiveAdmin(dependencies);
  const data = parseIdentifierInput(input);
  try {
    return await transaction(async (client) => {
      await lockGovernance(client);
      const existing = await client.query<{
        id: string;
        normalized_value: string;
      }>(
        `SELECT id, normalized_value FROM institutional_identifier
          WHERE user_id = $1 AND identifier_type = $2 AND issuer = $3
          FOR UPDATE`,
        [userId, data.identifierType, data.issuer],
      );
      if (existing.rows[0]) {
        await client.query(
          `UPDATE institutional_identifier
              SET normalized_value = $2
            WHERE id = $1`,
          [existing.rows[0].id, data.identifier],
        );
      } else {
        await client.query(
          `INSERT INTO institutional_identifier
            (id, user_id, identifier_type, issuer, normalized_value)
           VALUES ($1,$2,$3,$4,$5)`,
          [randomUUID(), userId, data.identifierType, data.issuer, data.identifier],
        );
      }
      await insertAudit(
        client,
        identity.id,
        "institutional_identifier.updated",
        {
          identifierType: data.identifierType,
          issuer: data.issuer,
        },
        userId,
      );
      return listUserIdentifiers(userId);
    });
  } catch (error) {
    if (isUniqueViolation(error))
      throw new GovernanceError(
        "conflict",
        "That institutional identifier is already assigned.",
      );
    throw error;
  }
}

export async function listRetentionPolicies(
  dependencies: Overrides = {},
): Promise<RetentionPolicyDto[]> {
  await requireActiveAdmin(dependencies);
  const result = await query<{
    record_class: string;
    label: string;
    retention_days: number | null;
    provisional: boolean;
    immutable: boolean;
    updated_at: Date | string;
  }>(
    `SELECT record_class, label, retention_days, provisional, immutable, updated_at
       FROM retention_policy_setting
      ORDER BY record_class`,
  );
  return result.rows.map((row) => ({
    recordClass: row.record_class,
    label: row.label,
    retentionDays: row.retention_days,
    provisional: row.provisional,
    immutable: row.immutable,
    updatedAt: iso(row.updated_at),
  }));
}

export async function previewRetention(
  input: unknown,
  dependencies: Overrides = {},
): Promise<RetentionDryRunDto> {
  await requireActiveAdmin(dependencies);
  const data = parseRetentionDryRunInput(input);
  const policy = await query<{
    record_class: string;
    retention_days: number | null;
    immutable: boolean;
    provisional: boolean;
    label: string;
  }>(
    `SELECT record_class, retention_days, immutable, provisional, label
       FROM retention_policy_setting
      WHERE record_class = $1`,
    [data.recordClass],
  );
  const setting = policy.rows[0];
  if (!setting)
    throw new GovernanceError("not_found", "The retention class was not found.");
  if (setting.immutable)
    return {
      recordClass: setting.record_class,
      eligibleCount: 0,
      immutable: true,
      applied: false,
      message: "Immutable accountability records cannot be archived.",
    };
  if (!setting.retention_days)
    return {
      recordClass: setting.record_class,
      eligibleCount: 0,
      immutable: false,
      applied: false,
      message: "No retention period is configured for this class.",
    };
  if (data.apply)
    throw new GovernanceError(
      "immutable",
      "Destructive archival apply is disabled until institutional policy is approved.",
    );
  let eligibleCount = 0;
  if (setting.record_class === "user_notification") {
    const count = await query<{ count: number }>(
      `SELECT count(*)::int AS count
         FROM user_notification
        WHERE created_at < now() - ($1::int * interval '1 day')`,
      [setting.retention_days],
    );
    eligibleCount = count.rows[0].count;
  } else if (setting.record_class === "access_request_terminal") {
    const count = await query<{ count: number }>(
      `SELECT count(*)::int AS count
         FROM access_request
        WHERE status IN ('denied', 'returned_for_revision', 'cancelled', 'expired')
          AND updated_at < now() - ($1::int * interval '1 day')`,
      [setting.retention_days],
    );
    eligibleCount = count.rows[0].count;
  }
  return {
    recordClass: setting.record_class,
    eligibleCount,
    immutable: false,
    applied: false,
    message: `${eligibleCount} ${setting.label.toLowerCase()} would match this provisional dry-run. No records were changed.`,
  };
}
