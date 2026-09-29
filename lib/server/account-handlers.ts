import "server-only";
import type { TrustedIdentity } from "@/lib/auth-types";
import {
  AccountServiceError,
  mapAccountServiceError,
} from "@/lib/account-management";
import { appUrl } from "./config";
import { getTrustedIdentityFromHeaders } from "./identity-data";
import {
  createUser,
  deactivateUser,
  getUser,
  listUsers,
  reactivateUser,
  updateUser,
} from "./account-service";

export interface AccountHandlerDependencies {
  getIdentity: (headers: Headers) => Promise<TrustedIdentity | null>;
  listUsers: typeof listUsers;
  getUser: typeof getUser;
  createUser: typeof createUser;
  updateUser: typeof updateUser;
  deactivateUser: typeof deactivateUser;
  reactivateUser: typeof reactivateUser;
}

const defaults: AccountHandlerDependencies = {
  getIdentity: getTrustedIdentityFromHeaders,
  listUsers,
  getUser,
  createUser,
  updateUser,
  deactivateUser,
  reactivateUser,
};

const responseHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Vary: "Cookie, Origin",
};
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class AccountAuthorizationError extends Error {
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
  dependencies: AccountHandlerDependencies,
) {
  const identity = await dependencies.getIdentity(request.headers);
  if (!identity)
    throw new AccountAuthorizationError(
      401,
      "unauthenticated",
      "Authentication is required.",
    );
  if (!identity.roles.includes("admin"))
    throw new AccountAuthorizationError(
      403,
      "forbidden",
      "Administrator access is required.",
    );
  return identity;
}

function mappedError(caught: unknown) {
  if (caught instanceof AccountAuthorizationError)
    return error(caught.status, caught.code, caught.message);
  const mapped = mapAccountServiceError(caught);
  if (caught instanceof AccountServiceError) return json(mapped.body, mapped.status);
  console.error("Account operation failed", {
    error: caught instanceof Error ? caught.name : "UnknownError",
  });
  return json(
    {
      error: {
        code: "service_unavailable",
        message: "Account management is temporarily unavailable.",
      },
    },
    503,
  );
}

async function jsonObject(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new AccountServiceError("invalid_input");
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new AccountServiceError("invalid_input");
  }
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new AccountServiceError("invalid_input");
  return body as Record<string, unknown>;
}

function serviceDependencies(identity: TrustedIdentity) {
  return { requireAdmin: async () => identity };
}

export async function handleUserListRequest(
  request: Request,
  overrides: Partial<AccountHandlerDependencies> = {},
) {
  const dependencies = { ...defaults, ...overrides };
  try {
    const identity = await administratorIdentity(request, dependencies);
    return json(
      await dependencies.listUsers(
        new URL(request.url).searchParams,
        serviceDependencies(identity),
      ),
    );
  } catch (caught) {
    return mappedError(caught);
  }
}

export async function handleUserDetailRequest(
  request: Request,
  userId: string,
  overrides: Partial<AccountHandlerDependencies> = {},
) {
  const dependencies = { ...defaults, ...overrides };
  try {
    const identity = await administratorIdentity(request, dependencies);
    if (!UUID.test(userId))
      return error(400, "invalid_input", "The account identifier is invalid.");
    const user = await dependencies.getUser(
      userId,
      serviceDependencies(identity),
    );
    return user
      ? json({ user })
      : error(404, "not_found", "The account was not found.");
  } catch (caught) {
    return mappedError(caught);
  }
}

export async function handleUserCreateRequest(
  request: Request,
  overrides: Partial<AccountHandlerDependencies> = {},
) {
  const dependencies = { ...defaults, ...overrides };
  try {
    if (!hasTrustedOrigin(request))
      return error(403, "forbidden", "The request origin is not allowed.");
    const identity = await administratorIdentity(request, dependencies);
    const input = await jsonObject(request);
    const user = await dependencies.createUser(
      input,
      serviceDependencies(identity),
    );
    return json({ user }, 201);
  } catch (caught) {
    return mappedError(caught);
  }
}

export async function handleUserUpdateRequest(
  request: Request,
  userId: string,
  overrides: Partial<AccountHandlerDependencies> = {},
) {
  const dependencies = { ...defaults, ...overrides };
  try {
    if (!hasTrustedOrigin(request))
      return error(403, "forbidden", "The request origin is not allowed.");
    const identity = await administratorIdentity(request, dependencies);
    if (!UUID.test(userId))
      return error(400, "invalid_input", "The account identifier is invalid.");
    const body = await jsonObject(request);
    const expectedValue = body.expectedUpdatedAt;
    if (
      typeof expectedValue !== "string" ||
      !Number.isFinite(Date.parse(expectedValue))
    )
      throw new AccountServiceError("invalid_input");
    const input = { ...body };
    delete input.expectedUpdatedAt;
    return json({
      user: await dependencies.updateUser(
        userId,
        input,
        serviceDependencies(identity),
        expectedValue,
      ),
    });
  } catch (caught) {
    return mappedError(caught);
  }
}

export async function handleUserDeactivationRequest(
  request: Request,
  userId: string,
  overrides: Partial<AccountHandlerDependencies> = {},
) {
  const dependencies = { ...defaults, ...overrides };
  try {
    if (!hasTrustedOrigin(request))
      return error(403, "forbidden", "The request origin is not allowed.");
    const identity = await administratorIdentity(request, dependencies);
    if (!UUID.test(userId))
      return error(400, "invalid_input", "The account identifier is invalid.");
    const input = await jsonObject(request);
    const result = await dependencies.deactivateUser(
      userId,
      input.reason,
      serviceDependencies(identity),
    );
    return json({
      user: result.user,
      sessionsRevoked: result.sessionsRevoked,
      ...(result.sessionsRevoked
        ? {}
        : {
            warning:
              "The account is deactivated, but existing sessions could not be invalidated. Access remains blocked; retry session invalidation before reactivation.",
          }),
    });
  } catch (caught) {
    return mappedError(caught);
  }
}

export async function handleUserReactivationRequest(
  request: Request,
  userId: string,
  overrides: Partial<AccountHandlerDependencies> = {},
) {
  const dependencies = { ...defaults, ...overrides };
  try {
    if (!hasTrustedOrigin(request))
      return error(403, "forbidden", "The request origin is not allowed.");
    const identity = await administratorIdentity(request, dependencies);
    if (!UUID.test(userId))
      return error(400, "invalid_input", "The account identifier is invalid.");
    await jsonObject(request);
    return json({
      user: await dependencies.reactivateUser(
        userId,
        serviceDependencies(identity),
      ),
    });
  } catch (caught) {
    return mappedError(caught);
  }
}
