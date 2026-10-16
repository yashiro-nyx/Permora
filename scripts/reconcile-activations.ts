import { Pool, type PoolClient } from "pg";
import {
  listStuckActivationCandidates,
  reconcileStuckActivation,
} from "../lib/activation-maintenance";
import {
  extractDatabaseTargetOptions,
  resolveCliDatabase,
} from "./database-target";

const HELP = `Permora activation reconciliation

Usage:
  npm run activations:reconcile -- --database-target <development|test|production> [--confirm-production] [--confirm-database-name <name>] [--apply]

Scans activations stuck in 'activating' for at least 15 minutes. Dry-run is the
default. Apply marks valid-but-unknown manual attempts failed/retryable, or
records non-retryable failure when current request eligibility/policy changed.
It never repeats a manual provisioning side effect. Test requires a database
ending in _test. Development requires --confirm-database-name; production
requires --confirm-production.`;

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
      "Development reconciliation requires --confirm-database-name with the exact parsed database name.",
    );

  const pool = new Pool({ connectionString, max: 1 });
  try {
    const current = await pool.query<{ name: string }>(
      "SELECT current_database() AS name",
    );
    if (current.rows[0]?.name !== databaseName)
      throw new Error("Connected database does not match the guarded target.");
    const scanClient = await pool.connect();
    let candidates;
    try {
      candidates = await listStuckActivationCandidates(scanClient);
    } finally {
      scanClient.release();
    }
    if (!apply) {
      console.log(
        `Dry run: ${candidates.length} activation(s) stuck for at least 15 minutes. No changes made. Re-run with --apply to reconcile.`,
      );
      return;
    }

    let failed = 0;
    let recovered = 0;
    let skipped = 0;
    for (const candidate of candidates) {
      const result = await inTransaction(pool, (client) =>
        reconcileStuckActivation(client, candidate.activationId),
      );
      if (result.action === "failed") failed++;
      else if (result.action === "recovered") recovered++;
      else skipped++;
    }
    console.log(
      `Reconciliation applied: ${failed} marked failed; ${recovered} prior outcomes recovered; ${skipped} skipped.`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(
    "Activation reconciliation failed:",
    error instanceof Error ? error.message : "Unknown error.",
  );
  process.exitCode = 1;
});
