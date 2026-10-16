import "server-only";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import {
  ACCEPTANCE_RATE_LIMIT,
  createInvitationToken,
  hashInvitationToken,
  hashRateLimitIdentifier,
  InvitationFlowError,
  invitationAuditMetadata,
  invitationRateLimitAllowed,
  parseInvitationAcceptanceInput,
  validatePasswordLength,
} from "@/lib/account-credentials";
import { AccountServiceError, parseUserId } from "@/lib/account-management";
import type { TrustedIdentity } from "@/lib/auth-types";
import { query, transaction } from "./db";

const ACCOUNT_ADMIN_LOCK = 73020423;
const INVITATION_LIFETIME_HOURS = 24;
const RATE_LIMIT_PREFIX = "permora:invitation-accept:";

interface InvitationServiceDependencies {
  requireAdmin: () => Promise<TrustedIdentity>;
}

type InvitationServiceOverrides = Partial<InvitationServiceDependencies>;

async function requireActiveAdminSession(): Promise<TrustedIdentity> {
  const { requireAdmin } = await import("./identity");
  return requireAdmin();
}

async function lockAccountAdministration(client: PoolClient) {
  await client.query("SELECT pg_advisory_xact_lock($1)", [ACCOUNT_ADMIN_LOCK]);
}

async function assertActiveAdministrator(client: PoolClient, userId: string) {
  const result = await client.query(
    `SELECT 1 FROM user_profile profile
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

async function insertAudit(
  client: PoolClient,
  actorUserId: string | null,
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

export async function issueInvitation(
  userId: string,
  dependencies: InvitationServiceOverrides = {},
) {
  const identity = await (dependencies.requireAdmin ?? requireActiveAdminSession)();
  const targetUserId = parseUserId(userId);
  const rawToken = createInvitationToken();
  const tokenHash = hashInvitationToken(rawToken);
  const invitationId = randomUUID();
  const expiresAt = new Date(Date.now() + INVITATION_LIFETIME_HOURS * 60 * 60 * 1000);

  const invitation = await transaction(async (client) => {
    await lockAccountAdministration(client);
    await assertActiveAdministrator(client, identity.id);
    const target = await client.query<{
      active: boolean;
      has_credential: boolean;
    }>(
      `SELECT profile.active,
              EXISTS (
                SELECT 1 FROM account credential
                 WHERE credential."userId" = user_record.id
                   AND credential."providerId" = 'credential'
                   AND credential.password IS NOT NULL
              ) AS has_credential
         FROM "user" user_record
         JOIN user_profile profile ON profile.user_id = user_record.id
        WHERE user_record.id = $1
        FOR UPDATE OF user_record, profile`,
      [targetUserId],
    );
    if (!target.rows[0] || !target.rows[0].active)
      throw new AccountServiceError("not_found");
    if (target.rows[0].has_credential)
      throw new InvitationFlowError("credential_exists");
    const outstanding = await client.query(
      `SELECT 1 FROM account_invitation
        WHERE target_user_id = $1 AND used_at IS NULL AND expires_at > now()
        LIMIT 1`,
      [targetUserId],
    );
    if (outstanding.rows[0])
      throw new InvitationFlowError("invitation_exists");

    await client.query(
      `INSERT INTO account_invitation
        (id, target_user_id, token_hash, expires_at, created_by)
       VALUES ($1,$2,$3,$4,$5)`,
      [invitationId, targetUserId, tokenHash, expiresAt, identity.id],
    );
    await insertAudit(
      client,
      identity.id,
      targetUserId,
      "account.invitation_issued",
      invitationAuditMetadata(invitationId, expiresAt.toISOString()),
    );
    return { id: invitationId, expiresAt: expiresAt.toISOString() };
  });

  return { invitation, rawToken };
}

export async function revokeInvitation(
  userId: string,
  invitationId: string,
  dependencies: InvitationServiceOverrides = {},
) {
  const identity = await (dependencies.requireAdmin ?? requireActiveAdminSession)();
  const targetUserId = parseUserId(userId);
  const id = parseUserId(invitationId);
  return transaction(async (client) => {
    await lockAccountAdministration(client);
    await assertActiveAdministrator(client, identity.id);
    const removed = await client.query<{ id: string }>(
      `DELETE FROM account_invitation
        WHERE id = $1 AND target_user_id = $2
          AND used_at IS NULL AND expires_at > now()
       RETURNING id`,
      [id, targetUserId],
    );
    if (!removed.rows[0]) throw new InvitationFlowError("not_found");
    await insertAudit(client, identity.id, targetUserId, "account.invitation_revoked", {
      ...invitationAuditMetadata(id),
    });
    return { revoked: true };
  });
}

export async function checkInvitationAcceptanceRateLimit(clientAddress: string) {
  const addressDigest = hashRateLimitIdentifier(clientAddress || "unknown");
  const key = `${RATE_LIMIT_PREFIX}${addressDigest}`;
  const now = Date.now();
  const cutoff = now - ACCEPTANCE_RATE_LIMIT.windowSeconds * 1000;
  const result = await query<{ count: number }>(
    `INSERT INTO "rateLimit" (id, key, count, "lastRequest")
     VALUES ($1,$1,1,$2)
     ON CONFLICT (key) DO UPDATE
       SET count = CASE
             WHEN "rateLimit"."lastRequest" <= $3 THEN 1
             ELSE LEAST("rateLimit".count + 1, $4)
           END,
           "lastRequest" = CASE
             WHEN "rateLimit"."lastRequest" <= $3 THEN $2
             ELSE "rateLimit"."lastRequest"
           END
     RETURNING count`,
    [key, now, cutoff, ACCEPTANCE_RATE_LIMIT.maxAttempts + 1],
  );
  return invitationRateLimitAllowed(result.rows[0].count);
}

export async function acceptInvitation(input: unknown) {
  const { tokenHash, password } = parseInvitationAcceptanceInput(input);
  const { auth } = await import("./auth");
  const authContext = await auth.$context;
  validatePasswordLength(
    password,
    authContext.password.config.minPasswordLength,
    authContext.password.config.maxPasswordLength,
  );

  const candidate = await query<{ id: string }>(
    `SELECT invitation.id
       FROM account_invitation invitation
       JOIN user_profile profile ON profile.user_id = invitation.target_user_id
      WHERE invitation.token_hash = $1
        AND invitation.used_at IS NULL
        AND invitation.expires_at > now()
        AND profile.active
        AND NOT EXISTS (
          SELECT 1 FROM account credential
           WHERE credential."userId" = invitation.target_user_id
             AND credential."providerId" = 'credential'
             AND credential.password IS NOT NULL
        )
      LIMIT 1`,
    [tokenHash],
  );
  if (!candidate.rows[0])
    throw new InvitationFlowError("invalid_invitation");

  const passwordHash = await authContext.password.hash(password);
  await transaction(async (client) => {
    const result = await client.query<{
      id: string;
      target_user_id: string;
      active: boolean;
      has_credential: boolean;
    }>(
      `SELECT invitation.id, invitation.target_user_id, profile.active,
              EXISTS (
                SELECT 1 FROM account credential
                 WHERE credential."userId" = invitation.target_user_id
                   AND credential."providerId" = 'credential'
                   AND credential.password IS NOT NULL
              ) AS has_credential
         FROM account_invitation invitation
         JOIN user_profile profile ON profile.user_id = invitation.target_user_id
        WHERE invitation.token_hash = $1
          AND invitation.used_at IS NULL
          AND invitation.expires_at > now()
        FOR UPDATE OF invitation, profile`,
      [tokenHash],
    );
    const row = result.rows[0];
    if (!row || !row.active || row.has_credential)
      throw new InvitationFlowError("invalid_invitation");

    const now = new Date();
    await client.query(
      `INSERT INTO account
        (id, "userId", "accountId", "providerId", password, "createdAt", "updatedAt")
       VALUES ($1,$2::uuid,$2::text,'credential',$3,$4,$4)`,
      [randomUUID(), row.target_user_id, passwordHash, now],
    );
    await client.query(
      `UPDATE "user" SET "emailVerified" = true WHERE id = $1`,
      [row.target_user_id],
    );
    const consumed = await client.query(
      `UPDATE account_invitation SET used_at = now()
        WHERE id = $1 AND used_at IS NULL AND expires_at > now()`,
      [row.id],
    );
    if (consumed.rowCount !== 1)
      throw new InvitationFlowError("invalid_invitation");
    await insertAudit(client, null, row.target_user_id, "account.invitation_accepted", {
      ...invitationAuditMetadata(row.id),
    });
  });
  return { accepted: true };
}
