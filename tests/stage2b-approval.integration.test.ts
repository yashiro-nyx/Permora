import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test, { after, before } from "node:test";
import { Pool, type PoolClient } from "pg";
import {
  applyApprovalDecision,
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
const legacyPendingRequestId = "20000000-0000-4000-8000-000000000001";
let pool: Pool;

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

before(async () => {
  pool = new Pool({
    connectionString: testDatabase.value,
    max: 4,
    connectionTimeoutMillis: 30_000,
  });
  const database = await pool.query<{ name: string }>(
    "SELECT current_database() AS name",
  );
  assert.equal(database.rows[0].name, testDatabase.databaseName);
  await applyMigrations(pool);
});

after(async () => {
  if (pool) await pool.end();
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
