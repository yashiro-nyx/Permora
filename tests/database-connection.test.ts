import assert from "node:assert/strict";
import test from "node:test";
import {
  connectWithTransientRetry,
  isTransientDatabaseConnectionError,
  preferNeonPooler,
  queryWithTransientReadRetry,
} from "../lib/database-connection";

test("test connection routing prefers the Neon pooler without changing the database", () => {
  const direct =
    "postgresql://test-user:test-password@ep-isolated.us-east-2.aws.neon.tech/permora_test?sslmode=require";
  const pooled = new URL(preferNeonPooler(direct));
  assert.equal(
    pooled.hostname,
    "ep-isolated-pooler.us-east-2.aws.neon.tech",
  );
  assert.equal(pooled.pathname, "/permora_test");
  assert.equal(preferNeonPooler(pooled.toString()), pooled.toString());
  assert.equal(
    preferNeonPooler("postgresql://localhost/permora_test"),
    "postgresql://localhost/permora_test",
  );
});

test("transient connection detection handles nested network and PostgreSQL failures", () => {
  assert.equal(
    isTransientDatabaseConnectionError(
      new AggregateError([
        Object.assign(new Error("socket failed"), { code: "ETIMEDOUT" }),
      ]),
    ),
    true,
  );
  assert.equal(
    isTransientDatabaseConnectionError(
      Object.assign(new Error("database is starting"), { code: "57P03" }),
    ),
    true,
  );
  assert.equal(
    isTransientDatabaseConnectionError(
      Object.assign(new Error("password rejected"), { code: "28P01" }),
    ),
    false,
  );
});

test("connection retry is bounded and never retries non-transient failures", async () => {
  let transientAttempts = 0;
  const connected = await connectWithTransientRetry(async () => {
    transientAttempts += 1;
    if (transientAttempts === 1)
      throw Object.assign(new Error("read ETIMEDOUT"), { code: "ETIMEDOUT" });
    return "connected";
  }, 2);
  assert.equal(connected, "connected");
  assert.equal(transientAttempts, 2);

  let permanentAttempts = 0;
  await assert.rejects(
    connectWithTransientRetry(async () => {
      permanentAttempts += 1;
      throw Object.assign(new Error("invalid password"), { code: "28P01" });
    }, 2),
  );
  assert.equal(permanentAttempts, 1);
});

test("query retry is limited to transient SELECT failures", async () => {
  let reads = 0;
  assert.equal(
    await queryWithTransientReadRetry("  SELECT 1", async () => {
      reads += 1;
      if (reads === 1)
        throw Object.assign(new Error("read ETIMEDOUT"), {
          code: "ETIMEDOUT",
        });
      return "ok";
    }),
    "ok",
  );
  assert.equal(reads, 2);

  let writes = 0;
  await assert.rejects(
    queryWithTransientReadRetry("UPDATE example SET value = 1", async () => {
      writes += 1;
      throw Object.assign(new Error("read ETIMEDOUT"), {
        code: "ETIMEDOUT",
      });
    }),
  );
  assert.equal(writes, 1);
});
