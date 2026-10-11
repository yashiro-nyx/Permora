import "server-only";
import {
  expireActivatedEntitlement,
  listExpiredActivationCandidates,
} from "@/lib/activation-maintenance";
import { transaction } from "./db";

export interface ExpirationRunSummary {
  examined: number;
  expired: number;
}

export interface ExpirationRunDependencies {
  listCandidates: typeof listExpiredActivationCandidates;
  expire: typeof expireActivatedEntitlement;
  /** Runs one unit of work inside its own database transaction. */
  runInTransaction: <T>(work: Parameters<typeof transaction<T>>[0]) => Promise<T>;
}

/**
 * Expire every activated entitlement whose validity window has ended, reusing
 * the existing, idempotent lifecycle service. Candidates are listed once, then
 * each is expired in its own transaction: `expireActivatedEntitlement` locks
 * the row `FOR UPDATE` and only transitions `activated -> expired` when
 * `expires_at <= now()`, so repeated or concurrent runs do not double-expire,
 * do not touch revoked/already-expired rows, and never expire before the
 * authorized timestamp. Approved-but-not-activated requests have no activated
 * activation row and are therefore never affected.
 */
export async function runActivationExpiration(
  overrides: Partial<ExpirationRunDependencies> = {},
): Promise<ExpirationRunSummary> {
  const deps: ExpirationRunDependencies = {
    listCandidates: listExpiredActivationCandidates,
    expire: expireActivatedEntitlement,
    runInTransaction: (work) => transaction(work),
    ...overrides,
  };

  const candidates = await deps.runInTransaction((client) =>
    deps.listCandidates(client),
  );

  let expired = 0;
  for (const candidate of candidates) {
    const result = await deps.runInTransaction((client) =>
      deps.expire(client, candidate.activationId),
    );
    if (result.expired) expired += 1;
  }

  return { examined: candidates.length, expired };
}
