import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";
import { hashPassword } from "../lib/server/password";

type Role = "student" | "faculty" | "approver" | "admin";

const HELP = `Permora account provisioning

Usage:
  npm run account:provision -- --email <email> --name <full-name> --role <role> [options] (--bootstrap-admin | --authorized-admin <admin-internal-uuid>)

Required flags:
  --email <email>                 Login email for the new account.
  --name <full-name>              Display name for the new account.
  --role <role>                   One of: admin, approver, student, faculty.

Authorization flags:
  --bootstrap-admin               Create the first administrator only. The role
                                  must be admin, and no active administrator may
                                  already exist. Do not combine with
                                  --authorized-admin.
  --authorized-admin <internal-uuid>
                                  Required for every non-bootstrap account. The
                                  value must identify an active administrator;
                                  it is not an email or institutional number.

Optional profile and institutional identifier flags:
  --department <department>       Department or organizational unit.
  --identifier-type <type>        One of: student_number, staff_number.
  --identifier <value>            Institutional identifier value.
  --issuer <namespace>            Institution-controlled identifier namespace.

  The three identifier flags must be supplied together. Institutional identifiers
  remain separate from Permora's internal user UUID.

Examples:
  # First administrator
  npm run account:provision -- --email <admin-email> --name "<admin-name>" --role admin --department "<department>" --bootstrap-admin

  # Approver
  npm run account:provision -- --email <approver-email> --name "<approver-name>" --role approver --department "<department>" --identifier-type staff_number --identifier <staff-number> --issuer <institution-namespace> --authorized-admin <admin-internal-uuid>

  # Student
  npm run account:provision -- --email <student-email> --name "<student-name>" --role student --department "<department>" --identifier-type student_number --identifier <student-number> --issuer <institution-namespace> --authorized-admin <admin-internal-uuid>

  # Faculty
  npm run account:provision -- --email <faculty-email> --name "<faculty-name>" --role faculty --department "<department>" --identifier-type staff_number --identifier <staff-number> --issuer <institution-namespace> --authorized-admin <admin-internal-uuid>

Passwords are requested twice through hidden terminal input and must contain
12–128 characters. Passwords must never be passed as command-line arguments.`;

const valueArguments = new Set([
  "email",
  "name",
  "role",
  "department",
  "authorized-admin",
  "identifier-type",
  "identifier",
  "issuer",
]);
const booleanArguments = new Set(["bootstrap-admin"]);

function safeFailureMessage(error: unknown) {
  if (!(error instanceof Error)) return "Unknown error.";
  if ("code" in error)
    return "Database operation failed. No changes were committed.";
  return error.message;
}

function argumentsMap(argv: string[]) {
  const values = new Map<string, string | true>();
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (!argument.startsWith("--") || argument.includes("="))
      throw new Error("Unknown argument. Use --help to see supported flags.");
    const key = argument.slice(2);
    if (!valueArguments.has(key) && !booleanArguments.has(key))
      throw new Error(`Unknown argument --${key}. Use --help for usage.`);
    if (values.has(key)) throw new Error(`Argument --${key} was supplied twice.`);
    if (booleanArguments.has(key)) {
      const next = argv[index + 1];
      if (next && !next.startsWith("--"))
        throw new Error(`--${key} does not accept a value.`);
      values.set(key, true);
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith("--"))
      throw new Error(`Missing value for --${key}.`);
    values.set(key, next);
    index++;
  }
  return values;
}

function requiredString(args: Map<string, string | true>, key: string) {
  const value = args.get(key);
  if (typeof value !== "string" || !value.trim())
    throw new Error(`Missing required argument: --${key}.`);
  return value.trim();
}

function validatedArguments(argv: string[]) {
  const args = argumentsMap(argv);
  const email = requiredString(args, "email").toLowerCase();
  const name = requiredString(args, "name");
  const role = requiredString(args, "role") as Role;
  const department = String(args.get("department") ?? "").trim();
  const bootstrap = args.get("bootstrap-admin") === true;
  const authorizedAdmin = String(args.get("authorized-admin") ?? "").trim();
  const identifierType = args.get("identifier-type");
  const identifier = String(args.get("identifier") ?? "").trim();
  const issuer = String(args.get("issuer") ?? "").trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error("--email must be valid.");
  if (name.length < 2) throw new Error("--name must contain at least 2 characters.");
  if (!["student", "faculty", "approver", "admin"].includes(role))
    throw new Error("--role must be student, faculty, approver, or admin.");
  if (bootstrap && role !== "admin")
    throw new Error("--bootstrap-admin can only create an administrator.");
  if (bootstrap && authorizedAdmin)
    throw new Error(
      "--bootstrap-admin and --authorized-admin cannot be used together.",
    );
  if (!bootstrap && !authorizedAdmin)
    throw new Error(
      "--authorized-admin is required for non-bootstrap provisioning.",
    );
  if (identifierType || identifier || issuer) {
    if (
      !["student_number", "staff_number"].includes(String(identifierType)) ||
      !identifier ||
      !issuer
    )
      throw new Error(
        "--identifier-type, --identifier, and --issuer must be supplied together; supported types are student_number and staff_number.",
      );
  }
  return {
    email,
    name,
    role,
    department,
    bootstrap,
    authorizedAdmin,
    identifierType,
    identifier,
    issuer,
  };
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
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(HELP);
    return;
  }
  const {
    email,
    name,
    role,
    department,
    bootstrap,
    authorizedAdmin,
    identifierType,
    identifier,
    issuer,
  } = validatedArguments(argv);
  loadEnvConfig(process.cwd());
  const connectionString = process.env.DATABASE_MIGRATION_URL;
  if (!connectionString) throw new Error("DATABASE_MIGRATION_URL is required.");
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
      if (identifierType || identifier || issuer) {
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
