import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test, { after, before } from "node:test";
import argon2 from "argon2";
import { Pool } from "pg";
import { ResilientPool } from "../lib/database-pool";
import {
  closeApplicationTestPool,
  installApplicationTestPool,
} from "./helpers/application-test-pool";

type OperationsHandlers = typeof import("../lib/server/operations-handlers");
let handleAllNotificationsReadRequest: OperationsHandlers["handleAllNotificationsReadRequest"];
let handleAuditListRequest: OperationsHandlers["handleAuditListRequest"];
let handleNotificationListRequest: OperationsHandlers["handleNotificationListRequest"];
let handleNotificationReadRequest: OperationsHandlers["handleNotificationReadRequest"];

function safeTestDatabaseUrl() {
  const value = process.env.TEST_DATABASE_URL;
  if (!value) throw new Error("TEST_DATABASE_URL is required.");
  const parsed = new URL(value);
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !name.endsWith("_test"))
    throw new Error("Refusing unsafe integration database.");
  return value;
}

const password = "Operations integration password 2026";
let pool: Pool;
let requesterA = "";
let requesterB = "";
let admin = "";
let requesterCookie = "";
let requesterBCookie = "";
let adminCookie = "";
let approverCookie = "";
let inactiveAdminCookie = "";
let requestA = "";
let notificationA = "";
let notificationA2 = "";
let notificationB = "";

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DROP SCHEMA public CASCADE");
    await client.query("CREATE SCHEMA public");
    await client.query("CREATE TABLE schema_migration (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    for (const file of (await readdir(path.join(process.cwd(), "db/migrations"))).filter((name) => /^\d+.*\.sql$/.test(name)).sort()) {
      if (file === "0003_fix_rate_limit_schema.sql")
        await client.query(`INSERT INTO "rateLimit" (key,count,"lastRequest") VALUES ('legacy',1,0)`);
      await client.query(await readFile(path.join(process.cwd(), "db/migrations", file), "utf8"));
      await client.query("INSERT INTO schema_migration (version) VALUES ($1)", [file]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function seedUser(role: "student" | "faculty" | "approver" | "admin", name: string, hash: string) {
  const id = randomUUID();
  const email = `${id}@permora.test`;
  await pool.query(`INSERT INTO "user" (id,name,email,"emailVerified") VALUES ($1,$2,$3,true)`, [id, name, email]);
  await pool.query(`INSERT INTO user_profile (user_id,department,requester_role) VALUES ($1,'Operations',$2)`, [id, role === "student" || role === "faculty" ? role : null]);
  await pool.query("INSERT INTO user_role (user_id,role) VALUES ($1,$2)", [id, role]);
  await pool.query(`INSERT INTO account (id,"userId","accountId","providerId",password) VALUES ($1,$2::uuid,$2::text,'credential',$3)`, [randomUUID(), id, hash]);
  return { id, email };
}

async function login(email: string, octet: number) {
  const { auth } = await import("../lib/server/auth");
  const response = await auth.handler(new Request("http://localhost:3000/api/auth/sign-in/email", {
    method: "POST",
    headers: { origin: "http://localhost:3000", "content-type": "application/json", "x-forwarded-for": `127.0.2.${octet}` },
    body: JSON.stringify({ email, password }),
  }));
  assert.equal(response.status, 200);
  return response.headers.get("set-cookie")?.split(";")[0] ?? "";
}

async function seedRequest(userId: string, displayId: string) {
  const policy = await pool.query<{ id: string }>("SELECT id FROM catalog_policy_version WHERE resource_id='r-library' ORDER BY version DESC LIMIT 1");
  const id = randomUUID();
  await pool.query(`INSERT INTO access_request
    (id,display_id,requester_user_id,resource_id,permission_id,policy_version_id,purpose,starts_at,expires_at,status,scope_fingerprint,submitted_at)
    VALUES ($1,$2,$3,'r-library','library:subscribed-materials',$4,'Operations integration request purpose.',now(),now()+interval '30 days','approved_pending_activation','resource-wide',now())`,
  [id, displayId, userId, policy.rows[0].id]);
  return id;
}

async function seedNotification(userId: string, requestId: string, type: "request_approved_pending_activation" | "request_denied", title: string, occurredAt: string) {
  const eventId = randomUUID();
  const id = randomUUID();
  await pool.query(`INSERT INTO request_event (id,request_id,actor_user_id,event_type,occurred_at,detail) VALUES ($1,$2,$3,$4,$5,$6)`, [eventId, requestId, admin, type === "request_denied" ? "review_denied" : "review_approved", occurredAt, title]);
  await pool.query(`INSERT INTO user_notification (id,recipient_user_id,request_id,request_event_id,notification_type,title,body,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [id, userId, requestId, eventId, type, title, `${title} safe message`, occurredAt]);
  return id;
}

function apiRequest(pathname: string, cookie = "", method = "GET", origin = "http://localhost:3000") {
  return new Request(`http://localhost:3000${pathname}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(method === "POST" ? { origin, "sec-fetch-site": "same-origin", "content-type": "application/json" } : {}),
    },
    body: method === "POST" ? "{}" : undefined,
  });
}

before(async () => {
  pool = new ResilientPool({
    connectionString: safeTestDatabaseUrl(),
    max: 1,
    connectionTimeoutMillis: 15_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
  }, 3);
  await installApplicationTestPool(pool);
  const handlers = await import("../lib/server/operations-handlers");
  ({
    handleAllNotificationsReadRequest,
    handleAuditListRequest,
    handleNotificationListRequest,
    handleNotificationReadRequest,
  } = handlers);
  await migrate();
  const hash = await argon2.hash(password, { type: argon2.argon2id });
  const a = await seedUser("student", "Requester Alpha", hash);
  const b = await seedUser("faculty", "Requester Beta", hash);
  const administrator = await seedUser("admin", "Audit Administrator", hash);
  const approver = await seedUser("approver", "Audit Approver", hash);
  const inactive = await seedUser("admin", "Inactive Administrator", hash);
  requesterA = a.id;
  requesterB = b.id;
  admin = administrator.id;
  requesterCookie = await login(a.email, 31);
  requesterBCookie = await login(b.email, 32);
  adminCookie = await login(administrator.email, 33);
  approverCookie = await login(approver.email, 34);
  inactiveAdminCookie = await login(inactive.email, 35);
  await pool.query("UPDATE user_profile SET active=false WHERE user_id=$1", [inactive.id]);
  requestA = await seedRequest(requesterA, "OPS-A");
  const requestB = await seedRequest(requesterB, "OPS-B");
  notificationA = await seedNotification(requesterA, requestA, "request_approved_pending_activation", "Approved A", "2026-09-20T09:00:00Z");
  notificationA2 = await seedNotification(requesterA, requestA, "request_denied", "Denied A", "2026-09-21T09:00:00Z");
  notificationB = await seedNotification(requesterB, requestB, "request_denied", "Denied B", "2026-09-22T09:00:00Z");
  for (const [eventType, at] of [["submitted", "2026-09-18T08:00:00Z"], ["request_routed", "2026-09-19T08:00:00Z"], ["review_approved", "2026-09-20T08:00:00Z"]] as const)
    await pool.query("INSERT INTO audit_event (id,actor_user_id,subject_user_id,request_id,event_type,occurred_at,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7)", [randomUUID(), admin, requesterA, requestA, eventType, at, { secret: "must-not-leak" }]);
});

after(closeApplicationTestPool);

test("authentication and role boundaries protect notification and audit routes", async () => {
  assert.equal((await handleNotificationListRequest(apiRequest("/api/notifications"))).status, 401);
  assert.equal((await handleNotificationListRequest(apiRequest("/api/notifications", adminCookie))).status, 403);
  assert.equal((await handleAuditListRequest(apiRequest("/api/admin/audit-events", requesterCookie))).status, 403);
  assert.equal((await handleAuditListRequest(apiRequest("/api/admin/audit-events", approverCookie))).status, 403);
  assert.equal((await handleAuditListRequest(apiRequest("/api/admin/audit-events", inactiveAdminCookie))).status, 401);
  assert.equal((await handleAuditListRequest(apiRequest("/api/admin/audit-events", adminCookie))).status, 200);
});

test("notification reads and mutations enforce owner isolation and idempotency", async () => {
  const response = await handleNotificationListRequest(apiRequest("/api/notifications?pageSize=1", requesterCookie));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.items.length, 1);
  assert.equal(body.pagination.total, 2);
  assert.equal(body.items[0].title, "Denied A");
  assert.equal(body.items[0].request.displayId, "OPS-A");
  assert.equal("recipient_user_id" in body.items[0], false);
  assert.equal("metadata" in body.items[0], false);

  assert.equal((await handleNotificationReadRequest(apiRequest(`/api/notifications/${notificationB}/read`, requesterCookie, "POST"), notificationB)).status, 404);
  const first = await handleNotificationReadRequest(apiRequest(`/api/notifications/${notificationA}/read`, requesterCookie, "POST"), notificationA);
  assert.equal(first.status, 200);
  const initial = await pool.query<{ read_at: Date }>("SELECT read_at FROM user_notification WHERE id=$1", [notificationA]);
  const second = await handleNotificationReadRequest(apiRequest(`/api/notifications/${notificationA}/read`, requesterCookie, "POST"), notificationA);
  assert.equal(second.status, 200);
  const repeated = await pool.query<{ read_at: Date }>("SELECT read_at FROM user_notification WHERE id=$1", [notificationA]);
  assert.equal(repeated.rows[0].read_at.toISOString(), initial.rows[0].read_at.toISOString());

  assert.equal((await handleAllNotificationsReadRequest(apiRequest("/api/notifications/read-all", requesterCookie, "POST"))).status, 200);
  const states = await pool.query<{ recipient_user_id: string; unread: number }>("SELECT recipient_user_id, count(*) FILTER (WHERE read_at IS NULL)::int unread FROM user_notification GROUP BY recipient_user_id ORDER BY recipient_user_id");
  assert.equal(states.rows.find((row) => row.recipient_user_id === requesterA)?.unread, 0);
  assert.equal(states.rows.find((row) => row.recipient_user_id === requesterB)?.unread, 1);
});

test("notification filtering, validation, origin checks, and generic failures are safe", async () => {
  const unread = await handleNotificationListRequest(apiRequest("/api/notifications?view=unread", requesterBCookie));
  assert.equal((await unread.json()).pagination.total, 1);
  assert.equal((await handleNotificationListRequest(apiRequest("/api/notifications?view=unknown", requesterCookie))).status, 400);
  assert.equal((await handleNotificationReadRequest(apiRequest(`/api/notifications/${notificationA2}/read`, requesterCookie, "POST", "https://untrusted.example"), notificationA2)).status, 403);
  const failed = await handleNotificationListRequest(apiRequest("/api/notifications", requesterCookie), { listNotifications: async () => { throw new Error("database detail"); } });
  assert.equal(failed.status, 503);
  assert.doesNotMatch(await failed.text(), /database detail/i);
  assert.match(failed.headers.get("cache-control") ?? "", /no-store/);
});

test("administrator audit DTOs are sanitized, filtered, paginated, and deterministic", async () => {
  const first = await handleAuditListRequest(apiRequest("/api/admin/audit-events?pageSize=2", adminCookie));
  assert.equal(first.status, 200);
  const body = await first.json();
  assert.equal(body.items.length, 2);
  assert.ok(body.pagination.total >= 3);
  assert.ok(body.items[0].occurredAt >= body.items[1].occurredAt);
  assert.equal("metadata" in body.items[0], false);
  assert.equal("actor_user_id" in body.items[0], false);
  assert.doesNotMatch(JSON.stringify(body), /must-not-leak|password|session|token/i);

  const filtered = await handleAuditListRequest(apiRequest("/api/admin/audit-events?eventType=review_approved&from=2026-09-20&to=2026-09-20", adminCookie));
  const filteredBody = await filtered.json();
  assert.equal(filteredBody.items.length, 1);
  assert.match(filteredBody.items[0].summary, /awaiting activation/);
  assert.equal((await handleAuditListRequest(apiRequest("/api/admin/audit-events?from=2026-10-01&to=2026-09-01", adminCookie))).status, 400);
  const failed = await handleAuditListRequest(apiRequest("/api/admin/audit-events", adminCookie), { listAudit: async () => { throw new Error("private query detail"); } });
  assert.equal(failed.status, 503);
  assert.doesNotMatch(await failed.text(), /private query detail/i);
});
