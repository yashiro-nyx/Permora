import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { type PoolClient } from "pg";
import { ResilientPool } from "../../lib/database-pool";
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
  const pool = new ResilientPool({
    connectionString: safeTestDatabaseUrl(),
    max: 1,
    connectionTimeoutMillis: 15_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
  }, 3);
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
      ...E2E.activationAdministrator,
      name: "Jordan Activation Administrator",
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
    await client.query(
      `INSERT INTO access_request
        (id,display_id,requester_user_id,resource_id,permission_id,
         policy_version_id,purpose,starts_at,expires_at,status,scope_fingerprint,
         submitted_at,created_at,updated_at)
       VALUES
        ($1,'E2E-NOTIFY-APPROVED',$3::uuid,'r-student-portal','portal:view-own-academic-information',
         '10000000-0000-4000-8000-000000000002','Persisted notification fixture for an approved own-account request.',
         now(),now()+interval '30 days','approved_pending_activation','own-account:' || $3::text,now()-interval '40 minutes',now(),now()),
        ($2,'E2E-NOTIFY-DENIED',$3::uuid,'r-library','library:subscribed-materials',
         '10000000-0000-4000-8000-000000000004','Persisted notification fixture for a denied request.',
         now(),now()+interval '30 days','denied','resource-wide',now()-interval '25 minutes',now(),now())`,
      [
        E2E.requests.notificationApproved,
        E2E.requests.notificationDenied,
        E2E.requester.id,
      ],
    );
    await client.query(
      `INSERT INTO request_submission_history
        (id,request_id,actor_user_id,event_type,occurred_at,detail)
       VALUES
        ($1,$3,$5,'submitted',now() - interval '40 minutes','Access request submitted.'),
        ($2,$4,$5,'submitted',now() - interval '25 minutes','Access request submitted.')`,
      [
        randomUUID(),
        randomUUID(),
        E2E.requests.notificationApproved,
        E2E.requests.notificationDenied,
        E2E.requester.id,
      ],
    );
    const approvedEvent = "e2000000-0000-4000-8000-000000000401";
    const deniedEvent = "e2000000-0000-4000-8000-000000000402";
    await client.query(
      `INSERT INTO request_event
        (id,request_id,actor_user_id,event_type,occurred_at,detail)
       VALUES
        ($1,$3,$5,'review_approved',now() - interval '30 minutes','Approved; activation has not occurred.'),
        ($2,$4,$5,'review_denied',now() - interval '15 minutes','Additional justification is required.')`,
      [
        approvedEvent,
        deniedEvent,
        E2E.requests.notificationApproved,
        E2E.requests.notificationDenied,
        E2E.approver.id,
      ],
    );
    const activationFailureEvent = "e2000000-0000-4000-8000-000000000403";
    const activationSuccessEvent = "e2000000-0000-4000-8000-000000000404";
    const activationResponsibility = "e2000000-0000-4000-8000-000000000503";
    const activationAssignment = "e2000000-0000-4000-8000-000000000502";
    const activationDecision = "e2000000-0000-4000-8000-000000000501";
    const activationId = "e2000000-0000-4000-8000-000000000504";
    const entitlementId = "e2000000-0000-4000-8000-000000000505";
    const firstActivationKey = "e2000000-0000-4000-8000-000000000506";
    const finalActivationKey = "e2000000-0000-4000-8000-000000000507";
    await client.query(
      `INSERT INTO approver_responsibility
        (id,approver_user_id,resource_id,permission_id,valid_from,assigned_by)
       VALUES ($1,$2,'r-student-portal','portal:view-own-academic-information',now()-interval '1 day',$3)`
      , [activationResponsibility, E2E.approver.id, E2E.administrator.id],
    );
    await client.query(
      `INSERT INTO request_review_assignment
        (id,request_id,approver_user_id,responsibility_id,status,assigned_at,completed_at)
       VALUES ($1,$2,$3,$4,'completed',now()-interval '35 minutes',now()-interval '30 minutes')`,
      [activationAssignment, E2E.requests.notificationApproved, E2E.approver.id, activationResponsibility],
    );
    await client.query(
      `UPDATE access_request SET version=2 WHERE id=$1`,
      [E2E.requests.notificationApproved],
    );
    await client.query(
      `INSERT INTO request_decision
        (id,request_id,assignment_id,actor_user_id,action,previous_status,
         resulting_status,previous_version,resulting_version,idempotency_key)
       VALUES ($1,$2,$3,$4,'approve','pending_review',
         'approved_pending_activation',1,2,$1)`,
      [activationDecision, E2E.requests.notificationApproved, activationAssignment, E2E.approver.id],
    );
    await client.query(
      `INSERT INTO ordinary_entitlement
        (id,user_id,resource_id,permission_id,scope_fingerprint,source,evidence,
         valid_from,valid_until,recorded_by)
       SELECT $2,requester_user_id,resource_id,permission_id,scope_fingerprint,
              'manual','E2E fixture: administrator confirmed provisioning.',
              starts_at,expires_at,$3
         FROM access_request WHERE id=$1`,
      [E2E.requests.notificationApproved, entitlementId, E2E.administrator.id],
    );
    await client.query(
      `INSERT INTO request_activation
        (id,request_id,decision_id,status,adapter_name,actor_user_id,idempotency_key,
         attempt_count,started_at,last_attempt_at,activated_at,expires_at,external_reference)
       SELECT $2,$1,$3,'activated','manual-admin',$4,$5,2,
              now()-interval '20 minutes',now()-interval '15 minutes',
              now()-interval '15 minutes',expires_at,'E2E-MANUAL-1001'
         FROM access_request WHERE id=$1`,
      [E2E.requests.notificationApproved, activationId, activationDecision, E2E.administrator.id, finalActivationKey],
    );
    await client.query(
      `INSERT INTO activation_event
        (id,activation_id,actor_user_id,event_type,idempotency_key,adapter_name,
         external_reference,occurred_at,detail,metadata)
       VALUES
        ('e2000000-0000-4000-8000-000000000508',$1,$2,'activation_started',$3,'manual-admin',NULL,now()-interval '25 minutes','First activation attempt started.','{"attemptCount":1}'::jsonb),
        ('e2000000-0000-4000-8000-000000000509',$1,$2,'activation_failed',$3,'manual-admin',NULL,now()-interval '23 minutes','The first manual attempt was not confirmed.','{"attemptCount":1,"failureCode":"activation_attempt_timeout","retryable":true}'::jsonb),
        ('e2000000-0000-4000-8000-000000000510',$1,$2,'activation_started',$4,'manual-admin',NULL,now()-interval '20 minutes','Retry started after manual verification.','{"attemptCount":2}'::jsonb),
        ('e2000000-0000-4000-8000-000000000511',$1,$2,'activation_succeeded',$4,'manual-admin','E2E-MANUAL-1001',now()-interval '15 minutes','Administrator confirmed access was provisioned.',$5::jsonb)`,
      [activationId, E2E.administrator.id, firstActivationKey, finalActivationKey, JSON.stringify({ entitlementId, attemptCount: 2, adapterName: "manual-admin", externalReference: "E2E-MANUAL-1001", evidence: "Administrator verified access." })],
    );
    await client.query(
      `INSERT INTO request_event
        (id,request_id,actor_user_id,event_type,occurred_at,detail,metadata)
       VALUES
        ($1,$3,$5,'activation_failed',now()-interval '23 minutes','The first manual attempt was not confirmed.','{"retryable":true}'::jsonb),
        ($2,$3,$5,'activation_succeeded',now()-interval '15 minutes','Administrator confirmed access was provisioned.',$4::jsonb)`,
      [activationFailureEvent, activationSuccessEvent, E2E.requests.notificationApproved, JSON.stringify({ entitlementId, externalReference: "E2E-MANUAL-1001" }), E2E.administrator.id],
    );
    await client.query(
      `INSERT INTO user_notification
        (id,recipient_user_id,request_id,request_event_id,notification_type,title,body,created_at)
       VALUES
        ($1,$3,$4,$6,'request_approved_pending_activation','Request approved — awaiting activation','Your request was approved. Access is not active until activation is completed.',now() - interval '30 minutes'),
        ($2,$3,$5,$7,'request_denied','Access request denied','Additional justification is required.',now() - interval '15 minutes'),
        ($8,$3,$4,$9,'activation_failed','Access activation failed','The first activation attempt was not confirmed. An administrator retried after verification.',now() - interval '23 minutes'),
        ($10,$3,$4,$11,'activation_succeeded','Access activated','Your approved access has been activated.',now() - interval '15 minutes')`,
      [
        E2E.notifications.approved,
        E2E.notifications.denied,
        E2E.requester.id,
        E2E.requests.notificationApproved,
        E2E.requests.notificationDenied,
        approvedEvent,
        deniedEvent,
        E2E.notifications.activationFailed,
        activationFailureEvent,
        E2E.notifications.activationSucceeded,
        activationSuccessEvent,
      ],
    );
    await client.query(
      `INSERT INTO audit_event
        (id,actor_user_id,subject_user_id,request_id,event_type,occurred_at,metadata)
       VALUES
        ($1,$3,$4,$5,'submitted',now() - interval '2 hours','{}'::jsonb),
        ($2,$3,$4,$5,'review_approved',now() - interval '30 minutes','{"private":"not returned"}'::jsonb)`,
      [
        randomUUID(),
        randomUUID(),
        E2E.administrator.id,
        E2E.requester.id,
        E2E.requests.notificationApproved,
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}
