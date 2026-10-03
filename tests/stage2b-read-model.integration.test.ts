import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test, { after, before } from "node:test";
import { Pool } from "pg";
import { ResilientPool } from "../lib/database-pool";
import {
  closeApplicationTestPool,
  installApplicationTestPool,
} from "./helpers/application-test-pool";
import type { TrustedIdentity } from "../lib/auth-types";

function requiredSafeTestDatabaseUrl() {
  const value = process.env.TEST_DATABASE_URL;
  if (!value)
    throw new Error(
      "TEST_DATABASE_URL is required for PostgreSQL integration tests.",
    );
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("TEST_DATABASE_URL must be a valid PostgreSQL URL.");
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol))
    throw new Error("TEST_DATABASE_URL must use the postgres protocol.");
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!databaseName.endsWith("_test"))
    throw new Error(
      "Refusing destructive fixtures: the test database name must end with _test.",
    );
  return { value, databaseName };
}

const testDatabase = requiredSafeTestDatabaseUrl();
const password = "Read model integration password 2026";
let pool: Pool;
let passwordHash = "";
let requester = "";
let approverA = "";
let approverB = "";
let adminAssigned = "";
let inactiveApprover = "";
let inactiveAdmin = "";
let cookieRequester = "";
let cookieApproverA = "";
let cookieApproverB = "";
let cookieAdminAssigned = "";
let cookieAdminUnassigned = "";
let cookieInactiveApprover = "";
let cookieInactiveAdmin = "";
let requestA = "";
let requestB = "";
let requestPartial = "";
let requestAdmin = "";
let requestUnassigned = "";
let deterministicIds: string[] = [];

async function applyMigrations() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DROP SCHEMA public CASCADE");
    await client.query("CREATE SCHEMA public");
    await client.query(`CREATE TABLE schema_migration (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const files = (await readdir(path.join(process.cwd(), "db", "migrations")))
      .filter((name) => /^\d+.*\.sql$/.test(name))
      .sort();
    for (const file of files) {
      if (file === "0003_fix_rate_limit_schema.sql")
        await client.query(
          `INSERT INTO "rateLimit" (key, count, "lastRequest")
           VALUES ('legacy-rate-limit-row', 1, 0)`,
        );
      await client.query(
        await readFile(path.join(process.cwd(), "db", "migrations", file), "utf8"),
      );
      await client.query("INSERT INTO schema_migration (version) VALUES ($1)", [
        file,
      ]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function seedUser(
  role: "student" | "approver" | "admin",
  name: string,
) {
  const id = randomUUID();
  const email = `${name.toLowerCase().replaceAll(" ", "-")}@permora.test`;
  const now = new Date();
  await pool.query(
    `INSERT INTO "user" (id,name,email,"emailVerified","createdAt","updatedAt")
     VALUES ($1,$2,$3,true,$4,$4)`,
    [id, name, email, now],
  );
  await pool.query(
    `INSERT INTO user_profile (user_id, department, requester_role)
     VALUES ($1,$2,$3)`,
    [id, role === "student" ? "Engineering" : "Administration", role === "student" ? "student" : null],
  );
  await pool.query("INSERT INTO user_role (user_id, role) VALUES ($1,$2)", [
    id,
    role,
  ]);
  await pool.query(
    `INSERT INTO account
      (id,"userId","accountId","providerId",password,"createdAt","updatedAt")
     VALUES ($1,$2::uuid,$2::text,'credential',$3,$4,$4)`,
    [randomUUID(), id, passwordHash, now],
  );
  return { id, email };
}

async function login(email: string, octet: number) {
  const { auth } = await import("../lib/server/auth");
  const response = await auth.handler(
    new Request("http://localhost:3000/api/auth/sign-in/email", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        "content-type": "application/json",
        "x-forwarded-for": `127.0.1.${octet}`,
      },
      body: JSON.stringify({ email, password }),
    }),
  );
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
  assert.ok(cookie);
  return cookie;
}

async function seedScope(field: "laboratory" | "software", suffix: string) {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO scope_option
      (id,resource_id,field_name,institutional_code,display_name,valid_from)
     VALUES ($1,'r-lab',$2,$3,$4,'2026-01-01T00:00:00Z')`,
    [id, field, `${field}-${suffix}`, `${field} ${suffix}`],
  );
  return id;
}

async function seedResponsibility(
  userId: string,
  resourceId: string,
  permissionId: string,
  scopeIds: string[] = [],
) {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO approver_responsibility
      (id,approver_user_id,resource_id,permission_id,scope_option_id,
       valid_from,assigned_by)
     VALUES ($1,$2,$3,$4,$5,'2026-01-01T00:00:00Z',$2)`,
    [id, userId, resourceId, permissionId, scopeIds[0] ?? null],
  );
  for (const scopeId of scopeIds)
    await pool.query(
      `INSERT INTO approver_responsibility_scope
        (responsibility_id,resource_id,scope_option_id)
       VALUES ($1,$2,$3)`,
      [id, resourceId, scopeId],
    );
  return id;
}

async function seedRequest(options: {
  id?: string;
  requesterId?: string;
  resourceId?: "r-lab" | "r-library" | "r-student-portal";
  permissionId?: string;
  scopes?: Array<{ field: "laboratory" | "software"; id: string }>;
  status?: "pending_routing" | "pending_review";
  approverId?: string;
  responsibilityId?: string;
  submittedAt?: string;
}) {
  const id = options.id ?? randomUUID();
  const resourceId = options.resourceId ?? "r-library";
  const permissionId =
    options.permissionId ?? "library:subscribed-materials";
  const scopes = options.scopes ?? [];
  const policy = await pool.query<{ id: string }>(
    `SELECT id FROM catalog_policy_version WHERE resource_id = $1
      ORDER BY version DESC LIMIT 1`,
    [resourceId],
  );
  const status = options.status ?? "pending_review";
  await pool.query(
    `INSERT INTO access_request
      (id,display_id,requester_user_id,resource_id,permission_id,
       policy_version_id,purpose,starts_at,expires_at,status,scope_fingerprint,
       submitted_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'2026-10-01T00:00:00Z',
       '2026-10-15T00:00:00Z',$8,$9,$10)`,
    [
      id,
      `READ-${id}`,
      options.requesterId ?? requester,
      resourceId,
      permissionId,
      policy.rows[0].id,
      "Access is required for an assigned academic activity.",
      status,
      scopes.map((scope) => `${scope.field}:${scope.id}`).sort().join("|") ||
        "resource-wide",
      options.submittedAt ?? "2026-09-15T08:00:00Z",
    ],
  );
  for (const scope of scopes)
    await pool.query(
      `INSERT INTO access_request_scope
        (request_id,field_name,scope_option_id,display_snapshot)
       SELECT $1,$2,id,display_name FROM scope_option WHERE id = $3`,
      [id, scope.field, scope.id],
    );
  await pool.query(
    `INSERT INTO request_submission_history
      (id,request_id,actor_user_id,event_type,detail,occurred_at)
     VALUES ($1,$2,$3,'submitted','Request submitted for review.',$4)`,
    [randomUUID(), id, options.requesterId ?? requester, options.submittedAt ?? "2026-09-15T08:00:00Z"],
  );
  if (status === "pending_review") {
    assert.ok(options.approverId && options.responsibilityId);
    await pool.query(
      `INSERT INTO request_review_assignment
        (id,request_id,approver_user_id,responsibility_id,assigned_at)
       VALUES ($1,$2,$3,$4,$5::timestamptz + interval '1 minute')`,
      [
        randomUUID(),
        id,
        options.approverId,
        options.responsibilityId,
        options.submittedAt ?? "2026-09-15T08:00:00Z",
      ],
    );
  }
  return id;
}

function apiRequest(pathname: string, cookie = "") {
  return new Request(`http://localhost:3000${pathname}`, {
    headers: cookie ? { cookie } : undefined,
  });
}

async function queue(pathname: string, cookie = "") {
  const route = await import("../app/api/review/requests/route");
  return route.GET(apiRequest(pathname, cookie));
}

async function detail(id: string, cookie = "") {
  const route = await import("../app/api/review/requests/[id]/route");
  return route.GET(apiRequest(`/api/review/requests/${id}`, cookie), {
    params: Promise.resolve({ id }),
  });
}

async function unassigned(pathname: string, cookie = "") {
  const route = await import("../app/api/admin/unassigned-requests/route");
  return route.GET(apiRequest(pathname, cookie));
}

before(async () => {
  process.env.APP_URL = "http://localhost:3000";
  process.env.AUTH_SECRET =
    "stage2b-read-test-secret-at-least-thirty-two-characters";
  pool = new ResilientPool({
    connectionString: testDatabase.value,
    max: 2,
    connectionTimeoutMillis: 15_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
  }, 3);
  await installApplicationTestPool(pool);
  const database = await pool.query<{ name: string }>(
    "SELECT current_database() AS name",
  );
  assert.equal(database.rows[0].name, testDatabase.databaseName);
  await applyMigrations();
  const { hashPassword } = await import("../lib/password-hash");
  passwordHash = await hashPassword(password);

  const users = [];
  for (const [role, name] of [
    ["student", "Requester One"],
    ["approver", "Approver Alpha"],
    ["approver", "Approver Beta"],
    ["admin", "Admin Assigned"],
    ["admin", "Admin Observer"],
    ["approver", "Inactive Approver"],
    ["admin", "Inactive Admin"],
  ] as const)
    users.push(await seedUser(role, name));
  [
    requester,
    approverA,
    approverB,
    adminAssigned,
    ,
    inactiveApprover,
    inactiveAdmin,
  ] = users.map((user) => user.id);
  const cookies: string[] = [];
  for (const [index, user] of users.entries())
    cookies.push(await login(user.email, index + 10));
  [
    cookieRequester,
    cookieApproverA,
    cookieApproverB,
    cookieAdminAssigned,
    cookieAdminUnassigned,
    cookieInactiveApprover,
    cookieInactiveAdmin,
  ] = cookies;

  const lab = await seedScope("laboratory", "main");
  const software = await seedScope("software", "analysis");
  const responsibilityA = await seedResponsibility(
    approverA,
    "r-lab",
    "lab:course-software",
    [lab, software],
  );
  const responsibilityB = await seedResponsibility(
    approverB,
    "r-library",
    "library:subscribed-materials",
  );
  const partialResponsibility = await seedResponsibility(
    approverB,
    "r-lab",
    "lab:course-software",
    [lab],
  );
  const adminResponsibility = await seedResponsibility(
    adminAssigned,
    "r-library",
    "library:subscribed-materials",
  );
  await seedResponsibility(
    inactiveApprover,
    "r-library",
    "library:subscribed-materials",
  );

  requestA = await seedRequest({
    requesterId: requester,
    resourceId: "r-lab",
    permissionId: "lab:course-software",
    scopes: [
      { field: "laboratory", id: lab },
      { field: "software", id: software },
    ],
    approverId: approverA,
    responsibilityId: responsibilityA,
  });
  requestB = await seedRequest({
    approverId: approverB,
    responsibilityId: responsibilityB,
    submittedAt: "2026-09-14T08:00:00Z",
  });
  requestPartial = await seedRequest({
    resourceId: "r-lab",
    permissionId: "lab:course-software",
    scopes: [
      { field: "laboratory", id: lab },
      { field: "software", id: software },
    ],
    approverId: approverB,
    responsibilityId: partialResponsibility,
    submittedAt: "2026-09-13T08:00:00Z",
  });
  requestAdmin = await seedRequest({
    approverId: adminAssigned,
    responsibilityId: adminResponsibility,
    submittedAt: "2026-09-12T08:00:00Z",
  });
  requestUnassigned = await seedRequest({
    resourceId: "r-student-portal",
    permissionId: "portal:view-own-academic-information",
    status: "pending_routing",
    submittedAt: "2026-09-11T08:00:00Z",
  });
  deterministicIds = [
    "30000000-0000-4000-8000-000000000001",
    "30000000-0000-4000-8000-000000000002",
    "30000000-0000-4000-8000-000000000003",
  ];
  for (const id of deterministicIds)
    await seedRequest({
      id,
      requesterId: requester,
      resourceId: "r-lab",
      permissionId: "lab:course-software",
      scopes: [
        { field: "laboratory", id: lab },
        { field: "software", id: software },
      ],
      approverId: approverA,
      responsibilityId: responsibilityA,
      submittedAt: "2026-09-16T08:00:00Z",
    });

  await pool.query("UPDATE user_profile SET active = false WHERE user_id = ANY($1::uuid[])", [
    [inactiveApprover, inactiveAdmin],
  ]);
});

after(closeApplicationTestPool);

test("read routes require an authenticated server session", async () => {
  for (const response of [
    await queue("/api/review/requests"),
    await detail(requestA),
    await unassigned("/api/admin/unassigned-requests"),
  ]) {
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  }
});

test("requesters and inactive staff cannot access approval reads", async () => {
  assert.equal(
    (await queue("/api/review/requests", cookieRequester)).status,
    403,
  );
  assert.equal(
    (await queue("/api/review/requests", cookieInactiveApprover)).status,
    401,
  );
  assert.equal(
    (
      await unassigned(
        "/api/admin/unassigned-requests",
        cookieInactiveAdmin,
      )
    ).status,
    401,
  );
});

test("assigned queue is scoped to the authenticated approver", async () => {
  const response = await queue(
    "/api/review/requests?pageSize=100",
    cookieApproverA,
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  const ids = body.items.map((item: { requestId: string }) => item.requestId);
  assert.ok(ids.includes(requestA));
  assert.ok(!ids.includes(requestB));
  assert.ok(!ids.includes(requestPartial));
  assert.ok(!ids.includes(requestUnassigned));
});

test("detail access hides other assignments, partial coverage, and unknown IDs", async () => {
  const another = await detail(requestA, cookieApproverB);
  const unknown = await detail(randomUUID(), cookieApproverB);
  const partial = await detail(requestPartial, cookieApproverB);
  assert.equal(another.status, 404);
  assert.equal(unknown.status, 404);
  assert.deepEqual(await another.json(), await unknown.json());
  assert.equal(partial.status, 404);
});

test("administrator review access still requires responsibility and assignment", async () => {
  assert.equal(
    (await queue("/api/review/requests", cookieAdminUnassigned)).status,
    403,
  );
  assert.equal((await detail(requestAdmin, cookieAdminAssigned)).status, 200);
  assert.equal((await detail(requestA, cookieAdminAssigned)).status, 404);
});

test("only administrators can list preserved unassigned routing failures", async () => {
  assert.equal(
    (
      await unassigned(
        "/api/admin/unassigned-requests",
        cookieApproverA,
      )
    ).status,
    403,
  );
  const response = await unassigned(
    "/api/admin/unassigned-requests",
    cookieAdminUnassigned,
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(
    body.items.map((item: { requestId: string }) => item.requestId),
    [requestUnassigned],
  );
});

test("detail DTO is explicit and excludes authentication and security records", async () => {
  const response = await detail(requestA, cookieApproverA);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.requestId, requestA);
  assert.equal(body.requester.name, "Requester One");
  assert.equal(body.scopes.length, 2);
  assert.equal(body.timeline[0].type, "submitted");
  assert.equal(typeof body.version, "number");
  const serialized = JSON.stringify(body);
  for (const forbidden of [
    "password",
    "session",
    "accountId",
    "userId",
    "approverUserId",
    "responsibilityId",
    "policyVersionId",
    "scopeOptionId",
    "metadata",
  ])
    assert.ok(!serialized.includes(`\"${forbidden}\"`));
});

test("filters and bounded pagination produce deterministic results", async () => {
  const first = await queue(
    "/api/review/requests?resource=r-lab&from=2026-09-16&to=2026-09-16&page=1&pageSize=2",
    cookieApproverA,
  );
  const second = await queue(
    "/api/review/requests?resource=r-lab&from=2026-09-16&to=2026-09-16&page=2&pageSize=2",
    cookieApproverA,
  );
  const firstBody = await first.json();
  const secondBody = await second.json();
  assert.deepEqual(
    firstBody.items.map((item: { requestId: string }) => item.requestId),
    [deterministicIds[2], deterministicIds[1]],
  );
  assert.deepEqual(
    secondBody.items.map((item: { requestId: string }) => item.requestId),
    [deterministicIds[0]],
  );
  assert.equal(firstBody.pagination.total, 3);
  const bounded = await queue(
    "/api/review/requests?pageSize=999",
    cookieApproverA,
  );
  assert.equal((await bounded.json()).pagination.pageSize, 100);
});

test("empty filters and invalid query input are handled safely", async () => {
  const empty = await queue(
    "/api/review/requests?search=no-such-request",
    cookieApproverA,
  );
  assert.deepEqual(await empty.json(), {
    items: [],
    pagination: { page: 1, pageSize: 20, total: 0, pageCount: 0 },
  });
  for (const query of [
    "status=pending_routing",
    "page=-1",
    "pageSize=zero",
    "from=2026-02-30",
    "from=2026-09-20&to=2026-09-19",
    `search=${"x".repeat(101)}`,
  ]) {
    const response = await queue(
      `/api/review/requests?${query}`,
      cookieApproverA,
    );
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "invalid_query");
  }
});

test("database failures map to a generic no-store service response", async () => {
  const { handleAssignedQueueRequest } = await import(
    "../lib/server/approval-read-handlers"
  );
  const identity: TrustedIdentity = {
    id: approverA,
    name: "Approver Alpha",
    email: "approver-alpha@permora.test",
    department: "Administration",
    active: true,
    roles: ["approver"],
    requesterRole: null,
  };
  const response = await handleAssignedQueueRequest(
    apiRequest("/api/review/requests"),
    {
      getIdentity: async () => identity,
      hasResponsibility: async () => true,
      listAssigned: async () => {
        throw new Error("sensitive database detail");
      },
    },
  );
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  const body = await response.json();
  assert.deepEqual(body, {
    error: {
      code: "service_unavailable",
      message: "Approval information is temporarily unavailable.",
    },
  });
  assert.ok(!JSON.stringify(body).includes("sensitive database detail"));
});
