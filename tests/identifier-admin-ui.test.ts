import assert from "node:assert/strict";
import test from "node:test";
import {
  findIdentifierOverwrite,
  identifierMutationMessage,
  identifierTypeLabel,
  normalizeIdentifierValue,
  validateIdentifierDraft,
} from "../lib/identifier-admin-ui";

const base = {
  identifierType: "student_number",
  issuer: "campus-registrar",
  identifier: "2026-00042",
};

test("identifier draft requires a known type, an issuer, and a value", () => {
  assert.equal(validateIdentifierDraft(base), "");
  assert.match(
    validateIdentifierDraft({ ...base, identifierType: "" }),
    /student or staff number/i,
  );
  assert.match(
    validateIdentifierDraft({ ...base, identifierType: "faculty_number" }),
    /student or staff number/i,
  );
  assert.match(
    validateIdentifierDraft({ ...base, issuer: "   " }),
    /issuing namespace/i,
  );
  assert.match(
    validateIdentifierDraft({ ...base, identifier: "" }),
    /identifier value/i,
  );
});

test("identifier draft enforces the same length bounds as the server", () => {
  assert.match(
    validateIdentifierDraft({ ...base, issuer: "A".repeat(121) }),
    /120 characters or fewer/,
  );
  assert.equal(validateIdentifierDraft({ ...base, issuer: "A".repeat(120) }), "");
  assert.match(
    validateIdentifierDraft({ ...base, identifier: "A".repeat(81) }),
    /80 characters or fewer/,
  );
});

test("identifier value normalizes to the stored upper-case form", () => {
  assert.equal(normalizeIdentifierValue("  2026-abc "), "2026-ABC");
});

test("type label maps known codes and passes through unknown ones", () => {
  assert.equal(identifierTypeLabel("student_number"), "Student number");
  assert.equal(identifierTypeLabel("staff_number"), "Staff number");
  assert.equal(identifierTypeLabel("other"), "other");
});

test("overwrite detection flags a changed value for the same type and issuer", () => {
  const existing = [
    { identifierType: "student_number", issuer: "campus-registrar", identifier: "2026-00001" },
    { identifierType: "staff_number", issuer: "hr", identifier: "STAFF-9" },
  ];
  // Same type + issuer, different normalized value -> overwrite.
  const overwrite = findIdentifierOverwrite(
    { identifierType: "student_number", issuer: "campus-registrar", identifier: "2026-99999" },
    existing,
  );
  assert.deepEqual(overwrite, { previous: "2026-00001" });
  // Same type + issuer, same normalized value (case-insensitive) -> no overwrite prompt.
  assert.equal(
    findIdentifierOverwrite(
      { identifierType: "student_number", issuer: "Campus-Registrar", identifier: "2026-00001" },
      existing,
    ),
    null,
  );
  // Different issuer -> treated as a new identifier, no overwrite.
  assert.equal(
    findIdentifierOverwrite(
      { identifierType: "student_number", issuer: "other-campus", identifier: "2026-00042" },
      existing,
    ),
    null,
  );
});

test("mutation messages map status codes without leaking internals", () => {
  assert.match(identifierMutationMessage(401), /session ended/i);
  assert.match(identifierMutationMessage(403), /administrator access/i);
  assert.match(identifierMutationMessage(404), /account was not found/i);
  assert.match(identifierMutationMessage(409), /already assigned/i);
  assert.match(identifierMutationMessage(200, "conflict"), /already assigned/i);
  assert.match(identifierMutationMessage(400), /identifier type, issuer, and value/i);
  assert.match(identifierMutationMessage(503), /temporarily unavailable/i);
});
