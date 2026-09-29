import { Pool, type PoolClient } from "pg";
import {
  expireActivatedEntitlement,
  listExpiredActivationCandidates,
} from "../lib/activation-maintenance";
import {
  extractDatabaseTargetOptions,
  resolveCliDatabase,
} from "./database-target";

const HELP = `Permora activation expiration

Usage:
  npm run activations:expire -- --database-target <development|test|production> [--confirm-production] [--confirm-database-name <name>] [--apply]

Scans activated access whose validity window has ended. Dry-run is the default;
--apply records the terminal expired lifecycle event and state. Test requires a
database ending in _test. Development requires --confirm-database-name;
production requires --confirm-production.`;

function parseArguments(argv: string[]) {
  const values = new Map<string, string>();
  let apply = false;
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index];
    if (key === "--apply") {
      if (apply) throw new Error("--apply was supplied more than once.");
      apply = true;
      continue;
    }
    if (!key.startsWith("--")) throw new Error(`Unexpected argument ${key}.`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--"))
      throw new Error(`Expected a value after ${key}.`);
    if (values.has(key.slice(2)))
      throw new Error(`${key} was supplied more than once.`);
    values.set(key.slice(2), value);
    index++;
  }
  return { values, apply };
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
  const { options, remaining } = extractDatabaseTargetOptions(argv);
  const { values, apply } = parseArguments(remaining);
  const { target, connectionString, databaseName } = resolveCliDatabase(options);
  if (
    target === "development" &&
    values.get("confirm-database-name") !== databaseName
  )
    throw new Error(
      "Development expiration requires --confirm-database-name with the exact parsed database name.",
    );

  const pool = new Pool({ connectionString, max: 1 });
  try {
    const current = await pool.query<{ name: string }>(
      "SELECT current_database() AS name",
    );
    if (current.rows[0]?.name !== databaseName)
      throw new Error("Connected database does not match the guarded target.");
    const client = await pool.connect();
    let candidates;
    try {
      candidates = await listExpiredActivationCandidates(client);
    } finally {
      client.release();
    }
    if (!apply) {
      console.log(
        `Dry run: ${candidates.length} activated entitlement(s) past their validity window. No changes made. Re-run with --apply to expire them.`,
      );
      return;
    }

    let expired = 0;
    for (const candidate of candidates) {
      const result = await inTransaction(pool, (transactionClient) =>
        expireActivatedEntitlement(transactionClient, candidate.activationId),
      );
      if (result.expired) expired++;
    }
    console.log(`Expiration applied: ${expired} activation(s) moved to expired.`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(
    "Activation expiration failed:",
    error instanceof Error ? error.message : "Unknown error.",
  );
  process.exitCode = 1;
});
