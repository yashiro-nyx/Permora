import type {
  RetentionDryRunDto,
  RetentionPolicyDto,
} from "@/lib/server/admin-governance-types";

export type RetentionStatus = "immutable" | "no-retention" | "provisional";

/**
 * Classify a retention policy for display. Immutable classes can never be
 * archived; classes without a retention period have none configured; the rest
 * carry a provisional retention window that supports a dry-run preview only.
 */
export function retentionStatus(policy: RetentionPolicyDto): RetentionStatus {
  if (policy.immutable) return "immutable";
  if (policy.retentionDays === null) return "no-retention";
  return "provisional";
}

export function retentionStatusLabel(status: RetentionStatus): string {
  switch (status) {
    case "immutable":
      return "Immutable";
    case "no-retention":
      return "No retention period";
    case "provisional":
      return "Provisional";
  }
}

export function retentionStatusTone(status: RetentionStatus): string {
  switch (status) {
    case "immutable":
      return "tone-neutral";
    case "no-retention":
      return "tone-warning";
    case "provisional":
      return "tone-success";
  }
}

/**
 * A policy supports a meaningful dry-run count only when it is both mutable and
 * has a configured retention window. Immutable / unconfigured classes still
 * return a preview, but with a zero count and an explanatory message.
 */
export function supportsRetentionPreview(policy: RetentionPolicyDto): boolean {
  return !policy.immutable && policy.retentionDays !== null;
}

/** Human-readable retention window, e.g. 730 days -> "730 days (~2.0 years)". */
export function formatRetentionPeriod(retentionDays: number | null): string {
  if (retentionDays === null) return "Not configured";
  if (retentionDays < 365) return `${retentionDays} days`;
  const years = (retentionDays / 365).toFixed(1);
  return `${retentionDays} days (~${years} years)`;
}

/**
 * Summarize a completed dry-run for display. The backend never modifies data in
 * a preview, so this always frames the result as a non-destructive projection.
 */
export function describePreview(result: RetentionDryRunDto): {
  tone: "info" | "success" | "warning";
  headline: string;
  detail: string;
} {
  if (result.immutable)
    return {
      tone: "info",
      headline: "Not archivable",
      detail: result.message,
    };
  if (result.eligibleCount === 0)
    return {
      tone: "info",
      headline: "No eligible records",
      detail: result.message,
    };
  return {
    tone: "warning",
    headline: `${result.eligibleCount} record${result.eligibleCount === 1 ? "" : "s"} would match`,
    detail: result.message,
  };
}

/**
 * Translate a retention mutation/preview response status into a safe,
 * non-leaking message. The `immutable` code corresponds to the server refusing
 * destructive apply, which this UI never requests.
 */
export function retentionRequestMessage(status: number, code?: string): string {
  if (status === 401)
    return "Your session ended. Sign in again with an active administrator account.";
  if (status === 403)
    return "Administrator access is required to review retention.";
  if (status === 404)
    return "That retention class was not found.";
  if (code === "immutable")
    return "Destructive archival is disabled until institutional policy is approved.";
  if (status === 400 || code === "invalid_input")
    return "The retention preview request was invalid.";
  if (status === 429)
    return "Too many attempts were made. Wait briefly before trying again.";
  return "The retention service is temporarily unavailable. Try again later.";
}
