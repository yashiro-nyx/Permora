import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test, { after, before } from "node:test";
import { promisify } from "node:util";
import { Pool, type PoolClient } from "pg";
import { ResilientPool } from "../lib/database-pool";
import {
  invokeActivationAdapter,
  ManualAdminActivationAdapter,
  type ActivationAdapter,
  type ManualActivationContext,
} from "../lib/activation-adapter";
import {
  prepareApprovedActivation,
  recordActivationOutcome,
} from "../lib/activation-lifecycle";
import {
  expireActivatedEntitlement,
  revokeActivatedEntitlement,
} from "../lib/activation-maintenance";
import { createAccessRequest } from "../lib/server/request-service";
import { listAdministratorActivations } from "../lib/server/activation-read-service";
import { closeDatabasePool } from "../lib/server/db";
import {
  ActivationDomainError,
  startActivationAttempt,
} from "../lib/activation-domain";
import {
  applyApprovalDecision as applyApprovalDecisionDomain,
  type ApprovalDecision,
  ApprovalDomainError,
  previewRequestRoute,
  routePendingRequest,
} from "../lib/approval-domain";

function requiredSafeTestDatabaseUrl() {
  const value = process.env.TEST_DATABASE_URL;
  if (!value)
    throw new Error(
      "TEST_DATABASE_URL is required for PostgreSQL integration tests.",
    );
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("TEST_DATABASE_URL must be a valid PostgreSQL URL.");
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol))
    throw new Error("TEST_DATABASE_URL must use the postgres protocol.");
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!databaseName.endsWith("_test"))
    throw new Error(
      "Refusing destructive fixtures: the test database name must end with _test.",
    );
  return { value, databaseName };
}

const testDatabase = requiredSafeTestDatabaseUrl();
const execFileAsync = promisify(execFile);
const legacyPendingRequestId = "20000000-0000-4000-8000-000000000001";
let pool: Pool;

function applyApprovalDecision(
  client: PoolClient,
  actorUserId: string,
  input: {
    requestId: string;
    expectedVersion: number;
    decision: ApprovalDecision;
    reason?: string;
  },
) {
  return applyApprovalDecisionDomain(client, actorUserId, {
    ...input,
    idempotencyKey: randomUUID(),
  });
}

async function applyMigrations(connection: Pool) {
  const client = await connection.connect();
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
           VALUES ('legacy-rate-limit-row', 1, 0)`,
        );
      if (file === "0004_stage_2b_approval_foundation.sql") {
        const legacyUserId = "20000000-0000-4000-8000-000000000002";
        const now = new Date();
        await client.query(
          `INSERT INTO "user" (id,name,email,"emailVerified","createdAt","updatedAt")
           VALUES ($1,'Legacy requester','legacy-requester@permora.test',true,$2,$2)`,
          [legacyUserId, now],
        );
        await client.query(
          "INSERT INTO user_profile (user_id, requester_role) VALUES ($1,'student')",
          [legacyUserId],
        );
        await client.query(
          "INSERT INTO user_role (user_id, role) VALUES ($1,'student')",
          [legacyUserId],
        );
        await client.query(
          `INSERT INTO access_request
            (id, display_id, requester_user_id, resource_id, permission_id,
             policy_version_id, purpose, starts_at, expires_at, status,
             scope_fingerprint)
           VALUES ($1,'LEGACY-PENDING',$2,'r-library',
             'library:subscribed-materials',
             '10000000-0000-4000-8000-000000000004',
             'A preserved request created before approval routing existed.',
             now() + interval '1 day', now() + interval '8 days', 'pending',
             'resource-wide')`,
          [legacyPendingRequestId, legacyUserId],
        );
      }
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

async function inTransaction<T>(work: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function seedUser(
  role: "student" | "approver" | "admin",
  id = randomUUID(),
) {
  const now = new Date();
  await pool.query(
    `INSERT INTO "user" (id,name,email,"emailVerified","createdAt","updatedAt")
     VALUES ($1,$2,$3,true,$4,$4)`,
    [id, `${role}-${id.slice(-6)}`, `${id}@permora.test`, now],
  );
  await pool.query(
    "INSERT INTO user_profile (user_id, requester_role) VALUES ($1,$2)",
    [id, role === "student" ? "student" : null],
  );
  await pool.query("INSERT INTO user_role (user_id, role) VALUES ($1,$2)", [
    id,
    role,
  ]);
  return id;
}

async function seedScope(
  resourceId: "r-lab" | "r-lms",
  fieldName: "laboratory" | "software" | "courseSection",
  suffix: string,
) {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO scope_option
      (id, resource_id, field_name, institutional_code, display_name, valid_from)
     VALUES ($1,$2,$3,$4,$5,now())`,
    [id, resourceId, fieldName, `${fieldName}-${suffix}`, `${fieldName} ${suffix}`],
  );
  return id;
}

async function seedResponsibility(
  approverUserId: string,
  resourceId: string,
  permissionId: string | null,
  scopeIds: string[] = [],
) {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO approver_responsibility
      (id, approver_user_id, resource_id, permission_id, scope_option_id,
       valid_from, assigned_by)
     VALUES ($1,$2,$3,$4,$5,now(),$2)`,
    [id, approverUserId, resourceId, permissionId, scopeIds[0] ?? null],
  );
  for (const scopeId of scopeIds)
    await pool.query(
      `INSERT INTO approver_responsibility_scope
        (responsibility_id, resource_id, scope_option_id)
       VALUES ($1,$2,$3)`,
      [id, resourceId, scopeId],
    );
  return id;
}

async function seedRequest(
  requesterUserId: string,
  resourceId: string,
  permissionId: string,
  scopeIds: { field: string; id: string }[] = [],
  status: "pending_routing" | "pending_review" = "pending_routing",
) {
  const id = randomUUID();
  const policy = await pool.query<{ id: string }>(
    `SELECT id FROM catalog_policy_version
      WHERE resource_id = $1 ORDER BY version DESC LIMIT 1`,
    [resourceId],
  );
  await pool.query(
    `INSERT INTO access_request
      (id, display_id, requester_user_id, resource_id, permission_id,
       policy_version_id, purpose, starts_at, expires_at, status, scope_fingerprint)
     VALUES ($1,$2,$3,$4,$5,$6,$7,now() + interval '1 day',
             now() + interval '8 days',$8,$9)`,
    [
      id,
      `TEST-${id}`,
      requesterUserId,
      resourceId,
      permissionId,
      policy.rows[0].id,
      "A sufficiently detailed integration-test access purpose.",
      status,
      scopeIds.map((scope) => `${scope.field}:${scope.id}`).sort().join("|") ||
        "resource-wide",
    ],
  );
  for (const scope of scopeIds)
    await pool.query(
      `INSERT INTO access_request_scope
        (request_id, field_name, scope_option_id, display_snapshot)
       SELECT $1,$2,id,display_name FROM scope_option WHERE id = $3`,
      [id, scope.field, scope.id],
    );
  return id;
}

async function route(requestId: string, actor: string | null = null) {
  return inTransaction((client) => routePendingRequest(client, requestId, actor));
}

async function requestVersion(requestId: string) {
  const result = await pool.query<{ version: number }>(
    "SELECT version FROM access_request WHERE id = $1",
    [requestId],
  );
  return result.rows[0].version;
}

async function seedRoutedLabRequest(requester: string, approver: string) {
  // Keep this helper independent from responsibilities created by earlier tests.
  await pool.query(
    `UPDATE approver_responsibility
        SET valid_until = now() - interval '1 second'
      WHERE resource_id = 'r-lab'
        AND approver_user_id <> $1
        AND valid_from <= now()
        AND (valid_until IS NULL OR valid_until > now())`,
    [approver],
  );
  const suffix = randomUUID();
  const laboratory = await seedScope("r-lab", "laboratory", suffix);
  const software = await seedScope("r-lab", "software", suffix);
  for (const scopeOptionId of [laboratory, software])
    await pool.query(
      `INSERT INTO requester_assignment
        (id,user_id,resource_id,permission_id,scope_option_id,evidence,valid_from,assigned_by)
       VALUES ($1,$2,'r-lab','lab:course-software',$3,
         'Isolated approval-domain fixture','2026-01-01T00:00:00Z',$2)`,
      [randomUUID(), requester, scopeOptionId],
    );
  await seedResponsibility(approver, "r-lab", "lab:course-software", [
    laboratory,
    software,
  ]);
  const requestId = await seedRequest(
    requester,
    "r-lab",
    "lab:course-software",
    [
      { field: "laboratory", id: laboratory },
      { field: "software", id: software },
    ],
  );
  const routed = await route(requestId, requester);
  assert.equal(routed.routed, true);
  assert.equal(routed.routed && routed.approverUserId, approver);
  return requestId;
}

async function seedRoutedLibraryRequest(requester: string, approver: string) {
  await pool.query(
    `UPDATE approver_responsibility
        SET valid_until = now() - interval '1 second'
      WHERE resource_id = 'r-library'
        AND approver_user_id <> $1
        AND valid_from <= now()
        AND (valid_until IS NULL OR valid_until > now())`,
    [approver],
  );
  await seedResponsibility(
    approver,
    "r-library",
    "library:subscribed-materials",
  );
  const requestId = await seedRequest(
    requester,
    "r-library",
    "library:subscribed-materials",
  );
  const routed = await route(requestId, requester);
  assert.equal(routed.routed, true);
  assert.equal(routed.routed && routed.approverUserId, approver);
  return requestId;
}

async function seedApprovedActivationRequest(
  resource: "lab" | "library" = "lab",
) {
  const requester = await seedUser("student");
  const approver = await seedUser("approver");
  const requestId =
    resource === "library"
      ? await seedRoutedLibraryRequest(requester, approver)
      : await seedRoutedLabRequest(requester, approver);
  const version = await requestVersion(requestId);
  await inTransaction((client) =>
    applyApprovalDecision(client, approver, {
      requestId,
      expectedVersion: version,
      decision: "approve",
    }),
  );
  const actor = await seedUser("admin");
  return { requestId, requester, approver, actor };
}

async function prepareManualActivation(
  requestId: string,
  actor: string,
  confirmation: ManualActivationContext["operatorConfirmation"],
  adapter: ActivationAdapter<ManualActivationContext> =
    new ManualAdminActivationAdapter(),
) {
  const idempotencyKey = randomUUID();
  const prepared = await inTransaction((client) =>
    prepareApprovedActivation(client, actor, { requestId, idempotencyKey }),
  );
  assert.ok(prepared.adapterContext);
  const adapterOutcome = await invokeActivationAdapter(adapter, {
    ...prepared.adapterContext,
    operatorConfirmation: confirmation,
  });
  return {
    activationId: prepared.result.activationId,
    idempotencyKey,
    attemptCount: prepared.result.attemptCount,
    adapterOutcome,
  };
}

async function recordManualActivationOutcome(
  actor: string,
  prepared: Awaited<ReturnType<typeof prepareManualActivation>>,
) {
  return inTransaction((client) =>
    recordActivationOutcome(
      client,
      actor,
      prepared.activationId,
      prepared.idempotencyKey,
      prepared.adapterOutcome,
    ),
  );
}

async function runLifecycleScript(scriptName: string, args: string[] = []) {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "test",
    TEST_DATABASE_URL: testDatabase.value,
  };
  delete environment.DATABASE_URL;
  delete environment.DATABASE_MIGRATION_URL;
  return execFileAsync(
    process.execPath,
    [
      "--import",
      "tsx",
      path.join(process.cwd(), "scripts", scriptName),
      "--database-target",
      "test",
      ...args,
    ],
    { cwd: process.cwd(), env: environment, timeout: 30_000 },
  );
}

before(async () => {
  pool = new ResilientPool({
    connectionString: testDatabase.value,
    max: 4,
    connectionTimeoutMillis: 15_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
  }, 3);
  const database = await pool.query<{ name: string }>(
    "SELECT current_database() AS name",
  );
  assert.equal(database.rows[0].name, testDatabase.databaseName);
  await applyMigrations(pool);
});

after(async () => {
  if (pool) await pool.end();
  await closeDatabasePool();
});

test("migration preserves legacy pending requests as visibly unassigned", async () => {
  const result = await pool.query<{ status: string; assignment_id: string | null }>(
    `SELECT request.status, assignment.id AS assignment_id
       FROM access_request request
       LEFT JOIN request_review_assignment assignment
         ON assignment.request_id = request.id
      WHERE request.id = $1`,
    [legacyPendingRequestId],
  );
  assert.deepEqual(result.rows[0], {
    status: "pending_routing",
    assignment_id: null,
  });
});

test("routing requires responsibility coverage for every requested scope", async () => {
  const requester = await seedUser("student");
  const approver = await seedUser("approver");
  const laboratory = await seedScope("r-lab", "laboratory", randomUUID());
  const software = await seedScope("r-lab", "software", randomUUID());
  await seedResponsibility(approver, "r-lab", "lab:course-software", [
    laboratory,
    software,
  ]);
  const requestId = await seedRequest(
    requester,
    "r-lab",
    "lab:course-software",
    [
      { field: "laboratory", id: laboratory },
      { field: "software", id: software },
    ],
  );
  const result = await route(requestId, requester);
  assert.equal(result.routed, true);
  assert.equal(result.routed && result.approverUserId, approver);
});

test("routing rejects a responsibility that covers only part of the scope", async () => {
  const requester = await seedUser("student");
  const approver = await seedUser("approver");
  const laboratory = await seedScope("r-lab", "laboratory", randomUUID());
  const software = await seedScope("r-lab", "software", randomUUID());
  await seedResponsibility(approver, "r-lab", "lab:course-software", [
    laboratory,
  ]);
  const requestId = await seedRequest(
    requester,
    "r-lab",
    "lab:course-software",
    [
      { field: "laboratory", id: laboratory },
      { field: "software", id: software },
    ],
  );
  const result = await route(requestId, requester);
  assert.deepEqual(result, {
    routed: false,
    reason: "no_eligible_approver",
  });
});

test("routing balances open assignments then uses stable approver UUID order", async () => {
  const requester = await seedUser("student");
  const first = await seedUser(
    "approver",
    "00000000-0000-4000-8000-000000000010",
  );
  const second = await seedUser(
    "approver",
    "00000000-0000-4000-8000-000000000020",
  );
  const firstResponsibility = await seedResponsibility(
    first,
    "r-library",
    "library:subscribed-materials",
  );
  await seedResponsibility(
    second,
    "r-library",
    "library:subscribed-materials",
  );
  const existing = await seedRequest(
    requester,
    "r-library",
    "library:subscribed-materials",
    [],
    "pending_review",
  );
  await pool.query(
    `INSERT INTO request_review_assignment
      (id, request_id, approver_user_id, responsibility_id)
     VALUES ($1,$2,$3,$4)`,
    [randomUUID(), existing, first, firstResponsibility],
  );
  const lessLoadedRequest = await seedRequest(
    requester,
    "r-library",
    "library:subscribed-materials",
  );
  const lessLoaded = await route(lessLoadedRequest);
  assert.equal(lessLoaded.routed && lessLoaded.approverUserId, second);
  const tiedRequest = await seedRequest(
    requester,
    "r-library",
    "library:subscribed-materials",
  );
  const tied = await route(tiedRequest);
  assert.equal(tied.routed && tied.approverUserId, first);
});

test("routing excludes self approval", async () => {
  const requester = await seedUser("student");
  await pool.query("INSERT INTO user_role (user_id, role) VALUES ($1,'approver')", [
    requester,
  ]);
  const course = await seedScope("r-lms", "courseSection", randomUUID());
  await seedResponsibility(requester, "r-lms", "lms:course-participation", [
    course,
  ]);
  const requestId = await seedRequest(
    requester,
    "r-lms",
    "lms:course-participation",
    [{ field: "courseSection", id: course }],
  );
  const result = await route(requestId, requester);
  assert.equal(result.routed, false);
});

test("missing approvers fail closed and preserve an unassigned request", async () => {
  const requester = await seedUser("student");
  const requestId = await seedRequest(
    requester,
    "r-student-portal",
    "portal:view-own-academic-information",
  );
  const result = await route(requestId, requester);
  assert.equal(result.routed, false);
  const stored = await pool.query<{ status: string; assignments: number }>(
    `SELECT request.status,
            count(assignment.id)::int AS assignments
       FROM access_request request
       LEFT JOIN request_review_assignment assignment
         ON assignment.request_id = request.id
      WHERE request.id = $1 GROUP BY request.id`,
    [requestId],
  );
  assert.deepEqual(stored.rows[0], {
    status: "pending_routing",
    assignments: 0,
  });
  await assert.rejects(
    () =>
      inTransaction((client) =>
        applyApprovalDecision(client, requester, {
          requestId,
          expectedVersion: 1,
          decision: "deny",
          reason: "Not eligible.",
        }),
      ),
    (error: unknown) =>
      error instanceof ApprovalDomainError &&
      error.code === "invalid_transition",
  );
});

test("approve, deny, and return transitions create terminal decision records", async () => {
  const requester = await seedUser("student");
  const approver = await seedUser("approver");
  const cases = [
    ["approve", undefined, "approved_pending_activation"],
    ["deny", "The requested access is not justified.", "denied"],
    [
      "return_for_revision",
      "Clarify the academic purpose before resubmitting.",
      "returned_for_revision",
    ],
  ] as const;
  for (const [decision, reason, expectedStatus] of cases) {
    const requestId = await seedRoutedLabRequest(requester, approver);
    const version = await requestVersion(requestId);
    const result = await inTransaction((client) =>
      applyApprovalDecision(client, approver, {
        requestId,
        expectedVersion: version,
        decision,
        reason,
      }),
    );
    assert.equal(result.status, expectedStatus);
    const stored = await pool.query<{ status: string; decision_count: number }>(
      `SELECT request.status, count(decision.id)::int AS decision_count
         FROM access_request request
         LEFT JOIN request_decision decision ON decision.request_id = request.id
        WHERE request.id = $1 GROUP BY request.id`,
      [requestId],
    );
    assert.deepEqual(stored.rows[0], {
      status: expectedStatus,
      decision_count: 1,
    });
  }
});

test("invalid, duplicate, and stale decisions are rejected", async () => {
  const requester = await seedUser("student");
  const approver = await seedUser("approver");
  const requestId = await seedRoutedLabRequest(requester, approver);
  const version = await requestVersion(requestId);
  const unassignedAdmin = await seedUser("admin");
  await seedResponsibility(
    unassignedAdmin,
    "r-lab",
    "lab:course-software",
  );
  await assert.rejects(
    () =>
      inTransaction((client) =>
        applyApprovalDecision(client, unassignedAdmin, {
          requestId,
          expectedVersion: version,
          decision: "approve",
        }),
      ),
    (error: unknown) =>
      error instanceof ApprovalDomainError && error.code === "not_assigned",
  );
  await assert.rejects(
    () =>
      inTransaction((client) =>
        applyApprovalDecision(client, approver, {
          requestId,
          expectedVersion: version,
          decision: "deny",
          reason: "   ",
        }),
      ),
    (error: unknown) =>
      error instanceof ApprovalDomainError && error.code === "invalid_reason",
  );
  await inTransaction((client) =>
    applyApprovalDecision(client, approver, {
      requestId,
      expectedVersion: version,
      decision: "approve",
    }),
  );
  await assert.rejects(
    () =>
      inTransaction((client) =>
        applyApprovalDecision(client, approver, {
          requestId,
          expectedVersion: version,
          decision: "approve",
        }),
      ),
    (error: unknown) =>
      error instanceof ApprovalDomainError && error.code === "stale_decision",
  );
  await assert.rejects(
    () =>
      inTransaction((client) =>
        applyApprovalDecision(client, approver, {
          requestId,
          expectedVersion: version + 1,
          decision: "approve",
        }),
      ),
    (error: unknown) =>
      error instanceof ApprovalDomainError &&
      error.code === "invalid_transition",
  );
});

test("optimistic concurrency permits exactly one competing decision", async () => {
  const requester = await seedUser("student");
  const approver = await seedUser("approver");
  const requestId = await seedRoutedLabRequest(requester, approver);
  const version = await requestVersion(requestId);
  const results = await Promise.allSettled([
    inTransaction((client) =>
      applyApprovalDecision(client, approver, {
        requestId,
        expectedVersion: version,
        decision: "approve",
      }),
    ),
    inTransaction((client) =>
      applyApprovalDecision(client, approver, {
        requestId,
        expectedVersion: version,
        decision: "deny",
        reason: "A concurrent denial must lose the race.",
      }),
    ),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  const decisions = await pool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM request_decision WHERE request_id = $1",
    [requestId],
  );
  assert.equal(decisions.rows[0].count, 1);
});

test("decision and audit creation are atomic", async () => {
  const requester = await seedUser("student");
  const approver = await seedUser("approver");
  const requestId = await seedRoutedLabRequest(requester, approver);
  const version = await requestVersion(requestId);
  await pool.query(`CREATE FUNCTION fail_review_audit_insert()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.event_type LIKE 'review_%' THEN
        RAISE EXCEPTION 'forced audit failure';
      END IF;
      RETURN NEW;
    END;
  $$`);
  await pool.query(`CREATE TRIGGER test_fail_review_audit
    BEFORE INSERT ON audit_event
    FOR EACH ROW EXECUTE FUNCTION fail_review_audit_insert()`);
  try {
    await assert.rejects(() =>
      inTransaction((client) =>
        applyApprovalDecision(client, approver, {
          requestId,
          expectedVersion: version,
          decision: "approve",
        }),
      ),
    );
  } finally {
    await pool.query("DROP TRIGGER test_fail_review_audit ON audit_event");
    await pool.query("DROP FUNCTION fail_review_audit_insert() ");
  }
  const stored = await pool.query<{
    status: string;
    decisions: number;
    review_events: number;
  }>(
    `SELECT request.status,
            (SELECT count(*)::int FROM request_decision WHERE request_id = request.id) AS decisions,
            (SELECT count(*)::int FROM request_event
              WHERE request_id = request.id AND event_type LIKE 'review_%') AS review_events
       FROM access_request request WHERE request.id = $1`,
    [requestId],
  );
  assert.deepEqual(stored.rows[0], {
    status: "pending_review",
    decisions: 0,
    review_events: 0,
  });
});

test("reconciliation preview is read-only and apply preserves unrouteable records", async () => {
  const requester = await seedUser("student");
  const approver = await seedUser("approver");
  await seedResponsibility(
    approver,
    "r-library",
    "library:subscribed-materials",
  );
  const routeable = await seedRequest(
    requester,
    "r-library",
    "library:subscribed-materials",
  );
  const unrouteable = await seedRequest(
    requester,
    "r-student-portal",
    "portal:view-own-academic-information",
  );
  const previewClient = await pool.connect();
  try {
    assert.ok(await previewRequestRoute(previewClient, routeable));
    assert.equal(await previewRequestRoute(previewClient, unrouteable), null);
  } finally {
    previewClient.release();
  }
  const before = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM request_review_assignment
      WHERE request_id = ANY($1::uuid[])`,
    [[routeable, unrouteable]],
  );
  assert.equal(before.rows[0].count, 0);
  assert.equal((await route(routeable)).routed, true);
  assert.equal((await route(unrouteable)).routed, false);
  const preserved = await pool.query<{ status: string; assignment_id: string | null }>(
    `SELECT request.status, assignment.id AS assignment_id
       FROM access_request request
       LEFT JOIN request_review_assignment assignment
         ON assignment.request_id = request.id
      WHERE request.id = $1`,
    [unrouteable],
  );
  assert.deepEqual(preserved.rows[0], {
    status: "pending_routing",
    assignment_id: null,
  });
});

test("activation start prevents duplicate lifecycle records per request", async () => {
  const { requestId, actor } = await seedApprovedActivationRequest();
  const attempts = await Promise.allSettled([
    inTransaction((client) =>
      startActivationAttempt(client, actor, {
        requestId,
        idempotencyKey: randomUUID(),
      }),
    ),
    inTransaction((client) =>
      startActivationAttempt(client, actor, {
        requestId,
        idempotencyKey: randomUUID(),
      }),
    ),
  ]);
  const started = attempts.filter((result) => result.status === "fulfilled");
  const rejected = attempts.find((result) => result.status === "rejected");
  assert.equal(started.length, 1);
  assert.ok(rejected && rejected.status === "rejected");
  assert.ok(rejected.reason instanceof ActivationDomainError);
  assert.equal(rejected.reason.code, "activation_in_progress");

  const activation = await pool.query<{
    id: string;
    decision_id: string;
    actor_user_id: string;
  }>(
    `SELECT id, decision_id, actor_user_id
       FROM request_activation WHERE request_id = $1`,
    [requestId],
  );
  assert.equal(activation.rows.length, 1);
  await assert.rejects(
    pool.query(
      `INSERT INTO request_activation
        (id, request_id, decision_id, status, adapter_name, actor_user_id,
         idempotency_key, expires_at)
       SELECT $2, request_id, decision_id, 'activating', 'manual-admin',
              actor_user_id, $3, now() + interval '1 day'
         FROM request_activation WHERE id = $1`,
      [activation.rows[0].id, randomUUID(), randomUUID()],
    ),
    (error: unknown) =>
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505",
  );
});

test("activation start replays the same actor idempotency key", async () => {
  const { requestId, actor } = await seedApprovedActivationRequest();
  const idempotencyKey = randomUUID();
  const first = await inTransaction((client) =>
    startActivationAttempt(client, actor, { requestId, idempotencyKey }),
  );
  const replay = await inTransaction((client) =>
    startActivationAttempt(client, actor, { requestId, idempotencyKey }),
  );
  assert.deepEqual(replay, { ...first, replayed: true });
  assert.equal(replay.failureCode, null);
  assert.equal(replay.retryable, null);

  const otherRequest = await seedApprovedActivationRequest();
  await assert.rejects(
    inTransaction((client) =>
      startActivationAttempt(client, actor, {
        requestId: otherRequest.requestId,
        idempotencyKey,
      }),
    ),
    (error: unknown) =>
      error instanceof ActivationDomainError &&
      error.code === "idempotency_conflict",
  );

  const counts = await pool.query<{
    activations: number;
    started_events: number;
  }>(
    `SELECT
       (SELECT count(*)::int FROM request_activation WHERE request_id = $1) AS activations,
       (SELECT count(*)::int FROM activation_event
         WHERE activation_id = $2 AND event_type = 'activation_started') AS started_events`,
    [requestId, first.activationId],
  );
  assert.deepEqual(counts.rows[0], { activations: 1, started_events: 1 });
});

test("a new idempotency key starts a fresh attempt after failure", async () => {
  const { requestId, actor } = await seedApprovedActivationRequest();
  const firstKey = randomUUID();
  const first = await inTransaction((client) =>
    startActivationAttempt(client, actor, {
      requestId,
      idempotencyKey: firstKey,
    }),
  );
  await pool.query(
    `UPDATE request_activation
        SET status = 'failed', failure_code = 'adapter_failure'
      WHERE id = $1`,
    [first.activationId],
  );
  await pool.query(
    `INSERT INTO activation_event
      (id, activation_id, actor_user_id, event_type, detail, metadata)
     VALUES ($1,$2,$3,'activation_failed','Simulated failed activation.',
             '{"attemptCount":1,"failureCode":"adapter_failure","retryable":true}'::jsonb)`,
    [randomUUID(), first.activationId, actor],
  );

  const retryKey = randomUUID();
  const retry = await inTransaction((client) =>
    startActivationAttempt(client, actor, {
      requestId,
      idempotencyKey: retryKey,
    }),
  );
  assert.deepEqual(retry, {
    activationId: first.activationId,
    status: "activating",
    attemptCount: 2,
    replayed: false,
    failureCode: null,
    retryable: null,
  });

  const originalReplay = await inTransaction((client) =>
    startActivationAttempt(client, actor, {
      requestId,
      idempotencyKey: firstKey,
    }),
  );
  assert.deepEqual(originalReplay, { ...first, replayed: true });
  const stored = await pool.query<{
    status: string;
    attempt_count: number;
    event_count: number;
  }>(
    `SELECT activation.status, activation.attempt_count,
            (SELECT count(*)::int FROM activation_event event
              WHERE event.activation_id = activation.id) AS event_count
       FROM request_activation activation WHERE activation.id = $1`,
    [first.activationId],
  );
  assert.deepEqual(stored.rows[0], {
    status: "activating",
    attempt_count: 2,
    event_count: 3,
  });
});

test("manual activation succeeds after transaction one commits", async () => {
  const { requestId, actor } = await seedApprovedActivationRequest();
  let adapterObservedCommittedStart = false;
  const manualAdapter = new ManualAdminActivationAdapter();
  const observingAdapter: ActivationAdapter<ManualActivationContext> = {
    name: manualAdapter.name,
    async activate(context) {
      const committed = await pool.query<{
        status: string;
        started_events: number;
      }>(
        `SELECT activation.status,
                (SELECT count(*)::int FROM activation_event event
                  WHERE event.activation_id = activation.id
                    AND event.event_type = 'activation_started') AS started_events
           FROM request_activation activation WHERE activation.id = $1`,
        [context.activationId],
      );
      adapterObservedCommittedStart =
        committed.rows[0]?.status === "activating" &&
        committed.rows[0]?.started_events === 1;
      return manualAdapter.activate(context);
    },
  };
  const prepared = await prepareManualActivation(
    requestId,
    actor,
    {
      provisioned: true,
      externalReference: "ITSM-REQ-7821",
      evidence: "Library administrator confirmed access in the e-resources console.",
    },
    observingAdapter,
  );
  const completed = await recordManualActivationOutcome(actor, prepared);
  const replayedCompletion = await recordManualActivationOutcome(actor, prepared);

  assert.equal(adapterObservedCommittedStart, true);
  assert.equal(completed.status, "activated");
  assert.equal(replayedCompletion.status, "activated");
  assert.equal(replayedCompletion.replayed, true);
  const stored = await pool.query<{
    approval_status: string;
    activation_status: string;
    entitlement_count: number;
    activation_success_events: number;
    request_success_events: number;
    audit_success_events: number;
    success_notifications: number;
    recorded_evidence: string;
  }>(
    `SELECT request.status AS approval_status,
            activation.status AS activation_status,
            (SELECT count(*)::int FROM ordinary_entitlement entitlement
              WHERE entitlement.user_id = request.requester_user_id
                AND entitlement.resource_id = request.resource_id
                AND entitlement.permission_id = request.permission_id
                AND entitlement.scope_fingerprint = request.scope_fingerprint) AS entitlement_count,
            (SELECT count(*)::int FROM activation_event event
              WHERE event.activation_id = activation.id
                AND event.event_type = 'activation_succeeded') AS activation_success_events,
            (SELECT count(*)::int FROM request_event event
              WHERE event.request_id = request.id
                AND event.event_type = 'activation_succeeded') AS request_success_events,
            (SELECT count(*)::int FROM audit_event event
              WHERE event.request_id = request.id
                AND event.event_type = 'activation_succeeded') AS audit_success_events,
            (SELECT count(*)::int FROM user_notification notification
              WHERE notification.request_id = request.id
                AND notification.notification_type = 'activation_succeeded') AS success_notifications,
            (SELECT evidence FROM ordinary_entitlement entitlement
              WHERE entitlement.user_id = request.requester_user_id
                AND entitlement.resource_id = request.resource_id
                AND entitlement.permission_id = request.permission_id
                AND entitlement.scope_fingerprint = request.scope_fingerprint
              LIMIT 1) AS recorded_evidence
       FROM access_request request
       JOIN request_activation activation ON activation.request_id = request.id
      WHERE request.id = $1`,
    [requestId],
  );
  assert.deepEqual(
    {
      approval_status: stored.rows[0].approval_status,
      activation_status: stored.rows[0].activation_status,
      entitlement_count: stored.rows[0].entitlement_count,
      activation_success_events: stored.rows[0].activation_success_events,
      request_success_events: stored.rows[0].request_success_events,
      audit_success_events: stored.rows[0].audit_success_events,
      success_notifications: stored.rows[0].success_notifications,
    },
    {
      approval_status: "approved_pending_activation",
      activation_status: "activated",
      entitlement_count: 1,
      activation_success_events: 1,
      request_success_events: 1,
      audit_success_events: 1,
      success_notifications: 1,
    },
  );
  assert.match(stored.rows[0].recorded_evidence, /ITSM-REQ-7821/);
  assert.match(stored.rows[0].recorded_evidence, /Library administrator confirmed/);
  const adminQueue = await listAdministratorActivations();
  const queueItem = adminQueue.find((item) => item.requestId === requestId);
  assert.equal(queueItem?.approvalStatus, "approved_pending_activation");
  assert.equal(queueItem?.activationStatus, "activated");
  assert.equal(queueItem?.retryable, null);
});

test("activation revalidation rejects inactive requester and separation-of-duties actors", async () => {
  const unauthorized = await seedApprovedActivationRequest();
  await assert.rejects(
    inTransaction((client) =>
      prepareApprovedActivation(client, unauthorized.approver, {
        requestId: unauthorized.requestId,
        idempotencyKey: randomUUID(),
      }),
    ),
    (error: unknown) =>
      error instanceof ActivationDomainError && error.code === "not_authorized",
  );

  const inactive = await seedApprovedActivationRequest();
  await pool.query("UPDATE user_profile SET active = false WHERE user_id = $1", [
    inactive.requester,
  ]);
  await assert.rejects(
    inTransaction((client) =>
      prepareApprovedActivation(client, inactive.actor, {
        requestId: inactive.requestId,
        idempotencyKey: randomUUID(),
      }),
    ),
    (error: unknown) =>
      error instanceof ActivationDomainError &&
      error.code === "activation_revalidation_failed",
  );

  const selfActivation = await seedApprovedActivationRequest();
  await pool.query("INSERT INTO user_role (user_id, role) VALUES ($1,'admin')", [
    selfActivation.requester,
  ]);
  await assert.rejects(
    inTransaction((client) =>
      prepareApprovedActivation(client, selfActivation.requester, {
        requestId: selfActivation.requestId,
        idempotencyKey: randomUUID(),
      }),
    ),
    (error: unknown) =>
      error instanceof ActivationDomainError &&
      error.code === "activation_forbidden",
  );

  const approverActivation = await seedApprovedActivationRequest();
  await pool.query("INSERT INTO user_role (user_id, role) VALUES ($1,'admin')", [
    approverActivation.approver,
  ]);
  await assert.rejects(
    inTransaction((client) =>
      prepareApprovedActivation(client, approverActivation.approver, {
        requestId: approverActivation.requestId,
        idempotencyKey: randomUUID(),
      }),
    ),
    (error: unknown) =>
      error instanceof ActivationDomainError &&
      error.code === "activation_forbidden",
  );
});

test("activation fails closed when an overlapping entitlement exists", async () => {
  const { requestId, requester, actor } = await seedApprovedActivationRequest();
  await pool.query(
    `INSERT INTO ordinary_entitlement
      (id, user_id, resource_id, permission_id, scope_fingerprint,
       evidence, valid_from, valid_until, recorded_by)
     SELECT $2, requester_user_id, resource_id, permission_id, scope_fingerprint,
            'Conflicting entitlement fixture', starts_at + interval '1 day',
            expires_at - interval '1 day', $3
       FROM access_request WHERE id = $1`,
    [requestId, randomUUID(), actor],
  );
  const idempotencyKey = randomUUID();
  await assert.rejects(
    inTransaction((client) =>
      prepareApprovedActivation(client, actor, { requestId, idempotencyKey }),
    ),
    (error: unknown) =>
      error instanceof ActivationDomainError &&
      error.code === "activation_conflict",
  );
  const activations = await pool.query(
    "SELECT 1 FROM request_activation WHERE request_id = $1",
    [requestId],
  );
  assert.equal(activations.rows.length, 0);
  assert.ok(requester);
});

test("manual negative confirmation records failure without granting entitlement", async () => {
  const { requestId, actor } = await seedApprovedActivationRequest();
  const prepared = await prepareManualActivation(requestId, actor, {
    provisioned: false,
  });
  const completed = await recordManualActivationOutcome(actor, prepared);
  assert.equal(completed.status, "failed");

  const stored = await pool.query<{
    status: string;
    entitlements: number;
    activation_events: number;
    request_events: number;
    audit_events: number;
    notifications: number;
  }>(
    `SELECT activation.status,
            (SELECT count(*)::int FROM ordinary_entitlement entitlement
              WHERE entitlement.user_id = request.requester_user_id
                AND entitlement.resource_id = request.resource_id
                AND entitlement.permission_id = request.permission_id
                AND entitlement.scope_fingerprint = request.scope_fingerprint) AS entitlements,
            (SELECT count(*)::int FROM activation_event event
              WHERE event.activation_id = activation.id
                AND event.event_type = 'activation_failed') AS activation_events,
            (SELECT count(*)::int FROM request_event event
              WHERE event.request_id = request.id
                AND event.event_type = 'activation_failed') AS request_events,
            (SELECT count(*)::int FROM audit_event event
              WHERE event.request_id = request.id
                AND event.event_type = 'activation_failed') AS audit_events,
            (SELECT count(*)::int FROM user_notification notification
              WHERE notification.request_id = request.id
                AND notification.notification_type = 'activation_failed') AS notifications
       FROM request_activation activation
       JOIN access_request request ON request.id = activation.request_id
      WHERE activation.id = $1`,
    [prepared.activationId],
  );
  assert.deepEqual(stored.rows[0], {
    status: "failed",
    entitlements: 0,
    activation_events: 1,
    request_events: 1,
    audit_events: 1,
    notifications: 1,
  });
});

test("definitive adapter failure notifies and blocks a fresh retry", async () => {
  const { requestId, actor } = await seedApprovedActivationRequest();
  const definitiveAdapter: ActivationAdapter<ManualActivationContext> = {
    name: "manual-admin",
    async activate() {
      return {
        outcome: "failure",
        failureCode: "manual_provisioning_not_confirmed",
        message: "The target system rejected the provisioning request.",
        retryable: false,
      };
    },
  };
  const prepared = await prepareManualActivation(
    requestId,
    actor,
    { provisioned: false },
    definitiveAdapter,
  );
  const completed = await recordManualActivationOutcome(actor, prepared);
  const replayed = await recordManualActivationOutcome(actor, prepared);
  assert.equal(completed.status, "failed");
  assert.equal(completed.retryable, false);
  assert.equal(replayed.replayed, true);
  assert.equal(replayed.failureCode, "manual_provisioning_not_confirmed");

  const stored = await pool.query<{
    status: string;
    retryable: string;
    notifications: number;
  }>(
    `SELECT activation.status, event.metadata ->> 'retryable' AS retryable,
            (SELECT count(*)::int FROM user_notification notification
              WHERE notification.request_id = activation.request_id
                AND notification.notification_type = 'activation_failed') AS notifications
       FROM request_activation activation
       JOIN activation_event event ON event.activation_id = activation.id
        AND event.event_type = 'activation_failed'
      WHERE activation.id = $1`,
    [prepared.activationId],
  );
  assert.deepEqual(stored.rows[0], {
    status: "failed",
    retryable: "false",
    notifications: 1,
  });
  await assert.rejects(
    inTransaction((client) =>
      prepareApprovedActivation(client, actor, {
        requestId,
        idempotencyKey: randomUUID(),
      }),
    ),
    (error: unknown) =>
      error instanceof ActivationDomainError && error.code === "invalid_transition",
  );
});

test("activation outcome events and notifications commit atomically", async () => {
  const cases = [
    {
      notificationType: "activation_succeeded",
      confirmation: {
        provisioned: true,
        evidence: "Confirmed by the library administrator.",
      },
    },
    {
      notificationType: "activation_failed",
      confirmation: { provisioned: false },
    },
  ] as const;

  for (const scenario of cases) {
    const { requestId, actor } = await seedApprovedActivationRequest();
    const prepared = await prepareManualActivation(
      requestId,
      actor,
      scenario.confirmation,
    );
    await pool.query(`CREATE FUNCTION fail_activation_notification_insert()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.notification_type IN ('activation_succeeded','activation_failed') THEN
          RAISE EXCEPTION 'forced activation notification failure';
        END IF;
        RETURN NEW;
      END;
    $$`);
    await pool.query(`CREATE TRIGGER test_fail_activation_notification
      BEFORE INSERT ON user_notification
      FOR EACH ROW EXECUTE FUNCTION fail_activation_notification_insert()`);
    try {
      await assert.rejects(
        recordManualActivationOutcome(actor, prepared),
        /forced activation notification failure/,
      );
    } finally {
      await pool.query(
        "DROP TRIGGER test_fail_activation_notification ON user_notification",
      );
      await pool.query("DROP FUNCTION fail_activation_notification_insert()");
    }

    const persisted = await pool.query<{
      status: string;
      entitlements: number;
      activation_outcomes: number;
      request_outcomes: number;
      audit_outcomes: number;
      outcome_notifications: number;
    }>(
      `SELECT activation.status,
              (SELECT count(*)::int FROM ordinary_entitlement entitlement
                WHERE entitlement.user_id = request.requester_user_id
                  AND entitlement.resource_id = request.resource_id
                  AND entitlement.permission_id = request.permission_id
                  AND entitlement.scope_fingerprint = request.scope_fingerprint) AS entitlements,
              (SELECT count(*)::int FROM activation_event event
                WHERE event.activation_id = activation.id
                  AND event.event_type IN ('activation_succeeded','activation_failed')) AS activation_outcomes,
              (SELECT count(*)::int FROM request_event event
                WHERE event.request_id = request.id
                  AND event.event_type IN ('activation_succeeded','activation_failed')) AS request_outcomes,
              (SELECT count(*)::int FROM audit_event event
                WHERE event.request_id = request.id
                  AND event.event_type IN ('activation_succeeded','activation_failed')) AS audit_outcomes,
              (SELECT count(*)::int FROM user_notification notification
                WHERE notification.request_id = request.id
                  AND notification.notification_type IN ('activation_succeeded','activation_failed')) AS outcome_notifications
         FROM request_activation activation
         JOIN access_request request ON request.id = activation.request_id
        WHERE request.id = $1`,
      [requestId],
    );
    assert.deepEqual(persisted.rows[0], {
      status: "activating",
      entitlements: 0,
      activation_outcomes: 0,
      request_outcomes: 0,
      audit_outcomes: 0,
      outcome_notifications: 0,
    });
    assert.equal(scenario.notificationType.endsWith("failed"), scenario.confirmation.provisioned === false);
  }
});

test("stuck activation reconciliation previews then applies and allows a retry", async () => {
  const { requestId, actor } = await seedApprovedActivationRequest();
  const prepared = await inTransaction((client) =>
    prepareApprovedActivation(client, actor, {
      requestId,
      idempotencyKey: randomUUID(),
    }),
  );
  await pool.query(
    "UPDATE request_activation SET last_attempt_at = now() - interval '16 minutes' WHERE id = $1",
    [prepared.result.activationId],
  );

  const preview = await runLifecycleScript("reconcile-activations.ts");
  assert.match(preview.stdout, /Dry run: 1 activation\(s\).*No changes made/);
  const beforeApply = await pool.query<{ status: string }>(
    "SELECT status FROM request_activation WHERE id = $1",
    [prepared.result.activationId],
  );
  assert.equal(beforeApply.rows[0].status, "activating");

  const applied = await runLifecycleScript("reconcile-activations.ts", ["--apply"]);
  assert.match(applied.stdout, /1 marked failed/);
  const failed = await pool.query<{
    status: string;
    failure_code: string;
    retryable: string;
    notifications: number;
  }>(
    `SELECT activation.status, activation.failure_code,
            event.metadata ->> 'retryable' AS retryable,
            (SELECT count(*)::int FROM user_notification notification
              WHERE notification.request_id = activation.request_id
                AND notification.notification_type = 'activation_failed') AS notifications
       FROM request_activation activation
       JOIN activation_event event ON event.activation_id = activation.id
        AND event.event_type = 'activation_failed'
      WHERE activation.id = $1`,
    [prepared.result.activationId],
  );
  assert.deepEqual(failed.rows[0], {
    status: "failed",
    failure_code: "activation_attempt_timeout",
    retryable: "true",
    notifications: 1,
  });

  const retry = await inTransaction((client) =>
    prepareApprovedActivation(client, actor, {
      requestId,
      idempotencyKey: randomUUID(),
    }),
  );
  assert.equal(retry.result.attemptCount, 2);
  assert.equal(retry.result.status, "activating");
});

test("stuck activation with changed policy fails closed and cannot be retried", async () => {
  const { requestId, actor } = await seedApprovedActivationRequest();
  const approvedPolicy = await pool.query<{ policy_version_id: string }>(
    "SELECT policy_version_id FROM access_request WHERE id = $1",
    [requestId],
  );
  const newPolicyId = randomUUID();
  const prepared = await inTransaction((client) =>
    prepareApprovedActivation(client, actor, {
      requestId,
      idempotencyKey: randomUUID(),
    }),
  );
  await pool.query(
    "UPDATE request_activation SET last_attempt_at = now() - interval '16 minutes' WHERE id = $1",
    [prepared.result.activationId],
  );
  await pool.query(
    "UPDATE catalog_policy_version SET effective_until = now() WHERE id = $1",
    [approvedPolicy.rows[0].policy_version_id],
  );
  await pool.query(
    `INSERT INTO catalog_policy_version
      (id, resource_id, version, effective_from, default_days, max_days, renewable, policy_note)
     SELECT $2, resource_id, version + 1, now(), default_days, max_days,
            renewable, 'Activation lifecycle test policy version'
       FROM catalog_policy_version WHERE id = $1`,
    [approvedPolicy.rows[0].policy_version_id, newPolicyId],
  );
  try {
    const applied = await runLifecycleScript("reconcile-activations.ts", ["--apply"]);
    assert.match(applied.stdout, /1 marked failed/);
    const event = await pool.query<{
      failure_code: string;
      retryable: string;
      detail: string;
    }>(
      `SELECT activation.failure_code,
              event.metadata ->> 'retryable' AS retryable,
              event.detail
         FROM request_activation activation
         JOIN activation_event event ON event.activation_id = activation.id
          AND event.event_type = 'activation_failed'
        WHERE activation.id = $1`,
      [prepared.result.activationId],
    );
    assert.equal(event.rows[0].failure_code, "activation_revalidation_failed");
    assert.equal(event.rows[0].retryable, "false");
    assert.match(event.rows[0].detail, /policy version is no longer current/);
    await assert.rejects(
      inTransaction((client) =>
        prepareApprovedActivation(client, actor, {
          requestId,
          idempotencyKey: randomUUID(),
        }),
      ),
      (error: unknown) =>
        error instanceof ActivationDomainError && error.code === "invalid_transition",
    );
  } finally {
    await pool.query(
      "DELETE FROM catalog_policy_version WHERE id = $1",
      [newPolicyId],
    );
    await pool.query(
      "UPDATE catalog_policy_version SET effective_until = NULL WHERE id = $1",
      [approvedPolicy.rows[0].policy_version_id],
    );
  }
});

test("expiry CLI previews without writes then expires terminal activations", async () => {
  const { requestId, actor } = await seedApprovedActivationRequest();
  const prepared = await prepareManualActivation(requestId, actor, {
    provisioned: true,
    evidence: "Confirmed and later expired for the lifecycle fixture.",
  });
  await recordManualActivationOutcome(actor, prepared);
  await pool.query(
    `UPDATE access_request
        SET starts_at = now() - interval '2 days', expires_at = now() - interval '1 day'
      WHERE id = $1`,
    [requestId],
  );
  await pool.query(
    `UPDATE ordinary_entitlement SET valid_from = now() - interval '2 days',
            valid_until = now() - interval '1 day'
      WHERE user_id = (SELECT requester_user_id FROM access_request WHERE id = $1)
        AND resource_id = 'r-library'
        AND permission_id = 'library:subscribed-materials'`,
    [requestId],
  );
  await pool.query(
    "UPDATE request_activation SET expires_at = now() - interval '1 day' WHERE id = $1",
    [prepared.activationId],
  );

  const preview = await runLifecycleScript("expire-activations.ts");
  assert.match(preview.stdout, /Dry run: 1 activated entitlement\(s\).*No changes made/);
  const beforeApply = await pool.query<{ status: string }>(
    "SELECT status FROM request_activation WHERE id = $1",
    [prepared.activationId],
  );
  assert.equal(beforeApply.rows[0].status, "activated");

  const applied = await runLifecycleScript("expire-activations.ts", ["--apply"]);
  assert.match(applied.stdout, /1 activation\(s\) moved to expired/);
  const repeated = await inTransaction((client) =>
    expireActivatedEntitlement(client, prepared.activationId),
  );
  assert.equal(repeated.expired, false);
  const final = await pool.query<{ status: string; expired_events: number }>(
    `SELECT activation.status,
            (SELECT count(*)::int FROM activation_event event
              WHERE event.activation_id = activation.id
                AND event.event_type = 'activation_expired') AS expired_events
       FROM request_activation activation WHERE activation.id = $1`,
    [prepared.activationId],
  );
  assert.deepEqual(final.rows[0], { status: "expired", expired_events: 1 });
});

test("administrator revocation closes the entitlement and cannot overwrite terminal state", async () => {
  const { requestId, actor } = await seedApprovedActivationRequest();
  const prepared = await prepareManualActivation(requestId, actor, {
    provisioned: true,
    externalReference: "ITSM-REVOCATION-1001",
  });
  await recordManualActivationOutcome(actor, prepared);

  const revoked = await inTransaction((client) =>
    revokeActivatedEntitlement(
      client,
      actor,
      prepared.activationId,
      "The project assignment ended early.",
    ),
  );
  assert.equal(revoked, true);
  const secondRevoke = await inTransaction((client) =>
    revokeActivatedEntitlement(
      client,
      actor,
      prepared.activationId,
      "Duplicate revocation must not rewrite history.",
    ),
  );
  assert.equal(secondRevoke, false);
  const expiry = await inTransaction((client) =>
    expireActivatedEntitlement(client, prepared.activationId),
  );
  assert.equal(expiry.expired, false);
  const state = await pool.query<{
    status: string;
    entitlement_valid_until: Date | null;
    revocation_events: number;
  }>(
    `SELECT activation.status, entitlement.valid_until AS entitlement_valid_until,
            (SELECT count(*)::int FROM activation_event event
              WHERE event.activation_id = activation.id
                AND event.event_type = 'activation_revoked') AS revocation_events
       FROM request_activation activation
       LEFT JOIN LATERAL (
         SELECT success.metadata ->> 'entitlementId' AS entitlement_id
           FROM activation_event success
          WHERE success.activation_id = activation.id
            AND success.event_type = 'activation_succeeded'
          ORDER BY success.occurred_at DESC, success.id DESC LIMIT 1
       ) success ON true
       LEFT JOIN ordinary_entitlement entitlement ON entitlement.id = success.entitlement_id::uuid
      WHERE activation.id = $1`,
    [prepared.activationId],
  );
  assert.equal(state.rows[0].status, "revoked");
  assert.equal(state.rows[0].entitlement_valid_until, null);
  assert.equal(state.rows[0].revocation_events, 1);
});

test("renewal submission creates a new request lifecycle", async () => {
  const requester = await seedUser("student");
  const oldRequestId = await seedRequest(
    requester,
    "r-library",
    "library:subscribed-materials",
  );
  await pool.query(
    `UPDATE access_request
        SET status = 'expired', starts_at = now() - interval '14 days',
            expires_at = now() - interval '7 days'
      WHERE id = $1`,
    [oldRequestId],
  );
  const start = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  const end = new Date(Date.now() + 32 * 86_400_000).toISOString().slice(0, 10);
  const renewal = await createAccessRequest(
    {
      id: requester,
      name: "Renewal fixture",
      email: `${requester}@permora.test`,
      department: "Test",
      active: true,
      roles: ["student"],
      requesterRole: "student",
    },
    {
      resourceId: "r-library",
      permissionId: "library:subscribed-materials",
      purpose: "Renew library access for the upcoming research period.",
      startsAt: start,
      expiresAt: end,
      renewalOf: oldRequestId,
    },
  );
  assert.notEqual(renewal.id, oldRequestId);
  const records = await pool.query<{
    id: string;
    renewal_of: string | null;
    status: string;
  }>(
    `SELECT id, renewal_of, status FROM access_request
      WHERE id = ANY($1::uuid[]) ORDER BY id`,
    [[oldRequestId, renewal.id]],
  );
  assert.equal(records.rows.length, 2);
  const oldRecord = records.rows.find((row) => row.id === oldRequestId);
  const newRecord = records.rows.find((row) => row.id === renewal.id);
  assert.equal(oldRecord?.status, "expired");
  assert.equal(oldRecord?.renewal_of, null);
  assert.equal(newRecord?.renewal_of, oldRequestId);
  assert.notEqual(newRecord?.status, "expired");
  const activations = await pool.query(
    "SELECT request_id FROM request_activation WHERE request_id = ANY($1::uuid[])",
    [[oldRequestId, renewal.id]],
  );
  assert.equal(activations.rows.length, 0);
});

test("end-to-end activation lifecycle covers failure, retry, expiry, renewal, and revocation", async () => {
  const expiring = await seedApprovedActivationRequest("library");
  const firstAttempt = await prepareManualActivation(expiring.requestId, expiring.actor, {
    provisioned: false,
  });
  const firstOutcome = await recordManualActivationOutcome(
    expiring.actor,
    firstAttempt,
  );
  assert.equal(firstOutcome.status, "failed");
  assert.equal(firstOutcome.retryable, true);

  const retry = await prepareManualActivation(expiring.requestId, expiring.actor, {
    provisioned: true,
    externalReference: "ITSM-LIFECYCLE-RETRY",
  });
  assert.equal(retry.activationId, firstAttempt.activationId);
  assert.notEqual(retry.idempotencyKey, firstAttempt.idempotencyKey);
  assert.equal(retry.attemptCount, 2);
  const success = await recordManualActivationOutcome(expiring.actor, retry);
  assert.equal(success.status, "activated");

  const retryHistory = await pool.query<{
    status: string;
    attempts: number;
    failures: number;
    successes: number;
    failure_notifications: number;
    success_notifications: number;
  }>(
    `SELECT activation.status, activation.attempt_count AS attempts,
            (SELECT count(*)::int FROM activation_event event
              WHERE event.activation_id = activation.id
                AND event.event_type = 'activation_failed') AS failures,
            (SELECT count(*)::int FROM activation_event event
              WHERE event.activation_id = activation.id
                AND event.event_type = 'activation_succeeded') AS successes,
            (SELECT count(*)::int FROM user_notification notification
              WHERE notification.request_id = activation.request_id
                AND notification.notification_type = 'activation_failed') AS failure_notifications,
            (SELECT count(*)::int FROM user_notification notification
              WHERE notification.request_id = activation.request_id
                AND notification.notification_type = 'activation_succeeded') AS success_notifications
       FROM request_activation activation WHERE activation.id = $1`,
    [retry.activationId],
  );
  assert.deepEqual(retryHistory.rows[0], {
    status: "activated",
    attempts: 2,
    failures: 1,
    successes: 1,
    failure_notifications: 1,
    success_notifications: 1,
  });

  await pool.query(
    `UPDATE access_request
        SET starts_at = now() - interval '2 days', expires_at = now() - interval '1 day'
      WHERE id = $1`,
    [expiring.requestId],
  );
  await pool.query(
    `UPDATE ordinary_entitlement SET valid_from = now() - interval '2 days',
            valid_until = now() - interval '1 day'
      WHERE id = (SELECT event.metadata ->> 'entitlementId'
                    FROM activation_event event
                   WHERE event.activation_id = $1
                     AND event.event_type = 'activation_succeeded')::uuid`,
    [retry.activationId],
  );
  await pool.query(
    "UPDATE request_activation SET expires_at = now() - interval '1 day' WHERE id = $1",
    [retry.activationId],
  );
  const expired = await inTransaction((client) =>
    expireActivatedEntitlement(client, retry.activationId),
  );
  assert.equal(expired.expired, true);
  const approvedStatus = await pool.query<{ status: string; activation_status: string }>(
    `SELECT request.status, activation.status AS activation_status
       FROM access_request request
       JOIN request_activation activation ON activation.request_id = request.id
      WHERE request.id = $1`,
    [expiring.requestId],
  );
  assert.deepEqual(approvedStatus.rows[0], {
    status: "approved_pending_activation",
    activation_status: "expired",
  });

  const renewalStart = new Date(Date.now() + 2 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const renewalEnd = new Date(Date.now() + 32 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const renewal = await createAccessRequest(
    {
      id: expiring.requester,
      name: "Lifecycle requester",
      email: `${expiring.requester}@permora.test`,
      department: "Test",
      active: true,
      roles: ["student"],
      requesterRole: "student",
    },
    {
      resourceId: "r-library",
      permissionId: "library:subscribed-materials",
      purpose: "Renew library access after the previous activation expired.",
      startsAt: renewalStart,
      expiresAt: renewalEnd,
      renewalOf: expiring.requestId,
    },
  );
  assert.notEqual(renewal.id, expiring.requestId);
  const renewalRows = await pool.query<{
    id: string;
    renewal_of: string | null;
    status: string;
  }>(
    `SELECT id, renewal_of, status FROM access_request
      WHERE id = ANY($1::uuid[])`,
    [[expiring.requestId, renewal.id]],
  );
  assert.equal(renewalRows.rows.length, 2);
  assert.equal(
    renewalRows.rows.find((row) => row.id === renewal.id)?.renewal_of,
    expiring.requestId,
  );
  assert.equal(
    renewalRows.rows.find((row) => row.id === expiring.requestId)?.status,
    "approved_pending_activation",
  );
  assert.equal(
    (await pool.query(
      "SELECT 1 FROM request_activation WHERE request_id = $1",
      [renewal.id],
    )).rows.length,
    0,
  );

  const revocable = await seedApprovedActivationRequest();
  const revocationAttempt = await prepareManualActivation(
    revocable.requestId,
    revocable.actor,
    { provisioned: true, evidence: "Verified for combined lifecycle flow." },
  );
  await recordManualActivationOutcome(revocable.actor, revocationAttempt);
  const revoked = await inTransaction((client) =>
    revokeActivatedEntitlement(
      client,
      revocable.actor,
      revocationAttempt.activationId,
      "Combined lifecycle test: access no longer required.",
    ),
  );
  assert.equal(revoked, true);
  const terminal = await pool.query<{
    approval_status: string;
    activation_status: string;
    revocation_events: number;
    entitlement_count: number;
  }>(
    `SELECT request.status AS approval_status,
            activation.status AS activation_status,
            (SELECT count(*)::int FROM activation_event event
              WHERE event.activation_id = activation.id
                AND event.event_type = 'activation_revoked') AS revocation_events,
            (SELECT count(*)::int FROM ordinary_entitlement entitlement
              WHERE entitlement.user_id = request.requester_user_id
                AND entitlement.resource_id = request.resource_id
                AND entitlement.permission_id = request.permission_id
                AND entitlement.scope_fingerprint = request.scope_fingerprint) AS entitlement_count
       FROM access_request request
       JOIN request_activation activation ON activation.request_id = request.id
      WHERE request.id = $1`,
    [revocable.requestId],
  );
  assert.deepEqual(terminal.rows[0], {
    approval_status: "approved_pending_activation",
    activation_status: "revoked",
    revocation_events: 1,
    entitlement_count: 0,
  });
});
