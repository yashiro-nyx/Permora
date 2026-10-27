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
 * Deployment-environment classification used to decide how strictly to enforce
 * the live Neon identity.
 *
 * WHY NOT NODE_ENV ALONE: Vercel runs `next build` for BOTH Production and
 * Preview deployments, so NODE_ENV === "production" is true in Preview too.
 * Relying on NODE_ENV alone would make a Preview demand the full Production
 * identity (and reject a safe Preview database). Vercel's own VERCEL_ENV is the
 * authoritative discriminator: "production" | "preview" | "development" (or a
 * custom environment name).
 */
export type DeploymentEnvironment =
  | "vercel-production" // must match the pinned Production identity exactly
  | "vercel-preview" // must NEVER reach Production or vercel-dev
  | "vercel-development" // must NEVER reach Production or vercel-dev
  | "local-test" // isolated destructive tests (guarded separately)
  | "local-development" // local dev; must not reach Production or vercel-dev
  | "production-strict"; // ambiguous/unknown but production-like => strictest

type EnvSource = {
  VERCEL_ENV?: string;
  NODE_ENV?: string;
};

/**
 * Classify the runtime environment, fail-closed.
 *
 *  - VERCEL_ENV present and recognized => trust it.
 *  - VERCEL_ENV present but an UNKNOWN/custom value => treat as a restricted
 *    deployment that must never reach Production or vercel-dev (NOT production).
 *    (A custom environment is never the canonical Production environment here.)
 *  - VERCEL_ENV absent:
 *      NODE_ENV === "test"        => local-test
 *      NODE_ENV === "production"  => AMBIGUOUS: a production-like build with no
 *                                    VERCEL_ENV. Fail closed to the STRICTEST
 *                                    posture ("production-strict") so we can
 *                                    only ever connect to the pinned Production
 *                                    identity -- never silently under-protect.
 *      otherwise                  => local-development
 */
export function classifyEnvironment(
  env: EnvSource = process.env,
): DeploymentEnvironment {
  const vercel = (env.VERCEL_ENV ?? "").trim().toLowerCase();
  const node = (env.NODE_ENV ?? "").trim().toLowerCase();

  if (vercel) {
    if (vercel === "production") return "vercel-production";
    if (vercel === "preview") return "vercel-preview";
    if (vercel === "development") return "vercel-development";
    // Unknown/custom VERCEL_ENV: never Production; restrict like a preview.
    return "vercel-preview";
  }

  if (node === "test") return "local-test";
  if (node === "production") return "production-strict"; // ambiguous => strict
  return "local-development";
}

/** Environments that must match the pinned Production identity exactly. */
function requiresProductionIdentity(envClass: DeploymentEnvironment): boolean {
  return envClass === "vercel-production" || envClass === "production-strict";
}

/**
 * Fail-closed decision for a connection's live Neon identity. Returns an error
 * string (why the connection must be refused) or null if acceptable.
 *
 * Rules (fail-closed):
 *  - Any NULL/empty field => refuse (identity cannot be proven).
 *  - vercel-dev branch/endpoint => refuse ALWAYS (never write to the old DB).
 *  - Production-like env (vercel-production or ambiguous production-strict):
 *      the full identity MUST match PRODUCTION_IDENTITY.
 *  - vercel-preview / vercel-development / local-development:
 *      must NOT be the intended Production identity (Preview/dev must never
 *      touch Production), and must be complete + not vercel-dev.
 *  - local-test:
 *      only "complete + not vercel-dev" is enforced here so the isolated test
 *      branch is not blocked; the destructive-test guard is the primary
 *      protection for that path.
 *
 * `envClass` defaults to classifyEnvironment(process.env). An explicit value is
 * accepted for testing. (The legacy boolean caller shape is preserved by the
 * `identityErrorForProduction` convenience wrapper below.)
 */
export function identityError(
  project: string | null | undefined,
  branch: string | null | undefined,
  endpoint: string | null | undefined,
  database: string | null | undefined,
  envClass: DeploymentEnvironment = classifyEnvironment(),
): string | null {
  if (!project || !branch || !endpoint || !database)
    return "Neon identity is incomplete";

  // vercel-dev is forbidden in every environment.
  if (branch === FORBIDDEN_BRANCH || endpoint === FORBIDDEN_ENDPOINT)
    return "connected to the vercel-dev database";

  const isProductionIdentity =
    project === PRODUCTION_IDENTITY.project &&
    branch === PRODUCTION_IDENTITY.branch &&
    endpoint === PRODUCTION_IDENTITY.endpoint &&
    database === PRODUCTION_IDENTITY.database;

  if (requiresProductionIdentity(envClass)) {
    if (!isProductionIdentity) return "not the intended Production branch";
    return null;
  }

  // Non-production served environments (Preview / Vercel-dev-env / local dev):
  // must NEVER connect to the intended Production branch.
  if (
    envClass === "vercel-preview" ||
    envClass === "vercel-development" ||
    envClass === "local-development"
  ) {
    if (isProductionIdentity)
      return "a non-production environment must not use the Production database";
    return null; // complete + not vercel-dev + not production => acceptable
  }

  // local-test: complete + not vercel-dev (destructive-test guard does the rest).
  return null;
}
