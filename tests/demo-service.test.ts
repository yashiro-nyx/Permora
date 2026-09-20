import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createSeed,
  parseStored,
  transition,
  validateDraft,
} from "../lib/demo-service";
import { RequestDraft } from "../lib/model";
import {
  RESOURCE_CATALOG,
  eligibleCatalogResources,
  getPermissionOptions,
} from "../lib/resource-catalog";

const draft: RequestDraft = {
  resourceId: "r-research-workspace",
  level: "research:contribute-project",
  scope: { researchProject: "PROJECT-2026-014 · Coastal Data Study" },
  purpose: "Research network access for my final project and coursework.",
  startsAt: "2026-09-14T09:00:00.000Z",
  expiresAt: "2026-09-15T09:00:00.000Z",
};
test("request → approve → activate → expire produces consistent notifications and audit", () => {
  const seed = createSeed();
  let state = transition(seed, "u-student", { type: "request", draft });
  const r = state.requests[0];
  assert.equal(r.status, "pending");
  assert.equal(seed.requests.length, 9);
  assert(
    state.notifications.some(
      (n) => n.userId === "u-approver" && n.requestId === r.id,
    ),
  );
  state = transition(state, "u-approver", {
    type: "decide",
    requestId: r.id,
    version: r.version,
    outcome: "approved",
    reason: "Appropriate for the research project.",
  });
  assert.equal(state.requests[0].status, "approved");
  assert(
    state.notifications.some(
      (n) => n.userId === "u-student" && n.title === "Access request approved",
    ),
  );
  state = transition(state, "u-admin", { type: "clock", days: 1 });
  assert.equal(state.requests[0].status, "active");
  state = transition(state, "u-admin", { type: "clock", days: 1 });
  assert.equal(state.requests[0].status, "expired");
  const events = state.audit.filter((e) => e.requestId === r.id);
  assert.equal(events.length, 4);
  assert(events.some((e) => e.action === "Access expired"));
  const count = events.length;
  state = transition(state, "u-admin", { type: "clock", days: 1 });
  assert.equal(state.audit.filter((e) => e.requestId === r.id).length, count);
});
test("rejects incompatible, overlapping, missing and excessive expiration requests", () => {
  const state = createSeed();
  const user = state.users[0];
  assert(
    validateDraft(state, user, {
      ...draft,
      resourceId: "r-faculty-grading",
      level: "grading:encode-assigned-section",
      scope: { courseSection: "CS 301 · Section A" },
    }).resourceId,
  );
  assert(
    validateDraft(state, user, {
      ...draft,
      resourceId: "r-library",
      level: "library:subscribed-materials",
      scope: {},
    }).resourceId,
  );
  assert(validateDraft(state, user, { ...draft, expiresAt: "" }).expiresAt);
  assert(
    validateDraft(state, user, { ...draft, expiresAt: draft.startsAt })
      .expiresAt,
  );
  assert(
    validateDraft(state, user, { ...draft, expiresAt: "2027-01-01T09:00:00Z" })
      .expiresAt,
  );
  assert(
    validateDraft(state, user, { ...draft, startsAt: "2020-01-01T09:00:00Z" })
      .startsAt,
  );
  assert.throws(
    () =>
      transition(state, "u-student", {
        type: "request",
        draft: { ...draft, level: "research:manage-project-files" },
      }),
    /permission/,
  );
});
test("denial is explained; stale and unauthorized decisions never mutate state", () => {
  let state = transition(createSeed(), "u-student", { type: "request", draft });
  const r = state.requests[0];
  assert.throws(
    () =>
      transition(state, "u-student", {
        type: "decide",
        requestId: r.id,
        version: 1,
        outcome: "approved",
        reason: "A sufficient reason.",
      }),
    /reviewer/,
  );
  assert.throws(
    () =>
      transition(state, "u-approver", {
        type: "decide",
        requestId: r.id,
        version: 1,
        outcome: "denied",
        reason: "No",
      }),
    /reason/,
  );
  state = transition(state, "u-approver", {
    type: "decide",
    requestId: r.id,
    version: 1,
    outcome: "denied",
    reason: "Training prerequisites must be completed.",
  });
  assert.equal(state.requests[0].status, "denied");
  assert.equal(
    state.requests[0].decision?.reason,
    "Training prerequisites must be completed.",
  );
  const before = JSON.stringify(state);
  assert.throws(
    () =>
      transition(state, "u-admin", {
        type: "decide",
        requestId: r.id,
        version: 1,
        outcome: "approved",
        reason: "A sufficient reason.",
      }),
    /already reviewed/,
  );
  assert.equal(JSON.stringify(state), before);
});
test("user deactivation and resource policy changes revoke incompatible access", () => {
  const seed = createSeed();
  const user = { ...seed.users[0], active: false };
  let state = transition(seed, "u-admin", { type: "user", user });
  assert(
    state.requests
      .filter((r) => r.userId === user.id)
      .every((r) => !["pending", "active", "approved"].includes(r.status)),
  );
  assert.throws(
    () => transition(state, user.id, { type: "request", draft }),
    /inactive/,
  );
  state = transition(seed, "u-admin", {
    type: "resource",
    resource: {
      ...seed.resources.find((resource) => resource.id === "r-library")!,
      online: false,
    },
  });
  assert.equal(
    state.requests.find((r) => r.resourceId === "r-library")?.status,
    "revoked",
  );
  assert(
    state.notifications.some((n) => n.title === "Resource access changed"),
  );
});
test("read state is scoped to the active profile; persistence is versioned", () => {
  const seed = createSeed();
  const state = transition(seed, "u-faculty", { type: "read", ids: ["n-1"] });
  assert.equal(state.notifications.find((n) => n.id === "n-1")?.read, false);
  assert.deepEqual(parseStored(JSON.stringify(state)), state);
  assert.throws(() => parseStored('{"schema":3}'));
  assert.throws(() => parseStored("broken"));
});
test("renewals require same requester/resource and a non-overlapping period", () => {
  const seed = createSeed();
  const previous = seed.requests.find(
    (r) => r.userId === "u-student" && r.resourceId === "r-library",
  )!;
  const renewal = {
    ...draft,
    resourceId: previous.resourceId,
    level: "library:subscribed-materials" as const,
    scope: {},
    startsAt: previous.expiresAt,
    expiresAt: "2026-10-01T09:00:00Z",
    renewalOf: previous.id,
  };
  const state = transition(seed, "u-student", {
    type: "request",
    draft: renewal,
  });
  assert.equal(state.requests[0].renewalOf, previous.id);
  assert.throws(
    () => transition(seed, "u-faculty", { type: "request", draft: renewal }),
    /renewal must keep/,
  );
});

test("catalog filters requester roles and validates resource-specific scope", () => {
  const state = createSeed();
  const student = state.users.find((user) => user.id === "u-student")!;
  const faculty = state.users.find((user) => user.id === "u-faculty")!;
  assert.equal(RESOURCE_CATALOG.length, 6);
  assert(
    !eligibleCatalogResources(state.resources, student).some(
      (resource) => resource.id === "r-faculty-grading",
    ),
  );
  assert.equal(
    eligibleCatalogResources(
      state.resources,
      state.users.find((user) => user.id === "u-approver")!,
    ).length,
    0,
  );
  const grading = eligibleCatalogResources(state.resources, faculty).find(
    (resource) => resource.id === "r-faculty-grading",
  );
  assert(grading);
  assert.deepEqual(
    getPermissionOptions(grading, faculty.role).map(
      (permission) => permission.id,
    ),
    ["grading:encode-assigned-section", "grading:submit-assigned-section"],
  );
  assert(
    validateDraft(state, faculty, {
      ...draft,
      resourceId: "r-faculty-grading",
      level: "grading:encode-assigned-section",
      scope: {},
    }).courseSection,
  );
  assert(
    validateDraft(state, student, {
      ...draft,
      resourceId: "r-student-portal",
      level: "portal:view-own-academic-information",
      scope: { accountUserId: "u-5" },
    }).resourceId,
  );
  assert(
    validateDraft(state, student, {
      ...draft,
      scope: {},
    }).researchProject,
  );
});

test("schema 1 data migrates in place and retains legacy references", () => {
  const current = createSeed();
  const schema1 = {
    ...current,
    schema: 1,
    resources: current.resources.filter(
      (resource) =>
        ![
          "r-student-portal",
          "r-faculty-grading",
          "r-research-workspace",
        ].includes(resource.id),
    ),
    requests: current.requests.map((request) => ({
      ...request,
      scope: undefined,
      level:
        request.resourceId === "r-lab" ||
        request.resourceId === "r-library" ||
        request.resourceId === "r-lms"
          ? ("read" as const)
          : request.level,
    })),
  };
  const migrated = parseStored(JSON.stringify(schema1));
  assert.equal(migrated.schema, 2);
  assert.equal(migrated.requests.length, current.requests.length);
  assert(migrated.resources.some((resource) => resource.id === "r-records"));
  assert(
    migrated.resources.some(
      (resource) => resource.id === "r-research-workspace",
    ),
  );
  assert(
    migrated.requests.find((request) => request.resourceId === "r-lab")?.scope
      ?.laboratory,
  );
});
