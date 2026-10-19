/**
 * Server-enforced reviewer selection policy.
 *
 * Dedicated approvers are the safe default. Administrators can participate
 * in normal routing only when the deployment explicitly opts into fallback.
 */
export type ApprovalRoutingPolicy =
  | "dedicated_only"
  | "dedicated_first_with_admin_fallback";

export function approvalRoutingPolicy(
  value = process.env.APPROVAL_ROUTING_POLICY,
): ApprovalRoutingPolicy {
  return value === "dedicated_first_with_admin_fallback"
    ? value
    : "dedicated_only";
}

export function allowsAdminFallback(policy = approvalRoutingPolicy()) {
  return policy === "dedicated_first_with_admin_fallback";
}
