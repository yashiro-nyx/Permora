import type { Role } from "./model";
import type {
  AccountUserDto,
  AccountUserRow,
  UserListFilters,
} from "./server/account-types";

const ROLES = new Set<Role>(["student", "faculty", "approver", "admin"]);
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type AccountErrorCode =
  | "invalid_input"
  | "forbidden"
  | "not_found"
  | "email_in_use"
  | "last_active_admin"
  | "self_deactivation"
  | "self_demotion"
  | "account_already_active"
  | "account_already_deactivated"
  | "session_revocation_failed"
  | "stale_account";

const ERROR_DETAILS: Record<
  AccountErrorCode,
  { status: number; message: string }
> = {
  invalid_input: { status: 400, message: "The account input is invalid." },
  forbidden: { status: 403, message: "Administrator access is required." },
  not_found: { status: 404, message: "The account was not found." },
  email_in_use: { status: 409, message: "An account already uses that email." },
  last_active_admin: {
    status: 409,
    message: "The last active administrator cannot be deactivated or demoted.",
  },
  self_deactivation: {
    status: 409,
    message: "An administrator cannot deactivate their own account.",
  },
  self_demotion: {
    status: 409,
    message: "An administrator cannot remove their own administrator role.",
  },
  account_already_active: {
    status: 409,
    message: "The account is already active.",
  },
  account_already_deactivated: {
    status: 409,
    message: "The account is already deactivated.",
  },
  session_revocation_failed: {
    status: 503,
    message: "Existing sessions could not be invalidated; the account remains deactivated.",
  },
  stale_account: {
    status: 409,
    message: "This account changed after it was loaded. Review the latest values and try again.",
  },
};

export class AccountServiceError extends Error {
  constructor(readonly code: AccountErrorCode) {
    super(ERROR_DETAILS[code].message);
    this.name = "AccountServiceError";
  }
}

export function mapAccountServiceError(error: unknown) {
  if (error instanceof AccountServiceError) {
    const detail = ERROR_DETAILS[error.code];
    return {
      status: detail.status,
      body: { error: { code: error.code, message: detail.message } },
    };
  }
  return {
    status: 503,
    body: {
      error: {
        code: "service_unavailable",
        message: "Account management is temporarily unavailable.",
      },
    },
  };
}

function recordInput(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AccountServiceError("invalid_input");
  return value as Record<string, unknown>;
}

function text(value: unknown, maximum: number, minimum = 0) {
  if (typeof value !== "string") throw new AccountServiceError("invalid_input");
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum)
    throw new AccountServiceError("invalid_input");
  return normalized;
}

function email(value: unknown) {
  const normalized = text(value, 254, 3).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized))
    throw new AccountServiceError("invalid_input");
  return normalized;
}

function roles(value: unknown): Role[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > ROLES.size)
    throw new AccountServiceError("invalid_input");
  const unique = new Set(value);
  if (
    unique.size !== value.length ||
    value.some((role) => typeof role !== "string" || !ROLES.has(role as Role)) ||
    (unique.has("student") && unique.has("faculty"))
  )
    throw new AccountServiceError("invalid_input");
  return [...unique].sort() as Role[];
}

function paginationValue(value: string | null, fallback: number, maximum: number) {
  if (value === null || value === "") return fallback;
  if (!/^\d+$/.test(value)) throw new AccountServiceError("invalid_input");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1)
    throw new AccountServiceError("invalid_input");
  return Math.min(parsed, maximum);
}

export function parseUserListFilters(params: URLSearchParams): UserListFilters {
  const search = params.get("search")?.trim() || undefined;
  if (search && search.length > 100)
    throw new AccountServiceError("invalid_input");
  const roleValue = params.get("role")?.trim() || undefined;
  if (roleValue && !ROLES.has(roleValue as Role))
    throw new AccountServiceError("invalid_input");
  const statusValue = params.get("status")?.trim() || undefined;
  if (statusValue && statusValue !== "active" && statusValue !== "deactivated")
    throw new AccountServiceError("invalid_input");
  return {
    search,
    role: roleValue as Role | undefined,
    status: statusValue as UserListFilters["status"],
    page: paginationValue(params.get("page"), 1, 10_000),
    pageSize: paginationValue(params.get("pageSize"), 25, 100),
  };
}

export type CreateUserInput = {
  name: string;
  email: string;
  department: string;
  roles: Role[];
};

export type UpdateUserInput = Partial<CreateUserInput>;

export function parseCreateUserInput(input: unknown): CreateUserInput {
  const value = recordInput(input);
  return {
    name: text(value.name, 120, 2),
    email: email(value.email),
    department: value.department === undefined ? "" : text(value.department, 200),
    roles: roles(value.roles),
  };
}

export function parseUpdateUserInput(input: unknown): UpdateUserInput {
  const value = recordInput(input);
  const keys = Object.keys(value);
  if (
    !keys.length ||
    keys.some((key) => !["name", "email", "department", "roles"].includes(key))
  )
    throw new AccountServiceError("invalid_input");
  const result: UpdateUserInput = {};
  if ("name" in value) result.name = text(value.name, 120, 2);
  if ("email" in value) result.email = email(value.email);
  if ("department" in value) result.department = text(value.department, 200);
  if ("roles" in value) result.roles = roles(value.roles);
  return result;
}

export function parseDeactivationReason(value: unknown) {
  const reason = text(value, 2000, 1);
  if (
    /\b(?:password|passwd|token|secret|api[_ -]?key|authorization|bearer)\b\s*[:=]\s*\S+/i.test(
      reason,
    ) ||
    /\$argon2(?:id|i|d)\$|\beyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\b/.test(
      reason,
    )
  )
    throw new AccountServiceError("invalid_input");
  return reason;
}

export function parseUserId(value: unknown) {
  if (typeof value !== "string" || !UUID.test(value))
    throw new AccountServiceError("invalid_input");
  return value;
}

function iso(value: Date | string) {
  return new Date(value).toISOString();
}

export function toAccountUserDto(row: AccountUserRow): AccountUserDto {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    department: row.department,
    active: row.active,
    hasCredential: row.has_credential,
    invitation:
      row.invitation_id && row.invitation_expires_at
        ? {
            id: row.invitation_id,
            expiresAt: iso(row.invitation_expires_at),
          }
        : null,
    roles: [...row.roles],
    requesterRole: row.requester_role,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    deactivatedAt: row.deactivated_at ? iso(row.deactivated_at) : null,
    deactivationReason: row.deactivation_reason,
    deactivatedBy:
      row.deactivated_by_user_id && row.deactivated_by_name
        ? { id: row.deactivated_by_user_id, name: row.deactivated_by_name }
        : null,
  };
}