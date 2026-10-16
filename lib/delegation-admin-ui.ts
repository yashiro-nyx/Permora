export interface DelegationDraft {
  delegatorUserId: string;
  substituteUserId: string;
  validFrom: string;
  validUntil: string;
}

/**
 * Validate an absence-delegation form before contacting the server. The server
 * remains the authority: this mirrors `parseCreateDelegationInput` (both users
 * required, parseable dates, end strictly after start) and adds the obvious
 * same-person guard so administrators get immediate feedback. It is not the
 * security boundary.
 */
export function validateDelegationDraft(draft: DelegationDraft): string {
  if (!draft.delegatorUserId) return "Choose the approver who will be absent.";
  if (!draft.substituteUserId) return "Choose the substitute approver.";
  if (draft.delegatorUserId === draft.substituteUserId)
    return "The absent approver and substitute must be different people.";
  if (!draft.validFrom || !draft.validUntil)
    return "Choose both a start and an end for the absence period.";
  const from = Date.parse(draft.validFrom);
  const until = Date.parse(draft.validUntil);
  if (Number.isNaN(from) || Number.isNaN(until))
    return "Enter valid start and end dates for the absence period.";
  if (until <= from) return "The absence must end after it starts.";
  return "";
}

export function delegationCancelConfirmMessage(
  delegatorName: string,
  substituteName: string,
): string {
  return `Cancel the delegation from ${delegatorName} to ${substituteName}? Existing review assignments are not changed; only future substitute eligibility ends.`;
}

export function delegationStatusLabel(delegation: {
  active: boolean;
  cancelledAt: string | null;
  validFrom: string;
  validUntil: string;
  now?: number;
}): "Active" | "Cancelled" | "Scheduled" | "Ended" {
  if (delegation.cancelledAt) return "Cancelled";
  const now = delegation.now ?? Date.now();
  if (now < Date.parse(delegation.validFrom)) return "Scheduled";
  if (now >= Date.parse(delegation.validUntil)) return "Ended";
  return "Active";
}

/**
 * Translate a delegation mutation response status into a safe, non-leaking
 * message. Mirrors the governance error contract in `mapGovernanceError`,
 * including the `circular_delegation` conflict code.
 */
export function delegationMutationMessage(status: number, code?: string): string {
  if (status === 401)
    return "Your session ended. Sign in again with an active administrator account.";
  if (status === 403)
    return "Administrator access is required to manage delegations.";
  if (status === 404)
    return "That delegation is no longer cancellable. The list has been refreshed.";
  if (code === "circular_delegation")
    return "That pair already delegates in the opposite direction over an overlapping period.";
  if (status === 409 || code === "conflict")
    return "An overlapping absence period already exists for that approver.";
  if (status === 400 || code === "invalid_input")
    return "Check the selected approvers and dates, then try again.";
  if (status === 415)
    return "The server rejected the request format. Reload and try again.";
  if (status === 429)
    return "Too many attempts were made. Wait briefly before trying again.";
  return "The delegation service is temporarily unavailable. Try again later.";
}
