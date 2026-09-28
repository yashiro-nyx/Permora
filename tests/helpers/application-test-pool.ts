import type { Pool } from "pg";

export async function installApplicationTestPool(pool: Pool) {
  if (globalThis.__permoraPool && globalThis.__permoraPool !== pool)
    throw new Error("A different application test pool is already installed.");
  globalThis.__permoraPool = pool;
  await import("../../lib/server/db");
}

export async function closeApplicationTestPool() {
  const { closeDatabasePool } = await import("../../lib/server/db");
  await closeDatabasePool();
}
