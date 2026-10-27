/**
 * Fail-closed safety guard for destructive test runners.
 *
 * The integration and e2e runners DROP/RECREATE and freely write to whatever
 * database TEST_DATABASE_URL names. The pre-existing checks only validated the
 * protocol and the `_test` suffix. A `_test` database can still live on the
 * Production Neon endpoint (this repo's .env.local currently points
 * TEST_DATABASE_URL at the Production endpoint), so the suffix guard alone does
 * NOT prevent destructive writes against Production infrastructure.
 *
 * This guard verifies the ACTUAL Neon identity (project, branch, endpoint) of
 * the test connection and refuses to run if it matches a known Production
 * identity. It is fail-closed: if the Neon identity cannot be read, or the
 * Production identity cannot be established, it aborts rather than proceeding.
 *
 * It performs only read-only SELECTs and never prints connection strings or
 * credentials.
 */
import { Pool } from "pg";

// Minimal, self-contained Neon identity shape. Kept local so this guard does
// not depend on scripts/database-target.ts (whose NeonIdentity export exists
// only on branches that also add unrelated Preview-target behavior). Identical
// field shape to that type; no safety check is weakened.
type NeonIdentity = {
  projectId: string;
  branchId: string;
  endpointId: string;
};

export type NeonIdentityReadResult =
  | { ok: true; identity: NeonIdentity; databaseName: string }
  | { ok: false; reason: string };

const IDENTITY_SQL = `SELECT current_database() AS database_name,
       current_setting('neon.project_id', true)  AS project_id,
       current_setting('neon.branch_id', true)   AS branch_id,
       current_setting('neon.endpoint_id', true) AS endpoint_id`;

function nonEmpty(value: string | null | undefined) {
  const trimmed = (value ?? "").trim();
  return trimmed.length ? trimmed : undefined;
}

/**
 * Read the live Neon identity for a connection string. Read-only. Returns a
 * structured result instead of throwing so callers can fail closed with a
 * precise reason. Never includes the connection string in the reason.
 */
export async function readNeonIdentity(
  connectionString: string,
  connectionTimeoutMillis = 10_000,
): Promise<NeonIdentityReadResult> {
  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis });
  try {
    const client = await pool.connect();
    try {
      const result = await client.query<{
        database_name: string;
        project_id: string | null;
        branch_id: string | null;
        endpoint_id: string | null;
      }>(IDENTITY_SQL);
      const row = result.rows[0];
      if (!row) return { ok: false, reason: "No identity row returned." };
      const projectId = nonEmpty(row.project_id);
      const branchId = nonEmpty(row.branch_id);
      const endpointId = nonEmpty(row.endpoint_id);
      if (!projectId || !branchId || !endpointId)
        return {
          ok: false,
          reason:
            "Neon identity settings (project/branch/endpoint) are not all present on this connection.",
        };
      return {
        ok: true,
        identity: { projectId, branchId, endpointId },
        databaseName: row.database_name,
      };
    } finally {
      client.release();
    }
  } catch {
    // Deliberately opaque: never leak the error (which may embed the URL).
    return {
      ok: false,
      reason: "Could not read the Neon identity for the test connection.",
    };
  } finally {
    await pool.end();
  }
}

/**
 * Resolve the forbidden Production Neon identity from environment variables.
 *
 * Preferred source: explicit PRODUCTION_NEON_{PROJECT,BRANCH,ENDPOINT}_ID.
 * These let the guard work even when no Production URL is present locally.
 *
 * It returns undefined only when NONE of the three are set, signalling the
 * caller to fall back to reading the live identity of a Production URL. A
 * PARTIAL set (some but not all three) is a configuration error and throws, so
 * a half-configured guard can never silently pass.
 */
export function productionIdentityFromEnvironment(
  environment: Record<string, string | undefined>,
): NeonIdentity | undefined {
  const projectId = nonEmpty(environment.PRODUCTION_NEON_PROJECT_ID);
  const branchId = nonEmpty(environment.PRODUCTION_NEON_BRANCH_ID);
  const endpointId = nonEmpty(environment.PRODUCTION_NEON_ENDPOINT_ID);
  const present = [projectId, branchId, endpointId].filter(Boolean).length;
  if (present === 0) return undefined;
  if (present < 3)
    throw new Error(
      "PRODUCTION_NEON_PROJECT_ID, PRODUCTION_NEON_BRANCH_ID, and PRODUCTION_NEON_ENDPOINT_ID must all be set together.",
    );
  return { projectId: projectId!, branchId: branchId!, endpointId: endpointId! };
}

/**
 * Pure decision: is this test identity SAFE to destructively write to?
 *
 * Fail-closed rules:
 *  - The test identity must be fully known (all three fields).
 *  - At least one Production identity must be known; if none can be
 *    established, the guard refuses (it cannot prove the target is not
 *    Production).
 *  - If the test identity matches ANY known Production identity on all three
 *    fields, refuse.
 *  - A match on endpoint alone (even if project/branch labels were read
 *    differently) also refuses, because the endpoint is the physical compute
 *    the writes hit.
 */
export function evaluateTestIdentitySafety(input: {
  testIdentity?: NeonIdentity;
  databaseName?: string;
  productionIdentities: NeonIdentity[];
}): { safe: true } | { safe: false; reason: string } {
  const { testIdentity, databaseName, productionIdentities } = input;

  if (!testIdentity)
    return {
      safe: false,
      reason: "Test database Neon identity could not be verified.",
    };
  if (!testIdentity.projectId || !testIdentity.branchId || !testIdentity.endpointId)
    return {
      safe: false,
      reason: "Test database Neon identity is incomplete.",
    };

  const knownProduction = productionIdentities.filter(
    (candidate) =>
      candidate.projectId && candidate.branchId && candidate.endpointId,
  );
  if (knownProduction.length === 0)
    return {
      safe: false,
      reason:
        "No Production Neon identity could be established, so the test target cannot be proven safe. Set PRODUCTION_NEON_{PROJECT,BRANCH,ENDPOINT}_ID or provide a Production DATABASE_URL.",
    };

  for (const production of knownProduction) {
    const fullMatch =
      testIdentity.projectId === production.projectId &&
      testIdentity.branchId === production.branchId &&
      testIdentity.endpointId === production.endpointId;
    if (fullMatch)
      return {
        safe: false,
        reason: `Refusing destructive tests: TEST_DATABASE_URL resolves to the Production Neon branch (endpoint ${production.endpointId}). Point it at a dedicated non-production test branch.`,
      };
    if (testIdentity.endpointId === production.endpointId)
      return {
        safe: false,
        reason: `Refusing destructive tests: TEST_DATABASE_URL shares the Production Neon endpoint (${production.endpointId}). The physical compute is Production even if the database differs.`,
      };
  }

  if (databaseName && !databaseName.endsWith("_test"))
    return {
      safe: false,
      reason: "Refusing destructive tests: database name does not end with _test.",
    };

  return { safe: true };
}

/**
 * End-to-end guard used by the runners. Reads the live test identity, resolves
 * the forbidden Production identity from env (explicit vars first, then the
 * live identity of a provided Production URL), and aborts on any failure.
 *
 * Returns nothing on success; throws with a credential-safe message otherwise.
 */
export async function assertTestDatabaseIsNotProduction(options: {
  testDatabaseUrl: string;
  environment?: Record<string, string | undefined>;
  productionDatabaseUrl?: string;
}): Promise<void> {
  const environment = options.environment ?? process.env;

  const testRead = await readNeonIdentity(options.testDatabaseUrl);
  if (!testRead.ok)
    throw new Error(
      `Test database safety guard failed closed: ${testRead.reason}`,
    );

  const productionIdentities: NeonIdentity[] = [];
  const explicit = productionIdentityFromEnvironment(environment);
  if (explicit) productionIdentities.push(explicit);

  // Fall back to the live identity of a Production URL if one is provided and
  // no explicit identity was configured. We only read it when needed so the
  // guard does not require Production connectivity when identities are pinned.
  if (productionIdentities.length === 0 && options.productionDatabaseUrl) {
    const prodRead = await readNeonIdentity(options.productionDatabaseUrl);
    if (prodRead.ok) productionIdentities.push(prodRead.identity);
  }

  const verdict = evaluateTestIdentitySafety({
    testIdentity: testRead.identity,
    databaseName: testRead.databaseName,
    productionIdentities,
  });
  if (!verdict.safe)
    throw new Error(`Test database safety guard failed closed: ${verdict.reason}`);
}
