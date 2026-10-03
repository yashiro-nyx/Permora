import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test, { after, before } from "node:test";
import { Pool } from "pg";
import type { Role } from "../lib/model";
import { InvitationFlowError } from "../lib/account-credentials";
import { AccountServiceError } from "../lib/account-management";
import { ResilientPool } from "../lib/database-pool";
import {
  extractDatabaseTargetOptions,
  resolveCliDatabase,
} from "../scripts/database-target";
import {
  closeApplicationTestPool,
  installApplicationTestPool,
} from "./helpers/application-test-pool";

const { options } = extractDatabaseTargetOptions([
  "--database-target",
  "test",
]);
if (options.target !== "test") throw new Error("The test target is required.");
const testDatabase = resolveCliDatabase(options);
if (!testDatabase.databaseName.endsWith("_test"))
  throw new Error("Refusing an integration database without the _test suffix.");

const password = "Account integration password 2026";
const invitationPassword = "Invitation acceptance password 2026";
const changedPassword = "Account changed password 2026";
let pool: Pool;
let passwordHash = "";
let loginAddress = 0;
let accountService: typeof import("../lib/server/account-service");
let invitationService: typeof import("../lib/server/invitation-service");
let credentialHandlers: typeof import("../lib/server/credential-handlers");
let getTrustedIdentityFromHeaders: typeof import("../lib/server/identity-data")["getTrustedIdentityFromHeaders"];
let hashPassword: typeof import("../lib/password-hash")["hashPassword"];

async function applyMigrations() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DROP SCHEMA public CASCADE");
    await client.query("CREATE SCHEMA public");
    await client.query(`CREATE TABLE schema_migration (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const files = (await readdir(path.join(process.cwd(), "db", "migrations")))
      .filter((name) => /^\d+.*\.sql$/.test(name))
      .sort();
    for (const file of files) {
      if (file === "0003_fix_rate_limit_schema.sql")
        await client.query(
          `INSERT INTO "rateLimit" (key, count, "lastRequest")
           VALUES ('account-test-legacy-rate', 1, 0)`,
        );
      await client.query(
        await readFile(path.join(process.cwd(), "db", "migrations", file), "utf8"),
      );
      await client.query("INSERT INTO schema_migration (version) VALUES ($1)", [
        file,
      ]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function seedUser(
  roles: Role[],
  name: string,
  active = true,
  withCredential = true,
) {
  const id = randomUUID();
  const email = `${id}@permora.test`;
  const requesterRole = roles.includes("student")
    ? "student"
    : roles.includes("faculty")
      ? "faculty"
      : null;
  const now = new Date();
  await pool.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ($1,$2,$3,true,$4,$4)`,
    [id, name, email, now],
  );
  await pool.query(
    `INSERT INTO user_profile (user_id, department, active, requester_role)
     VALUES ($1,'Account Integration',$2,$3)`,
    [id, active, requesterRole],
  );
  for (const role of roles)
    await pool.query("INSERT INTO user_role (user_id, role) VALUES ($1,$2)", [
      id,
      role,
    ]);
  if (withCredential)
    await pool.query(
      `INSERT INTO account
        (id, "userId", "accountId", "providerId", password, "createdAt", "updatedAt")
       VALUES ($1,$2::uuid,$2::text,'credential',$3,$4,$4)`,
      [randomUUID(), id, passwordHash, now],
    );
  return { id, email };
}

async function login(email: string, passwordForLogin = password) {
  const { auth } = await import("../lib/server/auth");
  const current = loginAddress++;
  const response = await auth.handler(
    new Request("http://localhost:3000/api/auth/sign-in/email", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        "content-type": "application/json",
        "x-forwarded-for": `127.0.${Math.floor(current / 250)}.${(current % 250) + 1}`,
      },
      body: JSON.stringify({ email, password: passwordForLogin }),
    }),
  );
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
  assert.ok(cookie);
  return cookie;
}

async function attemptLogin(email: string, passwordForLogin: string) {
  const { auth } = await import("../lib/server/auth");
  const current = loginAddress++;
  return auth.handler(
    new Request("http://localhost:3000/api/auth/sign-in/email", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        "content-type": "application/json",
        "x-forwarded-for": `127.0.${Math.floor(current / 250)}.${(current % 250) + 1}`,
      },
      body: JSON.stringify({ email, password: passwordForLogin }),
    }),
  );
}

function passwordChangeRequest(
  cookie: string,
  currentPassword: string,
  newPassword: string,
) {
  return new Request("http://localhost:3000/api/account/password", {
    method: "POST",
    headers: {
      cookie,
      origin: "http://localhost:3000",
      "content-type": "application/json",
    },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

async function sessionId(cookie: string) {
  const { auth } = await import("../lib/server/auth");
  const current = await auth.api.getSession({
    headers: new Headers({ cookie }),
    query: { disableCookieCache: true },
  });
  assert.ok(current);
  return current.session.id;
}

function dependencies(cookie: string, revokeUserSessions?: (userId: string) => Promise<void>) {
  return {
    requireAdmin: async () => {
      const identity = await getTrustedIdentityFromHeaders(
        new Headers(cookie ? { cookie } : {}),
      );
      if (!identity || !identity.roles.includes("admin"))
        throw new AccountServiceError("forbidden");
      return identity;
    },
    ...(revokeUserSessions ? { revokeUserSessions } : {}),
  };
}

async function assertServiceRejected(
  work: () => Promise<unknown>,
  code: AccountServiceError["code"],
) {
  await assert.rejects(work, (error: unknown) => {
    assert.ok(error instanceof AccountServiceError);
    assert.equal(error.code, code);
    return true;
  });
}

function assertSanitized(value: unknown) {
  const serialized = JSON.stringify(value);
  assert.doesNotMatch(serialized, /password_hash|password_token|token_hash|session_token/i);
  const visit = (entry: unknown) => {
    if (!entry || typeof entry !== "object") return;
    for (const [key, nested] of Object.entries(entry)) {
      assert.doesNotMatch(key, /^(?:password|passwordHash|token|tokenHash|session|sessionToken)$/i);
      visit(nested);
    }
  };
  visit(value);
}

async function seedResponsibility(approverUserId: string, actorUserId: string) {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO approver_responsibility
      (id, approver_user_id, resource_id, permission_id, valid_from, assigned_by)
     VALUES ($1,$2,'r-library','library:subscribed-materials',now() - interval '1 day',$3)`,
    [id, approverUserId, actorUserId],
  );
  return id;
}

async function seedPendingReview(
  requesterUserId: string,
  approverUserId: string,
  responsibilityId: string,
) {
  const policy = await pool.query<{ id: string }>(
    `SELECT id FROM catalog_policy_version
      WHERE resource_id = 'r-library' ORDER BY version DESC LIMIT 1`,
  );
  const requestId = randomUUID();
  await pool.query(
    `INSERT INTO access_request
      (id, display_id, requester_user_id, resource_id, permission_id,
       policy_version_id, purpose, starts_at, expires_at, status,
       scope_fingerprint, submitted_at)
     VALUES ($1,$2,$3,'r-library','library:subscribed-materials',$4,
       'Account management review reassignment integration request.',
       now(),now() + interval '7 days','pending_review','resource-wide',now())`,
    [requestId, `REQ-ACCOUNT-${requestId}`, requesterUserId, policy.rows[0].id],
  );
  await pool.query(
    `INSERT INTO request_review_assignment
      (id, request_id, approver_user_id, responsibility_id)
     VALUES ($1,$2,$3,$4)`,
    [randomUUID(), requestId, approverUserId, responsibilityId],
  );
  return requestId;
}

before(async () => {
  process.env.APP_URL = "http://localhost:3000";
  process.env.AUTH_SECRET =
    "account-integration-secret-at-least-thirty-two-characters";
  pool = new ResilientPool(
    {
      connectionString: testDatabase.connectionString,
      max: 5,
      connectionTimeoutMillis: 15_000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
    },
    3,
  );
  await installApplicationTestPool(pool);
  const database = await pool.query<{ name: string }>(
    "SELECT current_database() AS name",
  );
  assert.equal(database.rows[0].name, testDatabase.databaseName);
  assert.ok(database.rows[0].name.endsWith("_test"));
  await applyMigrations();
  hashPassword = (await import("../lib/password-hash")).hashPassword;
  passwordHash = await hashPassword(password);
  getTrustedIdentityFromHeaders = (
    await import("../lib/server/identity-data")
  ).getTrustedIdentityFromHeaders;
  accountService = await import("../lib/server/account-service");
  invitationService = await import("../lib/server/invitation-service");
  credentialHandlers = await import("../lib/server/credential-handlers");
});

after(closeApplicationTestPool);

async function invitationDependencies(adminEmail: string) {
  return dependencies(await login(adminEmail));
}

async function assertInvitationIsInvalid(token: string) {
  await assert.rejects(
    () => invitationService.acceptInvitation({ token, password: invitationPassword }),
    (error: unknown) =>
      error instanceof InvitationFlowError &&
      error.code === "invalid_invitation",
  );
}

test("invitation acceptance creates a Better Auth credential and audit event", async () => {
  const administrator = await seedUser(["admin"], "Invitation Acceptance Admin");
  const target = await seedUser(
    ["student"],
    "Invitation Acceptance Target",
    true,
    false,
  );
  await pool.query('UPDATE "user" SET "emailVerified" = false WHERE id = $1', [
    target.id,
  ]);
  const issued = await invitationService.issueInvitation(
    target.id,
    await invitationDependencies(administrator.email),
  );

  assert.deepEqual(
    await invitationService.acceptInvitation({
      token: issued.rawToken,
      password: invitationPassword,
    }),
    { accepted: true },
  );

  const credential = await pool.query<{
    user_id: string;
    account_id: string;
    provider_id: string;
    password_hash: string;
  }>(
    `SELECT "userId" AS user_id, "accountId" AS account_id,
            "providerId" AS provider_id, password AS password_hash
       FROM account WHERE "userId" = $1`,
    [target.id],
  );
  assert.equal(credential.rows.length, 1);
  assert.equal(credential.rows[0].user_id, target.id);
  assert.equal(credential.rows[0].account_id, target.id);
  assert.equal(credential.rows[0].provider_id, "credential");
  assert.notEqual(credential.rows[0].password_hash, invitationPassword);
  const verified = await pool.query<{ email_verified: boolean }>(
    'SELECT "emailVerified" AS email_verified FROM "user" WHERE id = $1',
    [target.id],
  );
  assert.equal(verified.rows[0].email_verified, true);

  const events = await pool.query<{ event_type: string; metadata: { invitationId: string } }>(
    `SELECT event_type, metadata FROM audit_event
      WHERE subject_user_id = $1 AND event_type = 'account.invitation_accepted'`,
    [target.id],
  );
  assert.equal(events.rows.length, 1);
  assert.equal(events.rows[0].metadata.invitationId, issued.invitation.id);
  await login(target.email, invitationPassword);
});

test("expired, used, and revoked invitations cannot be accepted", async () => {
  const administrator = await seedUser(["admin"], "Invalid Invitation Admin");
  const adminDependencies = await invitationDependencies(administrator.email);
  const expiredTarget = await seedUser(
    ["student"],
    "Expired Invitation Target",
    true,
    false,
  );
  const expired = await invitationService.issueInvitation(
    expiredTarget.id,
    adminDependencies,
  );
  await pool.query(
    `UPDATE account_invitation
        SET created_at = now() - interval '2 seconds',
            expires_at = now() - interval '1 second'
      WHERE id = $1`,
    [expired.invitation.id],
  );
  await assertInvitationIsInvalid(expired.rawToken);

  const usedTarget = await seedUser(
    ["student"],
    "Used Invitation Target",
    true,
    false,
  );
  const used = await invitationService.issueInvitation(
    usedTarget.id,
    adminDependencies,
  );
  await pool.query("UPDATE account_invitation SET used_at = now() WHERE id = $1", [
    used.invitation.id,
  ]);
  await assertInvitationIsInvalid(used.rawToken);

  const revokedTarget = await seedUser(
    ["student"],
    "Revoked Invitation Target",
    true,
    false,
  );
  const revoked = await invitationService.issueInvitation(
    revokedTarget.id,
    adminDependencies,
  );
  await invitationService.revokeInvitation(
    revokedTarget.id,
    revoked.invitation.id,
    adminDependencies,
  );
  await assertInvitationIsInvalid(revoked.rawToken);
});

test("invitation failure rolls back consumption and credential creation", async () => {
  const administrator = await seedUser(["admin"], "Invitation Rollback Admin");
  const target = await seedUser(
    ["student"],
    "Invitation Rollback Target",
    true,
    false,
  );
  const issued = await invitationService.issueInvitation(
    target.id,
    await invitationDependencies(administrator.email),
  );
  await pool.query(`
    CREATE FUNCTION reject_invitation_acceptance_test() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.event_type = 'account.invitation_accepted' THEN
        RAISE EXCEPTION 'test invitation audit rejection' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END;
    $$
  `);
  await pool.query(`
    CREATE TRIGGER reject_invitation_acceptance_test
    BEFORE INSERT ON audit_event
    FOR EACH ROW EXECUTE FUNCTION reject_invitation_acceptance_test()
  `);
  try {
    await assert.rejects(() =>
      invitationService.acceptInvitation({
        token: issued.rawToken,
        password: invitationPassword,
      }),
    );
  } finally {
    await pool.query(
      "DROP TRIGGER reject_invitation_acceptance_test ON audit_event",
    );
    await pool.query("DROP FUNCTION reject_invitation_acceptance_test()");
  }

  const state = await pool.query<{
    used_at: Date | null;
    credential_count: number;
  }>(
    `SELECT invitation.used_at,
            (SELECT count(*)::int FROM account
              WHERE "userId" = invitation.target_user_id) AS credential_count
       FROM account_invitation invitation WHERE invitation.id = $1`,
    [issued.invitation.id],
  );
  assert.equal(state.rows[0].used_at, null);
  assert.equal(state.rows[0].credential_count, 0);
  await invitationService.acceptInvitation({
    token: issued.rawToken,
    password: invitationPassword,
  });
});

test("concurrent invitation acceptance creates one credential and audit", async () => {
  const administrator = await seedUser(["admin"], "Concurrent Invitation Admin");
  const target = await seedUser(
    ["student"],
    "Concurrent Invitation Target",
    true,
    false,
  );
  const issued = await invitationService.issueInvitation(
    target.id,
    await invitationDependencies(administrator.email),
  );
  const attempts = await Promise.allSettled([
    invitationService.acceptInvitation({
      token: issued.rawToken,
      password: invitationPassword,
    }),
    invitationService.acceptInvitation({
      token: issued.rawToken,
      password: invitationPassword,
    }),
  ]);
  assert.equal(attempts.filter((attempt) => attempt.status === "fulfilled").length, 1);
  const failure = attempts.find((attempt) => attempt.status === "rejected");
  assert.ok(failure && failure.status === "rejected");
  assert.ok(failure.reason instanceof InvitationFlowError);
  assert.equal(failure.reason.code, "invalid_invitation");

  const counts = await pool.query<{
    credential_count: number;
    audit_count: number;
  }>(
    `SELECT (SELECT count(*)::int FROM account WHERE "userId" = $1) AS credential_count,
            (SELECT count(*)::int FROM audit_event
              WHERE subject_user_id = $1
                AND event_type = 'account.invitation_accepted') AS audit_count`,
    [target.id],
  );
  assert.equal(counts.rows[0].credential_count, 1);
  assert.equal(counts.rows[0].audit_count, 1);
});

test("invitation revocation is isolated to its target account", async () => {
  const administrator = await seedUser(["admin"], "Invitation Ownership Admin");
  const target = await seedUser(
    ["student"],
    "Invitation Ownership Target",
    true,
    false,
  );
  const otherTarget = await seedUser(
    ["student"],
    "Other Invitation Ownership Target",
    true,
    false,
  );
  const adminDependencies = await invitationDependencies(administrator.email);
  const issued = await invitationService.issueInvitation(
    target.id,
    adminDependencies,
  );

  await assert.rejects(
    () =>
      invitationService.revokeInvitation(
        otherTarget.id,
        issued.invitation.id,
        adminDependencies,
      ),
    (error: unknown) =>
      error instanceof InvitationFlowError && error.code === "not_found",
  );
  await invitationService.acceptInvitation({
    token: issued.rawToken,
    password: invitationPassword,
  });
  const credentials = await pool.query<{ user_id: string }>(
    'SELECT "userId" AS user_id FROM account WHERE "userId" = ANY($1::uuid[])',
    [[target.id, otherTarget.id]],
  );
  assert.deepEqual(credentials.rows.map((row) => row.user_id), [target.id]);
});

test("password change rejects an incorrect current password", async () => {
  const user = await seedUser(["student"], "Wrong Password Change User");
  const cookie = await login(user.email);
  const response = await credentialHandlers.handlePasswordChangeRequest(
    passwordChangeRequest(cookie, "Incorrect current password 2026", changedPassword),
  );
  assert.equal(response.status, 400);
  assert.equal((await response.json()).success, undefined);
  await login(user.email);
  assert.notEqual(
    (await attemptLogin(user.email, changedPassword)).status,
    200,
  );
});

test("password change rejects a stale credential hash", async () => {
  const user = await seedUser(["student"], "Stale Password Change User");
  const cookie = await login(user.email);
  let signalHashStarted!: () => void;
  let releaseHash!: () => void;
  const hashStarted = new Promise<void>((resolve) => {
    signalHashStarted = resolve;
  });
  const hashGate = new Promise<void>((resolve) => {
    releaseHash = resolve;
  });
  const request = passwordChangeRequest(cookie, password, changedPassword);
  const responsePromise = credentialHandlers.handlePasswordChangeRequest(
    request,
    {
      hashPassword: async (newPassword) => {
        const newHash = await hashPassword(newPassword);
        signalHashStarted();
        await hashGate;
        return newHash;
      },
    },
  );
  await hashStarted;
  const interveningPassword = "Concurrent password update 2026";
  await pool.query(
    `UPDATE account SET password = $1
      WHERE "userId" = $2 AND "providerId" = 'credential'`,
    [await hashPassword(interveningPassword), user.id],
  );
  releaseHash();

  const response = await responsePromise;
  assert.equal(response.status, 409);
  assert.equal((await response.json()).success, undefined);
  assert.notEqual((await attemptLogin(user.email, password)).status, 200);
  await login(user.email, interveningPassword);
  const events = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM audit_event
      WHERE subject_user_id = $1 AND event_type = 'account.password_changed'`,
    [user.id],
  );
  assert.equal(events.rows[0].count, 0);
});

test("password audit failure rolls back the change and preserves the old password", async () => {
  const user = await seedUser(["student"], "Password Audit Rollback User");
  const cookie = await login(user.email);
  await pool.query(`
    CREATE FUNCTION reject_password_change_audit_test() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.event_type = 'account.password_changed' THEN
        RAISE EXCEPTION 'test password audit rejection' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END;
    $$
  `);
  await pool.query(`
    CREATE TRIGGER reject_password_change_audit_test
    BEFORE INSERT ON audit_event
    FOR EACH ROW EXECUTE FUNCTION reject_password_change_audit_test()
  `);
  let response: Response;
  try {
    response = await credentialHandlers.handlePasswordChangeRequest(
      passwordChangeRequest(cookie, password, changedPassword),
    );
  } finally {
    await pool.query(
      "DROP TRIGGER reject_password_change_audit_test ON audit_event",
    );
    await pool.query("DROP FUNCTION reject_password_change_audit_test()");
  }

  assert.equal(response.status, 503);
  assert.equal((await response.json()).success, undefined);
  await login(user.email);
  assert.notEqual(
    (await attemptLogin(user.email, changedPassword)).status,
    200,
  );
  const events = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM audit_event
      WHERE subject_user_id = $1 AND event_type = 'account.password_changed'`,
    [user.id],
  );
  assert.equal(events.rows[0].count, 0);
});

test("password change revokes other sessions and keeps the current session", async () => {
  const user = await seedUser(["student"], "Password Session Revocation User");
  const currentCookie = await login(user.email);
  const otherCookie = await login(user.email);
  const currentSessionId = await sessionId(currentCookie);
  const otherSessionId = await sessionId(otherCookie);
  assert.notEqual(currentSessionId, otherSessionId);

  const response = await credentialHandlers.handlePasswordChangeRequest(
    passwordChangeRequest(currentCookie, password, changedPassword),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true });

  const sessions = await pool.query<{ id: string }>(
    'SELECT id FROM "session" WHERE "userId" = $1',
    [user.id],
  );
  assert.deepEqual(sessions.rows.map((row) => row.id), [currentSessionId]);
  assert.equal(
    await getTrustedIdentityFromHeaders(new Headers({ cookie: currentCookie }))
      .then((identity) => identity?.id),
    user.id,
  );
  assert.equal(
    await getTrustedIdentityFromHeaders(new Headers({ cookie: otherCookie })),
    null,
  );
  await login(user.email, changedPassword);
});

test("password change signs in with the new password and records its audit event", async () => {
  const user = await seedUser(["student"], "Password Change Sign-in User");
  const cookie = await login(user.email);
  const response = await credentialHandlers.handlePasswordChangeRequest(
    passwordChangeRequest(cookie, password, changedPassword),
  );
  assert.equal(response.status, 200);
  await login(user.email, changedPassword);
  assert.notEqual((await attemptLogin(user.email, password)).status, 200);
  const events = await pool.query<{
    count: number;
    other_sessions_revoked: boolean;
  }>(
    `SELECT count(*)::int AS count,
            bool_or(metadata->>'otherSessionsRevoked' = 'true') AS other_sessions_revoked
       FROM audit_event
      WHERE subject_user_id = $1 AND event_type = 'account.password_changed'`,
    [user.id],
  );
  assert.equal(events.rows[0].count, 1);
  assert.equal(events.rows[0].other_sessions_revoked, true);
});

test("account reads require an active administrator session", async () => {
  const requester = await seedUser(["student"], "Account Read Requester");
  const approver = await seedUser(["approver"], "Account Read Approver");
  const administrator = await seedUser(["admin"], "Account Read Admin");
  const inactiveAdmin = await seedUser(["admin"], "Account Read Inactive Admin");
  const cookies = await Promise.all([
    login(requester.email),
    login(approver.email),
    login(administrator.email),
    login(inactiveAdmin.email),
  ]);
  await pool.query("UPDATE user_profile SET active = false WHERE user_id = $1", [
    inactiveAdmin.id,
  ]);

  for (const cookie of [cookies[0], cookies[1], cookies[3]]) {
    const deps = dependencies(cookie);
    await assertServiceRejected(
      () => accountService.listUsers(new URLSearchParams(), deps),
      "forbidden",
    );
    await assertServiceRejected(
      () => accountService.getUser(requester.id, deps),
      "forbidden",
    );
  }
  const adminDeps = dependencies(cookies[2]);
  assert.ok(await accountService.getUser(requester.id, adminDeps));
  assertSanitized(await accountService.listUsers(new URLSearchParams(), adminDeps));
  assert.equal(
    await getTrustedIdentityFromHeaders(new Headers({ cookie: cookies[3] })),
    null,
  );
});

test("last administrator and self-deactivation safeguards reject unsafe changes", async () => {
  const onlyAdmin = await seedUser(["admin"], "Only Account Admin");
  const onlyAdminCookie = await login(onlyAdmin.email);
  await pool.query(
    `UPDATE user_profile SET active = false
      WHERE user_id <> $1
        AND user_id IN (SELECT user_id FROM user_role WHERE role = 'admin')`,
    [onlyAdmin.id],
  );
  await assertServiceRejected(
    () =>
      accountService.deactivateUser(
        onlyAdmin.id,
        "Sole administrator must remain active.",
        dependencies(onlyAdminCookie),
      ),
    "last_active_admin",
  );
  const onlyAdminState = await pool.query<{ active: boolean }>(
    "SELECT active FROM user_profile WHERE user_id = $1",
    [onlyAdmin.id],
  );
  assert.equal(onlyAdminState.rows[0].active, true);

  const adminA = await seedUser(["admin"], "Self Deactivation Admin A");
  const adminB = await seedUser(["admin"], "Self Deactivation Admin B");
  const adminCookie = await login(adminA.email);
  await login(adminB.email);
  await assertServiceRejected(
    () =>
      accountService.deactivateUser(
        adminA.id,
        "An administrator cannot deactivate themselves.",
        dependencies(adminCookie),
      ),
    "self_deactivation",
  );
  const selfState = await pool.query<{ active: boolean }>(
    "SELECT active FROM user_profile WHERE user_id = $1",
    [adminA.id],
  );
  assert.equal(selfState.rows[0].active, true);
});

test("administrators cannot demote themselves", async () => {
  const administrator = await seedUser(["admin"], "Self Demotion Admin");
  const cookie = await login(administrator.email);
  await assertServiceRejected(
    () =>
      accountService.updateUser(
        administrator.id,
        { roles: ["approver"] },
        dependencies(cookie),
      ),
    "self_demotion",
  );
  const roles = await pool.query<{ role: string }>(
    "SELECT role FROM user_role WHERE user_id = $1 ORDER BY role",
    [administrator.id],
  );
  assert.deepEqual(roles.rows.map((row) => row.role), ["admin"]);
});

test("concurrent cross-deactivation leaves exactly one active administrator", async () => {
  const adminA = await seedUser(["admin"], "Concurrent Admin A");
  const adminB = await seedUser(["admin"], "Concurrent Admin B");
  const [cookieA, cookieB] = await Promise.all([
    login(adminA.email),
    login(adminB.email),
  ]);
  const results = await Promise.allSettled([
    accountService.deactivateUser(
      adminB.id,
      "Concurrent administrator deactivation test.",
      dependencies(cookieA),
    ),
    accountService.deactivateUser(
      adminA.id,
      "Concurrent administrator deactivation test.",
      dependencies(cookieB),
    ),
  ]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(
    results.filter((result) => result.status === "rejected").length,
    1,
  );
  const activeAdmins = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count
       FROM user_profile profile
       JOIN user_role role ON role.user_id = profile.user_id
      WHERE profile.active AND role.role = 'admin'
        AND profile.user_id IN ($1,$2)`,
    [adminA.id, adminB.id],
  );
  assert.equal(activeAdmins.rows[0].count, 1);
});

test("inactive sessions cannot access account services or continue logging in", async () => {
  const administrator = await seedUser(["admin"], "Inactive Guard Admin");
  const requester = await seedUser(["student"], "Inactive Guard Requester");
  const adminCookie = await login(administrator.email);
  const requesterCookie = await login(requester.email);
  await pool.query(
    `UPDATE user_profile SET active = false, deactivated_at = now(),
       deactivated_by = $2, deactivation_reason = 'Integration inactive guard.'
     WHERE user_id = $1`,
    [requester.id, administrator.id],
  );
  assert.equal(
    await getTrustedIdentityFromHeaders(new Headers({ cookie: requesterCookie })),
    null,
  );
  await assertServiceRejected(
    () =>
      accountService.listUsers(
        new URLSearchParams(),
        dependencies(requesterCookie),
      ),
    "forbidden",
  );
  const { auth } = await import("../lib/server/auth");
  const loginResponse = await auth.handler(
    new Request("http://localhost:3000/api/auth/sign-in/email", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        "content-type": "application/json",
        "x-forwarded-for": "127.0.99.1",
      },
      body: JSON.stringify({ email: requester.email, password }),
    }),
  );
  assert.notEqual(loginResponse.status, 200);
  assert.equal(loginResponse.headers.get("set-cookie"), null);
  assert.equal((await accountService.listUsers(new URLSearchParams(), dependencies(adminCookie))).pagination.total >= 1, true);
});

test("account mutations write one secret-free audit event and return sanitized DTOs", async () => {
  const administrator = await seedUser(["admin"], "Mutation Audit Admin");
  const cookie = await login(administrator.email);
  const deps = dependencies(cookie);
  const created = await accountService.createUser(
    {
      name: "Managed Account",
      email: `${randomUUID()}@permora.test`,
      department: "Library Services",
      roles: ["student"],
    },
    deps,
  );
  assertSanitized(created);
  const listed = await accountService.listUsers(
    new URLSearchParams(`search=${encodeURIComponent(created.email)}`),
    deps,
  );
  assert.equal(listed.items.length, 1);
  assertSanitized(listed);
  const updated = await accountService.updateUser(
    created.id,
    { name: "Managed Faculty", roles: ["faculty"] },
    deps,
  );
  assert.equal(updated.roles[0], "faculty");
  assert.equal(updated.requesterRole, "faculty");
  assertSanitized(updated);
  const deactivated = await accountService.deactivateUser(
    created.id,
    "Account no longer requires access.",
    deps,
  );
  assert.equal(deactivated.sessionsRevoked, true);
  assert.equal(deactivated.user.active, false);
  assertSanitized(deactivated.user);
  const reactivated = await accountService.reactivateUser(created.id, deps);
  assert.equal(reactivated.active, true);
  assertSanitized(reactivated);

  const events = await pool.query<{ event_type: string; metadata: unknown }>(
    `SELECT event_type, metadata FROM audit_event
      WHERE subject_user_id = $1 AND event_type LIKE 'account.%'
      ORDER BY event_type`,
    [created.id],
  );
  assert.deepEqual(
    events.rows.map((event) => event.event_type).sort(),
    [
      "account.created",
      "account.deactivated",
      "account.reactivated",
      "account.updated",
    ],
  );
  assert.equal(events.rows.length, 4);
  assertSanitized(events.rows.map((event) => event.metadata));
  const credentialCount = await pool.query<{ count: number }>(
    'SELECT count(*)::int AS count FROM account WHERE "userId" = $1',
    [created.id],
  );
  assert.equal(credentialCount.rows[0].count, 0);
});

test("audit failure rolls back the account state and deactivation metadata", async () => {
  const administrator = await seedUser(["admin"], "Rollback Account Admin");
  const target = await seedUser(["student"], "Rollback Account Target");
  const cookie = await login(administrator.email);
  await pool.query(`
    CREATE FUNCTION reject_account_deactivation_test() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.event_type = 'account.deactivated' THEN
        RAISE EXCEPTION 'test audit rejection' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END;
    $$
  `);
  await pool.query(`
    CREATE TRIGGER reject_account_deactivation_test
    BEFORE INSERT ON audit_event
    FOR EACH ROW EXECUTE FUNCTION reject_account_deactivation_test()
  `);
  try {
    await assert.rejects(() =>
      accountService.deactivateUser(
        target.id,
        "This change must roll back.",
        dependencies(cookie),
      ),
    );
  } finally {
    await pool.query(
      "DROP TRIGGER reject_account_deactivation_test ON audit_event",
    );
    await pool.query("DROP FUNCTION reject_account_deactivation_test()");
  }
  const state = await pool.query<{
    active: boolean;
    deactivated_at: Date | null;
    deactivated_by: string | null;
    deactivation_reason: string | null;
  }>(
    `SELECT active, deactivated_at, deactivated_by, deactivation_reason
       FROM user_profile WHERE user_id = $1`,
    [target.id],
  );
  assert.deepEqual(state.rows[0], {
    active: true,
    deactivated_at: null,
    deactivated_by: null,
    deactivation_reason: null,
  });
  const eventCount = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM audit_event
      WHERE subject_user_id = $1 AND event_type = 'account.deactivated'`,
    [target.id],
  );
  assert.equal(eventCount.rows[0].count, 0);
});

test("approver deactivation reroutes reviews or preserves them as pending_routing", async () => {
  const administrator = await seedUser(["admin"], "Review Route Admin");
  const requester = await seedUser(["student"], "Review Route Requester");
  const departing = await seedUser(["approver"], "Departing Approver");
  const replacement = await seedUser(["approver"], "Replacement Approver");
  const cookie = await login(administrator.email);
  const departingResponsibility = await seedResponsibility(
    departing.id,
    administrator.id,
  );
  const replacementResponsibility = await seedResponsibility(
    replacement.id,
    administrator.id,
  );
  const routedRequest = await seedPendingReview(
    requester.id,
    departing.id,
    departingResponsibility,
  );
  const unrouteableRequester = await seedUser(
    ["faculty"],
    "Unrouteable Review Requester",
  );
  const unrouteableDeparting = await seedUser(
    ["approver"],
    "Unrouteable Departing Approver",
  );
  const unrouteableResponsibility = await seedResponsibility(
    unrouteableDeparting.id,
    administrator.id,
  );
  const unrouteableRequest = await seedPendingReview(
    unrouteableRequester.id,
    unrouteableDeparting.id,
    unrouteableResponsibility,
  );

  await accountService.deactivateUser(
    departing.id,
    "Approver account deactivated.",
    dependencies(cookie),
  );
  const routed = await pool.query<{ status: string; approver_user_id: string }>(
    `SELECT request.status, assignment.approver_user_id
       FROM access_request request
       JOIN request_review_assignment assignment ON assignment.request_id = request.id
      WHERE request.id = $1`,
    [routedRequest],
  );
  assert.equal(routed.rows[0].status, "pending_review");
  assert.equal(routed.rows[0].approver_user_id, replacement.id);
  const rerouteAudit = await pool.query<{ metadata: { previousApproverUserId: string; newApproverUserId: string } }>(
    `SELECT metadata FROM audit_event
      WHERE request_id = $1 AND event_type = 'request_approver_reconciled'`,
    [routedRequest],
  );
  assert.equal(rerouteAudit.rows[0].metadata.previousApproverUserId, departing.id);
  assert.equal(rerouteAudit.rows[0].metadata.newApproverUserId, replacement.id);
  await pool.query(
    `UPDATE approver_responsibility SET valid_until = now() - interval '1 second'
      WHERE id = $1`,
    [replacementResponsibility],
  );

  await accountService.deactivateUser(
    unrouteableDeparting.id,
    "No replacement approver is configured.",
    dependencies(cookie),
  );
  const unrouteable = await pool.query<{ status: string }>(
    "SELECT status FROM access_request WHERE id = $1",
    [unrouteableRequest],
  );
  assert.equal(unrouteable.rows[0].status, "pending_routing");
  const assignmentCount = await pool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM request_review_assignment WHERE request_id = $1",
    [unrouteableRequest],
  );
  assert.equal(assignmentCount.rows[0].count, 0);
  const unavailableEvent = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM request_event
      WHERE request_id = $1 AND event_type = 'request_routing_unavailable'`,
    [unrouteableRequest],
  );
  assert.equal(unavailableEvent.rows[0].count, 1);
});

test("reactivation revokes residual sessions before setting the profile active", async () => {
  const administrator = await seedUser(["admin"], "Reactivation Admin");
  const target = await seedUser(["student"], "Reactivation Target");
  const adminCookie = await login(administrator.email);
  const targetCookie = await login(target.email);
  assert.ok(targetCookie);
  const deps = dependencies(adminCookie);
  await accountService.deactivateUser(
    target.id,
    "Initial deactivation for session test.",
    deps,
  );
  const staleToken = randomUUID();
  const now = new Date();
  await pool.query(
    `INSERT INTO "session"
      (id, "userId", token, "expiresAt", "createdAt", "updatedAt")
     VALUES ($1,$2,$3,$4,$4,$4)`,
    [randomUUID(), target.id, staleToken, new Date(now.getTime() + 3_600_000)],
  );
  let revokedWhileInactive = false;
  const reactivationDependencies = dependencies(adminCookie, async (userId) => {
    const before = await pool.query<{ active: boolean }>(
      "SELECT active FROM user_profile WHERE user_id = $1",
      [userId],
    );
    assert.equal(before.rows[0].active, false);
    const { auth } = await import("../lib/server/auth");
    const context = await auth.$context;
    await context.internalAdapter.deleteUserSessions(userId);
    const remaining = await pool.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM "session" WHERE "userId" = $1',
      [userId],
    );
    assert.equal(remaining.rows[0].count, 0);
    revokedWhileInactive = true;
  });
  const reactivated = await accountService.reactivateUser(
    target.id,
    reactivationDependencies,
  );
  assert.equal(revokedWhileInactive, true);
  assert.equal(reactivated.active, true);
  const oldSessionCount = await pool.query<{ count: number }>(
    'SELECT count(*)::int AS count FROM "session" WHERE "userId" = $1',
    [target.id],
  );
  assert.equal(oldSessionCount.rows[0].count, 0);
  assert.equal(
    await getTrustedIdentityFromHeaders(new Headers({ cookie: targetCookie })),
    null,
  );
});