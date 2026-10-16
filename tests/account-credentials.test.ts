import assert from "node:assert/strict";
import test from "node:test";
import {
  createInvitationToken,
  hashInvitationToken,
  hashRateLimitIdentifier,
  invitationAuditMetadata,
  invitationFlowMessage,
  invitationRateLimitAllowed,
  InvitationFlowError,
  parseInvitationAcceptanceInput,
  validatePasswordLength,
} from "../lib/account-credentials";

test("invitation tokens are high entropy and digest to a fixed-size hash", () => {
  const token = createInvitationToken();
  const digest = hashInvitationToken(token);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(digest.length, 32);
  assert.notEqual(digest.toString("base64url"), token);
  assert.deepEqual(hashInvitationToken(token), digest);
});

test("invitation acceptance parsing rejects malformed tokens without echoing them", () => {
  const token = createInvitationToken();
  const parsed = parseInvitationAcceptanceInput({ token, password: "A secure password 2026" });
  assert.equal(parsed.password, "A secure password 2026");
  assert.equal(parsed.tokenHash.length, 32);
  assert.throws(
    () => parseInvitationAcceptanceInput({ token: "sensitive-token-value", password: "A secure password 2026" }),
    (error: unknown) => {
      assert.ok(error instanceof InvitationFlowError);
      assert.equal(error.code, "invalid_invitation");
      assert.doesNotMatch(error.message, /sensitive-token-value/);
      return true;
    },
  );
});

test("invitation acceptance uses one generic message for all invalid invitation states", () => {
  const messages = ["invalid_invitation", "invalid_invitation", "invalid_invitation"].map(
    (code) => invitationFlowMessage(code as "invalid_invitation"),
  );
  assert.equal(new Set(messages).size, 1);
  assert.equal(
    messages[0],
    "This invitation is invalid or expired. Ask an administrator to issue a new one.",
  );
});

test("password length checks use configured Better Auth bounds", () => {
  assert.equal(validatePasswordLength("123456789012", 12, 128), "123456789012");
  assert.throws(() => validatePasswordLength("short", 12, 128), InvitationFlowError);
  assert.throws(
    () => validatePasswordLength("x".repeat(129), 12, 128),
    InvitationFlowError,
  );
});

test("rate-limit identifiers are hashed and attempts are bounded", () => {
  assert.equal(hashRateLimitIdentifier("203.0.113.12").length, 64);
  assert.equal(invitationRateLimitAllowed(5), true);
  assert.equal(invitationRateLimitAllowed(6), false);
});

test("invitation audit metadata contains only its id and expiry", () => {
  const metadata = invitationAuditMetadata(
    "1a9d488b-3d73-49fa-9a47-2472340f44ef",
    "2026-10-01T12:00:00.000Z",
  );
  assert.deepEqual(metadata, {
    invitationId: "1a9d488b-3d73-49fa-9a47-2472340f44ef",
    expiresAt: "2026-10-01T12:00:00.000Z",
  });
  assert.doesNotMatch(JSON.stringify(metadata), /token|hash|password|session/i);
});