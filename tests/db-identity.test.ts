import assert from "node:assert/strict";
import test from "node:test";
import {
  identityError,
  classifyEnvironment,
  PRODUCTION_IDENTITY,
  FORBIDDEN_BRANCH,
  FORBIDDEN_ENDPOINT,
  type DeploymentEnvironment,
} from "../lib/db-identity";

const P = PRODUCTION_IDENTITY;
// A safe non-production Neon identity (distinct branch + endpoint from prod).
const SAFE = {
  project: "floral-cloud-69190292",
  branch: "br-red-hill-b3puvnss",
  endpoint: "ep-summer-cherry-b3o0t375",
  database: "permora_test",
};

// ---------------------------------------------------------------------------
// classifyEnvironment: VERCEL_ENV is authoritative; NODE_ENV alone is ambiguous.
// ---------------------------------------------------------------------------
test("classifyEnvironment trusts VERCEL_ENV over NODE_ENV", () => {
  assert.equal(
    classifyEnvironment({ VERCEL_ENV: "production", NODE_ENV: "production" }),
    "vercel-production",
  );
  // Preview also runs with NODE_ENV=production, but must classify as preview.
  assert.equal(
    classifyEnvironment({ VERCEL_ENV: "preview", NODE_ENV: "production" }),
    "vercel-preview",
  );
  assert.equal(
    classifyEnvironment({ VERCEL_ENV: "development", NODE_ENV: "production" }),
    "vercel-development",
  );
});

test("classifyEnvironment: unknown/custom VERCEL_ENV is restricted (never production)", () => {
  assert.equal(
    classifyEnvironment({ VERCEL_ENV: "staging", NODE_ENV: "production" }),
    "vercel-preview",
  );
});

test("classifyEnvironment: no VERCEL_ENV + NODE_ENV=production is ambiguous => production-strict", () => {
  assert.equal(
    classifyEnvironment({ NODE_ENV: "production" }),
    "production-strict",
  );
});

test("classifyEnvironment: test and dev locals", () => {
  assert.equal(classifyEnvironment({ NODE_ENV: "test" }), "local-test");
  assert.equal(classifyEnvironment({ NODE_ENV: "development" }), "local-development");
  assert.equal(classifyEnvironment({}), "local-development");
});

// ---------------------------------------------------------------------------
// identityError: incomplete + vercel-dev are refused in EVERY environment.
// ---------------------------------------------------------------------------
const ALL_ENVS: DeploymentEnvironment[] = [
  "vercel-production",
  "vercel-preview",
  "vercel-development",
  "local-test",
  "local-development",
  "production-strict",
];

test("incomplete identity is refused in every environment", () => {
  for (const e of ALL_ENVS) {
    assert.match(identityError(null, P.branch, P.endpoint, P.database, e) ?? "", /incomplete/, e);
    assert.match(identityError(P.project, "", P.endpoint, P.database, e) ?? "", /incomplete/, e);
    assert.match(identityError(undefined, undefined, undefined, undefined, e) ?? "", /incomplete/, e);
  }
});

test("vercel-dev branch/endpoint is refused in every environment", () => {
  for (const e of ALL_ENVS) {
    assert.match(
      identityError(P.project, FORBIDDEN_BRANCH, P.endpoint, P.database, e) ?? "",
      /vercel-dev/,
      `branch@${e}`,
    );
    assert.match(
      identityError(P.project, P.branch, FORBIDDEN_ENDPOINT, P.database, e) ?? "",
      /vercel-dev/,
      `endpoint@${e}`,
    );
  }
});

// ---------------------------------------------------------------------------
// Vercel Production
// ---------------------------------------------------------------------------
test("Vercel Production + intended Production DB: ACCEPTED", () => {
  assert.equal(
    identityError(P.project, P.branch, P.endpoint, P.database, "vercel-production"),
    null,
  );
});

test("Vercel Production + vercel-dev DB: REJECTED", () => {
  assert.match(
    identityError(P.project, FORBIDDEN_BRANCH, FORBIDDEN_ENDPOINT, P.database, "vercel-production") ?? "",
    /vercel-dev/,
  );
});

test("Vercel Production + wrong (non-prod) DB: REJECTED", () => {
  assert.match(
    identityError(SAFE.project, SAFE.branch, SAFE.endpoint, SAFE.database, "vercel-production") ?? "",
    /intended Production/,
  );
});

// ---------------------------------------------------------------------------
// Vercel Preview (NODE_ENV=production, but classified as preview)
// ---------------------------------------------------------------------------
test("Vercel Preview + safe Preview DB: ACCEPTED", () => {
  assert.equal(
    identityError(SAFE.project, SAFE.branch, SAFE.endpoint, SAFE.database, "vercel-preview"),
    null,
  );
});

test("Vercel Preview + intended Production DB: REJECTED", () => {
  assert.match(
    identityError(P.project, P.branch, P.endpoint, P.database, "vercel-preview") ?? "",
    /must not use the Production database/,
  );
});

test("Vercel Preview + vercel-dev DB: REJECTED", () => {
  assert.match(
    identityError(P.project, FORBIDDEN_BRANCH, FORBIDDEN_ENDPOINT, P.database, "vercel-preview") ?? "",
    /vercel-dev/,
  );
});

test("Preview classified from env (VERCEL_ENV=preview) accepts safe DB, rejects prod DB", () => {
  const env = classifyEnvironment({ VERCEL_ENV: "preview", NODE_ENV: "production" });
  assert.equal(identityError(SAFE.project, SAFE.branch, SAFE.endpoint, SAFE.database, env), null);
  assert.match(
    identityError(P.project, P.branch, P.endpoint, P.database, env) ?? "",
    /must not use the Production database/,
  );
});

// ---------------------------------------------------------------------------
// Vercel Development + local dev: must not reach Production or vercel-dev.
// ---------------------------------------------------------------------------
test("Vercel Development / local-development reject Production + vercel-dev, accept safe", () => {
  for (const e of ["vercel-development", "local-development"] as DeploymentEnvironment[]) {
    assert.match(
      identityError(P.project, P.branch, P.endpoint, P.database, e) ?? "",
      /must not use the Production database/,
      e,
    );
    assert.match(
      identityError(P.project, FORBIDDEN_BRANCH, P.endpoint, P.database, e) ?? "",
      /vercel-dev/,
      e,
    );
    assert.equal(identityError(SAFE.project, SAFE.branch, SAFE.endpoint, SAFE.database, e), null, e);
  }
});

// ---------------------------------------------------------------------------
// Ambiguous / spoofed / unknown env identifiers fail safe.
// ---------------------------------------------------------------------------
test("ambiguous production-strict (no VERCEL_ENV) demands the pinned Production identity", () => {
  // A production-like build with no VERCEL_ENV must ONLY accept the pinned prod id.
  assert.equal(
    identityError(P.project, P.branch, P.endpoint, P.database, "production-strict"),
    null,
  );
  assert.match(
    identityError(SAFE.project, SAFE.branch, SAFE.endpoint, SAFE.database, "production-strict") ?? "",
    /intended Production/,
  );
  // vercel-dev still rejected under the strict posture.
  assert.match(
    identityError(P.project, FORBIDDEN_BRANCH, FORBIDDEN_ENDPOINT, P.database, "production-strict") ?? "",
    /vercel-dev/,
  );
});

test("spoofed/custom VERCEL_ENV cannot reach Production (treated as preview)", () => {
  const env = classifyEnvironment({ VERCEL_ENV: "prod-ish-custom", NODE_ENV: "production" });
  assert.equal(env, "vercel-preview");
  assert.match(
    identityError(P.project, P.branch, P.endpoint, P.database, env) ?? "",
    /must not use the Production database/,
  );
});

// ---------------------------------------------------------------------------
// Local isolated test path remains supported.
// ---------------------------------------------------------------------------
test("local-test accepts a complete, non-vercel-dev isolated DB", () => {
  assert.equal(
    identityError(SAFE.project, SAFE.branch, SAFE.endpoint, SAFE.database, "local-test"),
    null,
  );
  // still rejects vercel-dev and incompleteness
  assert.match(
    identityError(SAFE.project, FORBIDDEN_BRANCH, SAFE.endpoint, SAFE.database, "local-test") ?? "",
    /vercel-dev/,
  );
  assert.match(
    identityError(SAFE.project, "", SAFE.endpoint, SAFE.database, "local-test") ?? "",
    /incomplete/,
  );
});
