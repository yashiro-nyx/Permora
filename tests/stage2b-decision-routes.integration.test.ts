import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test, { after, before } from "node:test";
import { Pool } from "pg";

function requiredSafeTestDatabaseUrl() {
  const value = process.env.TEST_DATABASE_URL;
  if (!value)
    throw new Error("TEST_DATABASE_URL is required for integration tests.");
  const parsed = new URL(value);
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !databaseName.endsWith("_test")
  )
    throw new Error(
      "Refusing destructive fixtures: TEST_DATABASE_URL must name a PostgreSQL database ending in _test.",
    );
  return { value, databaseName };
}

const testDatabase = requiredSafeTestDatabaseUrl();
const password = "Decision route integration password 2026";
let pool: Pool;
let passwordHash = "";
let requester = "";
let approver = "";
let otherApprover = "";
let inactiveApprover = "";
let requesterCookie = "";
let approverCookie = "";
let otherApproverCookie = "";
let observerAdminCookie = "";
let inactiveApproverCookie = "";
let approverResponsibility = "";

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
           VALUES ('legacy-rate-limit-row', 1, 0)`,
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
  role: "student" | "approver" | "admin",
  name: string,
) {
  const id = randomUUID();
  const email = `${name.toLowerCase().replaceAll(" ", "-")}@permora.test`;
  const now = new Date();
  await pool.query(
    `INSERT INTO "user" (id,name,email,"emailVerified","createdAt","updatedAt")
     VALUES ($1,$2,$3,true,$4,$4)`,
    [id, name, email, now],
  );
  await pool.query(
    `INSERT INTO user_profile (user_id,department,requester_role)
     VALUES ($1,$2,$3)`,
    [id, role === "student" ? "Engineering" : "Administration", role === "student" ? "student" : null],
  );
  await pool.query("INSERT INTO user_role (user_id,role) VALUES ($1,$2)", [
    id,
    role,
  ]);
  await pool.query(
    `INSERT INTO account
      (id,"userId","accountId","providerId",password,"createdAt","updatedAt")
     VALUES ($1,$2::uuid,$2::text,'credential',$3,$4,$4)`,
    [randomUUID(), id, passwordHash, now],
  );
  return { id, email };
}

async function login(email: string, octet: number) {
  const { auth } = await import("../lib/server/auth");
  const response = await auth.handler(
    new Request("http://localhost:3000/api/auth/sign-in/email", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        "content-type": "application/json",
        "x-forwarded-for": `127.0.2.${octet}`,
      },
      body: JSON.stringify({ email, password }),
    }),
  );
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
  assert.ok(cookie);
  return cookie;
}

async function seedResponsibility(userId: string) {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO approver_responsibility
      (id,approver_user_id,resource_id,permission_id,valid_from,assigned_by)
     VALUES ($1,$2,'r-library','library:subscribed-materials',
       '2026-01-01T00:00:00Z',$2)`,
    [id, userId],
  );
  return id;
}

async function seedReview(options: {
  approverId?: string;
  responsibilityId?: string;
  requesterId?: string;
}) {
  const id = randomUUID();
  const policy = await pool.query<{ id: string }>(
    `SELECT id FROM catalog_policy_version
      WHERE resource_id = 'r-library' ORDER BY version DESC LIMIT 1`,
  );
  await pool.query(
    `INSERT INTO access_request
      (id,display_id,requester_user_id,resource_id,permission_id,
       policy_version_id,purpose,starts_at,expires_at,status,scope_fingerprint)
     VALUES ($1,$2,$3,'r-library','library:subscribed-materials',$4,$5,
       now() + interval '1 day',now() + interval '8 days','pending_review',
       'resource-wide')`,
    [
      id,
      `DECISION-${id}`,
      options.requesterId ?? requester,
      policy.rows[0].id,
      "A sufficiently detailed purpose for approval route testing.",
    ],
  );
  await pool.query(
    `INSERT INTO request_review_assignment
      (id,request_id,approver_user_id,responsibility_id)
     VALUES ($1,$2,$3,$4)`,
    [
      randomUUID(),
      id,
      options.approverId ?? approver,
      options.responsibilityId ?? approverResponsibility,
    ],
  );
  return id;
}

function decisionRequest(
  requestId: string,
  cookie: string,
  body: unknown,
  options: { key?: string; origin?: string | null; contentType?: string } = {},
) {
  const headers = new Headers();
  if (cookie) headers.set("cookie", cookie);
  if (options.origin !== null)
    headers.set("origin", options.origin ?? "http://localhost:3000");
  headers.set("content-type", options.contentType ?? "application/json");
  headers.set("idempotency-key", options.key ?? randomUUID());
  return new Request(
    `http://localhost:3000/api/review/requests/${requestId}/decision`,
    { method: "POST", headers, body: JSON.stringify(body) },
  );
}

async function decide(
  requestId: string,
  cookie: string,
  body: unknown,
  options?: { key?: string; origin?: string | null; contentType?: string },
) {
  const route = await import(
    "../app/api/review/requests/[id]/decision/route"
  );
  return route.POST(decisionRequest(requestId, cookie, body, options), {
    params: Promise.resolve({ id: requestId }),
  });
}

before(async () => {
  process.env.APP_URL = "http://localhost:3000";
  process.env.AUTH_SECRET =
    "stage2b-decision-test-secret-at-least-thirty-two-characters";
  pool = new Pool({
    connectionString: testDatabase.value,
    max: 3,
    connectionTimeoutMillis: 30_000,
  });
  const database = await pool.query<{ name: string }>(
    "SELECT current_database() AS name",
  );
  assert.equal(database.rows[0].name, testDatabase.databaseName);
  await applyMigrations();
  const { hashPassword } = await import("../lib/server/password");
  passwordHash = await hashPassword(password);
  const users = [];
  for (const [role, name] of [
    ["student", "Decision Requester"],
    ["approver", "Decision Approver"],
    ["approver", "Other Approver"],
    ["admin", "Observer Admin"],
    ["approver", "Inactive Decision Approver"],
  ] as const)
    users.push(await seedUser(role, name));
  [requester, approver, otherApprover, , inactiveApprover] =
    users.map((user) => user.id);
  const cookies: string[] = [];
  for (const [index, user] of users.entries())
    cookies.push(await login(user.email, index + 30));
  [
    requesterCookie,
    approverCookie,
    otherApproverCookie,
    observerAdminCookie,
    inactiveApproverCookie,
  ] = cookies;
  approverResponsibility = await seedResponsibility(approver);
  await seedResponsibility(otherApprover);
  await seedResponsibility(inactiveApprover);
  await pool.query("UPDATE user_profile SET active = false WHERE user_id = $1", [
    inactiveApprover,
  ]);
});

after(async () => {
  if (pool) await pool.end();
});

test("decision route enforces origin, authentication, active role, and responsibility", async () => {
  const requestId = await seedReview({});
  const body = { expectedVersion: 1, decision: "deny", reason: "Not approved." };
  assert.equal((await decide(requestId, "", body)).status, 401);
  assert.equal((await decide(requestId, requesterCookie, body)).status, 403);
  assert.equal((await decide(requestId, inactiveApproverCookie, body)).status, 401);
  assert.equal((await decide(requestId, approverCookie, body, { origin: null })).status, 403);
  assert.equal(
    (await decide(requestId, approverCookie, body, { origin: "https://untrusted.example" })).status,
    403,
  );
});

test("only the persisted fully eligible assignee can decide a request", async () => {
  const requestId = await seedReview({});
  const unknown = randomUUID();
  const body = { expectedVersion: 1, decision: "deny", reason: "Not approved." };
  const another = await decide(requestId, otherApproverCookie, body);
  const missing = await decide(unknown, otherApproverCookie, body);
  assert.equal(another.status, 404);
  assert.equal(missing.status, 404);
  assert.deepEqual(await another.json(), await missing.json());
  assert.equal((await decide(requestId, observerAdminCookie, body)).status, 403);
});

test("a persisted malformed assignment cannot enable self-approval", async () => {
  await pool.query(
    "INSERT INTO user_role (user_id,role) VALUES ($1,'approver') ON CONFLICT DO NOTHING",
    [requester],
  );
  const responsibilityId = await seedResponsibility(requester);
  const requestId = await seedReview({
    requesterId: requester,
    approverId: requester,
    responsibilityId,
  });
  const response = await decide(requestId, requesterCookie, {
    expectedVersion: 1,
    decision: "approve",
  });
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, "not_found");
});

test("approve commits state, immutable records, and one notification without granting access", async () => {
  const requestId = await seedReview({});
  const response = await decide(requestId, approverCookie, {
    expectedVersion: 1,
    decision: "approve",
    actorUserId: requester,
    role: "admin",
    status: "active",
    assigneeId: requester,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    decisionId: (await pool.query<{ id: string }>(
      "SELECT id FROM request_decision WHERE request_id = $1",
      [requestId],
    )).rows[0].id,
    status: "approved_pending_activation",
    version: 2,
    replayed: false,
  });
  const stored = await pool.query<{
    status: string;
    decisions: number;
    events: number;
    audits: number;
    notifications: number;
    entitlements: number;
  }>(
    `SELECT request.status,
      (SELECT count(*)::int FROM request_decision WHERE request_id = request.id) decisions,
      (SELECT count(*)::int FROM request_event WHERE request_id = request.id AND event_type = 'review_approved') events,
      (SELECT count(*)::int FROM audit_event WHERE request_id = request.id AND event_type = 'review_approved') audits,
      (SELECT count(*)::int FROM user_notification WHERE request_id = request.id) notifications,
      (SELECT count(*)::int FROM ordinary_entitlement WHERE user_id = request.requester_user_id) entitlements
     FROM access_request request WHERE request.id = $1`,
    [requestId],
  );
  assert.deepEqual(stored.rows[0], {
    status: "approved_pending_activation",
    decisions: 1,
    events: 1,
    audits: 1,
    notifications: 1,
    entitlements: 0,
  });
});

test("denial and return require a non-empty reason", async () => {
  for (const decision of ["deny", "return_for_revision"] as const) {
    const requestId = await seedReview({});
    const invalid = await decide(requestId, approverCookie, {
      expectedVersion: 1,
      decision,
      reason: "   ",
    });
    assert.equal(invalid.status, 400);
    const valid = await decide(requestId, approverCookie, {
      expectedVersion: 1,
      decision,
      reason: "The requester must provide more supporting information.",
    });
    assert.equal(valid.status, 200);
  }
});

test("idempotent replay returns the stored outcome and rejects key reuse", async () => {
  const requestId = await seedReview({});
  const key = randomUUID();
  const body = {
    expectedVersion: 1,
    decision: "deny",
    reason: "The request does not meet the current policy.",
  };
  const first = await decide(requestId, approverCookie, body, { key });
  const replay = await decide(requestId, approverCookie, body, { key });
  assert.equal(first.status, 200);
  assert.equal(replay.status, 200);
  assert.equal((await first.json()).replayed, false);
  assert.equal((await replay.json()).replayed, true);
  const counts = await pool.query<{ decisions: number; notifications: number }>(
    `SELECT
      (SELECT count(*)::int FROM request_decision WHERE request_id = $1) decisions,
      (SELECT count(*)::int FROM user_notification WHERE request_id = $1) notifications`,
    [requestId],
  );
  assert.deepEqual(counts.rows[0], { decisions: 1, notifications: 1 });
  const conflict = await decide(
    requestId,
    approverCookie,
    { ...body, decision: "return_for_revision" },
    { key },
  );
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).error.code, "idempotency_conflict");
});

test("stale and concurrent decisions cannot create duplicate effects", async () => {
  const requestId = await seedReview({});
  const responses = await Promise.all([
    decide(requestId, approverCookie, {
      expectedVersion: 1,
      decision: "approve",
    }),
    decide(requestId, approverCookie, {
      expectedVersion: 1,
      decision: "deny",
      reason: "The concurrent denial must not also commit.",
    }),
  ]);
  assert.deepEqual(
    responses.map((response) => response.status).sort(),
    [200, 409],
  );
  const counts = await pool.query<{ decisions: number; notifications: number }>(
    `SELECT
      (SELECT count(*)::int FROM request_decision WHERE request_id = $1) decisions,
      (SELECT count(*)::int FROM user_notification WHERE request_id = $1) notifications`,
    [requestId],
  );
  assert.deepEqual(counts.rows[0], { decisions: 1, notifications: 1 });
});

test("approval revalidation fails closed when requester eligibility changes", async () => {
  const requestId = await seedReview({});
  await pool.query("UPDATE user_profile SET active = false WHERE user_id = $1", [
    requester,
  ]);
  try {
    const response = await decide(requestId, approverCookie, {
      expectedVersion: 1,
      decision: "approve",
    });
    assert.equal(response.status, 409);
    assert.equal(
      (await response.json()).error.code,
      "approval_revalidation_failed",
    );
    const stored = await pool.query<{ status: string; decisions: number }>(
      `SELECT request.status,
        (SELECT count(*)::int FROM request_decision WHERE request_id = request.id) decisions
       FROM access_request request WHERE request.id = $1`,
      [requestId],
    );
    assert.deepEqual(stored.rows[0], { status: "pending_review", decisions: 0 });
  } finally {
    await pool.query("UPDATE user_profile SET active = true WHERE user_id = $1", [
      requester,
    ]);
  }
});

test("notification failure rolls back the decision and every related effect", async () => {
  const requestId = await seedReview({});
  await pool.query(`CREATE FUNCTION fail_decision_notification_insert()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'forced notification failure'; END;
    $$`);
  await pool.query(`CREATE TRIGGER test_fail_decision_notification
    BEFORE INSERT ON user_notification
    FOR EACH ROW EXECUTE FUNCTION fail_decision_notification_insert()`);
  try {
    assert.equal(
      (await decide(requestId, approverCookie, {
        expectedVersion: 1,
        decision: "deny",
        reason: "This transaction must roll back completely.",
      })).status,
      503,
    );
  } finally {
    await pool.query("DROP TRIGGER test_fail_decision_notification ON user_notification");
    await pool.query("DROP FUNCTION fail_decision_notification_insert() ");
  }
  const stored = await pool.query<{
    status: string;
    decisions: number;
    events: number;
    audits: number;
    notifications: number;
  }>(
    `SELECT request.status,
      (SELECT count(*)::int FROM request_decision WHERE request_id = request.id) decisions,
      (SELECT count(*)::int FROM request_event WHERE request_id = request.id AND event_type LIKE 'review_%') events,
      (SELECT count(*)::int FROM audit_event WHERE request_id = request.id AND event_type LIKE 'review_%') audits,
      (SELECT count(*)::int FROM user_notification WHERE request_id = request.id) notifications
     FROM access_request request WHERE request.id = $1`,
    [requestId],
  );
  assert.deepEqual(stored.rows[0], {
    status: "pending_review",
    decisions: 0,
    events: 0,
    audits: 0,
    notifications: 0,
  });
});

test("invalid input and service failures use sanitized responses", async () => {
  const requestId = await seedReview({});
  const invalid = await decide(requestId, approverCookie, {
    expectedVersion: 0,
    decision: "approve",
  });
  assert.equal(invalid.status, 400);
  const { handleApprovalDecisionRequest } = await import(
    "../lib/server/approval-decision-handlers"
  );
  const response = await handleApprovalDecisionRequest(
    decisionRequest(requestId, "", {
      expectedVersion: 1,
      decision: "approve",
    }),
    requestId,
    {
      getIdentity: async () => ({
        id: approver,
        name: "Decision Approver",
        email: "decision-approver@permora.test",
        department: "Administration",
        active: true,
        roles: ["approver"],
        requesterRole: null,
      }),
      hasResponsibility: async () => true,
      decide: async () => {
        throw new Error("sensitive database detail");
      },
    },
  );
  assert.equal(response.status, 503);
  const responseBody = await response.json();
  assert.equal(responseBody.error.code, "service_unavailable");
  assert.ok(!JSON.stringify(responseBody).includes("sensitive database detail"));
});
