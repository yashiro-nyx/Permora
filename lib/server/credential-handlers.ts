import "server-only";
import { randomUUID } from "node:crypto";
import type { TrustedIdentity } from "@/lib/auth-types";
import { appUrl } from "./config";
import { getTrustedIdentityFromHeaders } from "./identity-data";
import { transaction } from "./db";

export interface CredentialHandlerDependencies {
  getIdentity: (headers: Headers) => Promise<TrustedIdentity | null>;
  changePassword: (
    request: Request,
    currentPassword: string,
    newPassword: string,
  ) => Promise<Response>;
  recordPasswordChange: (userId: string) => Promise<void>;
}

const defaults: CredentialHandlerDependencies = {
  getIdentity: getTrustedIdentityFromHeaders,
  changePassword: changePasswordThroughBetterAuth,
  recordPasswordChange,
};

const responseHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Vary: "Cookie, Origin",
};

function withSetCookies(response: Response, body: unknown, status: number) {
  const headers = new Headers(responseHeaders);
  const getSetCookie = (response.headers as Headers & {
    getSetCookie?: () => string[];
  }).getSetCookie;
  const cookies = getSetCookie
    ? getSetCookie.call(response.headers)
    : [response.headers.get("set-cookie")].filter(
        (value): value is string => Boolean(value),
      );
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return Response.json(body, { status, headers });
}

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

async function changePasswordThroughBetterAuth(
  request: Request,
  currentPassword: string,
  newPassword: string,
) {
  const { auth } = await import("./auth");
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  headers.set("content-type", "application/json");
  const authRequest = new Request(
    new URL("/api/auth/change-password", appUrl),
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      }),
    },
  );
  return auth.handler(authRequest);
}

async function recordPasswordChange(userId: string) {
  await transaction(async (client) => {
    await client.query(
      `INSERT INTO audit_event
        (id, actor_user_id, subject_user_id, event_type, metadata)
       VALUES ($1,$2,$2,'account.password_changed',$3::jsonb)`,
      [randomUUID(), userId, JSON.stringify({ otherSessionsRevoked: true })],
    );
  });
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

  let changed: Response;
  try {
    changed = await dependencies.changePassword(
      request,
      value.currentPassword,
      value.newPassword,
    );
  } catch (caught) {
    console.error("Password change failed", {
      error: caught instanceof Error ? caught.name : "UnknownError",
    });
    return json(
      { error: { code: "service_unavailable", message: "Password change is temporarily unavailable." } },
      503,
    );
  }
  if (!changed.ok) {
    const status = changed.status === 429 ? 429 : changed.status === 400 ? 400 : 503;
    return withSetCookies(
      changed,
      {
        error: {
          code: status === 429 ? "rate_limited" : "password_change_failed",
          message:
            status === 429
              ? "Too many attempts. Wait a few minutes and try again."
              : status === 400
                ? "The current password is incorrect or the new password is invalid."
                : "Password change is temporarily unavailable.",
        },
      },
      status,
    );
  }

  try {
    await dependencies.recordPasswordChange(identity.id);
  } catch (caught) {
    console.error("Password change audit failed", {
      error: caught instanceof Error ? caught.name : "UnknownError",
    });
    return withSetCookies(
      changed,
      {
        success: true,
        warning:
          "Your password changed and other sessions were revoked, but the audit record could not be confirmed. Contact support.",
      },
      200,
    );
  }
  return withSetCookies(changed, { success: true }, 200);
}
