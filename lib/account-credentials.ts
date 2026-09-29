import { createHash, randomBytes } from "node:crypto";

export const INVITATION_TOKEN_BYTES = 32;
export const INVITATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const ACCEPTANCE_RATE_LIMIT = { windowSeconds: 600, maxAttempts: 5 } as const;

export type InvitationFlowErrorCode =
  | "invalid_invitation"
  | "invalid_password"
  | "rate_limited"
  | "invitation_exists"
  | "credential_exists"
  | "account_unavailable"
  | "not_found"
  | "service_unavailable";

const INVITATION_MESSAGES: Record<InvitationFlowErrorCode, string> = {
  invalid_invitation:
    "This invitation is invalid or expired. Ask an administrator to issue a new one.",
  invalid_password:
    "Choose a password that meets the account password requirements.",
  rate_limited:
    "Too many attempts. Wait a few minutes and try again.",
  invitation_exists:
    "An active invitation already exists for this account.",
  credential_exists:
    "This account already has a password credential.",
  account_unavailable:
    "The account is not available for invitation acceptance.",
  not_found:
    "The invitation could not be found or is no longer outstanding.",
  service_unavailable:
    "The account service is temporarily unavailable.",
};

export class InvitationFlowError extends Error {
  constructor(readonly code: InvitationFlowErrorCode) {
    super(INVITATION_MESSAGES[code]);
    this.name = "InvitationFlowError";
  }
}

export function createInvitationToken() {
  return randomBytes(INVITATION_TOKEN_BYTES).toString("base64url");
}

export function hashInvitationToken(token: unknown) {
  if (typeof token !== "string" || !INVITATION_TOKEN_PATTERN.test(token))
    throw new InvitationFlowError("invalid_invitation");
  return createHash("sha256").update(token, "ascii").digest();
}

export function parseInvitationAcceptanceInput(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new InvitationFlowError("invalid_invitation");
  const value = input as Record<string, unknown>;
  const tokenHash = hashInvitationToken(value.token);
  if (typeof value.password !== "string")
    throw new InvitationFlowError("invalid_password");
  return { tokenHash, password: value.password };
}

export function validatePasswordLength(
  password: unknown,
  minimum: number,
  maximum: number,
) {
  if (
    typeof password !== "string" ||
    password.length < minimum ||
    password.length > maximum
  )
    throw new InvitationFlowError("invalid_password");
  return password;
}

export function hashRateLimitIdentifier(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function invitationRateLimitAllowed(count: number) {
  return Number.isSafeInteger(count) && count <= ACCEPTANCE_RATE_LIMIT.maxAttempts;
}

export function invitationFlowMessage(code: InvitationFlowErrorCode) {
  return INVITATION_MESSAGES[code];
}

export function invitationAuditMetadata(
  invitationId: string,
  expiresAt?: string,
) {
  return expiresAt ? { invitationId, expiresAt } : { invitationId };
}
