import "server-only";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { ResilientPool } from "../database-pool";
import { queryWithTransientReadRetry } from "../database-connection";

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
  return new ResilientPool({
    connectionString,
    max: isTest ? 1 : 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: isTest ? 15_000 : 5_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
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
