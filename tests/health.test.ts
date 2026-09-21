import assert from "node:assert/strict";
import test from "node:test";
import { resolveHealth } from "../lib/health";

test("health result reports application and database availability", async () => {
  let checks = 0;
  const result = await resolveHealth(async () => {
    checks += 1;
  });
  assert.equal(checks, 1);
  assert.deepEqual(result, {
    status: 200,
    body: {
      status: "ok",
      application: "available",
      database: "available",
    },
  });
});

test("health result maps database errors to a generic unavailable response", async () => {
  const result = await resolveHealth(async () => {
    throw new Error("sensitive database detail");
  });
  assert.deepEqual(result, {
    status: 503,
    body: { status: "unavailable" },
  });
  assert.doesNotMatch(JSON.stringify(result), /sensitive database detail/);
});

test("health database check is bounded", async () => {
  const result = await resolveHealth(
    () => new Promise(() => undefined),
    5,
  );
  assert.equal(result.status, 503);
});
