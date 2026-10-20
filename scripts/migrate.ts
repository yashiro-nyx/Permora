import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import {
  extractDatabaseTargetOptions,
  assertPreviewIdentity,
  resolveCliDatabase,
} from "./database-target";

const HELP = `Permora database migration

Usage:
  npm run db:migrate -- --database-target <development|test|preview|production> [--confirm-production]

Targets:
  development  Loads DATABASE_URL and DATABASE_MIGRATION_URL from the current
               process or .env.local and verifies that both target the same database.
  test         Uses only TEST_DATABASE_URL and requires a database ending in _test.
  preview      Uses only PREVIEW_DATABASE_URL, PREVIEW_DATABASE_MIGRATION_URL,
               PREVIEW_DATABASE_NAME, and PREVIEW_NEON_{PROJECT,BRANCH,ENDPOINT}_ID.
               It never loads .env.local and verifies Neon identity before writes.
  production   Requires DATABASE_URL and DATABASE_MIGRATION_URL in the current
               process plus --confirm-production. .env.local is not loaded.

Production example (inject both values through an approved secret manager):
  npm run db:migrate -- --database-target production --confirm-production`;

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(HELP);
    return;
  }
  const { options, remaining } = extractDatabaseTargetOptions(argv);
  if (remaining.length)
    throw new Error(`Unknown argument ${remaining[0]}. Use --help for usage.`);
  const resolved = resolveCliDatabase(options);
  const { connectionString } = resolved;

  const pool = new Pool({ connectionString, max: 1 });
  let client;
  try {
    client = await pool.connect();
    try {
      if (resolved.expectedNeonIdentity) {
        const identity = await client.query<{
          database_name: string;
          project_id: string | null;
          branch_id: string | null;
          endpoint_id: string | null;
        }>(`SELECT current_database() AS database_name,
                   current_setting('neon.project_id', true) AS project_id,
                   current_setting('neon.branch_id', true) AS branch_id,
                   current_setting('neon.endpoint_id', true) AS endpoint_id`);
        const row = identity.rows[0];
        assertPreviewIdentity(
          resolved.expectedNeonIdentity,
          {
            databaseName: row.database_name,
            projectId: row.project_id ?? "",
            branchId: row.branch_id ?? "",
            endpointId: row.endpoint_id ?? "",
          },
          resolved.databaseName,
        );
      }
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(73020421)");
      await client.query(`CREATE TABLE IF NOT EXISTS schema_migration (
        version text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
      const directory = path.join(process.cwd(), "db", "migrations");
      const files = (await readdir(directory))
        .filter((name) => /^\d+.*\.sql$/.test(name))
        .sort();
      const applied = await client.query<{ version: string }>(
        "SELECT version FROM schema_migration",
      );
      const versions = new Set(applied.rows.map((row) => row.version));
      for (const file of files) {
        if (versions.has(file)) continue;
        await client.query(await readFile(path.join(directory, file), "utf8"));
        await client.query(
          "INSERT INTO schema_migration (version) VALUES ($1)",
          [file],
        );
        console.log(`Applied ${file}`);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(
    "Migration failed:",
    error instanceof Error ? error.message : "Unknown error.",
  );
  process.exitCode = 1;
});
