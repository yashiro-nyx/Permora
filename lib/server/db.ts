import "server-only";
import { Pool, type PoolClient, type QueryResultRow } from "pg";

declare global {
  var __permoraPool: Pool | undefined;
}

function createPool() {
  const isTest = process.env.NODE_ENV === "test";
  if (isTest && !process.env.TEST_DATABASE_URL) {
    throw new Error("TEST_DATABASE_URL is required in the test environment.");
  }
  const connectionString = isTest
    ? process.env.TEST_DATABASE_URL
    : (process.env.DATABASE_URL ??
      "postgresql://unconfigured:unconfigured@127.0.0.1:1/permora_unconfigured");
  return new Pool({
    connectionString,
    max: isTest ? 1 : 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: isTest ? 30_000 : 5_000,
  });
}

export const db = globalThis.__permoraPool ?? createPool();
if (process.env.NODE_ENV !== "production") globalThis.__permoraPool = db;

export async function query<T extends QueryResultRow>(
  text: string,
  values: readonly unknown[] = [],
) {
  return db.query<T>(text, [...values]);
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
