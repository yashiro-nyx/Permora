import assert from "node:assert/strict";
import test from "node:test";
import {
  allowsAdminFallback,
  approvalRoutingPolicy,
} from "../lib/approval-routing-policy";

test("dedicated-only is the safe default routing policy", () => {
  assert.equal(approvalRoutingPolicy(undefined), "dedicated_only");
  assert.equal(allowsAdminFallback("dedicated_only"), false);
});

test("admin fallback requires an explicit deployment policy", () => {
  const policy = "dedicated_first_with_admin_fallback" as const;
  assert.equal(approvalRoutingPolicy(policy), policy);
  assert.equal(allowsAdminFallback(policy), true);
  assert.equal(approvalRoutingPolicy("all_staff"), "dedicated_only");
});
