import "server-only";
import { createHash } from "node:crypto";
import type { TrustedIdentity } from "@/lib/auth-types";
import { appUrl } from "./config";
import { query } from "./db";
import { getTrustedIdentityFromHeaders } from "./identity-data";
import {
  PasswordChangeConflictError,
  updatePasswordAndAudit,
} from "./password";

export interface CredentialHandlerDependencies {
  getIdentity: (headers: Headers) => Promise<TrustedIdentity | null>;
  getCurrentSession: (
    headers: Headers,
  ) => Promise<{ userId: string; sessionId: string } | null>;
  verifyPassword: (hash: string, password: string) => Promise<boolean>;
  hashPassword: (password: string) => Promise<string>;
  updatePassword: typeof updatePasswordAndAudit;
}

async function getCurrentSession(headers: Headers) {
  const { auth } = await import("./auth");
  const current = await auth.api.getSession({
    headers,
    query: { disableCookieCache: true },
  });
  return current
    ? { userId: current.user.id, sessionId: current.session.id }
    : null;
}

async function verifyConfiguredPassword(hash: string, password: string) {
  const { auth } = await import("./auth");
  const authContext = await auth.$context;
  return authContext.password.verify({ hash, password });
}

async function hashConfiguredPassword(password: string) {
  const { auth } = await import("./auth");
  const authContext = await auth.$context;
  return authContext.password.hash(password);
}

const defaults: CredentialHandlerDependencies = {
  getIdentity: getTrustedIdentityFromHeaders,
  getCurrentSession,
  verifyPassword: verifyConfiguredPassword,
  hashPassword: hashConfiguredPassword,
  updatePassword: updatePasswordAndAudit,
};

const responseHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Vary: "Cookie, Origin",
};
const PASSWORD_CHANGE_RATE_LIMIT = { windowSeconds: 60, maxAttempts: 60 } as const;
const PASSWORD_CHANGE_RATE_LIMIT_PREFIX = "permora:password-change:";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: responseHeaders });
}

function hasTrustedOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (!origin || (fetchSite && fetchSite !== "same-origin")) return false;
  try {
    return new URL(origin).origin === new URL(appUrl).origin;
  } catch {
    return false;
  }
}

async function passwordChangeRateLimitAllowed(request: Request) {
  const address =
    request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown";
  const addressHash = createHash("sha256").update(address).digest("hex");
  const key = `${PASSWORD_CHANGE_RATE_LIMIT_PREFIX}${addressHash}`;
  const now = Date.now();
  const cutoff = now - PASSWORD_CHANGE_RATE_LIMIT.windowSeconds * 1000;
  const result = await query<{ count: number }>(
    `INSERT INTO "rateLimit" (id, key, count, "lastRequest")
     VALUES ($1,$1,1,$2)
     ON CONFLICT (key) DO UPDATE
       SET count = CASE
             WHEN "rateLimit"."lastRequest" <= $3 THEN 1
             ELSE LEAST("rateLimit".count + 1, $4)
           END,
           "lastRequest" = CASE
             WHEN "rateLimit"."lastRequest" <= $3 THEN $2
             ELSE "rateLimit"."lastRequest"
           END
     RETURNING count`,
    [key, now, cutoff, PASSWORD_CHANGE_RATE_LIMIT.maxAttempts + 1],
  );
  return result.rows[0].count <= PASSWORD_CHANGE_RATE_LIMIT.maxAttempts;
}

export async function handlePasswordChangeRequest(
  request: Request,
  overrides: Partial<CredentialHandlerDependencies> = {},
) {
  const dependencies = { ...defaults, ...overrides };
  if (!hasTrustedOrigin(request))
    return json(
      { error: { code: "forbidden", message: "The request origin is not allowed." } },
      403,
    );
  const identity = await dependencies.getIdentity(request.headers).catch(() => null);
  if (!identity)
    return json(
      { error: { code: "unauthenticated", message: "Authentication is required." } },
      401,
    );
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return json(
      { error: { code: "invalid_input", message: "A JSON request is required." } },
      415,
    );

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return json(
      { error: { code: "invalid_input", message: "The password input is invalid." } },
      400,
    );
  }
  if (!input || typeof input !== "object" || Array.isArray(input))
    return json(
      { error: { code: "invalid_input", message: "The password input is invalid." } },
      400,
    );
  const value = input as Record<string, unknown>;
  if (
    typeof value.currentPassword !== "string" ||
    typeof value.newPassword !== "string" ||
    !value.currentPassword ||
    value.newPassword.length < 12 ||
    value.newPassword.length > 128
  )
    return json(
      { error: { code: "invalid_input", message: "Choose a password that meets the account password requirements." } },
      400,
    );

  try {
    if (!(await passwordChangeRateLimitAllowed(request)))
      return json(
        {
          error: {
            code: "rate_limited",
            message: "Too many attempts. Wait a few minutes and try again.",
          },
        },
        429,
      );
  } catch (caught) {
    console.error("Password change rate limit failed", {
      error: caught instanceof Error ? caught.name : "UnknownError",
    });
    return json(
      { error: { code: "service_unavailable", message: "Password change is temporarily unavailable." } },
      503,
    );
  }

  let currentSession: { userId: string; sessionId: string } | null;
  let credential: { id: string; password_hash: string } | undefined;
  let passwordMatches: boolean;
  let newPasswordHash: string;
  try {
    currentSession = await dependencies.getCurrentSession(request.headers);
    if (!currentSession || currentSession.userId !== identity.id)
      return json(
        { error: { code: "unauthenticated", message: "Authentication is required." } },
        401,
      );
    const result = await query<{ id: string; password_hash: string }>(
      `SELECT id, password AS password_hash FROM account
        WHERE "userId" = $1 AND "providerId" = 'credential'
          AND password IS NOT NULL
        LIMIT 1`,
      [identity.id],
    );
    credential = result.rows[0];
    if (!credential)
      return json(
        {
          error: {
            code: "invalid_credentials",
            message: "The current password is incorrect or the new password is invalid.",
          },
        },
        400,
      );
    passwordMatches = await dependencies.verifyPassword(
      credential.password_hash,
      value.currentPassword,
    );
    if (!passwordMatches)
      return json(
        {
          error: {
            code: "invalid_credentials",
            message: "The current password is incorrect or the new password is invalid.",
          },
        },
        400,
      );
    newPasswordHash = await dependencies.hashPassword(value.newPassword);
    await dependencies.updatePassword({
      userId: identity.id,
      currentSessionId: currentSession.sessionId,
      credentialId: credential.id,
      oldPasswordHash: credential.password_hash,
      newPasswordHash,
    });
  } catch (caught) {
    if (caught instanceof PasswordChangeConflictError)
      return json(
        {
          error: {
            code: "password_change_conflict",
            message: "The password changed during this request. Verify your current password and try again.",
          },
        },
        409,
      );
    console.error("Password change failed", {
      error: caught instanceof Error ? caught.name : "UnknownError",
    });
    return json(
      { error: { code: "service_unavailable", message: "Password change is temporarily unavailable." } },
      503,
    );
  }
  return json({ success: true }, 200);
}
