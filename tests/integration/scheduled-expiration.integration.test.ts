import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test, { after, before } from "node:test";
import { Pool } from "pg";
import { ResilientPool } from "../../lib/database-pool";
import {
  extractDatabaseTargetOptions,
  resolveCliDatabase,
} from "../../scripts/database-target";
import {
  closeApplicationTestPool,
  installApplicationTestPool,
} from "../helpers/application-test-pool";

const { options } = extractDatabaseTargetOptions(["--database-target", "test"]);
if (options.target !== "test") throw new Error("The test target is required.");
const testDatabase = resolveCliDatabase(options);
if (!testDatabase.databaseName.endsWith("_test"))
  throw new Error("Refusing an integration database without the _test suffix.");

let pool: Pool;
let handlers: typeof import("../../lib/server/maintenance-handlers");

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
      await client.query(
        await readFile(path.join(process.cwd(), "db", "migrations", file), "utf8"),
      );
      await client.query("INSERT INTO schema_migration (version) VALUES ($1)", [file]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function seedRequester() {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ($1,'Expiry Subject',$2,true,now(),now())`,
    [id, `${id}@permora.test`],
  );
  await pool.query(
    `INSERT INTO user_profile (user_id, department, active, requester_role)
     VALUES ($1,'Lifecycle',true,'student')`,
    [id],
  );
  await pool.query("INSERT INTO user_role (user_id, role) VALUES ($1,'student')", [id]);
  return id;
}

/**
 * Seed an access_request + request_decision + request_activation in a chosen
 * activation status with a chosen expires_at, so expiration can be exercised at
 * each lifecycle boundary.
 */
async function seedActivation(input: {
  requesterId: string;
  status: "activated" | "revoked";
  expiresAt: string; // SQL interval-relative expression, e.g. "now() - interval '1 hour'"
}) {
  const requestId = randomUUID();
  const policy = await pool.query<{ id: string }>(
    `SELECT id FROM catalog_policy_version WHERE resource_id = 'r-library'
      ORDER BY version DESC LIMIT 1`,
  );
  await pool.query(
    `INSERT INTO access_request
      (id, display_id, requester_user_id, resource_id, permission_id,
       policy_version_id, purpose, starts_at, expires_at, status, version,
       scope_fingerprint, submitted_at)
     VALUES ($1,$2,$3,'r-library','library:subscribed-materials',$4,
       'Scheduled expiration integration fixture request purpose.',
       now() - interval '40 days', ${input.expiresAt}, 'approved_pending_activation', 2,
       'resource-wide', now() - interval '41 days')`,
    [requestId, `REQ-EXP-${requestId}`, input.requesterId, policy.rows[0].id],
  );
  const decisionId = randomUUID();
  const assignmentId = randomUUID();
  // A minimal completed assignment + decision to satisfy the activation FK.
  await pool.query(
    `INSERT INTO approver_responsibility
      (id, approver_user_id, resource_id, permission_id, valid_from, assigned_by)
     VALUES ($1,$2,'r-library','library:subscribed-materials',now() - interval '2 days',$2)`,
    [randomUUID(), input.requesterId],
  );
  const responsibility = await pool.query<{ id: string }>(
    `SELECT id FROM approver_responsibility WHERE approver_user_id = $1 LIMIT 1`,
    [input.requesterId],
  );
  await pool.query(
    `INSERT INTO request_review_assignment
      (id, request_id, approver_user_id, responsibility_id, status, assigned_at, completed_at)
     VALUES ($1,$2,$3,$4,'completed',now() - interval '39 days',now() - interval '38 days')`,
    [assignmentId, requestId, input.requesterId, responsibility.rows[0].id],
  );
  await pool.query(
    `INSERT INTO request_decision
      (id, request_id, assignment_id, actor_user_id, action, previous_status,
       resulting_status, previous_version, resulting_version, idempotency_key)
     VALUES ($1,$2,$3,$4,'approve','pending_review','approved_pending_activation',1,2,$1)`,
    [decisionId, requestId, assignmentId, input.requesterId],
  );
  const activationId = randomUUID();
  await pool.query(
    `INSERT INTO request_activation
      (id, request_id, decision_id, status, adapter_name, actor_user_id,
       idempotency_key, attempt_count, started_at, last_attempt_at, activated_at, expires_at)
     VALUES ($1,$2,$3,$4,'manual-admin',$5,$6,1,
       now() - interval '38 days', now() - interval '38 days',
       now() - interval '38 days', ${input.expiresAt})`,
    [activationId, requestId, decisionId, input.status, input.requesterId, randomUUID()],
  );
  return { requestId, activationId };
}

function schedulerRequest(secretHeader: string | null) {
  const headers: Record<string, string> = {};
  if (secretHeader) headers.authorization = secretHeader;
  return new Request("http://localhost:3000/api/maintenance/expire-activations", {
    method: "POST",
    headers,
  });
}

const SECRET = "integration-scheduler-secret-value-xyz";
const withSecret = { secret: () => SECRET };

before(async () => {
  process.env.APP_URL = "http://localhost:3000";
  process.env.AUTH_SECRET =
    "scheduled-expiration-secret-at-least-thirty-two-characters";
  pool = new ResilientPool(
    {
      connectionString: testDatabase.connectionString,
      max: 5,
      connectionTimeoutMillis: 15_000,
    },
    3,
  );
  await installApplicationTestPool(pool);
  const database = await pool.query<{ name: string }>("SELECT current_database() AS name");
  assert.ok(database.rows[0]?.name.endsWith("_test"));
  await applyMigrations();
  handlers = await import("../../lib/server/maintenance-handlers");
});

after(closeApplicationTestPool);

test("scheduled expiration endpoint is disabled without a configured secret", async () => {
  const response = await handlers.handleScheduledExpiration(
    schedulerRequest("Bearer anything"),
    { secret: () => undefined },
  );
  assert.equal(response.status, 503);
  const body = (await response.json()) as { error?: { code?: string } };
  assert.equal(body.error?.code, "scheduler_disabled");
});

test("scheduled expiration rejects a missing or wrong credential", async () => {
  const missing = await handlers.handleScheduledExpiration(
    schedulerRequest(null),
    withSecret,
  );
  assert.equal(missing.status, 401);
  const wrong = await handlers.handleScheduledExpiration(
    schedulerRequest("Bearer not-the-secret"),
    withSecret,
  );
  assert.equal(wrong.status, 401);
});

test("expiration never touches access before its authorized timestamp", async () => {
  const requester = await seedRequester();
  const future = await seedActivation({
    requesterId: requester,
    status: "activated",
    expiresAt: "now() + interval '2 days'",
  });
  const response = await handlers.handleScheduledExpiration(
    schedulerRequest(`Bearer ${SECRET}`),
    withSecret,
  );
  assert.equal(response.status, 200);
  const state = await pool.query<{ status: string }>(
    "SELECT status FROM request_activation WHERE id = $1",
    [future.activationId],
  );
  assert.equal(state.rows[0].status, "activated");
  const events = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM activation_event
      WHERE activation_id = $1 AND event_type = 'activation_expired'`,
    [future.activationId],
  );
  assert.equal(events.rows[0].count, 0);
});

test("expiration transitions past-due access and is idempotent and audited", async () => {
  const requester = await seedRequester();
  const due = await seedActivation({
    requesterId: requester,
    status: "activated",
    expiresAt: "now() - interval '1 hour'",
  });

  const first = await handlers.handleScheduledExpiration(
    schedulerRequest(`Bearer ${SECRET}`),
    withSecret,
  );
  assert.equal(first.status, 200);
  const firstBody = (await first.json()) as { examined: number; expired: number };
  assert.ok(firstBody.expired >= 1);

  const afterFirst = await pool.query<{ status: string }>(
    "SELECT status FROM request_activation WHERE id = $1",
    [due.activationId],
  );
  assert.equal(afterFirst.rows[0].status, "expired");
  const activationEvents = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM activation_event
      WHERE activation_id = $1 AND event_type = 'activation_expired'`,
    [due.activationId],
  );
  const auditEvents = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM audit_event
      WHERE request_id = $1 AND event_type = 'activation_expired'`,
    [due.requestId],
  );
  assert.equal(activationEvents.rows[0].count, 1);
  assert.equal(auditEvents.rows[0].count, 1);

  // A repeated run does not re-expire this activation or duplicate events.
  const second = await handlers.handleScheduledExpiration(
    schedulerRequest(`Bearer ${SECRET}`),
    withSecret,
  );
  assert.equal(second.status, 200);
  const activationEventsAfter = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM activation_event
      WHERE activation_id = $1 AND event_type = 'activation_expired'`,
    [due.activationId],
  );
  assert.equal(activationEventsAfter.rows[0].count, 1);
});

test("concurrent runs expire a due activation exactly once", async () => {
  const requester = await seedRequester();
  const due = await seedActivation({
    requesterId: requester,
    status: "activated",
    expiresAt: "now() - interval '2 hours'",
  });
  const [a, b] = await Promise.all([
    handlers.handleScheduledExpiration(schedulerRequest(`Bearer ${SECRET}`), withSecret),
    handlers.handleScheduledExpiration(schedulerRequest(`Bearer ${SECRET}`), withSecret),
  ]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  const events = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM activation_event
      WHERE activation_id = $1 AND event_type = 'activation_expired'`,
    [due.activationId],
  );
  assert.equal(events.rows[0].count, 1);
  const state = await pool.query<{ status: string }>(
    "SELECT status FROM request_activation WHERE id = $1",
    [due.activationId],
  );
  assert.equal(state.rows[0].status, "expired");
});

test("already-revoked and approved-but-not-activated access are never expired", async () => {
  const requester = await seedRequester();
  const revoked = await seedActivation({
    requesterId: requester,
    status: "revoked",
    expiresAt: "now() - interval '1 day'",
  });
  // Approved request with no activation row at all.
  const policy = await pool.query<{ id: string }>(
    `SELECT id FROM catalog_policy_version WHERE resource_id = 'r-library'
      ORDER BY version DESC LIMIT 1`,
  );
  const bareRequestId = randomUUID();
  await pool.query(
    `INSERT INTO access_request
      (id, display_id, requester_user_id, resource_id, permission_id,
       policy_version_id, purpose, starts_at, expires_at, status, version,
       scope_fingerprint, submitted_at)
     VALUES ($1,$2,$3,'r-library','library:subscribed-materials',$4,
       'Approved but not activated fixture purpose text here.',
       now() - interval '1 day', now() - interval '1 hour',
       'approved_pending_activation', 2, 'resource-wide', now() - interval '2 days')`,
    [bareRequestId, `REQ-BARE-${bareRequestId}`, requester, policy.rows[0].id],
  );

  const response = await handlers.handleScheduledExpiration(
    schedulerRequest(`Bearer ${SECRET}`),
    withSecret,
  );
  assert.equal(response.status, 200);

  const revokedState = await pool.query<{ status: string }>(
    "SELECT status FROM request_activation WHERE id = $1",
    [revoked.activationId],
  );
  assert.equal(revokedState.rows[0].status, "revoked");
  const revokedExpiredEvents = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM activation_event
      WHERE activation_id = $1 AND event_type = 'activation_expired'`,
    [revoked.activationId],
  );
  assert.equal(revokedExpiredEvents.rows[0].count, 0);
  // The bare approved request still has no activation row.
  const bareActivation = await pool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM request_activation WHERE request_id = $1",
    [bareRequestId],
  );
  assert.equal(bareActivation.rows[0].count, 0);
});
