import assert from "node:assert/strict";
import test from "node:test";
import {
  availabilityLabel,
  catalogMutationMessage,
  catalogToggleConfirmMessage,
  normalizeInstitutionalCode,
  requesterRolesLabel,
  validateScopeOptionDraft,
} from "../lib/catalog-admin-ui";

const base = {
  resourceId: "r-lms",
  fieldName: "courseSection",
  institutionalCode: "CS-101",
  displayName: "Computer Science 101",
};

test("scope option draft requires a resource, field, code, and name", () => {
  assert.equal(validateScopeOptionDraft(base), "");
  assert.match(
    validateScopeOptionDraft({ ...base, resourceId: "  " }),
    /choose a resource/i,
  );
  assert.match(
    validateScopeOptionDraft({ ...base, fieldName: "" }),
    /scope field/i,
  );
  assert.match(
    validateScopeOptionDraft({ ...base, institutionalCode: "   " }),
    /institutional code/i,
  );
  assert.match(
    validateScopeOptionDraft({ ...base, displayName: "" }),
    /display name/i,
  );
});

test("scope option draft enforces the same length bounds as the server", () => {
  assert.match(
    validateScopeOptionDraft({ ...base, institutionalCode: "A".repeat(81) }),
    /80 characters or fewer/,
  );
  assert.equal(
    validateScopeOptionDraft({ ...base, institutionalCode: "A".repeat(80) }),
    "",
  );
  assert.match(
    validateScopeOptionDraft({ ...base, displayName: "A".repeat(201) }),
    /200 characters or fewer/,
  );
});

test("institutional code normalizes to the stored upper-case form", () => {
  assert.equal(normalizeInstitutionalCode("  cs-101 "), "CS-101");
});

test("toggle confirmation messages describe the direction and preserve records", () => {
  const disable = catalogToggleConfirmMessage("resource", "Library", false);
  assert.match(disable, /unavailable/i);
  assert.match(disable, /not changed/i);
  assert.match(
    catalogToggleConfirmMessage("permission", "Course participation", true),
    /available for new requests/i,
  );
});

test("requester role labels only surface requester-facing roles", () => {
  assert.equal(requesterRolesLabel(["student"]), "Students");
  assert.equal(requesterRolesLabel(["faculty"]), "Faculty");
  assert.equal(requesterRolesLabel(["student", "faculty"]), "Students, Faculty");
  assert.equal(requesterRolesLabel(["admin", "approver"]), "No requester roles");
  assert.equal(requesterRolesLabel([]), "No requester roles");
});

test("availability label maps the boolean to a human string", () => {
  assert.equal(availabilityLabel(true), "Available");
  assert.equal(availabilityLabel(false), "Unavailable");
});

test("mutation messages map status codes without leaking internals", () => {
  assert.match(catalogMutationMessage(403), /administrator access/i);
  assert.match(catalogMutationMessage(401), /session ended/i);
  assert.match(catalogMutationMessage(404), /no longer exists/i);
  assert.match(catalogMutationMessage(409), /already exists/i);
  assert.match(
    catalogMutationMessage(200, "conflict"),
    /already exists/i,
  );
  assert.match(catalogMutationMessage(400), /invalid/i);
  assert.match(catalogMutationMessage(503), /temporarily unavailable/i);
});
