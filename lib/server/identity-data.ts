import "server-only";
import { auth } from "./auth";
import { assertBackendConfigured } from "./config";
import { query } from "./db";
import type { Role } from "@/lib/model";
import type { TrustedIdentity } from "@/lib/auth-types";

export async function getTrustedIdentityFromHeaders(
  requestHeaders: Headers,
): Promise<TrustedIdentity | null> {
  assertBackendConfigured();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) return null;
  const result = await query<{
    id: string;
    name: string;
    email: string;
    department: string;
    active: boolean;
    requester_role: "student" | "faculty" | null;
    roles: Role[];
  }>(
    `SELECT u.id, u.name, u.email, p.department, p.active,
            p.requester_role,
            coalesce(array_agg(ur.role ORDER BY ur.role)
              FILTER (WHERE ur.role IS NOT NULL), '{}') AS roles
       FROM "user" u
       JOIN user_profile p ON p.user_id = u.id
       LEFT JOIN user_role ur ON ur.user_id = u.id
      WHERE u.id = $1
      GROUP BY u.id, p.department, p.active, p.requester_role`,
    [session.user.id],
  );
  const row = result.rows[0];
  if (!row?.active) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    department: row.department,
    active: row.active,
    roles: row.roles,
    requesterRole: row.requester_role,
  };
}

export async function hasActiveApprovalResponsibility(userId: string) {
  const result = await query(
    `SELECT 1
       FROM approver_responsibility responsibility
       JOIN user_profile profile
         ON profile.user_id = responsibility.approver_user_id
        AND profile.active
      WHERE responsibility.approver_user_id = $1
        AND responsibility.valid_from <= now()
        AND (responsibility.valid_until IS NULL OR responsibility.valid_until > now())
        AND EXISTS (
          SELECT 1 FROM user_role role
           WHERE role.user_id = responsibility.approver_user_id
             AND role.role IN ('approver', 'admin')
        )
      LIMIT 1`,
    [userId],
  );
  return Boolean(result.rows[0]);
}
