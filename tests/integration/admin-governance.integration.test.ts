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
  status?: "pending_routing" | "pending_review" | "denied";
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
  const { hashPassword } = await import("../../lib/server/password");
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