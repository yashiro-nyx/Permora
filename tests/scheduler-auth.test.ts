import assert from "node:assert/strict";
import test from "node:test";
import { authorizeScheduledRequest, parseBearer } from "../lib/scheduler-auth";

const SECRET = "a-high-entropy-scheduler-secret-value";

test("the endpoint is disabled when no secret is configured", () => {
  assert.deepEqual(authorizeScheduledRequest("Bearer anything", undefined), {
    ok: false,
    status: 503,
    code: "scheduler_disabled",
  });
  assert.deepEqual(authorizeScheduledRequest("Bearer anything", ""), {
    ok: false,
    status: 503,
    code: "scheduler_disabled",
  });
  // Too-short secrets are treated as not configured (disabled, never open).
  assert.deepEqual(authorizeScheduledRequest("Bearer short", "short"), {
    ok: false,
    status: 503,
    code: "scheduler_disabled",
  });
});

test("a missing or wrong bearer token is unauthorized when a secret is set", () => {
  assert.deepEqual(authorizeScheduledRequest(null, SECRET), {
    ok: false,
    status: 401,
    code: "unauthorized",
  });
  assert.deepEqual(authorizeScheduledRequest("Bearer wrong-secret-value-here", SECRET), {
    ok: false,
    status: 401,
    code: "unauthorized",
  });
  assert.deepEqual(authorizeScheduledRequest(SECRET, SECRET), {
    ok: false,
    status: 401,
    code: "unauthorized",
  }); // missing the Bearer scheme
});

test("a matching bearer token is authorized", () => {
  assert.deepEqual(authorizeScheduledRequest(`Bearer ${SECRET}`, SECRET), { ok: true });
  assert.deepEqual(authorizeScheduledRequest(`bearer ${SECRET}`, SECRET), { ok: true });
});

test("parseBearer extracts only a well-formed bearer value", () => {
  assert.equal(parseBearer("Bearer token-123"), "token-123");
  assert.equal(parseBearer("  Bearer   token-123  "), "token-123");
  assert.equal(parseBearer("Basic token-123"), null);
  assert.equal(parseBearer(null), null);
  assert.equal(parseBearer(""), null);
});
