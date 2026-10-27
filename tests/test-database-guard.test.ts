import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateTestIdentitySafety,
  productionIdentityFromEnvironment,
} from "../scripts/test-database-guard";

const production = {
  projectId: "floral-cloud-69190292",
  branchId: "br-gentle-boat-b3b3fr5v",
  endpointId: "ep-purple-mode-b3fyvdd0",
};

const dedicatedTest = {
  projectId: "floral-cloud-69190292",
  branchId: "br-dedicated-test-0001",
  endpointId: "ep-test-endpoint-0001",
};

test("a dedicated non-production test branch on a different endpoint is safe", () => {
  const verdict = evaluateTestIdentitySafety({
    testIdentity: dedicatedTest,
    databaseName: "permora_test",
    productionIdentities: [production],
  });
  assert.deepEqual(verdict, { safe: true });
});

test("refuses when the test identity fully matches Production", () => {
  const verdict = evaluateTestIdentitySafety({
    testIdentity: { ...production },
    databaseName: "permora_test",
    productionIdentities: [production],
  });
  assert.equal(verdict.safe, false);
  assert.match(
    (verdict as { reason: string }).reason,
    /Production Neon branch/,
  );
});

test("refuses on a shared Production endpoint even if branch/project labels differ", () => {
  const verdict = evaluateTestIdentitySafety({
    testIdentity: {
      projectId: "someproject",
      branchId: "br-looks-like-test",
      endpointId: production.endpointId, // same physical compute
    },
    databaseName: "permora_test",
    productionIdentities: [production],
  });
  assert.equal(verdict.safe, false);
  assert.match(
    (verdict as { reason: string }).reason,
    /shares the Production Neon endpoint/,
  );
});

test("fails closed when no Production identity can be established", () => {
  const verdict = evaluateTestIdentitySafety({
    testIdentity: dedicatedTest,
    databaseName: "permora_test",
    productionIdentities: [],
  });
  assert.equal(verdict.safe, false);
  assert.match(
    (verdict as { reason: string }).reason,
    /No Production Neon identity/,
  );
});

test("fails closed when the test identity is missing", () => {
  const verdict = evaluateTestIdentitySafety({
    testIdentity: undefined,
    productionIdentities: [production],
  });
  assert.equal(verdict.safe, false);
  assert.match(
    (verdict as { reason: string }).reason,
    /could not be verified/,
  );
});

test("fails closed when the test identity is incomplete", () => {
  const verdict = evaluateTestIdentitySafety({
    testIdentity: { projectId: "p", branchId: "", endpointId: "e" },
    productionIdentities: [production],
  });
  assert.equal(verdict.safe, false);
  assert.match((verdict as { reason: string }).reason, /incomplete/);
});

test("still rejects a non-_test database name on an otherwise safe target", () => {
  const verdict = evaluateTestIdentitySafety({
    testIdentity: dedicatedTest,
    databaseName: "neondb",
    productionIdentities: [production],
  });
  assert.equal(verdict.safe, false);
  assert.match((verdict as { reason: string }).reason, /end with _test/);
});

test("reasons never include a connection string or credentials", () => {
  const verdicts = [
    evaluateTestIdentitySafety({
      testIdentity: { ...production },
      databaseName: "permora_test",
      productionIdentities: [production],
    }),
    evaluateTestIdentitySafety({
      testIdentity: dedicatedTest,
      productionIdentities: [],
    }),
  ];
  for (const verdict of verdicts) {
    assert.equal(verdict.safe, false);
    const reason = (verdict as { reason: string }).reason;
    assert.doesNotMatch(reason, /postgres(?:ql)?:\/\//i);
    assert.doesNotMatch(reason, /:\/\/[^@]*@/);
  }
});

test("explicit Production identity is read fully from the environment", () => {
  const identity = productionIdentityFromEnvironment({
    PRODUCTION_NEON_PROJECT_ID: production.projectId,
    PRODUCTION_NEON_BRANCH_ID: production.branchId,
    PRODUCTION_NEON_ENDPOINT_ID: production.endpointId,
  });
  assert.deepEqual(identity, production);
});

test("no Production identity variables yields undefined (fall back to live URL)", () => {
  assert.equal(productionIdentityFromEnvironment({}), undefined);
});

test("a partial Production identity throws rather than silently passing", () => {
  assert.throws(
    () =>
      productionIdentityFromEnvironment({
        PRODUCTION_NEON_PROJECT_ID: production.projectId,
        // branch + endpoint intentionally missing
      }),
    /must all be set together/,
  );
});
