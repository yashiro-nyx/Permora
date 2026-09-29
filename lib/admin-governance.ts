import type { Role } from "./model";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class GovernanceError extends Error {
  constructor(
    readonly code:
      | "invalid_input"
      | "forbidden"
      | "not_found"
      | "conflict"
      | "immutable"
      | "circular_delegation",
    message: string,
  ) {
    super(message);
    this.name = "GovernanceError";
  }
}

export function mapGovernanceError(error: unknown) {
  if (error instanceof GovernanceError) {
    const status =
      error.code === "invalid_input"
        ? 400
        : error.code === "forbidden"
          ? 403
          : error.code === "not_found"
            ? 404
            : 409;
    return {
      status,
      body: { error: { code: error.code, message: error.message } },
    };
  }
  return {
    status: 503,
    body: {
      error: {
        code: "service_unavailable",
        message: "Administrative operations are temporarily unavailable.",
      },
    },
  };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new GovernanceError("invalid_input", "The request body is invalid.");
  return value as Record<string, unknown>;
}

function text(value: unknown, max: number, min = 0) {
  if (typeof value !== "string")
    throw new GovernanceError("invalid_input", "A required text field is invalid.");
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max)
    throw new GovernanceError("invalid_input", "A required text field is invalid.");
  return normalized;
}

function uuid(value: unknown) {
  if (typeof value !== "string" || !UUID.test(value))
    throw new GovernanceError("invalid_input", "An identifier is invalid.");
  return value;
}

function paginationValue(value: string | null, fallback: number, maximum: number) {
  if (value === null || value === "") return fallback;
  if (!/^\d+$/.test(value))
    throw new GovernanceError("invalid_input", "Pagination is invalid.");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1)
    throw new GovernanceError("invalid_input", "Pagination is invalid.");
  return Math.min(parsed, maximum);
}

export function parseReportFilters(params: URLSearchParams) {
  const from = params.get("from")?.trim() || undefined;
  const to = params.get("to")?.trim() || undefined;
  const resource = params.get("resource")?.trim() || undefined;
  const status = params.get("status")?.trim() || undefined;
  if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from))
    throw new GovernanceError("invalid_input", "The date range is invalid.");
  if (to && !/^\d{4}-\d{2}-\d{2}$/.test(to))
    throw new GovernanceError("invalid_input", "The date range is invalid.");
  return { from, to, resource, status };
}

export function parseResponsibilityListFilters(params: URLSearchParams) {
  const approver = params.get("approver")?.trim() || undefined;
  if (approver && !UUID.test(approver))
    throw new GovernanceError("invalid_input", "The approver filter is invalid.");
  const resource = params.get("resource")?.trim() || undefined;
  return {
    approver,
    resource,
    page: paginationValue(params.get("page"), 1, 10_000),
    pageSize: paginationValue(params.get("pageSize"), 25, 100),
  };
}

export function parseCreateResponsibilityInput(input: unknown) {
  const value = record(input);
  const scopeIds = Array.isArray(value.scopeOptionIds)
    ? value.scopeOptionIds.map((entry) => uuid(entry))
    : [];
  return {
    approverUserId: uuid(value.approverUserId),
    resourceId: text(value.resourceId, 80, 1),
    permissionId:
      value.permissionId === null || value.permissionId === undefined
        ? null
        : text(value.permissionId, 120, 1),
    scopeOptionIds: [...new Set(scopeIds)],
  };
}

export function parseEndResponsibilityInput(input: unknown) {
  const value = record(input);
  return { responsibilityId: uuid(value.responsibilityId) };
}

export function parseCreateDelegationInput(input: unknown) {
  const value = record(input);
  const validFrom = text(value.validFrom, 40, 10);
  const validUntil = text(value.validUntil, 40, 10);
  if (Number.isNaN(Date.parse(validFrom)) || Number.isNaN(Date.parse(validUntil)))
    throw new GovernanceError("invalid_input", "Delegation dates are invalid.");
  if (Date.parse(validUntil) <= Date.parse(validFrom))
    throw new GovernanceError("invalid_input", "Delegation end must be after start.");
  return {
    delegatorUserId: uuid(value.delegatorUserId),
    substituteUserId: uuid(value.substituteUserId),
    validFrom,
    validUntil,
  };
}

export function parseCancelDelegationInput(input: unknown) {
  return { delegationId: uuid(record(input).delegationId) };
}

export function parsePolicyVersionInput(input: unknown) {
  const value = record(input);
  const defaultDays = Number(value.defaultDays);
  const maxDays = Number(value.maxDays);
  if (!Number.isInteger(defaultDays) || defaultDays < 1 || defaultDays > 3650)
    throw new GovernanceError("invalid_input", "Policy duration is invalid.");
  if (!Number.isInteger(maxDays) || maxDays < defaultDays || maxDays > 3650)
    throw new GovernanceError("invalid_input", "Policy duration is invalid.");
  return {
    resourceId: text(value.resourceId, 80, 1),
    defaultDays,
    maxDays,
    renewable: value.renewable === true,
    policyNote: text(value.policyNote, 2000, 1),
  };
}

export function parsePolicyToggleInput(input: unknown) {
  const value = record(input);
  const kind = value.kind;
  if (kind !== "resource" && kind !== "permission")
    throw new GovernanceError("invalid_input", "The policy target is invalid.");
  return {
    kind,
    id: text(value.id, 120, 1),
    enabled: value.enabled === true,
  };
}

export function parseScopeOptionInput(input: unknown) {
  const value = record(input);
  return {
    resourceId: text(value.resourceId, 80, 1),
    fieldName: text(value.fieldName, 40, 1),
    institutionalCode: text(value.institutionalCode, 80, 1).toUpperCase(),
    displayName: text(value.displayName, 200, 1),
  };
}

export function parseManualAssignInput(input: unknown) {
  const value = record(input);
  return {
    responsibilityId: uuid(value.responsibilityId),
    expectedVersion:
      typeof value.expectedVersion === "number" &&
      Number.isInteger(value.expectedVersion) &&
      value.expectedVersion > 0
        ? value.expectedVersion
        : (() => {
            throw new GovernanceError(
              "invalid_input",
              "The request version is invalid.",
            );
          })(),
  };
}

export function parseNotificationPreferenceInput(input: unknown) {
  const value = record(input);
  const keys = Object.keys(value);
  if (
    !keys.length ||
    keys.some(
      (key) =>
        ![
          "inAppEnabled",
          "externalEmailEnabled",
          "externalSmsEnabled",
          "externalPushEnabled",
        ].includes(key),
    )
  )
    throw new GovernanceError("invalid_input", "Notification preferences are invalid.");
  const result: Record<string, boolean> = {};
  for (const key of keys) {
    if (typeof value[key] !== "boolean")
      throw new GovernanceError("invalid_input", "Notification preferences are invalid.");
    result[key] = value[key] as boolean;
  }
  return result;
}

export function parseIdentifierInput(input: unknown) {
  const value = record(input);
  const identifierType = text(value.identifierType, 40, 1);
  if (identifierType !== "student_number" && identifierType !== "staff_number")
    throw new GovernanceError("invalid_input", "The identifier type is invalid.");
  return {
    identifierType: identifierType as "student_number" | "staff_number",
    issuer: text(value.issuer, 120, 1),
    identifier: text(value.identifier, 80, 1).toUpperCase(),
  };
}

export function parseRetentionDryRunInput(input: unknown) {
  const value = record(input);
  const recordClass = text(value.recordClass, 80, 1);
  const apply = value.apply === true;
  return { recordClass, apply };
}

export function roleAllowsApprover(role: Role) {
  return role === "approver" || role === "admin";
}
