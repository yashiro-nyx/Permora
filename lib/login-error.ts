export const INCORRECT_CREDENTIALS_MESSAGE =
  "The email or password is incorrect, or this account is unavailable.";

export const RATE_LIMIT_MESSAGE =
  "Too many sign-in attempts. Wait a minute and try again.";

export const SIGN_IN_SERVICE_ERROR =
  "Sign-in is temporarily unavailable. No session was created. Try again later.";

export type LoginErrorPresentation =
  | { kind: "credentials"; message: string }
  | { kind: "rate-limit" | "service"; message: string };

export function loginErrorPresentation(
  status: number | undefined,
): LoginErrorPresentation {
  if (status === 401)
    return { kind: "credentials", message: INCORRECT_CREDENTIALS_MESSAGE };
  if (status === 429)
    return { kind: "rate-limit", message: RATE_LIMIT_MESSAGE };
  return { kind: "service", message: SIGN_IN_SERVICE_ERROR };
}
