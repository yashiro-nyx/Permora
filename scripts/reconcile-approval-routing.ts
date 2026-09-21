import { Pool, type PoolClient } from "pg";
import {
  previewRequestRoute,
  routePendingRequest,
} from "../lib/approval-domain";
import {
  extractDatabaseTargetOptions,
  resolveCliDatabase,
} from "./database-target";

const HELP = `Permora approval-routing reconciliation

Usage:
  npm run approvals:reconcile -- --database-target <development|test|production> [--confirm-production] [--confirm-database-name <name>] [--apply]

The command is a dry run unless --apply is present. Development additionally
requires --confirm-database-name. Test uses only TEST_DATABASE_URL and requires
a database ending in _test. Production requires both URLs in the current process
and --confirm-production; .env.local is not loaded.`;

function argumentsMap(argv: string[]) {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index];
    if (!key.startsWith("--")) throw new Error(`Unexpected argument ${key}.`);
    if (key === "--apply") {
      flags.add("apply");
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--"))
      throw new Error(`Expected a value after ${key}.`);
    values.set(key.slice(2), value);
    index++;
  }
  return { values, flags };
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
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(HELP);
    return;
  }
  const { options: databaseOptions, remaining } =
    extractDatabaseTargetOptions(argv);
  const { values, flags } = argumentsMap(remaining);
  const { target, connectionString, databaseName: expectedName } =
    resolveCliDatabase(databaseOptions);
  if (target === "development") {
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
