import type { Role } from "./model";

export type CatalogToggleKind = "resource" | "permission";

export const SCOPE_CODE_MAX = 80;
export const SCOPE_NAME_MAX = 200;

export interface ScopeOptionDraft {
  resourceId: string;
  fieldName: string;
  institutionalCode: string;
  displayName: string;
}

/**
 * Validate an add-scope-option form before contacting the server. The server
 * remains the authority: this mirrors the server-side bounds in
 * `parseScopeOptionInput` so the browser can give immediate, accurate feedback
 * without implying it is the security boundary.
 */
export function validateScopeOptionDraft(draft: ScopeOptionDraft): string {
  if (!draft.resourceId.trim())
    return "Choose a resource before adding a scope.";
  if (!draft.fieldName.trim())
    return "Choose a scope field for this resource.";
  const code = draft.institutionalCode.trim();
  if (!code) return "Enter the institutional code for this scope.";
  if (code.length > SCOPE_CODE_MAX)
    return `The institutional code must be ${SCOPE_CODE_MAX} characters or fewer.`;
  const name = draft.displayName.trim();
  if (!name) return "Enter a display name for this scope.";
  if (name.length > SCOPE_NAME_MAX)
    return `The display name must be ${SCOPE_NAME_MAX} characters or fewer.`;
  return "";
}

/**
 * The institutional code is stored upper-cased server-side; surface the same
 * normalization in the UI so administrators preview the stored value.
 */
export function normalizeInstitutionalCode(value: string): string {
  return value.trim().toUpperCase();
}

export function catalogToggleConfirmMessage(
  kind: CatalogToggleKind,
  label: string,
  enabled: boolean,
): string {
  const subject = kind === "resource" ? "resource" : "permission";
  return enabled
    ? `Make the ${subject} “${label}” available for new requests?`
    : `Make the ${subject} “${label}” unavailable for new requests? Existing requests, decisions, and entitlements are not changed.`;
}

export function requesterRolesLabel(roles: ReadonlyArray<Role>): string {
  const relevant = roles.filter(
    (role) => role === "student" || role === "faculty",
  );
  if (!relevant.length) return "No requester roles";
  return relevant
    .map((role) => (role === "student" ? "Students" : "Faculty"))
    .join(", ");
}

export function availabilityLabel(available: boolean): string {
  return available ? "Available" : "Unavailable";
}

/**
 * Translate a catalog mutation response status into a safe, non-leaking
 * message. Mirrors the governance error contract in `mapGovernanceError`.
 */
export function catalogMutationMessage(status: number, code?: string): string {
  if (status === 401)
    return "Your session ended. Sign in again with an active administrator account.";
  if (status === 403)
    return "Administrator access is required to change the catalog.";
  if (status === 404)
    return "That catalog record no longer exists. The list has been refreshed.";
  if (status === 409 || code === "conflict")
    return "That institutional code already exists for this resource field.";
  if (status === 400 || code === "invalid_input")
    return "Some values are invalid. Review the form and try again.";
  if (status === 415)
    return "The server rejected the request format. Reload and try again.";
  if (status === 429)
    return "Too many attempts were made. Wait briefly before trying again.";
  return "The catalog service is temporarily unavailable. Try again later.";
}
