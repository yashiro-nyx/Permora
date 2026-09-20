import assert from "node:assert/strict";
import test from "node:test";
import {
  INCORRECT_CREDENTIALS_MESSAGE,
  loginErrorPresentation,
  RATE_LIMIT_MESSAGE,
  SIGN_IN_SERVICE_ERROR,
} from "../lib/login-error";

test("maps invalid credentials without exposing account state", () => {
  assert.deepEqual(loginErrorPresentation(401), {
    kind: "credentials",
    message: INCORRECT_CREDENTIALS_MESSAGE,
  });
});

test("maps rate limiting to a retry message", () => {
  assert.deepEqual(loginErrorPresentation(429), {
    kind: "rate-limit",
    message: RATE_LIMIT_MESSAGE,
  });
});

test("maps server and unexpected failures to a service error", () => {
  for (const status of [500, 503, 403, undefined]) {
    assert.deepEqual(loginErrorPresentation(status), {
      kind: "service",
      message: SIGN_IN_SERVICE_ERROR,
    });
  }
});
