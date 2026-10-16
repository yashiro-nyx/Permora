import { randomUUID } from "node:crypto";
import { transaction } from "./db";
export { hashPassword, verifyPassword } from "../password-hash";

export class PasswordChangeConflictError extends Error {
  constructor() {
    super("The credential changed before the password update completed.");
    this.name = "PasswordChangeConflictError";
  }
}

export async function updatePasswordAndAudit(input: {
  userId: string;
  currentSessionId: string;
  credentialId: string;
  oldPasswordHash: string;
  newPasswordHash: string;
}) {
  await transaction(async (client) => {
    const updated = await client.query(
      `UPDATE account
          SET password = $1, "updatedAt" = now()
        WHERE id = $2 AND "userId" = $3 AND "providerId" = 'credential'
          AND password = $4
       RETURNING id`,
      [
        input.newPasswordHash,
        input.credentialId,
        input.userId,
        input.oldPasswordHash,
      ],
    );
    if (updated.rowCount !== 1) throw new PasswordChangeConflictError();

    await client.query(
      `DELETE FROM "session"
        WHERE "userId" = $1 AND id <> $2`,
      [input.userId, input.currentSessionId],
    );
    await client.query(
      `INSERT INTO audit_event
        (id, actor_user_id, subject_user_id, event_type, metadata)
       VALUES ($1,$2,$2,'account.password_changed',$3::jsonb)`,
      [
        randomUUID(),
        input.userId,
        JSON.stringify({ otherSessionsRevoked: true }),
      ],
    );
  });
}
