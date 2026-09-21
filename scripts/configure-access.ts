import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import {
  extractDatabaseTargetOptions,
  resolveCliDatabase,
} from "./database-target";

const HELP = `Permora access configuration

Usage:
  npm run access:configure -- <scope|assignment|approver|entitlement> --database-target <development|test|production> [command flags] [--confirm-production]

Database targets:
  development  Loads and validates DATABASE_URL plus DATABASE_MIGRATION_URL.
  test         Uses only guarded TEST_DATABASE_URL; its name must end in _test.
  production   Requires both URLs in the current process and the explicit
               --confirm-production flag. .env.local is not loaded.

Examples:
  npm run access:configure -- approver --database-target development --actor <admin-uuid> --approver <approver-uuid> --resource <resource-id> --permission <permission-id>
  npm run access:configure -- assignment --database-target production --confirm-production --actor <admin-uuid> --user <requester-uuid> --resource <resource-id> --scope <scope-uuid> --evidence "<verified-evidence>"`;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeFailureMessage(error: unknown) {
  if (!(error instanceof Error)) return "Unknown error.";
  if ("code" in error)
    return "Database operation failed. No changes were committed.";
  return error.message;
}

function argumentsMap(argv: string[]) {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key.startsWith("--") || !value || value.startsWith("--"))
      throw new Error(`Expected a value after ${key}.`);
    values.set(key.slice(2), value);
    index++;
  }
  return values;
}

async function requireAdministrator(client: PoolClient, actor: string) {
  const result = await client.query(
    `SELECT 1 FROM user_role ur JOIN user_profile p ON p.user_id = ur.user_id WHERE ur.user_id = $1::uuid AND ur.role = 'admin' AND p.active`,
    [actor],
  );
  if (!result.rows[0])
    throw new Error("--actor must identify an active administrator.");
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(HELP);
    return;
  }
  const command = argv[0];
  if (
    !command ||
    !["scope", "assignment", "approver", "entitlement"].includes(command)
  )
    throw new Error(
      "Command must be scope, assignment, approver, or entitlement.",
    );
  const { options: databaseOptions, remaining } =
    extractDatabaseTargetOptions(argv.slice(1));
  const args = argumentsMap(remaining);
  const required = (name: string) => {
    const value = args.get(name)?.trim();
    if (!value) throw new Error(`--${name} is required.`);
    return value;
  };
  const requiredUuid = (name: string) => {
    const value = required(name);
    if (!UUID.test(value)) throw new Error(`--${name} must be a valid UUID.`);
    return value;
  };
  const actor = requiredUuid("actor");
  const { connectionString } = resolveCliDatabase(databaseOptions);

  const pool = new Pool({ connectionString, max: 1 });
  let client;
  try {
    client = await pool.connect();
    try {
      await client.query("BEGIN");
      await requireAdministrator(client, actor);
      let successMessage: string;
      if (command === "scope") {
        const id = randomUUID();
        await client.query(
          `INSERT INTO scope_option (id, resource_id, field_name, institutional_code, display_name, valid_from, valid_until)
      SELECT $1,$2,$3,$4,$5,$6,$7 WHERE EXISTS (SELECT 1 FROM catalog_scope_field WHERE resource_id = $2 AND field_name = $3)`,
          [
            id,
            required("resource"),
            required("field"),
            required("code").toUpperCase(),
            required("name"),
            args.get("valid-from") ?? null,
            args.get("valid-until") ?? null,
          ],
        );
        if (
          (await client.query("SELECT 1 FROM scope_option WHERE id = $1", [id]))
            .rowCount !== 1
        )
          throw new Error("The resource/field combination is not configured.");
        successMessage = `Created scope option ${id}.`;
      } else if (command === "assignment") {
        const id = randomUUID();
        const user = requiredUuid("user");
        const scope = requiredUuid("scope");
        await client.query(
          `INSERT INTO requester_assignment (id, user_id, resource_id, scope_option_id, permission_id, evidence, valid_from, valid_until, assigned_by)
      SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9
      WHERE EXISTS (SELECT 1 FROM user_profile WHERE user_id = $2::uuid AND active)
        AND EXISTS (SELECT 1 FROM scope_option WHERE id = $4::uuid AND resource_id = $3)`,
          [
            id,
            user,
            required("resource"),
            scope,
            args.get("permission") ?? null,
            required("evidence"),
            args.get("valid-from") ?? new Date().toISOString(),
            args.get("valid-until") ?? null,
            actor,
          ],
        );
        if (
          (
            await client.query(
              "SELECT 1 FROM requester_assignment WHERE id = $1",
              [id],
            )
          ).rowCount !== 1
        )
          throw new Error("The user or scope is not active for this resource.");
        successMessage = `Created requester assignment ${id}.`;
      } else if (command === "approver") {
        const id = randomUUID();
        const approver = requiredUuid("approver");
        const resource = required("resource");
        const scopeIds = (args.get("scopes") ?? args.get("scope") ?? "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean);
        if (scopeIds.some((scopeId) => !UUID.test(scopeId)))
          throw new Error("--scope and --scopes must contain valid UUIDs.");
        const validScopes = scopeIds.length
          ? await client.query<{ id: string }>(
              `SELECT id FROM scope_option
                WHERE id = ANY($1::uuid[]) AND resource_id = $2`,
              [scopeIds, resource],
            )
          : { rows: [] };
        if (
          new Set(validScopes.rows.map((scope) => scope.id)).size !==
          new Set(scopeIds).size
        )
          throw new Error(
            "One or more approver scopes are invalid for the resource.",
          );
        await client.query(
          `INSERT INTO approver_responsibility (id, approver_user_id, resource_id, permission_id, scope_option_id, valid_from, valid_until, assigned_by)
      SELECT $1,$2,$3,$4,$5,$6,$7,$8
      WHERE EXISTS (SELECT 1 FROM user_profile p JOIN user_role ur ON ur.user_id = p.user_id WHERE p.user_id = $2::uuid AND p.active AND ur.role IN ('approver','admin'))`,
          [
            id,
            approver,
            resource,
            args.get("permission") ?? null,
            scopeIds[0] ?? null,
            args.get("valid-from") ?? new Date().toISOString(),
            args.get("valid-until") ?? null,
            actor,
          ],
        );
        if (
          (
            await client.query(
              "SELECT 1 FROM approver_responsibility WHERE id = $1",
              [id],
            )
          ).rowCount !== 1
        )
          throw new Error(
            "The approver account is inactive or lacks an approver/administrator role.",
          );
        for (const scopeId of new Set(scopeIds))
          await client.query(
            `INSERT INTO approver_responsibility_scope
              (responsibility_id, resource_id, scope_option_id)
             VALUES ($1,$2,$3)`,
            [id, resource, scopeId],
          );
        successMessage = `Created approver responsibility ${id}.`;
      } else {
        const user = requiredUuid("user");
        const resource = required("resource");
        const permission = required("permission");
        const scopeIds = (args.get("scopes") ?? "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean);
        if (scopeIds.some((scopeId) => !UUID.test(scopeId)))
          throw new Error("--scopes must contain valid UUIDs.");
        const scopes = scopeIds.length
          ? await client.query<{ id: string; field_name: string }>(
              "SELECT id, field_name FROM scope_option WHERE id = ANY($1::uuid[]) AND resource_id = $2",
              [scopeIds, resource],
            )
          : { rows: [] };
        if (scopes.rows.length !== scopeIds.length)
          throw new Error("One or more --scopes are invalid for the resource.");
        const fingerprint =
          resource === "r-student-portal"
            ? `own-account:${user}`
            : scopes.rows
                .map((scope) => `${scope.field_name}:${scope.id}`)
                .sort()
                .join("|") || "resource-wide";
        const id = randomUUID();
        await client.query(
          `INSERT INTO ordinary_entitlement (id, user_id, resource_id, permission_id, scope_fingerprint, evidence, valid_from, valid_until, recorded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            id,
            user,
            resource,
            permission,
            fingerprint,
            required("evidence"),
            args.get("valid-from") ?? new Date().toISOString(),
            args.get("valid-until") ?? null,
            actor,
          ],
        );
        successMessage = `Created ordinary entitlement ${id}.`;
      }
      await client.query(
        "INSERT INTO audit_event (id, actor_user_id, event_type, metadata) VALUES ($1,$2,$3,$4::jsonb)",
        [
          randomUUID(),
          actor,
          `configuration.${command}.created`,
          JSON.stringify({ command }),
        ],
      );
      await client.query("COMMIT");
      console.log(successMessage);
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
  console.error("Access configuration failed:", safeFailureMessage(error));
  process.exitCode = 1;
});
