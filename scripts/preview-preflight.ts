import { readdir } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import {
  assertPreviewIdentity,
  extractDatabaseTargetOptions,
  resolveCliDatabase,
} from "./database-target";

function migrationVersions() {
  return readdir(path.join(process.cwd(), "db", "migrations")).then((files) =>
    files.filter((file) => /^\d+.*\.sql$/.test(file)).sort(),
  );
}

async function main() {
  const { options, remaining } = extractDatabaseTargetOptions(
    process.argv.slice(2),
  );
  if (remaining.length) throw new Error(`Unknown argument ${remaining[0]}.`);
  if (options.target !== "preview")
    throw new Error("Preview preflight requires --database-target preview.");

  const resolved = resolveCliDatabase(options);
  if (!resolved.expectedNeonIdentity)
    throw new Error("Preview identity expectations are missing.");

  const pool = new Pool({ connectionString: resolved.connectionString, max: 1 });
  try {
    const client = await pool.connect();
    try {
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

      const migrationTable = await client.query<{ exists: boolean }>(
        "SELECT to_regclass('public.schema_migration') IS NOT NULL AS exists",
      );
      const applied = migrationTable.rows[0].exists
        ? await client.query<{ version: string }>(
            "SELECT version FROM schema_migration ORDER BY version",
          )
        : { rows: [] as { version: string }[] };
      const local = await migrationVersions();
      const appliedVersions = new Set(applied.rows.map((row) => row.version));
      const pending = local.filter((version) => !appliedVersions.has(version));

      const duplicateAssignments = await client.query(
        `SELECT request_id, count(*)::int AS count
           FROM request_review_assignment
          WHERE status = 'assigned'
          GROUP BY request_id
         HAVING count(*) > 1`,
      );
      const duplicateNotifications = await client.query(
        `SELECT request_event_id, recipient_user_id, count(*)::int AS count
           FROM user_notification
          GROUP BY request_event_id, recipient_user_id
         HAVING count(*) > 1`,
      );

      console.log(
        JSON.stringify(
          {
            target: "preview",
            database: row.database_name,
            neon: {
              projectId: row.project_id,
              branchId: row.branch_id,
              endpointId: row.endpoint_id,
            },
            migrationTablePresent: migrationTable.rows[0].exists,
            appliedMigrations: applied.rows.map((item) => item.version),
            pendingMigrations: pending,
            requestedPreflightRange: local.filter((version) =>
              /^(0011|0012|0013|0014)/.test(version),
            ),
            duplicateOpenAssignments: duplicateAssignments.rowCount ?? 0,
            duplicateNotificationPairs: duplicateNotifications.rowCount ?? 0,
            mode: "read-only",
          },
          null,
          2,
        ),
      );
    } finally {
      client.release();
    }
  } catch (error) {
    if (error instanceof Error && /password|postgres(?:ql)?:\/\//i.test(error.message))
      throw new Error("Preview preflight failed without exposing connection details.");
    throw error;
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(
    "Preview preflight failed:",
    error instanceof Error ? error.message : "Unknown error.",
  );
  process.exitCode = 1;
});
