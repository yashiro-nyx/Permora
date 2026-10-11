import { createHash, timingSafeEqual } from "node:crypto";

export type SchedulerAuthResult =
  | { ok: true }
  | { ok: false; status: 503 | 401; code: "scheduler_disabled" | "unauthorized" };

function constantTimeEquals(a: string, b: string): boolean {
  // Hash both sides to fixed-length buffers so timingSafeEqual never throws on
  // length mismatch and the comparison does not leak the secret's length.
  const left = createHash("sha256").update(a).digest();
  const right = createHash("sha256").update(b).digest();
  return timingSafeEqual(left, right);
}

/**
 * Authorize a scheduled-maintenance request using a shared bearer secret.
 *
 * - If no secret is configured, the endpoint is DISABLED (503) and never open.
 *   This keeps the surface safe by default until an operator deliberately sets
 *   `MAINTENANCE_SCHEDULER_SECRET` (e.g. for a Vercel Cron `Authorization`
 *   header), which is not enabled in production as part of this change.
 * - A present `Authorization: Bearer <secret>` is compared in constant time.
 */
export function authorizeScheduledRequest(
  authorizationHeader: string | null,
  configuredSecret: string | undefined,
): SchedulerAuthResult {
  if (!configuredSecret || configuredSecret.length < 16)
    return { ok: false, status: 503, code: "scheduler_disabled" };
  const presented = parseBearer(authorizationHeader);
  if (!presented || !constantTimeEquals(presented, configuredSecret))
    return { ok: false, status: 401, code: "unauthorized" };
  return { ok: true };
}

export function parseBearer(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}
