import "server-only";
import type { TrustedIdentity } from "@/lib/auth-types";
import {
  InvitationFlowError,
  invitationFlowMessage,
} from "@/lib/account-credentials";
import { AccountServiceError, mapAccountServiceError } from "@/lib/account-management";
import { appUrl } from "./config";
import { getTrustedIdentityFromHeaders } from "./identity-data";
import {
  acceptInvitation,
  checkInvitationAcceptanceRateLimit,
  issueInvitation,
  revokeInvitation,
} from "./invitation-service";

export interface InvitationHandlerDependencies {
  getIdentity: (headers: Headers) => Promise<TrustedIdentity | null>;
  issue: typeof issueInvitation;
  revoke: typeof revokeInvitation;
  accept: typeof acceptInvitation;
  rateLimit: typeof checkInvitationAcceptanceRateLimit;
}

const defaults: InvitationHandlerDependencies = {
  getIdentity: getTrustedIdentityFromHeaders,
  issue: issueInvitation,
  revoke: revokeInvitation,
  accept: acceptInvitation,
  rateLimit: checkInvitationAcceptanceRateLimit,
};

const responseHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Vary: "Cookie, Origin",
};
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class InvitationAuthorizationError extends Error {
  constructor(
    readonly status: 401 | 403,
    readonly code: "unauthenticated" | "forbidden",
    message: string,
  ) {
    super(message);
  }
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: responseHeaders });
}

function error(status: number, code: string, message: string) {
  return json({ error: { code, message } }, status);
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

async function administratorIdentity(
  request: Request,
  dependencies: InvitationHandlerDependencies,
) {
  const identity = await dependencies.getIdentity(request.headers);
  if (!identity)
    throw new InvitationAuthorizationError(
      401,
      "unauthenticated",
      "Authentication is required.",
    );
  if (!identity.roles.includes("admin"))
    throw new InvitationAuthorizationError(
      403,
      "forbidden",
      "Administrator access is required.",
    );
  return identity;
}

function serviceDependencies(identity: TrustedIdentity) {
  return { requireAdmin: async () => identity };
}

function mappedError(caught: unknown) {
  if (caught instanceof InvitationAuthorizationError)
    return error(caught.status, caught.code, caught.message);
  if (caught instanceof InvitationFlowError) {
    const status =
      caught.code === "rate_limited"
        ? 429
        : caught.code === "invitation_exists" || caught.code === "credential_exists"
          ? 409
          : caught.code === "service_unavailable"
            ? 503
            : caught.code === "not_found"
              ? 404
              : 400;
    return error(status, caught.code, invitationFlowMessage(caught.code));
  }
  if (caught instanceof AccountServiceError) {
    const mapped = mapAccountServiceError(caught);
    return json(mapped.body, mapped.status);
  }
  console.error("Invitation operation failed", {
    error: caught instanceof Error ? caught.name : "UnknownError",
  });
  return error(503, "service_unavailable", "The account service is temporarily unavailable.");
}

async function readJsonObject(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new InvitationFlowError("invalid_invitation");
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new InvitationFlowError("invalid_invitation");
  }
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new InvitationFlowError("invalid_invitation");
  return body as Record<string, unknown>;
}

function clientAddress(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
  const realAddress = request.headers.get("x-real-ip")?.trim();
  return forwarded || realAddress || "unknown";
}

export async function handleInvitationIssueRequest(
  request: Request,
  userId: string,
  overrides: Partial<InvitationHandlerDependencies> = {},
) {
  const dependencies = { ...defaults, ...overrides };
  try {
    if (!hasTrustedOrigin(request))
      return error(403, "forbidden", "The request origin is not allowed.");
    const identity = await administratorIdentity(request, dependencies);
    if (!UUID.test(userId))
      return error(400, "invalid_input", "The account identifier is invalid.");
    await readJsonObject(request);
    const issued = await dependencies.issue(
      userId,
      serviceDependencies(identity),
    );
    return json(
      {
        invitation: issued.invitation,
        rawToken: issued.rawToken,
      },
      201,
    );
  } catch (caught) {
    return mappedError(caught);
  }
}

export async function handleInvitationRevokeRequest(
  request: Request,
  userId: string,
  invitationId: string,
  overrides: Partial<InvitationHandlerDependencies> = {},
) {
  const dependencies = { ...defaults, ...overrides };
  try {
    if (!hasTrustedOrigin(request))
      return error(403, "forbidden", "The request origin is not allowed.");
    const identity = await administratorIdentity(request, dependencies);
    if (!UUID.test(userId) || !UUID.test(invitationId))
      return error(400, "invalid_input", "The invitation identifier is invalid.");
    await readJsonObject(request);
    return json(
      await dependencies.revoke(
        userId,
        invitationId,
        serviceDependencies(identity),
      ),
    );
  } catch (caught) {
    return mappedError(caught);
  }
}

export async function handleInvitationAcceptanceRequest(
  request: Request,
  overrides: Partial<InvitationHandlerDependencies> = {},
) {
  const dependencies = { ...defaults, ...overrides };
  try {
    if (!hasTrustedOrigin(request))
      return error(403, "forbidden", "The request origin is not allowed.");
    if (!(await dependencies.rateLimit(clientAddress(request))))
      return error(
        429,
        "rate_limited",
        invitationFlowMessage("rate_limited"),
      );
    const input = await readJsonObject(request);
    await dependencies.accept(input);
    return json({ accepted: true });
  } catch (caught) {
    return mappedError(caught);
  }
}
