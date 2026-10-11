/**
 * Idempotent synthetic demo-data seeder for the DEVELOPMENT database (neondb) ONLY.
 *
 * Scope: additive, idempotent inserts to make every Student/Faculty-eligible
 * resource end-to-end completable:
 *   - scope_option rows for r-faculty-grading/courseSection, r-lab/laboratory,
 *     r-lab/software (and a faculty teaching section on r-lms/courseSection)
 *   - requester_assignment eligibility (student + faculty) within existing role rules
 *   - approver_responsibility resource-wide routing for eligible requestable permissions
 *
 * Guarantees:
 *   - Refuses to run unless the live database is exactly "neondb" and not "*_test".
 *   - No schema changes, no migrations, no deletes/updates to existing rows.
 *   - Every insert is guarded by NOT EXISTS / unique-key existence so re-runs are no-ops.
 *   - Preserves existing accounts, passwords, requests, and valid assignments.
 *   - Mirrors the exact validation shape used by scripts/configure-access.ts and
 *     the server request-service, and writes an audit_event per logical change batch.
 *
 * This file is a dev utility and is NOT wired into package.json; it is run ad hoc.
 */
import { randomUUID } from "node:crypto";
import pg from "pg";

const DEV_URL = process.env.SEED_DATABASE_URL;
if (!DEV_URL) {
  console.error("SEED_DATABASE_URL is required.");
  process.exit(1);
}

const ADMIN_ACTOR = "bf752535-4980-4d6c-b638-8bbeea12c006";
const APPROVER = "c8cdc9bf-c650-41fb-b35c-8193a8f58b39";
const FACULTY = "11c9019a-8aee-48b8-9060-6f73e9992bde";
const STUDENT = "856441de-6186-4251-8f87-4b822e0d61af";

// Synthetic, clearly-prototype scope values (not official T.I.P. data).
// Enriched so every scoped resource offers several distinct, realistic choices.
const SCOPE_OPTIONS = [
  // Faculty grading sections
  { resource: "r-faculty-grading", field: "courseSection", code: "CS301-A", name: "CS 301 - Section A" },
  { resource: "r-faculty-grading", field: "courseSection", code: "MATH201-B", name: "MATH 201 - Section B" },
  { resource: "r-faculty-grading", field: "courseSection", code: "ENG102-C", name: "ENG 102 - Section C" },
  { resource: "r-faculty-grading", field: "courseSection", code: "PHYS210-A", name: "PHYS 210 - Section A" },
  // LMS course sections
  { resource: "r-lms", field: "courseSection", code: "CS101-A", name: "CS 101 - Section A" },
  { resource: "r-lms", field: "courseSection", code: "CS301-A", name: "CS 301 - Section A" },
  { resource: "r-lms", field: "courseSection", code: "MATH201-B", name: "MATH 201 - Section B" },
  { resource: "r-lms", field: "courseSection", code: "ENG102-C", name: "ENG 102 - Section C" },
  // Laboratories
  { resource: "r-lab", field: "laboratory", code: "LAB-COMP-1", name: "Computing Laboratory 1" },
  { resource: "r-lab", field: "laboratory", code: "LAB-COMP-2", name: "Computing Laboratory 2" },
  { resource: "r-lab", field: "laboratory", code: "LAB-COMP-3", name: "Computing Laboratory 3" },
  { resource: "r-lab", field: "laboratory", code: "LAB-NET-1", name: "Networking Laboratory 1" },
  // Laboratory software / environments
  { resource: "r-lab", field: "software", code: "SW-MATLAB", name: "MATLAB and Robotics Toolkit" },
  { resource: "r-lab", field: "software", code: "SW-ADOBE", name: "Adobe Creative Suite" },
  { resource: "r-lab", field: "software", code: "SW-AUTOCAD", name: "AutoCAD Design Suite" },
  { resource: "r-lab", field: "software", code: "SW-VISUALSTUDIO", name: "Visual Studio Enterprise" },
  { resource: "r-lab", field: "software", code: "SW-ANACONDA", name: "Anaconda Data Science Toolkit" },
  // Research projects
  { resource: "r-research-workspace", field: "researchProject", code: "RP-2026-001", name: "Permora Capstone Research Project" },
  { resource: "r-research-workspace", field: "researchProject", code: "RP-2026-002", name: "Coastal Water-Quality Data Study" },
  { resource: "r-research-workspace", field: "researchProject", code: "RP-2026-003", name: "Campus Energy Optimization Project" },
  // Campus network zones (r-network-access)
  { resource: "r-network-access", field: "networkZone", code: "ZONE-CAMPUS", name: "Campus-Wide Wireless" },
  { resource: "r-network-access", field: "networkZone", code: "ZONE-ENG", name: "Engineering Building" },
  { resource: "r-network-access", field: "networkZone", code: "ZONE-LIB", name: "Main Library" },
  { resource: "r-network-access", field: "networkZone", code: "ZONE-DORM", name: "Residence Halls" },
  // Departments (r-dept-shared)
  { resource: "r-dept-shared", field: "department", code: "DEPT-CS", name: "Computer Science Department" },
  { resource: "r-dept-shared", field: "department", code: "DEPT-MATH", name: "Mathematics Department" },
  { resource: "r-dept-shared", field: "department", code: "DEPT-ENG", name: "Engineering Department" },
] as const;

// Requester eligibility: (user, resource) -> which scope codes to assign.
// permission_id is left NULL so the assignment is valid for any permission the
// requester role is eligible for on that resource (matches request-service's
// "permission_id IS NULL OR permission_id = $" check).
const ASSIGNMENTS: {
  user: string;
  resource: string;
  scopes: { field: string; code: string }[];
  evidence: string;
}[] = [
  // --- FACULTY ---
  // Teaching assignments (r-lms assigned-teaching): several sections.
  { user: FACULTY, resource: "r-lms", scopes: [{ field: "courseSection", code: "CS301-A" }], evidence: "Prototype: assigned to teach CS 301 Section A (synthetic demo)." },
  { user: FACULTY, resource: "r-lms", scopes: [{ field: "courseSection", code: "MATH201-B" }], evidence: "Prototype: assigned to teach MATH 201 Section B (synthetic demo)." },
  { user: FACULTY, resource: "r-lms", scopes: [{ field: "courseSection", code: "ENG102-C" }], evidence: "Prototype: assigned to teach ENG 102 Section C (synthetic demo)." },
  // Grading authority: several sections.
  { user: FACULTY, resource: "r-faculty-grading", scopes: [{ field: "courseSection", code: "CS301-A" }], evidence: "Prototype: grading authority for CS 301 Section A (synthetic demo)." },
  { user: FACULTY, resource: "r-faculty-grading", scopes: [{ field: "courseSection", code: "MATH201-B" }], evidence: "Prototype: grading authority for MATH 201 Section B (synthetic demo)." },
  { user: FACULTY, resource: "r-faculty-grading", scopes: [{ field: "courseSection", code: "ENG102-C" }], evidence: "Prototype: grading authority for ENG 102 Section C (synthetic demo)." },
  { user: FACULTY, resource: "r-faculty-grading", scopes: [{ field: "courseSection", code: "PHYS210-A" }], evidence: "Prototype: grading authority for PHYS 210 Section A (synthetic demo)." },
  // Lab access: multiple laboratories and software (laboratory + software are
  // independent required fields; each option is assigned separately so the
  // requester can combine any assigned laboratory with any assigned software).
  { user: FACULTY, resource: "r-lab", scopes: [{ field: "laboratory", code: "LAB-COMP-1" }], evidence: "Prototype: Computing Laboratory 1 access (synthetic demo)." },
  { user: FACULTY, resource: "r-lab", scopes: [{ field: "laboratory", code: "LAB-COMP-3" }], evidence: "Prototype: Computing Laboratory 3 access (synthetic demo)." },
  { user: FACULTY, resource: "r-lab", scopes: [{ field: "laboratory", code: "LAB-NET-1" }], evidence: "Prototype: Networking Laboratory 1 access (synthetic demo)." },
  { user: FACULTY, resource: "r-lab", scopes: [{ field: "software", code: "SW-MATLAB" }], evidence: "Prototype: MATLAB toolkit access (synthetic demo)." },
  { user: FACULTY, resource: "r-lab", scopes: [{ field: "software", code: "SW-AUTOCAD" }], evidence: "Prototype: AutoCAD suite access (synthetic demo)." },
  { user: FACULTY, resource: "r-lab", scopes: [{ field: "software", code: "SW-VISUALSTUDIO" }], evidence: "Prototype: Visual Studio Enterprise access (synthetic demo)." },
  // Research membership: several projects.
  { user: FACULTY, resource: "r-research-workspace", scopes: [{ field: "researchProject", code: "RP-2026-001" }], evidence: "Prototype: member of Permora Capstone Research Project (synthetic demo)." },
  { user: FACULTY, resource: "r-research-workspace", scopes: [{ field: "researchProject", code: "RP-2026-003" }], evidence: "Prototype: lead of Campus Energy Optimization Project (synthetic demo)." },

  // --- STUDENT ---
  // LMS participation sections.
  { user: STUDENT, resource: "r-lms", scopes: [{ field: "courseSection", code: "CS101-A" }], evidence: "Prototype: enrolled in CS 101 Section A, all eligible permissions (synthetic demo)." },
  { user: STUDENT, resource: "r-lms", scopes: [{ field: "courseSection", code: "ENG102-C" }], evidence: "Prototype: enrolled in ENG 102 Section C (synthetic demo)." },
  // Lab access: multiple laboratories and software.
  { user: STUDENT, resource: "r-lab", scopes: [{ field: "laboratory", code: "LAB-COMP-2" }], evidence: "Prototype: Computing Laboratory 2 access (synthetic demo)." },
  { user: STUDENT, resource: "r-lab", scopes: [{ field: "laboratory", code: "LAB-COMP-3" }], evidence: "Prototype: Computing Laboratory 3 access (synthetic demo)." },
  { user: STUDENT, resource: "r-lab", scopes: [{ field: "software", code: "SW-ADOBE" }], evidence: "Prototype: Adobe Creative Suite access (synthetic demo)." },
  { user: STUDENT, resource: "r-lab", scopes: [{ field: "software", code: "SW-ANACONDA" }], evidence: "Prototype: Anaconda Data Science Toolkit access (synthetic demo)." },
  // Research membership: permission-agnostic assignment on existing + a second
  // project. The pre-existing migration-seeded permission-specific row
  // (research:contribute-project) is preserved; the read layer de-duplicates by
  // option id so the overlapping assignment never produces a duplicate dropdown.
  { user: STUDENT, resource: "r-research-workspace", scopes: [{ field: "researchProject", code: "RP-2026-001" }], evidence: "Prototype: member of Permora Capstone Research Project, all eligible permissions (synthetic demo)." },
  { user: STUDENT, resource: "r-research-workspace", scopes: [{ field: "researchProject", code: "RP-2026-002" }], evidence: "Prototype: member of Coastal Water-Quality Data Study (synthetic demo)." },

  // --- NEW: Campus Network & Wi-Fi Access (r-network-access) ---
  // Faculty: multiple zones (eligible for eduroam, VPN, device registration).
  { user: FACULTY, resource: "r-network-access", scopes: [{ field: "networkZone", code: "ZONE-CAMPUS" }], evidence: "Prototype: campus-wide network affiliation (synthetic demo)." },
  { user: FACULTY, resource: "r-network-access", scopes: [{ field: "networkZone", code: "ZONE-ENG" }], evidence: "Prototype: Engineering Building network zone (synthetic demo)." },
  // Student: zones (eligible for eduroam, device registration; NOT VPN by role map).
  { user: STUDENT, resource: "r-network-access", scopes: [{ field: "networkZone", code: "ZONE-CAMPUS" }], evidence: "Prototype: campus-wide network affiliation (synthetic demo)." },
  { user: STUDENT, resource: "r-network-access", scopes: [{ field: "networkZone", code: "ZONE-DORM" }], evidence: "Prototype: Residence Halls network zone (synthetic demo)." },

  // --- NEW: Department Shared Resources (r-dept-shared) ---
  // Faculty: departments (eligible for read, contribute, print).
  { user: FACULTY, resource: "r-dept-shared", scopes: [{ field: "department", code: "DEPT-CS" }], evidence: "Prototype: Computer Science department affiliation (synthetic demo)." },
  { user: FACULTY, resource: "r-dept-shared", scopes: [{ field: "department", code: "DEPT-ENG" }], evidence: "Prototype: Engineering department affiliation (synthetic demo)." },
  // Student: departments (eligible for read, print; NOT contribute by role map).
  { user: STUDENT, resource: "r-dept-shared", scopes: [{ field: "department", code: "DEPT-CS" }], evidence: "Prototype: Computer Science department affiliation (synthetic demo)." },
  { user: STUDENT, resource: "r-dept-shared", scopes: [{ field: "department", code: "DEPT-MATH" }], evidence: "Prototype: Mathematics department affiliation (synthetic demo)." },
];

// Resource-wide approver responsibilities (permission_id NULL, no scope restriction)
// so every eligible permission on the resource routes to the demo approver.
const APPROVER_RESOURCES = [
  "r-faculty-grading",
  "r-lab",
  "r-lms",
  "r-library",
  "r-research-workspace",
  "r-student-portal",
  "r-network-access",
  "r-dept-shared",
];

async function main() {
  const pool = new pg.Pool({ connectionString: DEV_URL, max: 1, connectionTimeoutMillis: 15000 });
  const client = await pool.connect();
  const added = { scopeOptions: 0, assignments: 0, approvers: 0 };
  try {
    const live = (await client.query("SELECT current_database() AS n")).rows[0].n as string;
    if (live !== "neondb") throw new Error(`Refusing: live database is "${live}", expected "neondb".`);
    if (/_test$/.test(live)) throw new Error(`Refusing: "${live}" looks like a test database.`);
    console.log(`Target confirmed: ${live}`);

    await client.query("BEGIN");

    // Verify actor is an active admin (same guard as configure-access.ts).
    const adminOk = await client.query(
      `SELECT 1 FROM user_role ur JOIN user_profile p ON p.user_id = ur.user_id
        WHERE ur.user_id = $1::uuid AND ur.role = 'admin' AND p.active`,
      [ADMIN_ACTOR],
    );
    if (!adminOk.rows[0]) throw new Error("Admin actor is not an active administrator.");

    // 1) Scope options (unique on resource_id, field_name, institutional_code).
    for (const o of SCOPE_OPTIONS) {
      const id = randomUUID();
      const res = await client.query(
        `INSERT INTO scope_option (id, resource_id, field_name, institutional_code, display_name)
         SELECT $1,$2,$3,$4,$5
          WHERE EXISTS (SELECT 1 FROM catalog_scope_field WHERE resource_id = $2 AND field_name = $3)
            AND NOT EXISTS (SELECT 1 FROM scope_option WHERE resource_id = $2 AND field_name = $3 AND institutional_code = $4)`,
        [id, o.resource, o.field, o.code.toUpperCase(), o.name],
      );
      if (res.rowCount === 1) added.scopeOptions++;
    }

    const scopeId = async (resource: string, field: string, code: string) => {
      const r = await client.query<{ id: string }>(
        `SELECT id FROM scope_option WHERE resource_id = $1 AND field_name = $2 AND institutional_code = $3`,
        [resource, field, code.toUpperCase()],
      );
      if (!r.rows[0]) throw new Error(`Missing scope option ${resource}/${field}/${code}`);
      return r.rows[0].id;
    };

    // 2) Requester assignments (guard: same user+resource+scope+NULL-permission not already active).
    for (const a of ASSIGNMENTS) {
      for (const s of a.scopes) {
        const sid = await scopeId(a.resource, s.field, s.code);
        const id = randomUUID();
        const res = await client.query(
          `INSERT INTO requester_assignment (id, user_id, resource_id, scope_option_id, permission_id, evidence, valid_from, valid_until, assigned_by)
           SELECT $1,$2,$3,$4,NULL,$5, now(), NULL, $6
            WHERE EXISTS (SELECT 1 FROM user_profile WHERE user_id = $2::uuid AND active)
              AND EXISTS (SELECT 1 FROM scope_option WHERE id = $4::uuid AND resource_id = $3)
              AND NOT EXISTS (
                SELECT 1 FROM requester_assignment
                 WHERE user_id = $2::uuid AND resource_id = $3 AND scope_option_id = $4::uuid
                   AND permission_id IS NULL
                   AND valid_from <= now() AND (valid_until IS NULL OR valid_until > now()))`,
          [id, a.user, a.resource, sid, a.evidence, ADMIN_ACTOR],
        );
        if (res.rowCount === 1) added.assignments++;
      }
    }

    // 3) Resource-wide approver responsibilities (guard: no active resource-wide row already).
    for (const resource of APPROVER_RESOURCES) {
      const id = randomUUID();
      const res = await client.query(
        `INSERT INTO approver_responsibility (id, approver_user_id, resource_id, permission_id, scope_option_id, valid_from, valid_until, assigned_by)
         SELECT $1,$2,$3,NULL,NULL, now(), NULL, $4
          WHERE EXISTS (
                  SELECT 1 FROM user_profile p JOIN user_role ur ON ur.user_id = p.user_id
                   WHERE p.user_id = $2::uuid AND p.active AND ur.role IN ('approver','admin'))
            AND NOT EXISTS (
                  SELECT 1 FROM approver_responsibility
                   WHERE approver_user_id = $2::uuid AND resource_id = $3
                     AND permission_id IS NULL AND scope_option_id IS NULL
                     AND valid_from <= now() AND (valid_until IS NULL OR valid_until > now()))`,
        [id, APPROVER, resource, ADMIN_ACTOR],
      );
      if (res.rowCount === 1) added.approvers++;
    }

    // Audit trail for the batch (only if something changed).
    const totalAdded = added.scopeOptions + added.assignments + added.approvers;
    if (totalAdded > 0) {
      await client.query(
        `INSERT INTO audit_event (id, actor_user_id, event_type, metadata)
         VALUES ($1,$2,$3,$4::jsonb)`,
        [randomUUID(), ADMIN_ACTOR, "configuration.demo_seed.applied", JSON.stringify({ added, prototype: true })],
      );
    }

    await client.query("COMMIT");
    console.log("Seed complete (idempotent). Rows added this run:", JSON.stringify(added));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error("Seed failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
