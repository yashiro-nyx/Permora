import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test, { after, before } from "node:test";
import { promisify } from "node:util";
import { Pool } from "pg";
import { ResilientPool } from "../lib/database-pool";

const execFileAsync = promisify(execFile);

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
const script = path.join(process.cwd(), "scripts", "configure-access.ts");
let pool: Pool;
let administrator = "";
let approver = "";
let student = "";
let laboratory = "";

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

async function seedUser(role: "admin" | "approver" | "student") {
  const id = randomUUID();
  const now = new Date();
  await pool.query(
    `INSERT INTO "user" (id,name,email,"emailVerified","createdAt","updatedAt")
     VALUES ($1,$2,$3,true,$4,$4)`,
    [id, `${role} fixture`, `${id}@permora.test`, now],
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

async function runConfigureAccess(args: string[]) {
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
      script,
      ...args,
      "--database-target",
      "test",
    ],
    {
      cwd: process.cwd(),
      env: environment,
      timeout: 30_000,
    },
  );
}

before(async () => {
  pool = new ResilientPool({
    connectionString: testDatabase.value,
    max: 1,
    connectionTimeoutMillis: 15_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
  }, 3);
  const current = await pool.query<{ name: string }>(
    "SELECT current_database() AS name",
  );
  assert.equal(current.rows[0]?.name, testDatabase.databaseName);
  await applyMigrations();
  administrator = await seedUser("admin");
  approver = await seedUser("approver");
  student = await seedUser("student");
  laboratory = randomUUID();
  await pool.query(
    `INSERT INTO scope_option
      (id,resource_id,field_name,institutional_code,display_name,valid_from)
     VALUES ($1,'r-lab','laboratory','CLI-LAB','CLI test laboratory',now())`,
    [laboratory],
  );
});

after(async () => {
  if (pool) await pool.end();
});

test("approver command creates a responsibility and audit event", async () => {
  const result = await runConfigureAccess([
    "approver",
    "--actor",
    administrator,
    "--approver",
    approver,
    "--resource",
    "r-library",
    "--permission",
    "library:subscribed-materials",
  ]);
  assert.match(result.stdout, /Created approver responsibility/);
  assert.equal(result.stderr, "");

  const responsibility = await pool.query<{ id: string }>(
    `SELECT id FROM approver_responsibility
      WHERE approver_user_id=$1 AND resource_id='r-library'
        AND permission_id='library:subscribed-materials'`,
    [approver],
  );
  assert.equal(responsibility.rowCount, 1);
  const audit = await pool.query(
    `SELECT 1 FROM audit_event
      WHERE actor_user_id=$1 AND event_type='configuration.approver.created'`,
    [administrator],
  );
  assert.equal(audit.rowCount, 1);
});

test("assignment command creates a scoped assignment and audit event", async () => {
  const result = await runConfigureAccess([
    "assignment",
    "--actor",
    administrator,
    "--user",
    student,
    "--resource",
    "r-lab",
    "--scope",
    laboratory,
    "--permission",
    "lab:designated-account",
    "--evidence",
    "Isolated CLI regression fixture",
  ]);
  assert.match(result.stdout, /Created requester assignment/);
  assert.equal(result.stderr, "");

  const assignment = await pool.query(
    `SELECT 1 FROM requester_assignment
      WHERE user_id=$1 AND resource_id='r-lab' AND scope_option_id=$2
        AND permission_id='lab:designated-account'`,
    [student, laboratory],
  );
  assert.equal(assignment.rowCount, 1);
  const audit = await pool.query(
    `SELECT 1 FROM audit_event
      WHERE actor_user_id=$1 AND event_type='configuration.assignment.created'`,
    [administrator],
  );
  assert.equal(audit.rowCount, 1);
});

test("malformed UUID input returns a clear credential-safe error", async () => {
  await assert.rejects(
    runConfigureAccess([
      "approver",
      "--actor",
      administrator,
      "--approver",
      "not-a-uuid",
      "--resource",
      "r-library",
      "--permission",
      "library:subscribed-materials",
    ]),
    (error: unknown) => {
      assert.ok(error && typeof error === "object" && "stderr" in error);
      const stderr = String((error as { stderr: string }).stderr);
      assert.match(stderr, /--approver must be a valid UUID/);
      assert.doesNotMatch(stderr, /Database operation failed/);
      assert.doesNotMatch(stderr, /postgres(?:ql)?:\/\//i);
      return true;
    },
  );
});
