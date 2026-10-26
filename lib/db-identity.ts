// Pure, dependency-free Neon identity decision. Kept OUT of the server-only
// config module so it can be unit-tested without `server-only`/`pg`.

export const PRODUCTION_IDENTITY = {
  project: "floral-cloud-69190292",
  branch: "br-gentle-boat-b3b3fr5v",
  endpoint: "ep-purple-mode-b3fyvdd0",
  database: "neondb",
} as const;

// Non-production branches a served application must never write to.
export const FORBIDDEN_BRANCH = "br-ancient-hat-b3x47ppb"; // vercel-dev source
export const FORBIDDEN_ENDPOINT = "ep-summer-dust-b3qrwqqr"; // vercel-dev endpoint

/**
 * Fail-closed decision for a connection's live Neon identity. Returns an error
 * string (why the connection must be refused) or null if acceptable.
 *
 * - Any NULL/empty field => refuse (identity cannot be proven).
 * - vercel-dev branch/endpoint => refuse (never write to the old DB).
 * - When `isProduction`, the full identity must match PRODUCTION_IDENTITY.
 * - Otherwise (test/dev), only "complete + not vercel-dev" is enforced so the
 *   isolated test branch is not blocked.
 */
export function identityError(
  project: string | null | undefined,
  branch: string | null | undefined,
  endpoint: string | null | undefined,
  database: string | null | undefined,
  isProduction: boolean = process.env.NODE_ENV === "production",
): string | null {
  if (!project || !branch || !endpoint || !database)
    return "Neon identity is incomplete";
  if (branch === FORBIDDEN_BRANCH || endpoint === FORBIDDEN_ENDPOINT)
    return "connected to the vercel-dev database";
  if (isProduction) {
    if (
      project !== PRODUCTION_IDENTITY.project ||
      branch !== PRODUCTION_IDENTITY.branch ||
      endpoint !== PRODUCTION_IDENTITY.endpoint ||
      database !== PRODUCTION_IDENTITY.database
    )
      return "not the intended Production branch";
  }
  return null;
}
