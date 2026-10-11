import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test, { after, before } from "node:test";
import { Pool } from "pg";
import type { TrustedIdentity } from "../../lib/auth-types";
import { GovernanceError } from "../../lib/admin-governance";
import type { Role } from "../../lib/model";
import { ResilientPool } from "../../lib/database-pool";
import {
  extractDatabaseTargetOptions,
  resolveCliDatabase,
} from "../../scripts/database-target";
import {
  closeApplicationTestPool,
  installApplicationTestPool,
} from "../helpers/application-test-pool";

const { options } = extractDatabaseTargetOptions([
  "--database-target",
  "test",
]);
if (options.target !== "test") throw new Error("The test target is required.");
const testDatabase = resolveCliDatabase(options);
if (!testDatabase.databaseName.endsWith("_test"))
  throw new Error("Refusing an integration database without the _test suffix.");

const password = "Governance integration password 2026";
let pool: Pool;
let passwordHash = "";
let loginAddress = 0;
let service: typeof import("../../lib/server/admin-governance-service");
let handlers: typeof import("../../lib/server/admin-governance-handlers");

interface UserFixture {
  id: string;
  name: string;
  email: string;
  roles: Role[];
  requesterRole: "student" | "faculty" | null;
}

interface ScopeFixture {
  id: string;
  resourceId: string;
  fieldName: string;
  displayName: string;
}

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
           VALUES ('governance-test-legacy-rate', 1, 0)`,
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
  withCredential = false,
): Promise<UserFixture> {
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
     VALUES ($1,'Governance Integration',true,$2)`,
    [id, requesterRole],
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
  return { id, name, email, roles, requesterRole };
}

function identityFor(user: UserFixture): TrustedIdentity {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    department: "Governance Integration",
    active: true,
    roles: user.roles,
    requesterRole: user.requesterRole,
  };
}

function adminDependencies(user: UserFixture) {
  return { requireAdmin: async () => identityFor(user) };
}

async function login(email: string) {
  const { auth } = await import("../../lib/server/auth");
  const current = loginAddress++;
  const response = await auth.handler(
    new Request("http://localhost:3000/api/auth/sign-in/email", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        "content-type": "application/json",
        "x-forwarded-for": `127.0.${Math.floor(current / 250)}.${(current % 250) + 1}`,
      },
      body: JSON.stringify({ email, password }),
    }),
  );
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
  assert.ok(cookie);
  return cookie;
}

function jsonRequest(
  url: string,
  cookie: string,
  body: unknown,
  method = "POST",
) {
  return new Request(url, {
    method,
    headers: {
      cookie,
      origin: "http://localhost:3000",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function seedScope(
  resourceId: string,
  fieldName: string,
  code = `GOV-${randomUUID()}`,
): Promise<ScopeFixture> {
  const id = randomUUID();
  const displayName = `Governance scope ${code}`;
  await pool.query(
    `INSERT INTO scope_option
      (id, resource_id, field_name, institutional_code, display_name, valid_from)
     VALUES ($1,$2,$3,$4,$5,now())`,
    [id, resourceId, fieldName, code, displayName],
  );
  return { id, resourceId, fieldName, displayName };
}

async function createResponsibility(
  admin: UserFixture,
  approver: UserFixture,
  options: {
    resourceId?: string;
    permissionId?: string | null;
    scopeOptionIds?: string[];
  } = {},
) {
  return service.createResponsibility(
    {
      approverUserId: approver.id,
      resourceId: options.resourceId ?? "r-lms",
      permissionId: options.permissionId ?? "lms:course-participation",
      scopeOptionIds: options.scopeOptionIds ?? [],
    },
    adminDependencies(admin),
  );
}

async function seedRequest(input: {
  requester: UserFixture;
  resourceId?: string;
  permissionId?: string;
  status?:
    | "pending_routing"
    | "pending_review"
    | "denied"
    | "approved_pending_activation"
    | "returned_for_revision";
  version?: number;
  scopes?: ScopeFixture[];
}) {
  const resourceId = input.resourceId ?? "r-lms";
  const permissionId = input.permissionId ?? "lms:course-participation";
  const policy = await pool.query<{ id: string }>(
    `SELECT id FROM catalog_policy_version
      WHERE resource_id = $1 ORDER BY version DESC LIMIT 1`,
    [resourceId],
  );
  assert.ok(policy.rows[0]);
  const id = randomUUID();
  const scopes = input.scopes ?? [];
  const now = new Date();
  await pool.query(
    `INSERT INTO access_request
      (id, display_id, requester_user_id, resource_id, permission_id,
       policy_version_id, purpose, starts_at, expires_at, status, version,
       scope_fingerprint, submitted_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$8)`,
    [
      id,
      `REQ-GOV-${id}`,
      input.requester.id,
      resourceId,
      permissionId,
      policy.rows[0].id,
      "Governance integration fixture request purpose.",
      now,
      new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000),
      input.status ?? "pending_routing",
      input.version ?? 1,
      scopes.length ? scopes.map((scope) => scope.id).sort().join(":") : "resource-wide",
    ],
  );
  for (const scope of scopes)
    await pool.query(
      `INSERT INTO access_request_scope
        (request_id, field_name, scope_option_id, display_snapshot)
       VALUES ($1,$2,$3,$4)`,
      [id, scope.fieldName, scope.id, scope.displayName],
    );
  return id;
}

async function seedAssignment(input: {
  requestId: string;
  approver: UserFixture;
  responsibilityId: string;
  completed?: boolean;
}) {
  const id = randomUUID();
  const assignedAt = new Date(Date.now() - 60_000);
  const completedAt = input.completed ? new Date(Date.now() - 30_000) : null;
  await pool.query(
    `INSERT INTO request_review_assignment
      (id, request_id, approver_user_id, responsibility_id, status, assigned_at, completed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      id,
      input.requestId,
      input.approver.id,
      input.responsibilityId,
      input.completed ? "completed" : "assigned",
      assignedAt,
      completedAt,
    ],
  );
  return id;
}

async function assertGovernanceError(
  work: () => Promise<unknown>,
  code: GovernanceError["code"],
) {
  await assert.rejects(work, (error: unknown) => {
    assert.ok(error instanceof GovernanceError);
    assert.equal(error.code, code);
    return true;
  });
}

before(async () => {
  process.env.APP_URL = "http://localhost:3000";
  process.env.AUTH_SECRET =
    "governance-integration-secret-at-least-thirty-two-characters";
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
  assert.equal(database.rows[0]?.name, testDatabase.databaseName);
  assert.ok(database.rows[0]?.name.endsWith("_test"));
  await applyMigrations();
  const { hashPassword } = await import("../../lib/password-hash");
  passwordHash = await hashPassword(password);
  service = await import("../../lib/server/admin-governance-service");
  handlers = await import("../../lib/server/admin-governance-handlers");
});

after(closeApplicationTestPool);

test("responsibilities validate inputs, audit atomically, and preserve history", async () => {
  const admin = await seedUser(["admin"], "Responsibility Admin", true);
  const nonAdmin = await seedUser(["student"], "Responsibility Student", true);
  const approver = await seedUser(["approver"], "Responsibility Approver");
  const courseA = await seedScope("r-lms", "courseSection");
  const wrongResourceScope = await seedScope("r-lab", "laboratory");
  const adminDeps = adminDependencies(admin);
  const nonAdminCookie = await login(nonAdmin.email);

  await assertGovernanceError(
    () =>
      service.createResponsibility(
        {
          approverUserId: approver.id,
          resourceId: "unknown-resource",
          permissionId: null,
          scopeOptionIds: [],
        },
        adminDeps,
      ),
    "not_found",
  );
  await assertGovernanceError(
    () =>
      createResponsibility(admin, approver, {
        permissionId: "library:subscribed-materials",
      }),
    "invalid_input",
  );
  await assertGovernanceError(
    () =>
      createResponsibility(admin, approver, {
        scopeOptionIds: [wrongResourceScope.id],
      }),
    "invalid_input",
  );

  const createDenied = await handlers.handleResponsibilityCreate(
    jsonRequest(
      "http://localhost:3000/api/admin/responsibilities",
      nonAdminCookie,
      {
        approverUserId: approver.id,
        resourceId: "r-lms",
        permissionId: "lms:course-participation",
        scopeOptionIds: [],
      },
    ),
  );
  assert.equal(createDenied.status, 403);
  const endDenied = await handlers.handleResponsibilityEnd(
    new Request("http://localhost:3000/api/admin/responsibilities/id/end", {
      method: "POST",
      headers: { cookie: nonAdminCookie, origin: "http://localhost:3000" },
    }),
    randomUUID(),
  );
  assert.equal(endDenied.status, 403);

  const created = await createResponsibility(admin, approver, {
    scopeOptionIds: [courseA.id],
  });
  const createdAudit = await pool.query<{ metadata: { responsibilityId: string } }>(
    `SELECT metadata FROM audit_event
      WHERE actor_user_id = $1 AND subject_user_id = $2
        AND event_type = 'approver_responsibility.created'`,
    [admin.id, approver.id],
  );
  assert.equal(createdAudit.rowCount, 1);
  assert.equal(createdAudit.rows[0].metadata.responsibilityId, created.id);

  const rollbackApprover = await seedUser(["approver"], "Rollback Approver");
  await pool.query(`
    CREATE FUNCTION reject_governance_audit_test() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.event_type = 'approver_responsibility.created' THEN
        RAISE EXCEPTION 'blocked by integration test';
      END IF;
      RETURN NEW;
    END;
    $$
  `);
  await pool.query(`
    CREATE TRIGGER reject_governance_audit_test
    BEFORE INSERT ON audit_event
    FOR EACH ROW EXECUTE FUNCTION reject_governance_audit_test()
  `);
  try {
    await assert.rejects(() => createResponsibility(admin, rollbackApprover));
  } finally {
    await pool.query(
      "DROP TRIGGER reject_governance_audit_test ON audit_event",
    );
    await pool.query("DROP FUNCTION reject_governance_audit_test()");
  }
  const rolledBackResponsibility = await pool.query(
    `SELECT 1 FROM approver_responsibility
      WHERE approver_user_id = $1 AND resource_id = 'r-lms'`,
    [rollbackApprover.id],
  );
  const rolledBackAudit = await pool.query(
    `SELECT 1 FROM audit_event
      WHERE subject_user_id = $1 AND event_type = 'approver_responsibility.created'`,
    [rollbackApprover.id],
  );
  assert.equal(rolledBackResponsibility.rowCount, 0);
  assert.equal(rolledBackAudit.rowCount, 0);

  const pastRequestId = await seedRequest({
    requester: nonAdmin,
    status: "denied",
    version: 2,
    scopes: [courseA],
  });
  const pastAssignmentId = await seedAssignment({
    requestId: pastRequestId,
    approver,
    responsibilityId: created.id,
    completed: true,
  });
  await pool.query(
    `INSERT INTO request_decision
      (id, request_id, assignment_id, actor_user_id, action, reason, idempotency_key,
       previous_status, resulting_status, previous_version, resulting_version)
     VALUES ($1,$2,$3,$4,'deny','Historical decision remains immutable.',$5,
       'pending_review','denied',1,2)`,
    [randomUUID(), pastRequestId, pastAssignmentId, approver.id, randomUUID()],
  );
  const assignmentBefore = await pool.query(
    `SELECT id, request_id, approver_user_id, responsibility_id, status,
            assigned_at::text, completed_at::text
       FROM request_review_assignment WHERE id = $1`,
    [pastAssignmentId],
  );
  const decisionBefore = await pool.query(
    `SELECT request_id, assignment_id, actor_user_id, action, reason,
            previous_status, resulting_status, previous_version, resulting_version
       FROM request_decision WHERE request_id = $1`,
    [pastRequestId],
  );
  await pool.query(`
    CREATE FUNCTION reject_governance_end_audit_test() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.event_type = 'approver_responsibility.ended' THEN
        RAISE EXCEPTION 'blocked by integration test';
      END IF;
      RETURN NEW;
    END;
    $$
  `);
  await pool.query(`
    CREATE TRIGGER reject_governance_end_audit_test
    BEFORE INSERT ON audit_event
    FOR EACH ROW EXECUTE FUNCTION reject_governance_end_audit_test()
  `);
  try {
    await assert.rejects(() => service.endResponsibility(created.id, adminDeps));
  } finally {
    await pool.query(
      "DROP TRIGGER reject_governance_end_audit_test ON audit_event",
    );
    await pool.query("DROP FUNCTION reject_governance_end_audit_test()");
  }
  const responsibilityAfterFailedEnd = await pool.query<{
    valid_until: Date | null;
  }>("SELECT valid_until FROM approver_responsibility WHERE id = $1", [created.id]);
  assert.equal(responsibilityAfterFailedEnd.rows[0].valid_until, null);
  await service.endResponsibility(created.id, adminDeps);
  const assignmentAfter = await pool.query(
    `SELECT id, request_id, approver_user_id, responsibility_id, status,
            assigned_at::text, completed_at::text
       FROM request_review_assignment WHERE id = $1`,
    [pastAssignmentId],
  );
  const decisionAfter = await pool.query(
    `SELECT request_id, assignment_id, actor_user_id, action, reason,
            previous_status, resulting_status, previous_version, resulting_version
       FROM request_decision WHERE request_id = $1`,
    [pastRequestId],
  );
  assert.deepEqual(assignmentAfter.rows, assignmentBefore.rows);
  assert.deepEqual(decisionAfter.rows, decisionBefore.rows);
  const endedAudit = await pool.query(
    `SELECT 1 FROM audit_event
      WHERE actor_user_id = $1 AND subject_user_id = $2
        AND event_type = 'approver_responsibility.ended'
        AND metadata ->> 'responsibilityId' = $3`,
    [admin.id, approver.id, created.id],
  );
  assert.equal(endedAudit.rowCount, 1);
});

test("unassigned requests enforce routing rules and leave replay effects idempotent", async () => {
  const admin = await seedUser(["admin"], "Assignment Admin", true);
  const requester = await seedUser(["student"], "Assignment Requester");
  const partialApprover = await seedUser(["approver"], "Partial Approver");
  const fullApprover = await seedUser(["approver"], "Full Approver");
  const firstScope = await seedScope("r-lab", "laboratory");
  const secondScope = await seedScope("r-lab", "software");
  const partialResponsibility = await createResponsibility(admin, partialApprover, {
    resourceId: "r-lab",
    permissionId: "lab:designated-account",
    scopeOptionIds: [firstScope.id],
  });
  const scopedRequest = await seedRequest({
    requester,
    resourceId: "r-lab",
    permissionId: "lab:designated-account",
    scopes: [firstScope, secondScope],
  });
  assert.deepEqual(await service.listEligibleAssignees(scopedRequest), []);
  await assertGovernanceError(
    () =>
      service.assignUnassignedRequest(
        scopedRequest,
        {
          responsibilityId: partialResponsibility.id,
          expectedVersion: 1,
        },
        adminDependencies(admin),
      ),
    "conflict",
  );
  const partialRequestState = await pool.query<{ status: string; count: number }>(
    `SELECT request.status,
            (SELECT count(*)::int FROM request_review_assignment assignment
              WHERE assignment.request_id = request.id) AS count
       FROM access_request request WHERE request.id = $1`,
    [scopedRequest],
  );
  assert.equal(partialRequestState.rows[0].status, "pending_routing");
  assert.equal(partialRequestState.rows[0].count, 0);

  const selfRequester = await seedUser(
    ["student", "approver"],
    "Self Assignment Requester",
  );
  const selfResponsibility = await createResponsibility(admin, selfRequester);
  const selfRequest = await seedRequest({ requester: selfRequester });
  await assertGovernanceError(
    () =>
      service.assignUnassignedRequest(
        selfRequest,
        { responsibilityId: selfResponsibility.id, expectedVersion: 1 },
        adminDependencies(admin),
      ),
    "conflict",
  );

  const fullResponsibility = await createResponsibility(admin, fullApprover);
  const alreadyRoutedRequest = await seedRequest({
    requester,
    status: "pending_review",
  });
  await seedAssignment({
    requestId: alreadyRoutedRequest,
    approver: fullApprover,
    responsibilityId: fullResponsibility.id,
  });
  await assertGovernanceError(
    () =>
      service.assignUnassignedRequest(
        alreadyRoutedRequest,
        { responsibilityId: fullResponsibility.id, expectedVersion: 1 },
        adminDependencies(admin),
      ),
    "conflict",
  );

  const staleRequest = await seedRequest({ requester });
  await assertGovernanceError(
    () =>
      service.assignUnassignedRequest(
        staleRequest,
        { responsibilityId: fullResponsibility.id, expectedVersion: 2 },
        adminDependencies(admin),
      ),
    "conflict",
  );
  const staleState = await pool.query<{ status: string; version: number }>(
    "SELECT status, version FROM access_request WHERE id = $1",
    [staleRequest],
  );
  assert.deepEqual(staleState.rows[0], { status: "pending_routing", version: 1 });

  const adminCookie = await login(admin.email);
  const assignRequest = await seedRequest({ requester });
  const eligibleResponse = await handlers.handleEligibleAssignees(
    new Request(
      `http://localhost:3000/api/admin/unassigned-requests/${assignRequest}/assign`,
      { headers: { cookie: adminCookie } },
    ),
    assignRequest,
  );
  assert.equal(eligibleResponse.status, 200);
  const eligibleBody = (await eligibleResponse.json()) as {
    items: Array<{ responsibilityId: string }>;
  };
  assert.ok(
    eligibleBody.items.some(
      (item) => item.responsibilityId === fullResponsibility.id,
    ),
  );
  const assignedResponse = await handlers.handleManualAssign(
    jsonRequest(
      `http://localhost:3000/api/admin/unassigned-requests/${assignRequest}/assign`,
      adminCookie,
      { responsibilityId: fullResponsibility.id, expectedVersion: 1 },
    ),
    assignRequest,
  );
  assert.equal(assignedResponse.status, 200);
  const assignedBody = (await assignedResponse.json()) as {
    result: { assignmentId: string; approverUserId: string; version: number };
  };
  assert.equal(assignedBody.result.approverUserId, fullApprover.id);
  assert.equal(assignedBody.result.version, 2);
  const requestEvent = await pool.query(
    `SELECT 1 FROM request_event
      WHERE request_id = $1 AND event_type = 'request_administrator_assigned'`,
    [assignRequest],
  );
  const auditEvent = await pool.query(
    `SELECT 1 FROM audit_event
      WHERE request_id = $1 AND actor_user_id = $2
        AND event_type = 'request_administrator_assigned'`,
    [assignRequest, admin.id],
  );
  assert.equal(requestEvent.rowCount, 1);
  assert.equal(auditEvent.rowCount, 1);

  await assertGovernanceError(
    () =>
      service.assignUnassignedRequest(
        assignRequest,
        { responsibilityId: fullResponsibility.id, expectedVersion: 1 },
        adminDependencies(admin),
      ),
    "conflict",
  );
  const replayCounts = await pool.query<{ assignments: number; events: number; audits: number }>(
    `SELECT
       (SELECT count(*)::int FROM request_review_assignment WHERE request_id = $1) AS assignments,
       (SELECT count(*)::int FROM request_event WHERE request_id = $1
          AND event_type = 'request_administrator_assigned') AS events,
       (SELECT count(*)::int FROM audit_event WHERE request_id = $1
          AND event_type = 'request_administrator_assigned') AS audits`,
    [assignRequest],
  );
  assert.deepEqual(replayCounts.rows[0], { assignments: 1, events: 1, audits: 1 });
});

test("delegations create and cancel with admin-only access and valid dates", async () => {
  const admin = await seedUser(["admin"], "Delegation Admin", true);
  const nonAdmin = await seedUser(["faculty"], "Delegation Faculty", true);
  const delegator = await seedUser(["approver"], "Delegator");
  const substitute = await seedUser(["approver"], "Substitute");
  const nonAdminCookie = await login(nonAdmin.email);
  const validFrom = new Date(Date.now() - 60_000).toISOString();
  const validUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const adminDeps = adminDependencies(admin);

  await assertGovernanceError(
    () =>
      service.createDelegation(
        {
          delegatorUserId: delegator.id,
          substituteUserId: substitute.id,
          validFrom: "not-a-date",
          validUntil,
        },
        adminDeps,
      ),
    "invalid_input",
  );
  await assertGovernanceError(
    () =>
      service.createDelegation(
        {
          delegatorUserId: delegator.id,
          substituteUserId: substitute.id,
          validFrom: validUntil,
          validUntil: validFrom,
        },
        adminDeps,
      ),
    "invalid_input",
  );
  const nonAdminResponse = await handlers.handleDelegationCreate(
    jsonRequest(
      "http://localhost:3000/api/admin/delegations",
      nonAdminCookie,
      { delegatorUserId: delegator.id, substituteUserId: substitute.id, validFrom, validUntil },
    ),
  );
  assert.equal(nonAdminResponse.status, 403);

  const created = await service.createDelegation(
    {
      delegatorUserId: delegator.id,
      substituteUserId: substitute.id,
      validFrom,
      validUntil,
    },
    adminDeps,
  );
  const createdAudit = await pool.query(
    `SELECT 1 FROM audit_event
      WHERE actor_user_id = $1 AND subject_user_id = $2
        AND event_type = 'approver_delegation.created'
        AND metadata ->> 'delegationId' = $3`,
    [admin.id, delegator.id, created.id],
  );
  assert.equal(createdAudit.rowCount, 1);
  const cancelDenied = await handlers.handleDelegationCancel(
    new Request(
      `http://localhost:3000/api/admin/delegations/${created.id}/cancel`,
      {
        method: "POST",
        headers: {
          cookie: nonAdminCookie,
          origin: "http://localhost:3000",
        },
      },
    ),
    created.id,
  );
  assert.equal(cancelDenied.status, 403);
  const unchangedDelegation = await pool.query<{ cancelled_at: Date | null }>(
    "SELECT cancelled_at FROM approver_delegation WHERE id = $1",
    [created.id],
  );
  assert.equal(unchangedDelegation.rows[0].cancelled_at, null);
  await service.cancelDelegation(created.id, adminDeps);
  const cancelled = await pool.query<{ cancelled_by: string; cancelled_at: Date | null }>(
    `SELECT cancelled_by, cancelled_at FROM approver_delegation WHERE id = $1`,
    [created.id],
  );
  assert.equal(cancelled.rows[0].cancelled_by, admin.id);
  assert.ok(cancelled.rows[0].cancelled_at);
  const cancelledAudit = await pool.query(
    `SELECT 1 FROM audit_event
      WHERE actor_user_id = $1 AND subject_user_id = $2
        AND event_type = 'approver_delegation.cancelled'
        AND metadata ->> 'delegationId' = $3`,
    [admin.id, delegator.id, created.id],
  );
  assert.equal(cancelledAudit.rowCount, 1);
});

test("institutional identifiers enforce issuer-scoped uniqueness and audit updates", async () => {
  const admin = await seedUser(["admin"], "Identifier Admin", true);
  const firstUser = await seedUser(["student"], "Identifier Student One");
  const secondUser = await seedUser(["student"], "Identifier Student Two");
  const adminCookie = await login(admin.email);
  const firstResponse = await handlers.handleIdentifierUpsert(
    jsonRequest(
      `http://localhost:3000/api/admin/users/${firstUser.id}/identifiers`,
      adminCookie,
      {
        identifierType: "student_number",
        issuer: "campus-a",
        identifier: "student-0042",
      },
      "PUT",
    ),
    firstUser.id,
  );
  assert.equal(firstResponse.status, 200);
  const firstBody = (await firstResponse.json()) as {
    items?: Array<{ id: string; identifier: string; issuer: string }>;
    error?: unknown;
  };
  assert.ok(firstBody.items?.[0], JSON.stringify(firstBody));
  assert.equal(firstBody.items[0].identifier, "STUDENT-0042");
  assert.equal(firstBody.items[0].issuer, "campus-a");
  assert.ok(firstBody.items[0].id);

  await assertGovernanceError(
    () =>
      service.upsertUserIdentifier(
        secondUser.id,
        {
          identifierType: "student_number",
          issuer: "campus-a",
          identifier: "student-0042",
        },
        adminDependencies(admin),
      ),
    "conflict",
  );
  const otherIssuer = await service.upsertUserIdentifier(
    secondUser.id,
    {
      identifierType: "student_number",
      issuer: "campus-b",
      identifier: "student-0042",
    },
    adminDependencies(admin),
  );
  assert.equal(otherIssuer[0].issuer, "campus-b");
  assert.ok(otherIssuer[0].id);

  const audit = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM audit_event
      WHERE actor_user_id = $1 AND event_type = 'institutional_identifier.updated'
        AND subject_user_id IN ($2,$3)`,
    [admin.id, firstUser.id, secondUser.id],
  );
  assert.equal(audit.rows[0].count, 2);
});

test("catalog administration reads, toggles availability, and adds audited scopes", async () => {
  const admin = await seedUser(["admin"], "Catalog Admin", true);
  const nonAdmin = await seedUser(["student"], "Catalog Student", true);
  const adminCookie = await login(admin.email);
  const nonAdminCookie = await login(nonAdmin.email);

  function catalogGet(url: string, cookie: string) {
    return new Request(url, {
      headers: { cookie, origin: "http://localhost:3000" },
    });
  }

  // Unauthenticated and non-admin reads are rejected.
  const anonymous = await handlers.handleCatalogGet(
    new Request("http://localhost:3000/api/admin/catalog"),
  );
  assert.equal(anonymous.status, 401);
  const studentRead = await handlers.handleCatalogGet(
    catalogGet("http://localhost:3000/api/admin/catalog", nonAdminCookie),
  );
  assert.equal(studentRead.status, 403);

  // Administrator read returns the seeded catalog with policy, permissions, and scopes.
  const read = await handlers.handleCatalogGet(
    catalogGet("http://localhost:3000/api/admin/catalog", adminCookie),
  );
  assert.equal(read.status, 200);
  const readBody = (await read.json()) as {
    resources: Array<{
      id: string;
      available: boolean;
      permissions: Array<{ id: string; enabled: boolean; requesterRoles: string[] }>;
      scopeFields: Array<{ fieldName: string }>;
      currentPolicy: { provisional: boolean } | null;
    }>;
  };
  const lms = readBody.resources.find((resource) => resource.id === "r-lms");
  assert.ok(lms, "expected the seeded LMS resource");
  assert.equal(lms.available, true);
  assert.ok(lms.permissions.some((p) => p.id === "lms:course-participation"));
  assert.ok(lms.currentPolicy?.provisional);

  // Non-admin availability toggle is forbidden and makes no change.
  const forbiddenToggle = await handlers.handleCatalogToggle(
    jsonRequest("http://localhost:3000/api/admin/catalog", nonAdminCookie, {
      kind: "resource",
      id: "r-lms",
      enabled: false,
    }, "PATCH"),
  );
  assert.equal(forbiddenToggle.status, 403);
  const afterForbidden = await pool.query<{ available: boolean }>(
    "SELECT available FROM catalog_resource WHERE id = 'r-lms'",
  );
  assert.equal(afterForbidden.rows[0].available, true);

  // Cross-origin toggle is rejected even for an administrator.
  const crossOrigin = await handlers.handleCatalogToggle(
    new Request("http://localhost:3000/api/admin/catalog", {
      method: "PATCH",
      headers: {
        cookie: adminCookie,
        origin: "http://evil.example",
        "content-type": "application/json",
      },
      body: JSON.stringify({ kind: "resource", id: "r-lms", enabled: false }),
    }),
  );
  assert.equal(crossOrigin.status, 403);
  const crossOriginBody = (await crossOrigin.json()) as { error?: { code?: string } };
  assert.equal(crossOriginBody.error?.code, "invalid_origin");

  // Administrator toggles resource availability off, then a permission off, each audited.
  const resourceOff = await handlers.handleCatalogToggle(
    jsonRequest("http://localhost:3000/api/admin/catalog", adminCookie, {
      kind: "resource",
      id: "r-lms",
      enabled: false,
    }, "PATCH"),
  );
  assert.equal(resourceOff.status, 200);
  const resourceState = await pool.query<{ available: boolean }>(
    "SELECT available FROM catalog_resource WHERE id = 'r-lms'",
  );
  assert.equal(resourceState.rows[0].available, false);
  const resourceAudit = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM audit_event
      WHERE actor_user_id = $1 AND event_type = 'catalog.availability_updated'
        AND metadata ->> 'kind' = 'resource'
        AND metadata ->> 'id' = 'r-lms'
        AND metadata ->> 'enabled' = 'false'`,
    [admin.id],
  );
  assert.equal(resourceAudit.rows[0].count, 1);

  const permissionOff = await handlers.handleCatalogToggle(
    jsonRequest("http://localhost:3000/api/admin/catalog", adminCookie, {
      kind: "permission",
      id: "lms:course-participation",
      enabled: false,
    }, "PATCH"),
  );
  assert.equal(permissionOff.status, 200);
  const permissionState = await pool.query<{ enabled: boolean }>(
    "SELECT enabled FROM catalog_permission WHERE id = 'lms:course-participation'",
  );
  assert.equal(permissionState.rows[0].enabled, false);

  // Restore availability so later ordering of tests is unaffected.
  await handlers.handleCatalogToggle(
    jsonRequest("http://localhost:3000/api/admin/catalog", adminCookie, {
      kind: "resource",
      id: "r-lms",
      enabled: true,
    }, "PATCH"),
  );
  await handlers.handleCatalogToggle(
    jsonRequest("http://localhost:3000/api/admin/catalog", adminCookie, {
      kind: "permission",
      id: "lms:course-participation",
      enabled: true,
    }, "PATCH"),
  );

  // Toggling an unknown record returns not_found.
  await assertGovernanceError(
    () =>
      service.toggleCatalogAvailability(
        { kind: "resource", id: "r-does-not-exist", enabled: false },
        adminDependencies(admin),
      ),
    "not_found",
  );

  // Scope creation requires a valid resource/field pair and is admin-only.
  const nonAdminScope = await handlers.handleScopeCreate(
    jsonRequest("http://localhost:3000/api/admin/catalog/scopes", nonAdminCookie, {
      resourceId: "r-lms",
      fieldName: "courseSection",
      institutionalCode: `GOV-${randomUUID()}`,
      displayName: "Rejected scope",
    }),
  );
  assert.equal(nonAdminScope.status, 403);

  await assertGovernanceError(
    () =>
      service.createScopeOption(
        {
          resourceId: "r-lms",
          fieldName: "laboratory", // not a field of r-lms
          institutionalCode: `GOV-${randomUUID()}`,
          displayName: "Invalid field scope",
        },
        adminDependencies(admin),
      ),
    "invalid_input",
  );

  // The server upper-cases institutional codes; submit a lower-case input and
  // assert the stored and listed values are the normalized upper-case form.
  const code = `GOV-${randomUUID()}`.slice(0, 40).toUpperCase();
  const createdScope = await handlers.handleScopeCreate(
    jsonRequest("http://localhost:3000/api/admin/catalog/scopes", adminCookie, {
      resourceId: "r-lms",
      fieldName: "courseSection",
      institutionalCode: code.toLowerCase(),
      displayName: "Integration Course Section",
    }),
  );
  assert.equal(createdScope.status, 200);
  const createdScopeBody = (await createdScope.json()) as {
    result: { id: string };
  };
  const storedScope = await pool.query<{
    institutional_code: string;
    display_name: string;
    resource_id: string;
    field_name: string;
  }>(
    `SELECT institutional_code, display_name, resource_id, field_name
       FROM scope_option WHERE id = $1`,
    [createdScopeBody.result.id],
  );
  assert.equal(storedScope.rows[0].institutional_code, code);
  assert.equal(storedScope.rows[0].resource_id, "r-lms");
  assert.equal(storedScope.rows[0].field_name, "courseSection");
  const scopeAudit = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM audit_event
      WHERE actor_user_id = $1 AND event_type = 'catalog.scope_option_created'
        AND metadata ->> 'scopeOptionId' = $2`,
    [admin.id, createdScopeBody.result.id],
  );
  assert.equal(scopeAudit.rows[0].count, 1);

  // Duplicate institutional code for the same resource field conflicts.
  await assertGovernanceError(
    () =>
      service.createScopeOption(
        {
          resourceId: "r-lms",
          fieldName: "courseSection",
          institutionalCode: code,
          displayName: "Duplicate code scope",
        },
        adminDependencies(admin),
      ),
    "conflict",
  );

  // The new scope is visible through the admin scope list endpoint.
  const scopeList = await handlers.handleScopeList(
    catalogGet(
      "http://localhost:3000/api/admin/catalog/scopes?resource=r-lms",
      adminCookie,
    ),
  );
  assert.equal(scopeList.status, 200);
  const scopeListBody = (await scopeList.json()) as {
    options: Array<{ institutionalCode: string }>;
  };
  assert.ok(
    scopeListBody.options.some((option) => option.institutionalCode === code),
  );
});

test("delegation list and circular rejection back the absence management UI", async () => {
  const admin = await seedUser(["admin"], "Delegation List Admin", true);
  const nonAdmin = await seedUser(["student"], "Delegation List Student", true);
  const first = await seedUser(["approver"], "Absence Approver One");
  const second = await seedUser(["approver"], "Absence Approver Two");
  const adminCookie = await login(admin.email);
  const nonAdminCookie = await login(nonAdmin.email);
  const adminDeps = adminDependencies(admin);

  // The list endpoint is administrator-only.
  const unauth = await handlers.handleDelegationList(
    new Request("http://localhost:3000/api/admin/delegations"),
  );
  assert.equal(unauth.status, 401);
  const forbidden = await handlers.handleDelegationList(
    new Request("http://localhost:3000/api/admin/delegations", {
      headers: { cookie: nonAdminCookie, origin: "http://localhost:3000" },
    }),
  );
  assert.equal(forbidden.status, 403);

  const validFrom = new Date(Date.now() - 60_000).toISOString();
  const validUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const created = await service.createDelegation(
    {
      delegatorUserId: first.id,
      substituteUserId: second.id,
      validFrom,
      validUntil,
    },
    adminDeps,
  );

  // The list endpoint returns a sanitized, named, active-flagged record for the UI.
  const listed = await handlers.handleDelegationList(
    new Request("http://localhost:3000/api/admin/delegations", {
      headers: { cookie: adminCookie, origin: "http://localhost:3000" },
    }),
  );
  assert.equal(listed.status, 200);
  const listedBody = (await listed.json()) as {
    items: Array<{
      id: string;
      delegator: { id: string; name: string };
      substitute: { id: string; name: string };
      active: boolean;
      cancelledAt: string | null;
    }>;
  };
  const record = listedBody.items.find((item) => item.id === created.id);
  assert.ok(record, "expected the created delegation in the list");
  assert.equal(record.delegator.id, first.id);
  assert.equal(record.substitute.id, second.id);
  assert.equal(record.active, true);
  assert.equal(record.cancelledAt, null);

  // A reverse delegation that overlaps the same window is rejected as circular,
  // the exact code the UI surfaces as a distinct message.
  const circular = await handlers.handleDelegationCreate(
    jsonRequest("http://localhost:3000/api/admin/delegations", adminCookie, {
      delegatorUserId: second.id,
      substituteUserId: first.id,
      validFrom,
      validUntil,
    }),
  );
  assert.equal(circular.status, 409);
  const circularBody = (await circular.json()) as { error?: { code?: string } };
  assert.equal(circularBody.error?.code, "circular_delegation");

  // A second overlapping absence for the same approver is a plain conflict.
  await assertGovernanceError(
    () =>
      service.createDelegation(
        {
          delegatorUserId: first.id,
          substituteUserId: second.id,
          validFrom,
          validUntil,
        },
        adminDeps,
      ),
    "conflict",
  );
});

test("identifier list and in-place update back the maintenance UI", async () => {
  const admin = await seedUser(["admin"], "Identifier UI Admin", true);
  const nonAdmin = await seedUser(["student"], "Identifier UI Student", true);
  const subject = await seedUser(["student"], "Identifier UI Subject");
  const adminCookie = await login(admin.email);
  const nonAdminCookie = await login(nonAdmin.email);

  // The per-account list endpoint is administrator-only and UUID-validated.
  const unauth = await handlers.handleIdentifierList(
    new Request(`http://localhost:3000/api/admin/users/${subject.id}/identifiers`),
    subject.id,
  );
  assert.equal(unauth.status, 401);
  const forbidden = await handlers.handleIdentifierList(
    new Request(`http://localhost:3000/api/admin/users/${subject.id}/identifiers`, {
      headers: { cookie: nonAdminCookie, origin: "http://localhost:3000" },
    }),
    subject.id,
  );
  assert.equal(forbidden.status, 403);
  const badId = await handlers.handleIdentifierList(
    new Request("http://localhost:3000/api/admin/users/not-a-uuid/identifiers", {
      headers: { cookie: adminCookie, origin: "http://localhost:3000" },
    }),
    "not-a-uuid",
  );
  assert.equal(badId.status, 400);

  // An empty account lists no identifiers.
  const emptyList = await handlers.handleIdentifierList(
    new Request(`http://localhost:3000/api/admin/users/${subject.id}/identifiers`, {
      headers: { cookie: adminCookie, origin: "http://localhost:3000" },
    }),
    subject.id,
  );
  assert.equal(emptyList.status, 200);
  assert.deepEqual(((await emptyList.json()) as { items: unknown[] }).items, []);

  // Create a lower-case value through the PUT handler; it is normalized upper-case.
  const created = await handlers.handleIdentifierUpsert(
    jsonRequest(
      `http://localhost:3000/api/admin/users/${subject.id}/identifiers`,
      adminCookie,
      { identifierType: "student_number", issuer: "campus-registrar", identifier: "2026-ab12" },
      "PUT",
    ),
    subject.id,
  );
  assert.equal(created.status, 200);
  const createdBody = (await created.json()) as {
    items: Array<{ id: string; identifierType: string; issuer: string; identifier: string }>;
  };
  assert.equal(createdBody.items.length, 1);
  assert.equal(createdBody.items[0].identifier, "2026-AB12");
  assert.equal(createdBody.items[0].identifierType, "student_number");

  // Updating the same type + issuer with a new value replaces it in place
  // (no second row) and records a fresh audit event.
  const updated = await handlers.handleIdentifierUpsert(
    jsonRequest(
      `http://localhost:3000/api/admin/users/${subject.id}/identifiers`,
      adminCookie,
      { identifierType: "student_number", issuer: "campus-registrar", identifier: "2026-ZZ99" },
      "PUT",
    ),
    subject.id,
  );
  assert.equal(updated.status, 200);
  const updatedBody = (await updated.json()) as {
    items: Array<{ identifier: string }>;
  };
  assert.equal(updatedBody.items.length, 1);
  assert.equal(updatedBody.items[0].identifier, "2026-ZZ99");
  const rows = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM institutional_identifier
      WHERE user_id = $1 AND identifier_type = 'student_number' AND issuer = 'campus-registrar'`,
    [subject.id],
  );
  assert.equal(rows.rows[0].count, 1);
  const auditCount = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM audit_event
      WHERE actor_user_id = $1 AND subject_user_id = $2
        AND event_type = 'institutional_identifier.updated'`,
    [admin.id, subject.id],
  );
  assert.equal(auditCount.rows[0].count, 2);

  // A second identifier type coexists; the list returns both for the UI.
  await handlers.handleIdentifierUpsert(
    jsonRequest(
      `http://localhost:3000/api/admin/users/${subject.id}/identifiers`,
      adminCookie,
      { identifierType: "staff_number", issuer: "hr", identifier: "STAFF-7" },
      "PUT",
    ),
    subject.id,
  );
  const finalList = await handlers.handleIdentifierList(
    new Request(`http://localhost:3000/api/admin/users/${subject.id}/identifiers`, {
      headers: { cookie: adminCookie, origin: "http://localhost:3000" },
    }),
    subject.id,
  );
  const finalBody = (await finalList.json()) as {
    items: Array<{ identifierType: string; identifier: string }>;
  };
  assert.equal(finalBody.items.length, 2);
  assert.ok(finalBody.items.some((i) => i.identifierType === "staff_number" && i.identifier === "STAFF-7"));
  assert.ok(finalBody.items.some((i) => i.identifierType === "student_number" && i.identifier === "2026-ZZ99"));
});

test("analytics summary aggregates request and lifecycle states for the reports UI", async () => {
  const admin = await seedUser(["admin"], "Analytics Admin", true);
  const nonAdmin = await seedUser(["student"], "Analytics Student", true);
  const requester = await seedUser(["student"], "Analytics Requester");
  const adminCookie = await login(admin.email);
  const nonAdminCookie = await login(nonAdmin.email);

  // Unauthenticated and non-admin access is rejected before any data is read.
  const anonymous = await handlers.handleAnalytics(
    new Request("http://localhost:3000/api/admin/analytics"),
  );
  assert.equal(anonymous.status, 401);
  const forbidden = await handlers.handleAnalytics(
    new Request("http://localhost:3000/api/admin/analytics", {
      headers: { cookie: nonAdminCookie, origin: "http://localhost:3000" },
    }),
  );
  assert.equal(forbidden.status, 403);

  // Seed a known distribution of request statuses for this requester.
  await seedRequest({ requester, status: "pending_review" });
  await seedRequest({ requester, status: "pending_routing" });
  await seedRequest({ requester, status: "approved_pending_activation" });
  await seedRequest({ requester, status: "approved_pending_activation" });
  await seedRequest({ requester, status: "denied" });
  await seedRequest({ requester, status: "returned_for_revision" });

  const response = await handlers.handleAnalytics(
    new Request("http://localhost:3000/api/admin/analytics", {
      headers: { cookie: adminCookie, origin: "http://localhost:3000" },
    }),
  );
  assert.equal(response.status, 200);
  // The response is private/no-store and discloses no raw records.
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  const body = (await response.json()) as {
    requests: {
      total: number;
      byStatus: Record<string, number>;
      pendingReview: number;
      pendingRouting: number;
      approvedPendingActivation: number;
    };
    users: { total: number; active: number; inactive: number };
    entitlements: { active: number; expired: number; revoked: number };
    activation: { activated: number; failed: number; activating: number };
    approverWorkload: Array<{ approverName: string; openAssignments: number }>;
    generatedAt: string;
  };

  // Aggregated counts reflect at least the seeded distribution (the suite shares
  // a database, so other tests may add more; assert lower bounds and derived
  // values that must hold regardless of other rows).
  assert.ok(body.requests.total >= 6);
  assert.ok((body.requests.byStatus.approved_pending_activation ?? 0) >= 2);
  assert.ok((body.requests.byStatus.denied ?? 0) >= 1);
  assert.ok((body.requests.byStatus.returned_for_revision ?? 0) >= 1);
  assert.ok(body.requests.pendingReview >= 1);
  assert.ok(body.requests.pendingRouting >= 1);
  assert.ok(body.users.total >= 3);
  assert.equal(body.users.total, body.users.active + body.users.inactive);
  assert.equal(typeof body.entitlements.active, "number");
  assert.equal(typeof body.activation.activated, "number");

  // Safe DTO: no personal request content or account identifiers leak.
  const serialized = JSON.stringify(body);
  assert.equal(serialized.includes(requester.email), false);
  assert.equal(serialized.includes("Governance integration fixture request purpose."), false);
  assert.equal(serialized.includes("REQ-GOV-"), false);
  // generatedAt is an ISO timestamp.
  assert.ok(!Number.isNaN(Date.parse(body.generatedAt)));

  // A far-past date window yields an empty request set without error.
  const emptyWindow = await service.getAnalyticsSummary(
    new URLSearchParams({ from: "1999-01-01", to: "1999-01-02" }),
    adminDependencies(admin),
  );
  assert.equal(emptyWindow.requests.total, 0);
  assert.deepEqual(emptyWindow.requests.byStatus, {});
  assert.equal(emptyWindow.approvalTurnaroundHours, null);
  // User and entitlement aggregates are not date-filtered and remain available.
  assert.ok(emptyWindow.users.total >= 3);

  // An invalid date filter is rejected by validation (surfaced as 400 upstream).
  await assertGovernanceError(
    () =>
      service.getAnalyticsSummary(
        new URLSearchParams({ from: "not-a-date" }),
        adminDependencies(admin),
      ),
    "invalid_input",
  );
});

test("notification preferences are per-account, save in-app, and reject external channels", async () => {
  const first = await seedUser(["student"], "Preference Student One", true);
  const second = await seedUser(["approver"], "Preference Approver Two", true);
  const firstCookie = await login(first.email);
  const secondCookie = await login(second.email);

  // Unauthenticated reads are rejected.
  const anonymous = await handlers.handlePreferenceGet(
    new Request("http://localhost:3000/api/notifications/preferences"),
  );
  assert.equal(anonymous.status, 401);

  // Default preferences for a fresh account: in-app on, external off/unconfigured.
  const initial = await handlers.handlePreferenceGet(
    new Request("http://localhost:3000/api/notifications/preferences", {
      headers: { cookie: firstCookie, origin: "http://localhost:3000" },
    }),
  );
  assert.equal(initial.status, 200);
  const initialBody = (await initial.json()) as {
    preference: {
      inAppEnabled: boolean;
      externalEmailEnabled: boolean;
      externalDeliveryConfigured: boolean;
    };
  };
  assert.equal(initialBody.preference.inAppEnabled, true);
  assert.equal(initialBody.preference.externalEmailEnabled, false);
  assert.equal(initialBody.preference.externalDeliveryConfigured, false);

  // Turning in-app off persists and is recorded; external stays false.
  const update = await handlers.handlePreferenceUpdate(
    jsonRequest(
      "http://localhost:3000/api/notifications/preferences",
      firstCookie,
      { inAppEnabled: false },
      "PATCH",
    ),
  );
  assert.equal(update.status, 200);
  const updateBody = (await update.json()) as {
    preference: { inAppEnabled: boolean; externalEmailEnabled: boolean };
  };
  assert.equal(updateBody.preference.inAppEnabled, false);
  assert.equal(updateBody.preference.externalEmailEnabled, false);

  const stored = await pool.query<{
    in_app_enabled: boolean;
    external_email_enabled: boolean;
    external_sms_enabled: boolean;
    external_push_enabled: boolean;
  }>(
    `SELECT in_app_enabled, external_email_enabled, external_sms_enabled, external_push_enabled
       FROM user_notification_preference WHERE user_id = $1`,
    [first.id],
  );
  assert.equal(stored.rows[0].in_app_enabled, false);
  assert.equal(stored.rows[0].external_email_enabled, false);
  assert.equal(stored.rows[0].external_sms_enabled, false);
  assert.equal(stored.rows[0].external_push_enabled, false);
  const audit = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM audit_event
      WHERE actor_user_id = $1 AND event_type = 'notification_preference.updated'`,
    [first.id],
  );
  assert.ok(audit.rows[0].count >= 1);

  // Persistence after a fresh read reflects the saved value.
  const reread = await handlers.handlePreferenceGet(
    new Request("http://localhost:3000/api/notifications/preferences", {
      headers: { cookie: firstCookie, origin: "http://localhost:3000" },
    }),
  );
  const rereadBody = (await reread.json()) as { preference: { inAppEnabled: boolean } };
  assert.equal(rereadBody.preference.inAppEnabled, false);

  // The second account is unaffected by the first account's change (ownership).
  const secondRead = await handlers.handlePreferenceGet(
    new Request("http://localhost:3000/api/notifications/preferences", {
      headers: { cookie: secondCookie, origin: "http://localhost:3000" },
    }),
  );
  const secondBody = (await secondRead.json()) as { preference: { inAppEnabled: boolean } };
  assert.equal(secondBody.preference.inAppEnabled, true);

  // Enabling any external channel is rejected and persists nothing.
  for (const channel of [
    "externalEmailEnabled",
    "externalSmsEnabled",
    "externalPushEnabled",
  ]) {
    const rejected = await handlers.handlePreferenceUpdate(
      jsonRequest(
        "http://localhost:3000/api/notifications/preferences",
        secondCookie,
        { [channel]: true },
        "PATCH",
      ),
    );
    assert.equal(rejected.status, 400, `${channel} must be rejected`);
    const rejectedBody = (await rejected.json()) as { error?: { code?: string } };
    assert.equal(rejectedBody.error?.code, "invalid_input");
  }
  const secondStored = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM user_notification_preference
      WHERE user_id = $1
        AND (external_email_enabled OR external_sms_enabled OR external_push_enabled)`,
    [second.id],
  );
  assert.equal(secondStored.rows[0].count, 0);

  // An empty or unknown-field body is rejected before any write.
  const emptyBody = await handlers.handlePreferenceUpdate(
    jsonRequest("http://localhost:3000/api/notifications/preferences", firstCookie, {}, "PATCH"),
  );
  assert.equal(emptyBody.status, 400);
  const unknownField = await handlers.handlePreferenceUpdate(
    jsonRequest(
      "http://localhost:3000/api/notifications/preferences",
      firstCookie,
      { smsCarrier: "acme" },
      "PATCH",
    ),
  );
  assert.equal(unknownField.status, 400);

  // The update handler enforces same-origin.
  const crossOrigin = await handlers.handlePreferenceUpdate(
    new Request("http://localhost:3000/api/notifications/preferences", {
      method: "PATCH",
      headers: {
        cookie: firstCookie,
        origin: "http://evil.example",
        "content-type": "application/json",
      },
      body: JSON.stringify({ inAppEnabled: true }),
    }),
  );
  assert.equal(crossOrigin.status, 403);

  // The DTO exposes no delivery credentials, tokens, or provider configuration.
  const serialized = JSON.stringify(rereadBody);
  for (const forbidden of ["token", "secret", "password", "apiKey", "provider"]) {
    assert.equal(
      serialized.toLowerCase().includes(forbidden.toLowerCase()),
      false,
      `DTO unexpectedly contains "${forbidden}": ${serialized}`,
    );
  }
});

test("retention policies list and dry-run previews never modify data", async () => {
  const admin = await seedUser(["admin"], "Retention Admin", true);
  const nonAdmin = await seedUser(["student"], "Retention Student", true);
  const recipient = await seedUser(["student"], "Retention Recipient");
  const adminCookie = await login(admin.email);
  const nonAdminCookie = await login(nonAdmin.email);
  const adminDeps = adminDependencies(admin);

  // List is administrator-only.
  const unauthList = await handlers.handleRetentionList(
    new Request("http://localhost:3000/api/admin/retention"),
  );
  assert.equal(unauthList.status, 401);
  const forbiddenList = await handlers.handleRetentionList(
    new Request("http://localhost:3000/api/admin/retention", {
      headers: { cookie: nonAdminCookie, origin: "http://localhost:3000" },
    }),
  );
  assert.equal(forbiddenList.status, 403);

  // The seeded provisional policy classes are returned with their flags.
  const list = await handlers.handleRetentionList(
    new Request("http://localhost:3000/api/admin/retention", {
      headers: { cookie: adminCookie, origin: "http://localhost:3000" },
    }),
  );
  assert.equal(list.status, 200);
  const listBody = (await list.json()) as {
    items: Array<{ recordClass: string; retentionDays: number | null; immutable: boolean }>;
  };
  const auditClass = listBody.items.find((i) => i.recordClass === "audit_event");
  const notificationClass = listBody.items.find((i) => i.recordClass === "user_notification");
  assert.ok(auditClass);
  assert.equal(auditClass.immutable, true);
  assert.equal(auditClass.retentionDays, null);
  assert.ok(notificationClass);
  assert.equal(notificationClass.immutable, false);
  assert.equal(notificationClass.retentionDays, 730);

  // Seed two notifications older than the 730-day window so they are eligible.
  // user_notification requires a request and a request_event (both NOT NULL).
  for (const index of [0, 1]) {
    const requestId = await seedRequest({ requester: recipient, status: "denied" });
    const eventId = randomUUID();
    await pool.query(
      `INSERT INTO request_event
        (id, request_id, actor_user_id, event_type, occurred_at, detail)
       VALUES ($1,$2,$3,'review_denied',now() - interval '800 days','Historical denial event.')`,
      [eventId, requestId, admin.id],
    );
    await pool.query(
      `INSERT INTO user_notification
        (id, recipient_user_id, request_id, request_event_id, notification_type, title, body, created_at)
       VALUES ($1,$2,$3,$4,'request_denied','Old notice','Historical notice',
         now() - interval '800 days' - ($5 || ' minutes')::interval)`,
      [randomUUID(), recipient.id, requestId, eventId, String(index)],
    );
  }
  const notificationsBefore = await pool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM user_notification",
  );

  // Non-admin preview is rejected.
  const forbiddenPreview = await handlers.handleRetentionPreview(
    jsonRequest("http://localhost:3000/api/admin/retention", nonAdminCookie, {
      recordClass: "user_notification",
      apply: false,
    }),
  );
  assert.equal(forbiddenPreview.status, 403);

  // A dry-run preview reports the eligible count and changes nothing.
  const preview = await handlers.handleRetentionPreview(
    jsonRequest("http://localhost:3000/api/admin/retention", adminCookie, {
      recordClass: "user_notification",
      apply: false,
    }),
  );
  assert.equal(preview.status, 200);
  const previewBody = (await preview.json()) as {
    result: { eligibleCount: number; applied: boolean; immutable: boolean; message: string };
  };
  assert.ok(previewBody.result.eligibleCount >= 2);
  assert.equal(previewBody.result.applied, false);
  assert.match(previewBody.result.message, /No records were changed/);
  const notificationsAfter = await pool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM user_notification",
  );
  assert.equal(notificationsAfter.rows[0].count, notificationsBefore.rows[0].count);

  // Immutable classes return a zero count and an explanatory message.
  const immutablePreview = await service.previewRetention(
    { recordClass: "audit_event", apply: false },
    adminDeps,
  );
  assert.equal(immutablePreview.eligibleCount, 0);
  assert.equal(immutablePreview.immutable, true);
  assert.match(immutablePreview.message, /cannot be archived/i);

  // Attempting to apply is refused server-side (immutable code -> 409).
  const applyAttempt = await handlers.handleRetentionPreview(
    jsonRequest("http://localhost:3000/api/admin/retention", adminCookie, {
      recordClass: "user_notification",
      apply: true,
    }),
  );
  assert.equal(applyAttempt.status, 409);
  const applyBody = (await applyAttempt.json()) as { error?: { code?: string } };
  assert.equal(applyBody.error?.code, "immutable");
  const notificationsAfterApply = await pool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM user_notification",
  );
  assert.equal(notificationsAfterApply.rows[0].count, notificationsBefore.rows[0].count);

  // Unknown classes are not found; the safe DTO exposes no record contents.
  await assertGovernanceError(
    () => service.previewRetention({ recordClass: "unknown_class", apply: false }, adminDeps),
    "not_found",
  );
  const serialized = JSON.stringify(previewBody);
  assert.equal(serialized.includes("Historical notice"), false);
  assert.equal(serialized.includes(recipient.id), false);
});
