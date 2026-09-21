import type { ApprovalDecision } from "./approval-domain";

export function validateDecisionReason(
  decision: ApprovalDecision,
  reason: string,
) {
  const trimmed = reason.trim();
  if (
    (decision === "deny" || decision === "return_for_revision") &&
    !trimmed
  )
    return "Enter a reason before continuing.";
  if (trimmed.length > 2000)
    return "The reason must be 2,000 characters or fewer.";
  return "";
}

export function decisionFailureMessage(status: number, code?: string) {
  if (status === 400)
    return "Check the decision and reason, then try again.";
  if (status === 401)
    return "Your session ended. Sign in again before making a decision.";
  if (status === 403)
    return "You are not authorized to decide this request.";
  if (status === 404)
    return "This assigned request is no longer available.";
  if (status === 409 && code === "stale_decision")
    return "Another decision changed this request. The latest server record has been loaded.";
  if (status === 409 && code === "approval_revalidation_failed")
    return "Approval was blocked because current eligibility or policy no longer permits this request.";
  if (status === 409)
    return "This request can no longer accept that decision. The latest server record has been loaded.";
  if (status === 415)
    return "The server rejected the request format. Reload and try again.";
  if (status === 429)
    return "Too many attempts were made. Wait briefly before trying again.";
  return "The decision service is temporarily unavailable. Your reason has been preserved; try again.";
}
