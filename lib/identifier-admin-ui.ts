export type IdentifierType = "student_number" | "staff_number";

export const ISSUER_MAX = 120;
export const IDENTIFIER_MAX = 80;

export interface IdentifierDraft {
  identifierType: string;
  issuer: string;
  identifier: string;
}

export const identifierTypeOptions: ReadonlyArray<{
  value: IdentifierType;
  label: string;
}> = [
  { value: "student_number", label: "Student number" },
  { value: "staff_number", label: "Staff number" },
];

export function identifierTypeLabel(type: string): string {
  const match = identifierTypeOptions.find((option) => option.value === type);
  return match ? match.label : type;
}

/**
 * Validate an identifier form before contacting the server. The server remains
 * the authority: this mirrors `parseIdentifierInput` (type must be a known
 * value, issuer 1–120, identifier 1–80) so the browser gives immediate,
 * accurate feedback. It is not the security boundary.
 */
export function validateIdentifierDraft(draft: IdentifierDraft): string {
  if (draft.identifierType !== "student_number" && draft.identifierType !== "staff_number")
    return "Choose a student or staff number type.";
  const issuer = draft.issuer.trim();
  if (!issuer) return "Enter the issuing namespace for this identifier.";
  if (issuer.length > ISSUER_MAX)
    return `The issuer must be ${ISSUER_MAX} characters or fewer.`;
  const identifier = draft.identifier.trim();
  if (!identifier) return "Enter the institutional identifier value.";
  if (identifier.length > IDENTIFIER_MAX)
    return `The identifier must be ${IDENTIFIER_MAX} characters or fewer.`;
  return "";
}

/**
 * The identifier value is stored upper-cased server-side; surface the same
 * normalization in the UI so administrators preview the stored value.
 */
export function normalizeIdentifierValue(value: string): string {
  return value.trim().toUpperCase();
}

/**
 * Decide whether submitting this draft would overwrite an existing identifier
 * for the same (type, issuer) pair with a different stored value. Used to show
 * an explicit update confirmation, since upsert replaces the prior value.
 */
export function findIdentifierOverwrite(
  draft: IdentifierDraft,
  existing: ReadonlyArray<{ identifierType: string; issuer: string; identifier: string }>,
): { previous: string } | null {
  const issuer = draft.issuer.trim();
  const normalized = normalizeIdentifierValue(draft.identifier);
  const match = existing.find(
    (item) =>
      item.identifierType === draft.identifierType &&
      item.issuer.trim().toLowerCase() === issuer.toLowerCase(),
  );
  if (match && match.identifier !== normalized) return { previous: match.identifier };
  return null;
}

/**
 * Translate an identifier mutation response status into a safe, non-leaking
 * message. Mirrors the governance error contract in `mapGovernanceError`.
 */
export function identifierMutationMessage(status: number, code?: string): string {
  if (status === 401)
    return "Your session ended. Sign in again with an active administrator account.";
  if (status === 403)
    return "Administrator access is required to maintain institutional identifiers.";
  if (status === 404)
    return "That account was not found. The directory may have changed.";
  if (status === 409 || code === "conflict")
    return "That institutional identifier is already assigned to another account for this issuer.";
  if (status === 400 || code === "invalid_input")
    return "Check the identifier type, issuer, and value, then try again.";
  if (status === 415)
    return "The server rejected the request format. Reload and try again.";
  if (status === 429)
    return "Too many attempts were made. Wait briefly before trying again.";
  return "The identifier service is temporarily unavailable. Try again later.";
}
