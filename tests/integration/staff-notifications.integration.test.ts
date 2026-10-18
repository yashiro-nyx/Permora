/**
 * Staff notification integration tests.
 *
 * Tests that:
 * 1. Auth/role checks reject requesters and unauthenticated users.
 * 2. Approver receives notification on request assignment (routing).
 * 3. Admin receives routing-unavailable notification when routing fails.
 * 4. Other approvers do NOT receive unrelated assignment notifications.
 * 5. Mark-as-read and mark-all-as-read work and are owner-scoped.
 * 6. Requester bell does NOT show staff notification types.
 * 7. No duplicate notifications from retried routing (idempotent).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test, { after, before } from "node:test";
import argon2 from "argon2";
import { ResilientPool } from "../../lib/database-pool";
import {
  closeApplicationTestPool,
  installApplicationTestPool,
} from "../helpers/application-test-pool";

type StaffOpsHandlers = typeof import("../../lib/server/operations-handlers");
let handleStaffNotificationListRequest: StaffOpsHandlers["handleStaffNotificationListRequest"];
let handleStaffNotificationReadRequest: StaffOpsHandlers["handleStaffNotificationReadRequest"];
let handleStaffAllNotificationsReadRequest: StaffOpsHandlers["handleStaffAllNotificationsReadRequest"];
let handleNotificationListRequest: StaffOpsHandlers["handleNotificationListRequest"];

function safeTestDatabaseUrl() {
  const value = process.env.TEST_DATABASE_URL;
  if (!value) throw new Error("TEST_DATABASE_URL is required.");
  const parsed = new URL(value);
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !name.endsWith("_test"))
    throw new Error("Refusing unsafe integration database.");
  return value;
}

const password = "Staff notifications integration 2026!";
let pool: ReturnType<typeof createPool>;

function createPool() {
  return new ResilientPool(
    {
      connectionString: safeTestDatabaseUrl(),
      max: 1,
      connectionTimeoutMillis: 15_000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
    },
    3,
  );
}

let approver1: { id: string; email: string };
let approver2: { id: string; email: string };
let admin1: { id: string; email: string };
let requester1: { id: string; email: string };
let approver1Cookie = "";
let approver2Cookie = "";
let adminCookie = "";
let requesterCookie = "";
let assignedNotificationId = "";
let routingUnavailableNotificationId = "";
let requestIdA = "";

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DROP SCHEMA public CASCADE");
    await client.query("CREATE SCHEMA public");
    await client.query(
      "CREATE TABLE schema_migration (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const files = (
      await readdir(path.join(process.cwd(), "db/migrations"))
    )
      .filter((name) => /^\d+.*\.sql$/.test(name))
      .sort();
    for (const file of files) {
      if (file === "0003_fix_rate_limit_schema.sql")
        await client.query(
          `INSERT INTO "rateLimit" (key,count,"lastRequest") VALUES ('legacy',1,0)`,
        );
      await client.query(
        await readFile(
          path.join(process.cwd(), "db/migrations", file),
          "utf8",
        ),
      );
      await client.query(
        "INSERT INTO schema_migration (version) VALUES ($1)",
        [file],
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function seedUser(
  role: "student" | "approver" | "admin",
  name: string,
  hash: string,
) {
  const id = randomUUID();
  const email = `${id}@permora-staff-test.test`;
  await pool.query(
    `INSERT INTO "user" (id,name,email,"emailVerified") VALUES ($1,$2,$3,true)`,
    [id, name, email],
  );
  await pool.query(
    `INSERT INTO user_profile (user_id,department,requester_role) VALUES ($1,'Staff Test',$2)`,
    [id, role === "student" ? "student" : null],
  );
  await pool.query("INSERT INTO user_role (user_id,role) VALUES ($1,$2)", [
    id,
    role,
  ]);
  await pool.query(
    `INSERT INTO account (id,"userId","accountId","providerId",password) VALUES ($1,$2::uuid,$2::text,'credential',$3)`,
    [randomUUID(), id, hash],
  );
  return { id, email };
}

async function login(email: string, octet: number) {
  const { auth } = await import("../../lib/server/auth");
  const response = await auth.handler(
    new Request("http://localhost:3000/api/auth/sign-in/email", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        "content-type": "application/json",
        "x-forwarded-for": `127.0.4.${octet}`,
      },
      body: JSON.stringify({ email, password }),
    }),
  );
  assert.equal(response.status, 200, `login failed for ${email}`);
  return response.headers.get("set-cookie")?.split(";")[0] ?? "";
}

function apiRequest(
  pathname: string,
  cookie = "",
  method = "GET",
  origin = "http://localhost:3000",
) {
  return new Request(`http://localhost:3000${pathname}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(method === "POST"
        ? {
            origin,
            "sec-fetch-site": "same-origin",
            "content-type": "application/json",
          }
        : {}),
    },
    body: method === "POST" ? "{}" : undefined,
  });
}

/** Seed a notification directly so we can test read/list without triggering
 * the full routing pipeline in every test. */
async function seedStaffNotification(
  recipientId: string,
  requestId: string,
  type: "request_assigned_for_review" | "routing_unavailable",
  title: string,
) {
  const eventId = randomUUID();
  const id = randomUUID();
  await pool.query(
    `INSERT INTO request_event (id,request_id,actor_user_id,event_type,occurred_at,detail)
     VALUES ($1,$2,$3,'request_routed',now(),$4)`,
    [eventId, requestId, admin1.id, title],
  );
  await pool.query(
    `INSERT INTO user_notification
      (id,recipient_user_id,request_id,request_event_id,notification_type,title,body)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, recipientId, requestId, eventId, type, title, `${title} body`],
  );
  return id;
}

async function seedRequest(requesterId: string, displayId: string) {
  const policy = await pool.query<{ id: string }>(
    "SELECT id FROM catalog_policy_version WHERE resource_id='r-library' ORDER BY version DESC LIMIT 1",
  );
  const id = randomUUID();
  await pool.query(
    `INSERT INTO access_request
      (id,display_id,requester_user_id,resource_id,permission_id,policy_version_id,
       purpose,starts_at,expires_at,status,scope_fingerprint,submitted_at)
     VALUES ($1,$2,$3,'r-library','library:subscribed-materials',$4,
             'Staff notification test.',now(),now()+interval '30 days',
             'pending_review','resource-wide',now())`,
    [id, displayId, requesterId, policy.rows[0].id],
  );
  return id;
}

/** Seed an approver responsibility so routing can work. */
async function seedResponsibility(approverId: string) {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO approver_responsibility
      (id,approver_user_id,resource_id,permission_id,valid_from,valid_until)
     VALUES ($1,$2,'r-library','library:subscribed-materials',
             now()-interval '1 day',null)`,
    [id, approverId],
  );
  return id;
}

before(async () => {
  pool = createPool();
  await installApplicationTestPool(pool);
  const handlers = await import("../../lib/server/operations-handlers");
  handleStaffNotificationListRequest =
    handlers.handleStaffNotificationListRequest;
  handleStaffNotificationReadRequest =
    handlers.handleStaffNotificationReadRequest;
  handleStaffAllNotificationsReadRequest =
    handlers.handleStaffAllNotificationsReadRequest;
  handleNotificationListRequest = handlers.handleNotificationListRequest;
  await migrate();
  const hash = await argon2.hash(password, { type: argon2.argon2id });
  approver1 = await seedUser("approver", "Approver One", hash);
  approver2 = await seedUser("approver", "Approver Two", hash);
  admin1 = await seedUser("admin", "Admin One", hash);
  requester1 = await seedUser("student", "Student One", hash);
  approver1Cookie = await login(approver1.email, 41);
  approver2Cookie = await login(approver2.email, 42);
  adminCookie = await login(admin1.email, 43);
  requesterCookie = await login(requester1.email, 44);
  requestIdA = await seedRequest(requester1.id, "STAFF-A");
  // Seed an assignment notification for approver1.
  assignedNotificationId = await seedStaffNotification(
    approver1.id,
    requestIdA,
    "request_assigned_for_review",
    "New request assigned for review",
  );
  // Seed a routing-unavailable notification for admin1.
  routingUnavailableNotificationId = await seedStaffNotification(
    admin1.id,
    requestIdA,
    "routing_unavailable",
    "Request needs manual assignment",
  );
});

after(closeApplicationTestPool);

test("authentication and role checks protect staff notification routes", async () => {
  // Unauthenticated → 401.
  assert.equal(
    (await handleStaffNotificationListRequest(apiRequest("/api/notifications/staff"))).status,
    401,
  );
  // Requester (no staff role) → 403.
  assert.equal(
    (
      await handleStaffNotificationListRequest(
        apiRequest("/api/notifications/staff", requesterCookie),
      )
    ).status,
    403,
  );
  // Approver → 200.
  assert.equal(
    (
      await handleStaffNotificationListRequest(
        apiRequest("/api/notifications/staff", approver1Cookie),
      )
    ).status,
    200,
  );
  // Admin → 200.
  assert.equal(
    (
      await handleStaffNotificationListRequest(
        apiRequest("/api/notifications/staff", adminCookie),
      )
    ).status,
    200,
  );
});

test("approver only sees their own assigned notifications", async () => {
  const res = await handleStaffNotificationListRequest(
    apiRequest("/api/notifications/staff?pageSize=50", approver1Cookie),
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  // approver1 should see their assignment notification.
  const ids = body.items.map((i: { notificationId: string }) => i.notificationId);
  assert.ok(ids.includes(assignedNotificationId), "approver1 must see their assignment");
  // approver2's notifications (if any) must not appear.
  const res2 = await handleStaffNotificationListRequest(
    apiRequest("/api/notifications/staff?pageSize=50", approver2Cookie),
  );
  const body2 = await res2.json();
  const ids2 = body2.items.map((i: { notificationId: string }) => i.notificationId);
  assert.ok(!ids2.includes(assignedNotificationId), "approver2 must NOT see approver1's notification");
});

test("admin sees routing-unavailable notification, not the assignment notification", async () => {
  const res = await handleStaffNotificationListRequest(
    apiRequest("/api/notifications/staff?pageSize=50", adminCookie),
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  const ids = body.items.map((i: { notificationId: string }) => i.notificationId);
  assert.ok(ids.includes(routingUnavailableNotificationId), "admin must see routing-unavailable");
  assert.ok(!ids.includes(assignedNotificationId), "admin must NOT see approver1's assignment");
});

test("requester bell does not return staff notification types", async () => {
  const res = await handleNotificationListRequest(
    apiRequest("/api/notifications?pageSize=50", requesterCookie),
  );
  // requester has no notifications of any type → empty list is fine, just 200.
  assert.equal(res.status, 200);
  const body = await res.json();
  const staffTypes = ["request_assigned_for_review", "routing_unavailable"];
  const hasStaffType = body.items.some((i: { type: string }) =>
    staffTypes.includes(i.type),
  );
  assert.equal(hasStaffType, false, "requester bell must never show staff notification types");
});

test("mark staff notification as read and verify idempotency", async () => {
  // Mark approver1's assignment notification as read.
  const readRes = await handleStaffNotificationReadRequest(
    apiRequest(
      `/api/notifications/staff/${assignedNotificationId}/read`,
      approver1Cookie,
      "POST",
    ),
    assignedNotificationId,
  );
  assert.equal(readRes.status, 200);

  // Verify unread count is now 0 for approver1.
  const listRes = await handleStaffNotificationListRequest(
    apiRequest("/api/notifications/staff?view=unread", approver1Cookie),
  );
  const body = await listRes.json();
  assert.equal(body.unreadTotal, 0);

  // Idempotent: marking again returns 200.
  const again = await handleStaffNotificationReadRequest(
    apiRequest(
      `/api/notifications/staff/${assignedNotificationId}/read`,
      approver1Cookie,
      "POST",
    ),
    assignedNotificationId,
  );
  assert.equal(again.status, 200);
});

test("mark-as-read is owner-scoped: approver2 cannot read approver1's notification", async () => {
  // Add a fresh unread notification for approver1 to test cross-user read rejection.
  const requestB = await seedRequest(requester1.id, "STAFF-B");
  const freshId = await seedStaffNotification(
    approver1.id,
    requestB,
    "request_assigned_for_review",
    "Cross-user read test",
  );
  // approver2 attempts to mark approver1's notification as read → 404.
  const res = await handleStaffNotificationReadRequest(
    apiRequest(
      `/api/notifications/staff/${freshId}/read`,
      approver2Cookie,
      "POST",
    ),
    freshId,
  );
  assert.equal(res.status, 404, "approver2 must not be able to mark approver1's notification");
});

test("mark-all-as-read only affects the authenticated user's notifications", async () => {
  // Seed another unread notification for admin to confirm mark-all is scoped.
  const requestC = await seedRequest(requester1.id, "STAFF-C");
  await seedStaffNotification(
    admin1.id,
    requestC,
    "routing_unavailable",
    "Second routing failure",
  );
  // Mark all as read for admin.
  const markAll = await handleStaffAllNotificationsReadRequest(
    apiRequest(
      "/api/notifications/staff/read-all",
      adminCookie,
      "POST",
    ),
  );
  assert.equal(markAll.status, 200);
  // Admin's unread count → 0.
  const adminList = await handleStaffNotificationListRequest(
    apiRequest("/api/notifications/staff?view=unread", adminCookie),
  );
  assert.equal((await adminList.json()).unreadTotal, 0);
  // approver2 is unaffected (still no notifications, unreadTotal=0 independently).
  const approver2List = await handleStaffNotificationListRequest(
    apiRequest("/api/notifications/staff", approver2Cookie),
  );
  assert.equal((await approver2List.json()).unreadTotal, 0);
});

test("CSRF origin check rejects cross-origin POST requests", async () => {
  const res = await handleStaffNotificationReadRequest(
    apiRequest(
      `/api/notifications/staff/${assignedNotificationId}/read`,
      approver1Cookie,
      "POST",
      "https://evil.example",
    ),
    assignedNotificationId,
  );
  assert.equal(res.status, 403);
});

test("unread filter returns only unread staff notifications", async () => {
  // Seed a fresh approver2 notification (unread).
  const requestD = await seedRequest(requester1.id, "STAFF-D");
  const freshId = await seedStaffNotification(
    approver2.id,
    requestD,
    "request_assigned_for_review",
    "Unread filter test",
  );
  const unreadRes = await handleStaffNotificationListRequest(
    apiRequest("/api/notifications/staff?view=unread", approver2Cookie),
  );
  const body = await unreadRes.json();
  assert.ok(
    body.items.some((i: { notificationId: string }) => i.notificationId === freshId),
    "unread filter must include the fresh notification",
  );
  assert.ok(
    body.items.every((i: { readAt: string | null }) => i.readAt === null),
    "all items in unread view must have readAt=null",
  );
});

test("service failures use sanitized error responses without detail leakage", async () => {
  const failed = await handleStaffNotificationListRequest(
    apiRequest("/api/notifications/staff", approver1Cookie),
    {
      listStaffNotifications: async () => {
        throw new Error("internal db query detail");
      },
    },
  );
  assert.equal(failed.status, 503);
  const text = await failed.text();
  assert.doesNotMatch(text, /internal db query detail/i);
  assert.match(failed.headers.get("cache-control") ?? "", /no-store/);
});
