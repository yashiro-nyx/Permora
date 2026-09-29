import "server-only";
import { randomUUID } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import type { Role } from "@/lib/model";
import type { TrustedIdentity } from "@/lib/auth-types";
import {
  AccountServiceError,
  parseCreateUserInput,
  parseDeactivationReason,
  parseUpdateUserInput,
  parseUserId,
  parseUserListFilters,
  toAccountUserDto,
  type CreateUserInput,
  type UpdateUserInput,
} from "@/lib/account-management";
import { reconcilePendingReviewsForInactiveApprover } from "@/lib/approval-domain";
import { query, transaction } from "./db";
import type {
  AccountUserDto,
  AccountUserRow,
  UserListDto,
  UserListFilters,
} from "./account-types";

const ACCOUNT_ADMIN_LOCK = 73020423;

export interface AccountServiceDependencies {
  requireAdmin: () => Promise<TrustedIdentity>;
  revokeUserSessions: typeof revokeUserSessions;
}

type AccountServiceOverrides = Partial<AccountServiceDependencies>;

type LockedUser = {
  id: string;
  active: boolean;
  roles: Role[];
};

type AccountUserQueryRow = AccountUserRow & QueryResultRow;

const ACCOUNT_USER_SELECT = `
  SELECT u.id, u.name, u.email, profile.department, profile.active,
         profile.requester_role, u."createdAt" AS created_at,
         greatest(u."updatedAt", profile.updated_at) AS updated_at,
         profile.deactivated_at,
         profile.deactivation_reason,
         profile.deactivated_by AS deactivated_by_user_id,
         deactivator.name AS deactivated_by_name,
         coalesce(array_agg(assigned_role.role ORDER BY assigned_role.role)
           FILTER (WHERE assigned_role.role IS NOT NULL), '{}') AS roles
    FROM "user" u
    JOIN user_profile profile ON profile.user_id = u.id
    LEFT JOIN "user" deactivator ON deactivator.id = profile.deactivated_by
    LEFT JOIN user_role assigned_role ON assigned_role.user_id = u.id`;

async function requireActiveAdminSession() {
  const { requireAdmin } = await import("./identity");
  return requireAdmin();
}

function isEmailUniqueViolation(error: unknown) {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "23505" &&
    "constraint" in error &&
    error.constraint === "user_email_unique"
  );
}

async function withAccountErrorMapping<T>(work: () => Promise<T>) {
  try {
    return await work();
  } catch (error) {
    if (isEmailUniqueViolation(error))
      throw new AccountServiceError("email_in_use");
    throw error;
  }
}

function requesterRoleFor(assignedRoles: Role[]) {
  if (assignedRoles.includes("student")) return "student";
  if (assignedRoles.includes("faculty")) return "faculty";
  return null;
}

async function lockAccountAdministration(client: PoolClient) {
  await client.query("SELECT pg_advisory_xact_lock($1)", [ACCOUNT_ADMIN_LOCK]);
}

async function assertActiveAdministrator(client: PoolClient, userId: string) {
  const result = await client.query(
    `SELECT 1
       FROM user_profile profile
      WHERE profile.user_id = $1 AND profile.active
        AND EXISTS (
          SELECT 1 FROM user_role role
           WHERE role.user_id = profile.user_id AND role.role = 'admin'
        )
      FOR UPDATE OF profile`,
    [userId],
  );
  if (!result.rows[0]) throw new AccountServiceError("forbidden");
}

async function lockUser(client: PoolClient, userId: string): Promise<LockedUser> {
  const result = await client.query<{
    id: string;
    active: boolean;
  }>(
    `SELECT user_record.id, profile.active
       FROM "user" user_record
       JOIN user_profile profile ON profile.user_id = user_record.id
      WHERE user_record.id = $1
      FOR UPDATE OF user_record, profile`,
    [userId],
  );
  const account = result.rows[0];
  if (!account) throw new AccountServiceError("not_found");
  const assignedRoles = await client.query<{ role: Role }>(
    "SELECT role FROM user_role WHERE user_id = $1 ORDER BY role",
    [userId],
  );
  return {
    id: account.id,
    active: account.active,
    roles: assignedRoles.rows.map((row) => row.role),
  };
}

async function activeAdministratorCount(client: PoolClient) {
  const result = await client.query<{ count: number }>(
    `SELECT count(*)::int AS count
       FROM user_role role
       JOIN user_profile profile ON profile.user_id = role.user_id
      WHERE role.role = 'admin' AND profile.active`,
  );
  return result.rows[0].count;
}

async function assertAdministratorCanBeRemoved(
  client: PoolClient,
  user: LockedUser,
) {
  if (user.active && user.roles.includes("admin") &&
      (await activeAdministratorCount(client)) <= 1)
    throw new AccountServiceError("last_active_admin");
}

async function selectAccountUser(client: PoolClient, userId: string) {
  const result = await client.query<AccountUserQueryRow>(
    `${ACCOUNT_USER_SELECT}
      WHERE u.id = $1
      GROUP BY u.id, profile.user_id, deactivator.id`,
    [userId],
  );
  const row = result.rows[0];
  if (!row) throw new AccountServiceError("not_found");
  return toAccountUserDto(row);
}

async function insertAccountAudit(
  client: PoolClient,
  actorUserId: string,
  subjectUserId: string,
  eventType: string,
  metadata: Record<string, unknown>,
) {
  await client.query(
    `INSERT INTO audit_event
      (id, actor_user_id, subject_user_id, event_type, metadata)
     VALUES ($1,$2,$3,$4,$5::jsonb)`,
    [randomUUID(), actorUserId, subjectUserId, eventType, JSON.stringify(metadata)],
  );
}

function accountWhere(filters: UserListFilters) {
  const values: unknown[] = [];
  const clauses: string[] = [];
  if (filters.search) {
    values.push(`%${filters.search}%`);
    clauses.push(
      `(u.name ILIKE $${values.length} OR u.email ILIKE $${values.length} OR profile.department ILIKE $${values.length})`,
    );
  }
  if (filters.role) {
    values.push(filters.role);
    clauses.push(
      `EXISTS (SELECT 1 FROM user_role filter_role WHERE filter_role.user_id = u.id AND filter_role.role = $${values.length})`,
    );
  }
  if (filters.status) {
    values.push(filters.status === "active");
    clauses.push(`profile.active = $${values.length}`);
  }
  return { values, where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "" };
}

export async function listUsers(
  searchParams: URLSearchParams,
  dependencies: AccountServiceOverrides = {},
): Promise<UserListDto> {
  await (dependencies.requireAdmin ?? requireActiveAdminSession)();
  const filters = parseUserListFilters(searchParams);
  const { values, where } = accountWhere(filters);
  const limitPosition = values.length + 1;
  const offsetPosition = values.length + 2;
  values.push(filters.pageSize, (filters.page - 1) * filters.pageSize);
  const result = await query<
    (AccountUserQueryRow & { total_count: number }) | (QueryResultRow & { total_count: number; id: null })
  >(
    `WITH filtered AS (
       ${ACCOUNT_USER_SELECT}
        ${where}
        GROUP BY u.id, profile.user_id, deactivator.id
     ), page AS (
       SELECT * FROM filtered
        ORDER BY lower(name), id
        LIMIT $${limitPosition} OFFSET $${offsetPosition}
     )
     SELECT page.*, (SELECT count(*)::int FROM filtered) AS total_count
       FROM (SELECT 1) seed
       LEFT JOIN page ON true
      ORDER BY lower(page.name) NULLS LAST, page.id NULLS LAST`,
    values,
  );
  const total = Number(result.rows[0]?.total_count ?? 0);
  const items = result.rows
    .filter((row) => row.id !== null)
    .map((row) => toAccountUserDto(row as AccountUserQueryRow));
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

export async function getUser(
  userId: string,
  dependencies: AccountServiceOverrides = {},
): Promise<AccountUserDto | null> {
  await (dependencies.requireAdmin ?? requireActiveAdminSession)();
  const id = parseUserId(userId);
  const result = await query<AccountUserQueryRow>(
    `${ACCOUNT_USER_SELECT}
      WHERE u.id = $1
      GROUP BY u.id, profile.user_id, deactivator.id`,
    [id],
  );
  return result.rows[0] ? toAccountUserDto(result.rows[0]) : null;
}

async function validateActiveAdminTransaction(
  client: PoolClient,
  actorUserId: string,
) {
  await lockAccountAdministration(client);
  await assertActiveAdministrator(client, actorUserId);
}

export async function createUser(
  input: unknown,
  dependencies: AccountServiceOverrides = {},
): Promise<AccountUserDto> {
  const identity = await (dependencies.requireAdmin ?? requireActiveAdminSession)();
  const data: CreateUserInput = parseCreateUserInput(input);
  return withAccountErrorMapping(() =>
    transaction(async (client) => {
      await validateActiveAdminTransaction(client, identity.id);
      const id = randomUUID();
      await client.query(
        `INSERT INTO "user"
          (id, name, email, "emailVerified", "createdAt", "updatedAt")
         VALUES ($1,$2,$3,false,now(),now())`,
        [id, data.name, data.email],
      );
      await client.query(
        `INSERT INTO user_profile (user_id, department, requester_role)
         VALUES ($1,$2,$3)`,
        [id, data.department, requesterRoleFor(data.roles)],
      );
      for (const role of data.roles)
        await client.query(
          "INSERT INTO user_role (user_id, role, assigned_by) VALUES ($1,$2,$3)",
          [id, role, identity.id],
        );
      await insertAccountAudit(client, identity.id, id, "account.created", {
        roles: data.roles,
      });
      return selectAccountUser(client, id);
    }),
  );
}

export async function updateUser(
  userId: string,
  input: unknown,
  dependencies: AccountServiceOverrides = {},
): Promise<AccountUserDto> {
  const identity = await (dependencies.requireAdmin ?? requireActiveAdminSession)();
  const id = parseUserId(userId);
  const changes: UpdateUserInput = parseUpdateUserInput(input);
  return withAccountErrorMapping(() =>
    transaction(async (client) => {
      await validateActiveAdminTransaction(client, identity.id);
      const current = await lockUser(client, id);
      const nextRoles = changes.roles ?? current.roles;
      if (
        identity.id === id &&
        current.roles.includes("admin") &&
        !nextRoles.includes("admin")
      )
        throw new AccountServiceError("self_demotion");
      if (current.roles.includes("admin") && !nextRoles.includes("admin"))
        await assertAdministratorCanBeRemoved(client, current);
      await client.query(
        `UPDATE "user"
            SET name = coalesce($2, name), email = coalesce($3, email),
                "updatedAt" = now()
          WHERE id = $1`,
        [id, changes.name ?? null, changes.email ?? null],
      );
      if (changes.department !== undefined || changes.roles !== undefined) {
        await client.query(
          `UPDATE user_profile
              SET department = coalesce($2, department),
                  requester_role = CASE WHEN $3 THEN $4 ELSE requester_role END,
                  updated_at = now()
            WHERE user_id = $1`,
          [
            id,
            changes.department ?? null,
            changes.roles !== undefined,
            changes.roles ? requesterRoleFor(changes.roles) : null,
          ],
        );
      }
      if (changes.roles !== undefined) {
        await client.query("DELETE FROM user_role WHERE user_id = $1", [id]);
        for (const role of changes.roles)
          await client.query(
            "INSERT INTO user_role (user_id, role, assigned_by) VALUES ($1,$2,$3)",
            [id, role, identity.id],
          );
      }
      const reconciliation =
        changes.roles !== undefined &&
        current.active &&
        current.roles.includes("approver") &&
        !changes.roles.includes("approver")
          ? await reconcilePendingReviewsForInactiveApprover(
              client,
              id,
              identity.id,
            )
          : { routed: 0, unassigned: 0 };
      await insertAccountAudit(client, identity.id, id, "account.updated", {
        changedFields: Object.keys(changes).sort(),
        ...(changes.roles
          ? { previousRoles: current.roles, roles: changes.roles }
          : {}),
        reassignedReviews: reconciliation.routed,
        unassignedReviews: reconciliation.unassigned,
      });
      return selectAccountUser(client, id);
    }),
  );
}

async function revokeUserSessions(userId: string) {
  const { auth } = await import("./auth");
  const context = await auth.$context;
  await context.internalAdapter.deleteUserSessions(userId);
}

export async function deactivateUser(
  userId: string,
  reason: unknown,
  dependencies: AccountServiceOverrides = {},
): Promise<{ user: AccountUserDto; sessionsRevoked: boolean }> {
  const identity = await (dependencies.requireAdmin ?? requireActiveAdminSession)();
  const id = parseUserId(userId);
  const normalizedReason = parseDeactivationReason(reason);
  const result = await transaction(async (client) => {
    await validateActiveAdminTransaction(client, identity.id);
    const target = await lockUser(client, id);
    if (!target.active)
      throw new AccountServiceError("account_already_deactivated");
    await assertAdministratorCanBeRemoved(client, target);
    if (identity.id === id) throw new AccountServiceError("self_deactivation");
    await client.query(
      `UPDATE user_profile
          SET active = false, deactivated_at = now(), deactivated_by = $2,
              deactivation_reason = $3, updated_at = now()
        WHERE user_id = $1`,
      [id, identity.id, normalizedReason],
    );
    const reconciliation = target.roles.includes("approver")
      ? await reconcilePendingReviewsForInactiveApprover(client, id, identity.id)
      : { routed: 0, unassigned: 0 };
    await insertAccountAudit(client, identity.id, id, "account.deactivated", {
      deactivationReasonRecorded: true,
      reassignedReviews: reconciliation.routed,
      unassignedReviews: reconciliation.unassigned,
    });
    return selectAccountUser(client, id);
  });

  let sessionsRevoked = true;
  try {
    await (dependencies.revokeUserSessions ?? revokeUserSessions)(id);
  } catch {
    sessionsRevoked = false;
  }
  return { user: result, sessionsRevoked };
}

export async function reactivateUser(
  userId: string,
  dependencies: AccountServiceOverrides = {},
): Promise<AccountUserDto> {
  const identity = await (dependencies.requireAdmin ?? requireActiveAdminSession)();
  const id = parseUserId(userId);
  await transaction(async (client) => {
    await validateActiveAdminTransaction(client, identity.id);
    const target = await lockUser(client, id);
    if (target.active) throw new AccountServiceError("account_already_active");
  });
  try {
    await (dependencies.revokeUserSessions ?? revokeUserSessions)(id);
  } catch {
    throw new AccountServiceError("session_revocation_failed");
  }
  return transaction(async (client) => {
    await validateActiveAdminTransaction(client, identity.id);
    const target = await lockUser(client, id);
    if (target.active) throw new AccountServiceError("account_already_active");
    await client.query(
      `UPDATE user_profile
          SET active = true, deactivated_at = NULL, deactivated_by = NULL,
              deactivation_reason = NULL, updated_at = now()
        WHERE user_id = $1`,
      [id],
    );
    await insertAccountAudit(client, identity.id, id, "account.reactivated", {});
    return selectAccountUser(client, id);
  });
}