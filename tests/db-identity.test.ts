import assert from "node:assert/strict";
import test from "node:test";
import {
  identityError,
  PRODUCTION_IDENTITY,
  FORBIDDEN_BRANCH,
  FORBIDDEN_ENDPOINT,
} from "../lib/db-identity";

const P = PRODUCTION_IDENTITY;

test("incomplete identity is refused (any NULL/empty field)", () => {
  assert.match(identityError(null, P.branch, P.endpoint, P.database) ?? "", /incomplete/);
  assert.match(identityError(P.project, null, P.endpoint, P.database) ?? "", /incomplete/);
  assert.match(identityError(P.project, P.branch, null, P.database) ?? "", /incomplete/);
  assert.match(identityError(P.project, P.branch, P.endpoint, null) ?? "", /incomplete/);
  assert.match(identityError("", P.branch, P.endpoint, P.database) ?? "", /incomplete/);
  assert.match(
    identityError(undefined, undefined, undefined, undefined) ?? "",
    /incomplete/,
  );
});

test("vercel-dev branch is refused regardless of environment", () => {
  for (const isProd of [true, false]) {
    const reason = identityError(
      P.project,
      FORBIDDEN_BRANCH,
      P.endpoint,
      P.database,
      isProd,
    );
    assert.match(reason ?? "", /vercel-dev/, `isProduction=${isProd}`);
  }
});

test("vercel-dev endpoint is refused regardless of environment", () => {
  for (const isProd of [true, false]) {
    const reason = identityError(
      P.project,
      P.branch,
      FORBIDDEN_ENDPOINT,
      P.database,
      isProd,
    );
    assert.match(reason ?? "", /vercel-dev/, `isProduction=${isProd}`);
  }
});

test("correct Production identity is accepted when isProduction", () => {
  assert.equal(
    identityError(P.project, P.branch, P.endpoint, P.database, true),
    null,
  );
});

test("wrong Production identity is refused when isProduction", () => {
  assert.match(
    identityError("other-project", P.branch, P.endpoint, P.database, true) ?? "",
    /intended Production/,
  );
  assert.match(
    identityError(P.project, "br-some-other", P.endpoint, P.database, true) ?? "",
    /intended Production/,
  );
  assert.match(
    identityError(P.project, P.branch, "ep-some-other", P.database, true) ?? "",
    /intended Production/,
  );
  assert.match(
    identityError(P.project, P.branch, P.endpoint, "other-db", true) ?? "",
    /intended Production/,
  );
});

test("non-production: only complete + not-vercel-dev is enforced", () => {
  // A different (isolated test) branch is acceptable when not in production.
  assert.equal(
    identityError(
      "test-project",
      "br-isolated-test",
      "ep-isolated-test",
      "neondb",
      false,
    ),
    null,
  );
  // But completeness and the vercel-dev prohibition still apply.
  assert.match(
    identityError("test-project", "", "ep-isolated", "neondb", false) ?? "",
    /incomplete/,
  );
  assert.match(
    identityError("test-project", FORBIDDEN_BRANCH, "ep-isolated", "neondb", false) ?? "",
    /vercel-dev/,
  );
});
