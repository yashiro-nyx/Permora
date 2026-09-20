import { loadEnvConfig } from "@next/env";
import { Pool, type PoolClient } from "pg";
import {
  previewRequestRoute,
  routePendingRequest,
} from "../lib/approval-domain";

type Target = "test" | "development";

function argumentsMap() {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 2; index < process.argv.length; index++) {
    const key = process.argv[index];
    if (!key.startsWith("--")) throw new Error(`Unexpected argument ${key}.`);
    if (key === "--apply") {
      flags.add("apply");
      continue;
    }
    const value = process.argv[index + 1];
    if (!value || value.startsWith("--"))
      throw new Error(`Expected a value after ${key}.`);
    values.set(key.slice(2), value);
    index++;
  }
  return { values, flags };
}

function databaseName(connectionString: string, variable: string) {
  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error(`${variable} must be a valid PostgreSQL URL.`);
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol))
    throw new Error(`${variable} must use the postgres protocol.`);
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!name) throw new Error(`${variable} must identify a database.`);
  return name;
}

async function inTransaction<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
) {
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

async function main() {
  loadEnvConfig(process.cwd());
  const { values, flags } = argumentsMap();
  const target = values.get("database") as Target | undefined;
  if (target !== "test" && target !== "development")
    throw new Error("--database must be explicitly set to test or development.");
  const variable =
    target === "test" ? "TEST_DATABASE_URL" : "DATABASE_MIGRATION_URL";
  const connectionString = process.env[variable];
  if (!connectionString) throw new Error(`${variable} is required.`);
  const expectedName = databaseName(connectionString, variable);
  if (target === "test" && !expectedName.endsWith("_test"))
    throw new Error(
      "Refusing unsafe test target: database name must end with _test.",
    );
  if (target === "development") {
    if (
      process.env.NODE_ENV === "production" ||
      /(^|[_-])prod(uction)?($|[_-])/i.test(expectedName)
    )
      throw new Error("Refusing to reconcile an apparent production database.");
    if (values.get("confirm-database-name") !== expectedName)
      throw new Error(
        "Development reconciliation requires --confirm-database-name with the exact parsed database name.",
      );
  }
  const apply = flags.has("apply");
  const pool = new Pool({ connectionString, max: 1 });
  try {
    const current = await pool.query<{ name: string }>(
      "SELECT current_database() AS name",
    );
    if (current.rows[0]?.name !== expectedName)
      throw new Error(
        "Connected database does not match the explicitly confirmed target.",
      );
    const requests = await pool.query<{ id: string }>(
      `SELECT id FROM access_request
        WHERE status = 'pending_routing'
        ORDER BY submitted_at, id`,
    );
    let routeable = 0;
    let routed = 0;
    for (const request of requests.rows) {
      if (!apply) {
        const client = await pool.connect();
        try {
          if (await previewRequestRoute(client, request.id)) routeable++;
        } finally {
          client.release();
        }
        continue;
      }
      const result = await inTransaction(pool, (client) =>
        routePendingRequest(client, request.id, null),
      );
      if (result.routed) routed++;
    }
    if (apply)
      console.log(
        `Reconciliation applied: ${routed} routed; ${requests.rows.length - routed} preserved unassigned.`,
      );
    else
      console.log(
        `Dry run: ${routeable} routeable; ${requests.rows.length - routeable} would remain unassigned. Re-run with --apply to commit routing.`,
      );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(
    "Approval routing reconciliation failed:",
    error instanceof Error ? error.message : "Unknown error.",
  );
  process.exitCode = 1;
});
