import "server-only";
import { Pool, type ClientBase, type PoolClient, type QueryResultRow } from "pg";
import { ResilientPool } from "../database-pool";
import { queryWithTransientReadRetry } from "../database-connection";
import { identityError } from "./config";

const IDENTITY_TIMEOUT_MS = 5_000;

/**
 * Awaited pg-pool `onConnect` barrier: pg-pool waits for this promise before a
 * new physical connection is handed to ANY caller (pool.query OR pool.connect,
 * i.e. both the application and Better Auth). On rejection, pg-pool ends the
 * client and fails the pending acquisition — so an unverified or wrongly
 * identified connection can never execute a statement. Fail-closed.
 *
 * Uses the SAME client passed in (no recursive pool acquisition => no deadlock).
 */
async function verifyConnectionIdentity(client: ClientBase): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const queryPromise = client.query<{
    p: string | null;
    b: string | null;
    e: string | null;
    d: string;
  }>(
    `SELECT current_setting('neon.project_id', true)  AS p,
            current_setting('neon.branch_id', true)   AS b,
            current_setting('neon.endpoint_id', true) AS e,
            current_database() AS d`,
  );
  // Swallow a late rejection if the timeout wins, so it never becomes unhandled.
  queryPromise.catch(() => undefined);

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("identity verification timed out")),
      IDENTITY_TIMEOUT_MS,
    );
    timer.unref?.();
  });

  try {
    const result = await Promise.race([queryPromise, timeoutPromise]);
    const row = result.rows[0];
    const reason = identityError(row?.p, row?.b, row?.e, row?.d);
    if (reason) throw new Error(`refusing connection: ${reason}`);
  } finally {
    if (timer) clearTimeout(timer); // clear on success, failure, or timeout
  }
}

declare global {
  var __permoraPool: Pool | undefined;
  var __permoraPoolClosePromise: Promise<void> | undefined;
  var __permoraPoolErrorListenerAttached: boolean | undefined;
}

function createPool() {
  const isBrowserTest =
    process.env.PERMORA_E2E_DATABASE === "isolated-test";
  const isTest =
    process.env.NODE_ENV === "test" ||
    isBrowserTest;
  if (isTest && !process.env.TEST_DATABASE_URL) {
    throw new Error("TEST_DATABASE_URL is required in the test environment.");
  }
  const connectionString = isTest
    ? process.env.TEST_DATABASE_URL
    : (process.env.DATABASE_URL ??
      "postgresql://unconfigured:unconfigured@127.0.0.1:1/permora_unconfigured");
  // The browser-test server handles concurrent requests (e.g. a mutation's
  // transaction overlapping a page render), so it needs more than one
  // connection to avoid self-contention timeouts. The sequential integration
  // runner keeps a single connection. Production uses the full pool.
  // The isolated browser suite can issue concurrent page/API requests, but
  // opening four Neon connections at once makes the remote test endpoint
  // susceptible to local ephemeral-port exhaustion during a long run. Two
  // connections still avoid transaction/render self-contention while keeping
  // the browser-only pool bounded. Integration tests remain single-connection.
  const testPoolMax = isBrowserTest ? 2 : 1;
  return new ResilientPool({
    connectionString,
    max: isTest ? testPoolMax : 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: isTest ? 15_000 : 5_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    // Non-test pools verify the live Neon identity on every new physical
    // connection (awaited; fails closed). The isolated test pool is exempt so
    // the guarded _test branch is never blocked. `onConnect` is a typed
    // PoolConfig option (@types/pg 8.23.1) forwarded by pg.Pool to pg-pool.
    ...(isTest ? {} : { onConnect: verifyConnectionIdentity }),
  }, isTest ? 3 : 1);
}

export const db = globalThis.__permoraPool ?? createPool();
if (process.env.NODE_ENV !== "production") globalThis.__permoraPool = db;
if (!globalThis.__permoraPoolErrorListenerAttached) {
  db.on("error", () => {
    console.error("Database pool lost an idle connection.");
  });
  globalThis.__permoraPoolErrorListenerAttached = true;
}

export function closeDatabasePool() {
  globalThis.__permoraPoolClosePromise ??= db.end();
  return globalThis.__permoraPoolClosePromise;
}

export async function query<T extends QueryResultRow>(
  text: string,
  values: readonly unknown[] = [],
) {
  return queryWithTransientReadRetry(text, () =>
    db.query<T>(text, [...values]),
  );
}

export async function transaction<T>(
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
