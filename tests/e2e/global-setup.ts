import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { Pool, type PoolClient } from "pg";
import { E2E, e2ePassword } from "./staff-fixture";

function safeTestDatabaseUrl() {
  const value = process.env.TEST_DATABASE_URL;
  if (!value) throw new Error("TEST_DATABASE_URL is required for browser tests.");
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("TEST_DATABASE_URL must be a valid PostgreSQL URL.");
  }
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !name.endsWith("_test")
  )
    throw new Error(
      "Refusing browser fixtures: TEST_DATABASE_URL must name a PostgreSQL database ending in _test.",
    );
  return value;
}

async function migrate(client: PoolClient) {
  await client.query("DROP SCHEMA public CASCADE");
  await client.query("CREATE SCHEMA public");
  await client.query(`CREATE TABLE schema_migration (
    version text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const directory = path.join(process.cwd(), "db", "migrations");
  const files = (await readdir(directory))
    .filter((name) => /^\d+.*\.sql$/.test(name))
    .sort();
  for (const file of files) {
    await client.query(await readFile(path.join(directory, file), "utf8"));
    await client.query("INSERT INTO schema_migration (version) VALUES ($1)", [
      file,
    ]);
  }
}

async function user(
  client: PoolClient,
  passwordHash: string,
  input: {
    id: string;
    email: string;
    name: string;
    role: "student" | "approver" | "admin";
  },
) {
  await client.query(
    `INSERT INTO "user" (id,name,email,"emailVerified")
     VALUES ($1,$2,$3,true)`,
    [input.id, input.name, input.email],
  );
  await client.query(
    `INSERT INTO user_profile (user_id,department,requester_role)
     VALUES ($1,$2,$3)`,
    [
      input.id,
      input.role === "student" ? "Engineering" : "Academic Services",
      input.role === "student" ? "student" : null,
    ],
  );
  await client.query("INSERT INTO user_role (user_id,role) VALUES ($1,$2)", [
    input.id,
    input.role,
  ]);
  await client.query(
    `INSERT INTO account
      (id,"userId","accountId","providerId",password)
     VALUES ($1,$2::uuid,$2::text,'credential',$3)`,
    [randomUUID(), input.id, passwordHash],
  );
}

async function responsibility(
  client: PoolClient,
  id: string,
  approverId: string,
) {
  await client.query(
    `INSERT INTO approver_responsibility
      (id,approver_user_id,resource_id,permission_id,valid_from,assigned_by)
     VALUES ($1,$2,'r-library','library:subscribed-materials',now() - interval '1 day',$3)`,
    [id, approverId, E2E.administrator.id],
  );
}

async function request(
  client: PoolClient,
  input: {
    id: string;
    displayId: string;
    submittedHoursAgo: number;
    approverId?: string;
    responsibilityId?: string;
  },
) {
  await client.query(
    `INSERT INTO access_request
      (id,display_id,requester_user_id,resource_id,permission_id,
       policy_version_id,purpose,starts_at,expires_at,status,scope_fingerprint,
       submitted_at,created_at,updated_at)
     VALUES ($1,$2,$3,'r-library','library:subscribed-materials',
       '10000000-0000-4000-8000-000000000004',
       'Access to subscribed research materials for the capstone literature review.',
       now() + interval '1 day',now() + interval '31 days',$4,'resource-wide',
       now() - ($5 * interval '1 hour'),now(),now())`,
    [
      input.id,
      input.displayId,
      E2E.requester.id,
      input.approverId ? "pending_review" : "pending_routing",
      input.submittedHoursAgo,
    ],
  );
  await client.query(
    `INSERT INTO request_submission_history
      (id,request_id,actor_user_id,event_type,occurred_at,detail)
     VALUES ($1,$2,$3,'submitted',
       now() - ($4 * interval '1 hour'),'Access request submitted.')`,
    [randomUUID(), input.id, E2E.requester.id, input.submittedHoursAgo],
  );
  if (input.approverId && input.responsibilityId) {
    await client.query(
      `INSERT INTO request_review_assignment
        (id,request_id,approver_user_id,responsibility_id,assigned_at)
       VALUES ($1,$2,$3,$4,
         now() - (($5 - 0.1) * interval '1 hour'))`,
      [
        randomUUID(),
        input.id,
        input.approverId,
        input.responsibilityId,
        input.submittedHoursAgo,
      ],
    );
    await client.query(
      `INSERT INTO request_event
        (id,request_id,actor_user_id,event_type,occurred_at,detail)
       VALUES ($1,$2,NULL,'request_routed',
         now() - (($3 - 0.1) * interval '1 hour'),
         'Request assigned to an eligible approver.')`,
      [randomUUID(), input.id, input.submittedHoursAgo],
    );
  } else {
    await client.query(
      `INSERT INTO request_event
        (id,request_id,actor_user_id,event_type,occurred_at,detail)
       VALUES ($1,$2,NULL,'request_routing_unavailable',now(),
         'No fully eligible approver was available.')`,
      [randomUUID(), input.id],
    );
  }
}

export default async function globalSetup() {
  const pool = new Pool({ connectionString: safeTestDatabaseUrl(), max: 1 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await migrate(client);
    const passwordHash = await argon2.hash(e2ePassword(), {
      type: argon2.argon2id,
      memoryCost: 65_536,
      timeCost: 3,
      parallelism: 1,
    });
    await user(client, passwordHash, {
      ...E2E.administrator,
      name: "Avery Administrator",
      role: "admin",
    });
    await user(client, passwordHash, {
      ...E2E.approver,
      name: "Reese Approver",
      role: "approver",
    });
    await user(client, passwordHash, {
      ...E2E.otherApprover,
      name: "Morgan Reviewer",
      role: "approver",
    });
    await user(client, passwordHash, {
      ...E2E.requester,
      name: "Sam Requester",
      role: "student",
    });
    await user(client, passwordHash, {
      ...E2E.workflowRequester,
      name: "Taylor Workflow",
      role: "student",
    });
    const approverResponsibility =
      "e2000000-0000-4000-8000-000000000201";
    const otherResponsibility = "e2000000-0000-4000-8000-000000000202";
    const adminResponsibility = "e2000000-0000-4000-8000-000000000203";
    await responsibility(client, approverResponsibility, E2E.approver.id);
    await responsibility(client, otherResponsibility, E2E.otherApprover.id);
    await responsibility(client, adminResponsibility, E2E.administrator.id);
    await request(client, {
      id: E2E.requests.approve,
      displayId: "E2E-APPROVE",
      submittedHoursAgo: 5,
      approverId: E2E.approver.id,
      responsibilityId: approverResponsibility,
    });
    await request(client, {
      id: E2E.requests.retry,
      displayId: "E2E-RETRY",
      submittedHoursAgo: 4,
      approverId: E2E.approver.id,
      responsibilityId: approverResponsibility,
    });
    await request(client, {
      id: E2E.requests.stale,
      displayId: "E2E-STALE",
      submittedHoursAgo: 3,
      approverId: E2E.approver.id,
      responsibilityId: approverResponsibility,
    });
    await request(client, {
      id: E2E.requests.anotherApprover,
      displayId: "E2E-OTHER",
      submittedHoursAgo: 2,
      approverId: E2E.otherApprover.id,
      responsibilityId: otherResponsibility,
    });
    await request(client, {
      id: E2E.requests.unassigned,
      displayId: "E2E-UNASSIGNED",
      submittedHoursAgo: 1,
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}
