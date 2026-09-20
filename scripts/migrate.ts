import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";

async function main() {
  loadEnvConfig(process.cwd());
  const connectionString = process.env.DATABASE_MIGRATION_URL;
  if (!connectionString)
    throw new Error("DATABASE_MIGRATION_URL is required.");

  const pool = new Pool({ connectionString, max: 1 });
  let client;
  try {
    client = await pool.connect();
    try {
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
