import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";
import { hashPassword } from "../lib/server/password";

type Role = "student" | "faculty" | "approver" | "admin";

function safeFailureMessage(error: unknown) {
  if (!(error instanceof Error)) return "Unknown error.";
  if ("code" in error)
    return "Database operation failed. No changes were committed.";
  return error.message;
}

function argumentsMap() {
  const values = new Map<string, string | true>();
  for (let index = 2; index < process.argv.length; index++) {
    const key = process.argv[index];
    if (!key.startsWith("--")) throw new Error(`Unexpected argument: ${key}`);
    const next = process.argv[index + 1];
    if (!next || next.startsWith("--")) values.set(key.slice(2), true);
    else {
      values.set(key.slice(2), next);
      index++;
    }
  }
  return values;
}

async function hiddenPrompt(label: string) {
  if (
    !process.stdin.isTTY ||
    !process.stdout.isTTY ||
    !process.stdin.setRawMode
  )
    throw new Error(
      "A private interactive terminal is required for password entry.",
    );
  process.stdout.write(label);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  return new Promise<string>((resolve, reject) => {
    let value = "";
    const finish = (error?: Error) => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("data", onData);
      process.stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk: string) => {
      for (const character of chunk) {
        if (character === "\u0003") return finish(new Error("Cancelled."));
        if (character === "\r" || character === "\n") return finish();
        if (character === "\u007f") value = value.slice(0, -1);
        else value += character;
      }
    };
    process.stdin.on("data", onData);
  });
}

async function main() {
  loadEnvConfig(process.cwd());
  const args = argumentsMap();
  const connectionString = process.env.DATABASE_MIGRATION_URL;
  if (!connectionString) throw new Error("DATABASE_MIGRATION_URL is required.");
  const email = String(args.get("email") ?? "")
    .trim()
    .toLowerCase();
  const name = String(args.get("name") ?? "").trim();
  const role = String(args.get("role") ?? "") as Role;
  const department = String(args.get("department") ?? "").trim();
  const bootstrap = args.get("bootstrap-admin") === true;
  const authorizedAdmin = String(args.get("authorized-admin") ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error("--email must be valid.");
  if (name.length < 2) throw new Error("--name is required.");
  if (!["student", "faculty", "approver", "admin"].includes(role))
    throw new Error("--role must be student, faculty, approver, or admin.");
  if (bootstrap && role !== "admin")
    throw new Error("--bootstrap-admin can only create an administrator.");
  if (!bootstrap && !authorizedAdmin)
    throw new Error(
      "--authorized-admin is required for non-bootstrap provisioning.",
    );
  const password = await hiddenPrompt("New account password (input hidden): ");
  const confirmation = await hiddenPrompt("Confirm password (input hidden): ");
  if (password !== confirmation) throw new Error("Passwords do not match.");
  if (password.length < 12 || password.length > 128)
    throw new Error("Password must be 12–128 characters.");
  const passwordHash = await hashPassword(password);

  const pool = new Pool({ connectionString, max: 1 });
  let client;
  try {
    client = await pool.connect();
    const id = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(73020422)");
      const existing = await client.query(
        'SELECT 1 FROM "user" WHERE lower(email) = $1',
        [email],
      );
      if (existing.rows[0])
        throw new Error(
          "An account with this email already exists. No changes were made.",
        );
      let actorId: string = id;
      if (bootstrap) {
        const administrators = await client.query(
          `SELECT 1 FROM user_role ur JOIN user_profile p ON p.user_id = ur.user_id WHERE ur.role = 'admin' AND p.active LIMIT 1`,
        );
        if (administrators.rows[0])
          throw new Error(
            "An active administrator already exists. Bootstrap was refused.",
          );
      } else {
        const administrator = await client.query(
          `SELECT ur.user_id FROM user_role ur JOIN user_profile p ON p.user_id = ur.user_id WHERE ur.user_id::text = $1 AND ur.role = 'admin' AND p.active`,
          [authorizedAdmin],
        );
        if (!administrator.rows[0])
          throw new Error(
            "--authorized-admin must identify an active administrator.",
          );
        actorId = authorizedAdmin;
      }
      const now = new Date();
      await client.query(
        `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES ($1,$2,$3,true,$4,$4)`,
        [id, name, email, now],
      );
      await client.query(
        "INSERT INTO user_profile (user_id, department, requester_role) VALUES ($1,$2,$3)",
        [
          id,
          department,
          role === "student" || role === "faculty" ? role : null,
        ],
      );
      await client.query(
        "INSERT INTO user_role (user_id, role, assigned_by) VALUES ($1,$2,$3)",
        [id, role, bootstrap ? null : actorId],
      );
      await client.query(
        `INSERT INTO account (id, "userId", "accountId", "providerId", password, "createdAt", "updatedAt") VALUES ($1,$2::uuid,$2::text,'credential',$3,$4,$4)`,
        [randomUUID(), id, passwordHash, now],
      );
      const identifierType = args.get("identifier-type");
      const identifier = String(args.get("identifier") ?? "").trim();
      const issuer = String(args.get("issuer") ?? "").trim();
      if (identifierType || identifier || issuer) {
        if (
          !["student_number", "staff_number"].includes(
            String(identifierType),
          ) ||
          !identifier ||
          !issuer
        )
          throw new Error(
            "--identifier-type, --identifier, and --issuer must be supplied together.",
          );
        await client.query(
          "INSERT INTO institutional_identifier (id, user_id, identifier_type, issuer, normalized_value) VALUES ($1,$2,$3,$4,$5)",
          [randomUUID(), id, identifierType, issuer, identifier.toUpperCase()],
        );
      }
      await client.query(
        "INSERT INTO audit_event (id, actor_user_id, subject_user_id, event_type, metadata) VALUES ($1,$2,$3,'account.provisioned',$4::jsonb)",
        [randomUUID(), actorId, id, JSON.stringify({ role, bootstrap })],
      );
      await client.query("COMMIT");
      console.log(`Created ${role} account ${id} for ${email}.`);
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
  console.error("Account provisioning failed:", safeFailureMessage(error));
  process.exitCode = 1;
});
