import assert from "node:assert/strict";
import test from "node:test";
import {
  allRequirementsMet,
  estimatePasswordStrength,
  evaluatePasswordRequirements,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from "../lib/password-strength";

test("empty password is weak with a length suggestion", () => {
  const result = estimatePasswordStrength("");
  assert.equal(result.level, "weak");
  assert.equal(result.score, 0);
  assert.equal(result.filledSegments, 1);
  assert.match(result.suggestions[0], /12 characters/);
});

test("below the minimum length can never exceed weak", () => {
  const result = estimatePasswordStrength("Ab3$xy");
  assert.equal(result.level, "weak");
  assert.ok(result.suggestions.some((s) => /at least 12/i.test(s)));
});

test("level rises with length and variety and segments track the level", () => {
  const fair = estimatePasswordStrength("alllowercaseword");
  const strong = estimatePasswordStrength("Tr0ub4dour-&-3-corgis-run");
  assert.ok(["fair", "good"].includes(fair.level), `expected fair/good, got ${fair.level}`);
  assert.equal(strong.level, "strong");
  assert.equal(strong.filledSegments, 4);
  assert.equal(estimatePasswordStrength("x").filledSegments, 1);
  // Monotonic-ish: a long varied passphrase scores higher than a short one.
  assert.ok(strong.score > fair.score);
});

test("common passwords and predictable patterns are penalized", () => {
  // "password1" is in the illustrative common-password set.
  const common = estimatePasswordStrength("password1");
  assert.equal(common.level, "weak");
  assert.ok(common.suggestions.some((s) => /common|guessed/i.test(s)));

  const sequential = estimatePasswordStrength("abcdefghijkl");
  assert.ok(sequential.suggestions.some((s) => /sequence/i.test(s)));

  const repeated = estimatePasswordStrength("aaaaaaaaaaaa");
  assert.ok(repeated.suggestions.some((s) => /repeating|wider mix/i.test(s)));
  assert.equal(repeated.level, "weak");
});

test("score stays within 0–100 and suggestions are capped", () => {
  for (const sample of ["", "a", "password1234", "Tr0ub4dour-&-3-corgis-run", "x".repeat(200)]) {
    const result = estimatePasswordStrength(sample);
    assert.ok(result.score >= 0 && result.score <= 100);
    assert.ok(result.suggestions.length <= 3);
  }
});

test("requirements checklist mirrors the server contract", () => {
  const base = {
    currentPassword: "current-password-123",
    newPassword: "a-brand-new-passphrase",
    confirmation: "a-brand-new-passphrase",
  };
  const ok = evaluatePasswordRequirements(base);
  assert.ok(allRequirementsMet(ok));

  const tooShort = evaluatePasswordRequirements({ ...base, newPassword: "short", confirmation: "short" });
  assert.equal(tooShort.find((r) => r.id === "length-min")?.met, false);
  assert.equal(allRequirementsMet(tooShort), false);

  const tooLong = "x".repeat(MAX_PASSWORD_LENGTH + 1);
  const over = evaluatePasswordRequirements({ ...base, newPassword: tooLong, confirmation: tooLong });
  assert.equal(over.find((r) => r.id === "length-max")?.met, false);

  const same = evaluatePasswordRequirements({
    currentPassword: "repeated-password-xx",
    newPassword: "repeated-password-xx",
    confirmation: "repeated-password-xx",
  });
  assert.equal(same.find((r) => r.id === "different")?.met, false);

  const mismatch = evaluatePasswordRequirements({ ...base, confirmation: "different-value-entirely" });
  assert.equal(mismatch.find((r) => r.id === "match")?.met, false);
});

test("length boundary constants are the enforced 12 and 128", () => {
  assert.equal(MIN_PASSWORD_LENGTH, 12);
  assert.equal(MAX_PASSWORD_LENGTH, 128);
  const exactMin = "x".repeat(MIN_PASSWORD_LENGTH);
  assert.equal(
    evaluatePasswordRequirements({ currentPassword: "other", newPassword: exactMin, confirmation: exactMin })
      .find((r) => r.id === "length-min")?.met,
    true,
  );
});
