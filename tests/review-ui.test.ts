import assert from "node:assert/strict";
import test from "node:test";
import { navigationForIdentity } from "../lib/navigation";
import {
  decisionFailureMessage,
  reviewQueueActionLabel,
  validateDecisionReason,
} from "../lib/review-ui";
import type { TrustedIdentity } from "../lib/auth-types";

function identity(
  roles: TrustedIdentity["roles"],
  requesterRole: TrustedIdentity["requesterRole"] = null,
): TrustedIdentity {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    name: "Test User",
    email: "user@example.test",
    active: true,
    roles,
    requesterRole,
    department: "Testing",
  };
}

test("staff navigation is role-specific and excludes requester actions", () => {
  assert.deepEqual(
    navigationForIdentity(identity(["approver"])).map((item) => item[1]),
    ["Dashboard", "Review Requests", "Help & Support"],
  );
  assert.deepEqual(
    navigationForIdentity(identity(["admin"])).map((item) => item[1]),
    [
      "Dashboard",
      "Review Requests",
      "Unassigned Requests",
      "Audit Logs",
      "Help & Support",
    ],
  );
  assert.equal(
    navigationForIdentity(identity(["admin", "student"], "student")).some(
      (item) => item[1] === "My Requests" || item[1] === "Request Access",
    ),
    false,
  );
});

test("requester navigation is preserved", () => {
  assert.deepEqual(
    navigationForIdentity(identity(["student"], "student")).map(
      (item) => item[1],
    ),
    ["Dashboard", "My Requests", "Request Access", "Notifications"],
  );
});

test("only pending reviews use the actionable queue label", () => {
  assert.equal(reviewQueueActionLabel("pending_review"), "Review");
  for (const status of [
    "approved_pending_activation",
    "denied",
    "returned_for_revision",
    "expired",
    "cancelled",
  ] as const) {
    assert.equal(reviewQueueActionLabel(status), "View details");
  }
});

test("denial and revision reasons are trimmed, required, and bounded", () => {
  assert.equal(validateDecisionReason("approve", ""), "");
  assert.match(validateDecisionReason("deny", "   "), /reason/i);
  assert.match(
    validateDecisionReason("return_for_revision", "\n"),
    /reason/i,
  );
  assert.equal(validateDecisionReason("deny", " Clear reason "), "");
  assert.match(validateDecisionReason("deny", "x".repeat(2001)), /2,000/);
});

test("decision failures map to credential-safe actionable messages", () => {
  assert.match(decisionFailureMessage(400), /check/i);
  assert.match(decisionFailureMessage(401), /sign in/i);
  assert.match(decisionFailureMessage(403), /authorized/i);
  assert.equal(decisionFailureMessage(404), decisionFailureMessage(404, "x"));
  assert.match(decisionFailureMessage(409, "stale_decision"), /changed/i);
  assert.match(decisionFailureMessage(415), /format/i);
  assert.match(decisionFailureMessage(429), /too many/i);
  assert.match(decisionFailureMessage(503), /unavailable/i);
  assert.match(decisionFailureMessage(500), /unavailable/i);
});
