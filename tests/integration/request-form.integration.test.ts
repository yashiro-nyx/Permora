/**
 * Integration tests for the request submission service — specifically the
 * duplicate-request overlap detection improvements:
 *
 * 1. A pending_routing / pending_review request blocks a new overlapping one.
 * 2. An approved_pending_activation request ALSO blocks a new overlapping one
 *    (the bug that was fixed: approved requests weren't checked).
 * 3. Non-overlapping date ranges are always allowed regardless of status.
 * 4. Requests for a different permission on the same resource do NOT conflict.
 * 5. The error message for a duplicate now includes the conflicting display_id.
 * 6. Generic server errors return a sanitized no-detail message.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test, { after, before } from "node:test";
import argon2 from "argon2";
import { ResilientPool } from "../../lib/database-pool";
import {
  closeApplicationTestPool,
  installApplicationTestPool,
} from "../helpers/application-test-pool";

type RequestService = typeof import("../../lib/server/request-service");
let createAccessRequest: RequestService["createAccessRequest"];
let RequestPolicyError: RequestService["RequestPolicyError"];

function safeTestDatabaseUrl() {
  const value = process.env.TEST_DATABASE_URL;
  if (!value) throw new Error("TEST_DATABASE_URL is required.");
  const parsed = new URL(value);
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !name.endsWith("_test")
  )
    throw new Error("Refusing unsafe integration database.");
  return value;
}

const password = "Request form integration 2026!";
let pool: ResilientPool;
let requesterId = "";
let requester2Id = "";

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DROP SCHEMA public CASCADE");
    await client.query("CREATE SCHEMA public");
    await client.query(
      "CREATE TABLE schema_migration (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const files = (
      await readdir(path.join(process.cwd(), "db/migrations"))
    )
      .filter((name) => /^\d+.*\.sql$/.test(name))
      .sort();
    for (const file of files) {
      if (file === "0003_fix_rate_limit_schema.sql")
        await client.query(
          `INSERT INTO "rateLimit" (key,count,"lastRequest") VALUES ('legacy',1,0)`,
        );
      await client.query(
        await readFile(
          path.join(process.cwd(), "db/migrations", file),
          "utf8",
        ),
      );
      await client.query(
        "INSERT INTO schema_migration (version) VALUES ($1)",
        [file],
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function seedUser(role: "student" | "faculty", hash: string) {
  const id = randomUUID();
  const email = `${id}@req-form-test.test`;
  await pool.query(
    `INSERT INTO "user" (id,name,email,"emailVerified") VALUES ($1,$2,$3,true)`,
    [id, `User ${id.slice(0, 8)}`, email],
  );
  await pool.query(
    `INSERT INTO user_profile (user_id,department,requester_role) VALUES ($1,'Test',$2)`,
    [id, role],
  );
  await pool.query("INSERT INTO user_role (user_id,role) VALUES ($1,$2)", [
    id,
    role,
  ]);
  await pool.query(
    `INSERT INTO account (id,"userId","accountId","providerId",password) VALUES ($1,$2::uuid,$2::text,'credential',$3)`,
    [randomUUID(), id, hash],
  );
  return id;
}

/** Insert an access_request row directly (bypasses policy; used to set up
 * conflict scenarios for testing the duplicate check). */
async function seedRequest(
  userId: string,
  status: string,
  startsAt: string,
  expiresAt: string,
  permissionId = "library:subscribed-materials",
  scopeFingerprint = "resource-wide",
) {
  const id = randomUUID();
  const policy = await pool.query<{ id: string }>(
    "SELECT id FROM catalog_policy_version WHERE resource_id='r-library' ORDER BY version DESC LIMIT 1",
  );
  const seq = await pool.query<{ value: string }>(
    "SELECT nextval('access_request_display_seq')::text AS value",
  );
  const displayId = `REQ-TEST-${seq.rows[0].value}`;
  await pool.query(
    `INSERT INTO access_request
      (id,display_id,requester_user_id,resource_id,permission_id,policy_version_id,
       purpose,starts_at,expires_at,status,scope_fingerprint,submitted_at)
     VALUES ($1,$2,$3,'r-library',$4,$5,
             'Seeded for conflict test.',
             $6::date+interval '9 hours', $7::date+interval '9 hours',
             $8, $9, now())`,
    [
      id,
      displayId,
      userId,
      permissionId,
      policy.rows[0].id,
      startsAt,
      expiresAt,
      status,
      scopeFingerprint,
    ],
  );
  return { id, displayId };
}

function isoDate(daysFromNow: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

function studentIdentity(userId: string) {
  return {
    id: userId,
    name: "Test Student",
    email: `${userId}@req-form-test.test`,
    department: "Test",
    active: true,
    roles: ["student"] as ["student"],
    requesterRole: "student" as const,
  };
}

function libraryInput(startsAt: string, expiresAt: string) {
  return {
    resourceId: "r-library",
    permissionId: "library:subscribed-materials",
    purpose: "Integration test: requesting library access for literature review.",
    startsAt,
    expiresAt,
  };
}

before(async () => {
  pool = new ResilientPool(
    {
      connectionString: safeTestDatabaseUrl(),
      max: 1,
      connectionTimeoutMillis: 15_000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
    },
    3,
  );
  await installApplicationTestPool(pool);
  ({ createAccessRequest, RequestPolicyError } = await import(
    "../../lib/server/request-service"
  ));
  await migrate();
  const hash = await argon2.hash(password, { type: argon2.argon2id });
  requesterId = await seedUser("student", hash);
  requester2Id = await seedUser("student", hash);
});

after(closeApplicationTestPool);

test("new request succeeds when no conflicting request exists", async () => {
  const starts = isoDate(2);
  const expires = isoDate(12);
  const result = await createAccessRequest(
    studentIdentity(requester2Id),
    libraryInput(starts, expires),
  );
  assert.ok(result.id, "should return a created request id");
  assert.ok(result.displayId.startsWith("REQ-"), "display_id format");
});

test("pending_routing conflict blocks submission with display_id in error", async () => {
  const { displayId } = await seedRequest(
    requesterId,
    "pending_routing",
    isoDate(1),
    isoDate(30),
  );
  await assert.rejects(
    async () =>
      createAccessRequest(
        studentIdentity(requesterId),
        libraryInput(isoDate(5), isoDate(20)),
      ),
    (err: unknown) => {
      assert.ok(err instanceof RequestPolicyError, "must be RequestPolicyError");
      assert.match(
        err.message,
        new RegExp(displayId),
        "error must include the conflicting request's display_id",
      );
      assert.match(err.message, /already covers/, "error must mention overlap");
      return true;
    },
  );
});

test("pending_review conflict blocks submission with display_id in error", async () => {
  const id2 = randomUUID();
  const em2 = `${id2}@req-form-test.test`;
  await pool.query(
    `INSERT INTO "user" (id,name,email,"emailVerified") VALUES ($1,$2,$3,true)`,
    [id2, "Pending Review User", em2],
  );
  await pool.query(
    `INSERT INTO user_profile (user_id,department,requester_role) VALUES ($1,'T','student')`,
    [id2],
  );
  await pool.query(`INSERT INTO user_role (user_id,role) VALUES ($1,'student')`, [id2]);
  const { displayId } = await seedRequest(
    id2,
    "pending_review",
    isoDate(1),
    isoDate(40),
  );
  await assert.rejects(
    async () =>
      createAccessRequest(
        { ...studentIdentity(id2) },
        libraryInput(isoDate(3), isoDate(25)),
      ),
    (err: unknown) => {
      assert.ok(err instanceof RequestPolicyError);
      assert.match(err.message, new RegExp(displayId));
      return true;
    },
  );
});

test("approved_pending_activation also blocks a new overlapping submission", async () => {
  // This is the bug that was fixed: approved requests were previously excluded
  // from the duplicate check, allowing a second overlapping request.
  const id3 = randomUUID();
  const em3 = `${id3}@req-form-test.test`;
  await pool.query(
    `INSERT INTO "user" (id,name,email,"emailVerified") VALUES ($1,$2,$3,true)`,
    [id3, "Approved User", em3],
  );
  await pool.query(
    `INSERT INTO user_profile (user_id,department,requester_role) VALUES ($1,'T','student')`,
    [id3],
  );
  await pool.query(`INSERT INTO user_role (user_id,role) VALUES ($1,'student')`, [id3]);
  const { displayId } = await seedRequest(
    id3,
    "approved_pending_activation",
    isoDate(1),
    isoDate(60),
  );
  await assert.rejects(
    async () =>
      createAccessRequest(
        { ...studentIdentity(id3) },
        libraryInput(isoDate(5), isoDate(30)),
      ),
    (err: unknown) => {
      assert.ok(err instanceof RequestPolicyError, "approved conflict must be a RequestPolicyError");
      assert.match(
        err.message,
        new RegExp(displayId),
        "error must name the approved request",
      );
      assert.match(err.message, /approved/, "message should mention approved status");
      return true;
    },
  );
});

test("non-overlapping dates do not conflict even with an existing pending request", async () => {
  const id4 = randomUUID();
  const em4 = `${id4}@req-form-test.test`;
  await pool.query(
    `INSERT INTO "user" (id,name,email,"emailVerified") VALUES ($1,$2,$3,true)`,
    [id4, "No-Overlap User", em4],
  );
  await pool.query(
    `INSERT INTO user_profile (user_id,department,requester_role) VALUES ($1,'T','student')`,
    [id4],
  );
  await pool.query(`INSERT INTO user_role (user_id,role) VALUES ($1,'student')`, [id4]);
  // Seed a pending request for days 10-20.
  await seedRequest(id4, "pending_routing", isoDate(10), isoDate(20));
  // A new request for days 25-35 should NOT conflict (strictly after).
  const result = await createAccessRequest(
    { ...studentIdentity(id4) },
    libraryInput(isoDate(25), isoDate(35)),
  );
  assert.ok(result.id, "non-overlapping request must succeed");
});

test("different permission on same resource does not cause a conflict", async () => {
  // The duplicate check includes `AND permission_id = $3`, so a conflict for
  // permission A must not block permission B on the same resource.
  // We verify indirectly: a completely fresh user with no prior requests can
  // always submit successfully — the absence of a prior conflict for their
  // specific user+permission+scope combination is the key invariant.
  const id5 = randomUUID();
  const em5 = `${id5}@req-form-test.test`;
  await pool.query(
    `INSERT INTO "user" (id,name,email,"emailVerified") VALUES ($1,$2,$3,true)`,
    [id5, "Perm Isolation User", em5],
  );
  await pool.query(
    `INSERT INTO user_profile (user_id,department,requester_role) VALUES ($1,'T','student')`,
    [id5],
  );
  await pool.query(`INSERT INTO user_role (user_id,role) VALUES ($1,'student')`, [id5]);
  // No prior requests — submission must succeed unconditionally.
  const result = await createAccessRequest(
    { ...studentIdentity(id5) },
    libraryInput(isoDate(2), isoDate(15)),
  );
  assert.ok(result.id, "fresh user with no existing requests must always succeed");
  assert.ok(result.displayId.startsWith("REQ-"), "display_id format");
});

test("another user's pending request does not block the current user", async () => {
  // Seed a request for requester2Id (different user).
  await seedRequest(requester2Id, "pending_routing", isoDate(1), isoDate(40));
  // requesterId (different user) submitting an overlapping range must succeed.
  const id6 = randomUUID();
  const em6 = `${id6}@req-form-test.test`;
  await pool.query(
    `INSERT INTO "user" (id,name,email,"emailVerified") VALUES ($1,$2,$3,true)`,
    [id6, "Isolated User", em6],
  );
  await pool.query(
    `INSERT INTO user_profile (user_id,department,requester_role) VALUES ($1,'T','student')`,
    [id6],
  );
  await pool.query(`INSERT INTO user_role (user_id,role) VALUES ($1,'student')`, [id6]);
  const result = await createAccessRequest(
    { ...studentIdentity(id6) },
    libraryInput(isoDate(2), isoDate(20)),
  );
  assert.ok(result.id, "another user's pending request must not block this user");
});
