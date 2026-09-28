import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test, { after, before } from "node:test";
import { Pool } from "pg";
import { ResilientPool } from "../lib/database-pool";
import {
  closeApplicationTestPool,
  installApplicationTestPool,
} from "./helpers/application-test-pool";

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
let pool: Pool;
let userA = "";
let userB = "";
let cookieA = "";

async function connectToVerifiedTestDatabase() {
  return pool.query<{ name: string }>("SELECT current_database() AS name");
}

function request(pathname: string, init: RequestInit = {}) {
  return new Request(`http://localhost:3000/api/auth${pathname}`, {
    ...init,
    headers: {
      origin: "http://localhost:3000",
      "content-type": "application/json",
      "x-forwarded-for": "127.0.0.20",
      ...init.headers,
    },
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
      if (file === "0003_fix_rate_limit_schema.sql") {
        await client.query(
          `INSERT INTO "rateLimit" (key, count, "lastRequest")
           VALUES ('legacy-rate-limit-row', 1, 0)`,
        );
      }
      await client.query(
        await readFile(
          path.join(process.cwd(), "db", "migrations", file),
          "utf8",
        ),
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
  email: string,
  role: "student" | "approver",
  password: string,
) {
  const { hashPassword } = await import("../lib/server/password");
  const id = randomUUID();
  const now = new Date();
  await pool.query(
    `INSERT INTO "user" (id,name,email,"emailVerified","createdAt","updatedAt") VALUES ($1,$2,$3,true,$4,$4)`,
    [id, email.split("@")[0], email, now],
  );
  await pool.query(
    "INSERT INTO user_profile (user_id, requester_role) VALUES ($1,$2)",
    [id, role === "student" ? "student" : null],
  );
  await pool.query("INSERT INTO user_role (user_id, role) VALUES ($1,$2)", [
    id,
    role,
  ]);
  await pool.query(
    `INSERT INTO account (id,"userId","accountId","providerId",password,"createdAt","updatedAt") VALUES ($1,$2::uuid,$2::text,'credential',$3,$4,$4)`,
    [randomUUID(), id, await hashPassword(password), now],
  );
  return id;
}

before(async () => {
  process.env.APP_URL = "http://localhost:3000";
  process.env.AUTH_SECRET =
    "stage2a-isolated-test-secret-at-least-thirty-two-characters";
  pool = new ResilientPool({
    connectionString: testDatabase.value,
    max: 1,
    connectionTimeoutMillis: 15_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
  }, 3);
  await installApplicationTestPool(pool);
  const database = await connectToVerifiedTestDatabase();
  assert.equal(database.rows[0].name, testDatabase.databaseName);
  assert.ok(database.rows[0].name.endsWith("_test"));
  await applyMigrations(pool);
  userA = await seedUser(
    "owner-a@permora.test",
    "student",
    "Owner A secure password 2026",
  );
  userB = await seedUser(
    "owner-b@permora.test",
    "student",
    "Owner B secure password 2026",
  );
  const approver = await seedUser(
    "approver@permora.test",
    "approver",
    "Approver secure password 2026",
  );
  await pool.query(
    "INSERT INTO approver_responsibility (id,approver_user_id,resource_id,valid_from,assigned_by) VALUES ($1,$2,'r-library',now(),$2)",
    [randomUUID(), approver],
  );
});

after(closeApplicationTestPool);

test("rate-limit migration matches Better Auth and preserves legacy rows", async () => {
  const column = await pool.query<{
    data_type: string;
    is_nullable: "YES" | "NO";
  }>(
    `SELECT data_type, is_nullable
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'rateLimit'
        AND column_name = 'id'`,
  );
  assert.deepEqual(column.rows[0], {
    data_type: "text",
    is_nullable: "NO",
  });

  const constraints = await pool.query<{
    primary_id: boolean;
    unique_key: boolean;
  }>(
    `SELECT
       EXISTS (
         SELECT 1 FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         WHERE t.relname = 'rateLimit' AND c.contype = 'p'
           AND pg_get_constraintdef(c.oid) = 'PRIMARY KEY (id)'
       ) AS primary_id,
       EXISTS (
         SELECT 1 FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         WHERE t.relname = 'rateLimit' AND c.contype = 'u'
           AND pg_get_constraintdef(c.oid) = 'UNIQUE (key)'
       ) AS unique_key`,
  );
  assert.deepEqual(constraints.rows[0], {
    primary_id: true,
    unique_key: true,
  });

  const legacy = await pool.query<{ preserved: boolean }>(
    `SELECT (id = key) AS preserved
       FROM "rateLimit" WHERE key = 'legacy-rate-limit-row'`,
  );
  assert.equal(legacy.rows[0]?.preserved, true);
});

test("real login rejects invalid credentials and creates a revocable database session", async () => {
  const { auth } = await import("../lib/server/auth");
  const untrustedOrigin = await auth.handler(
    request("/sign-in/email", {
      method: "POST",
      headers: {
        origin: "https://untrusted.example",
        "content-type": "application/json",
        "x-forwarded-for": "127.0.0.19",
      },
      body: JSON.stringify({
        email: "owner-a@permora.test",
        password: "Owner A secure password 2026",
      }),
    }),
  );
  assert.equal(untrustedOrigin.status, 403);
  const invalid = await auth.handler(
    request("/sign-in/email", {
      method: "POST",
      body: JSON.stringify({
        email: "owner-a@permora.test",
        password: "wrong password",
      }),
    }),
  );
  assert.equal(invalid.status, 401);
  const valid = await auth.handler(
    request("/sign-in/email", {
      method: "POST",
      body: JSON.stringify({
        email: "owner-a@permora.test",
        password: "Owner A secure password 2026",
      }),
    }),
  );
  assert.equal(valid.status, 200);
  cookieA = valid.headers.get("set-cookie")?.split(";")[0] ?? "";
  assert.ok(cookieA);
  assert.equal(
    Number(
      (
        await pool.query(
          'SELECT count(*)::int AS count FROM "session" WHERE "userId" = $1',
          [userA],
        )
      ).rows[0].count,
    ),
    1,
  );
});

test("email login is rate limited", async () => {
  const { auth } = await import("../lib/server/auth");
  const statuses: number[] = [];
  for (let attempt = 0; attempt < 7; attempt++) {
    const response = await auth.handler(
      request("/sign-in/email", {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          "content-type": "application/json",
          "x-forwarded-for": "127.0.0.99",
        },
        body: JSON.stringify({
          email: "nobody@permora.test",
          password: "invalid password",
        }),
      }),
    );
    statuses.push(response.status);
  }
  assert.ok(statuses.includes(429));
  const stored = await pool.query<{ valid: boolean }>(
    `SELECT bool_and(id IS NOT NULL AND length(id) > 0) AS valid
       FROM "rateLimit"`,
  );
  assert.equal(stored.rows[0].valid, true);
});

test("session expiration is enforced server-side", async () => {
  const { auth } = await import("../lib/server/auth");
  await pool.query(
    'UPDATE "session" SET "expiresAt" = now() - interval \'1 minute\' WHERE "userId" = $1',
    [userA],
  );
  const response = await auth.handler(
    request("/get-session", {
      headers: {
        cookie: cookieA,
        origin: "http://localhost:3000",
        "x-forwarded-for": "127.0.0.21",
      },
    }),
  );
  assert.equal(await response.json(), null);
});

test("owner scoping, role checks, tamper resistance, persistence, and logout", async () => {
  const { auth } = await import("../lib/server/auth");
  const { createAccessRequest, getOwnedRequest, RequestPolicyError } =
    await import("../lib/server/request-service");
  const login = await auth.handler(
    request("/sign-in/email", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        "content-type": "application/json",
        "x-forwarded-for": "127.0.0.22",
      },
      body: JSON.stringify({
        email: "owner-a@permora.test",
        password: "Owner A secure password 2026",
      }),
    }),
  );
  const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
  const start = new Date();
  start.setUTCDate(start.getUTCDate() + 1);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);
  const created = await createAccessRequest(
    {
      id: userA,
      name: "owner-a",
      email: "owner-a@permora.test",
      department: "",
      active: true,
      roles: ["student"],
      requesterRole: "student",
    },
    {
      resourceId: "r-library",
      permissionId: "library:subscribed-materials",
      purpose: "Additional temporary access for assigned academic research.",
      startsAt: start.toISOString().slice(0, 10),
      expiresAt: end.toISOString().slice(0, 10),
      userId: userB,
      role: "admin",
      status: "active",
    },
  );
  assert.ok(await getOwnedRequest(userA, created.id));
  assert.equal(await getOwnedRequest(userB, created.id), null);
  await assert.rejects(
    () =>
      createAccessRequest(
        {
          id: userA,
          name: "owner-a",
          email: "owner-a@permora.test",
          department: "",
          active: true,
          roles: ["student"],
          requesterRole: "student",
        },
        {
          resourceId: "r-faculty-grading",
          permissionId: "grading:submit-assigned-section",
          purpose: "Attempted incompatible permission must always fail closed.",
          startsAt: start.toISOString().slice(0, 10),
          expiresAt: end.toISOString().slice(0, 10),
        },
      ),
    RequestPolicyError,
  );
  const logout = await auth.handler(
    request("/sign-out", {
      method: "POST",
      headers: {
        cookie,
        origin: "http://localhost:3000",
        "content-type": "application/json",
        "x-forwarded-for": "127.0.0.22",
      },
      body: "{}",
    }),
  );
  assert.equal(logout.status, 200);
  const relogin = await auth.handler(
    request("/sign-in/email", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        "content-type": "application/json",
        "x-forwarded-for": "127.0.0.23",
      },
      body: JSON.stringify({
        email: "owner-a@permora.test",
        password: "Owner A secure password 2026",
      }),
    }),
  );
  assert.equal(relogin.status, 200);
  assert.ok(await getOwnedRequest(userA, created.id));
});
