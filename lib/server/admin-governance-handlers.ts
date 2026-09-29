import "server-only";
import { GovernanceError, mapGovernanceError } from "@/lib/admin-governance";
import type { TrustedIdentity } from "@/lib/auth-types";
import { appUrl } from "./config";
import { getTrustedIdentityFromHeaders } from "./identity-data";
import {
  assignUnassignedRequest,
  cancelDelegation,
  createDelegation,
  createResponsibility,
  createScopeOption,
  endResponsibility,
  getAnalyticsSummary,
  getNotificationPreferences,
  listCatalogResources,
  listDelegations,
  listEligibleAssignees,
  listResponsibilities,
  listRetentionPolicies,
  listScopeOptions,
  listUserIdentifiers,
  previewRetention,
  toggleCatalogAvailability,
  updateNotificationPreferences,
  upsertUserIdentifier,
} from "./admin-governance-service";

const responseHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Vary: "Cookie, Origin",
};
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class AuthError extends Error {
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

async function identityFrom(request: Request) {
  const identity = await getTrustedIdentityFromHeaders(request.headers);
  if (!identity)
    throw new AuthError(401, "unauthenticated", "Authentication is required.");
  return identity;
}

async function adminFrom(request: Request) {
  const identity = await identityFrom(request);
  if (!identity.roles.includes("admin"))
    throw new AuthError(403, "forbidden", "Administrator access is required.");
  return identity;
}

async function jsonBody(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new GovernanceError("invalid_input", "JSON is required.");
  try {
    return await request.json();
  } catch {
    throw new GovernanceError("invalid_input", "JSON is required.");
  }
}

function mapped(caught: unknown) {
  if (caught instanceof AuthError)
    return error(caught.status, caught.code, caught.message);
  const result = mapGovernanceError(caught);
  if (caught instanceof GovernanceError) return json(result.body, result.status);
  console.error("Governance operation failed", {
    error: caught instanceof Error ? caught.name : "UnknownError",
  });
  return json(result.body, result.status);
}

const adminDeps = (identity: TrustedIdentity) => ({
  requireAdmin: async () => identity,
});

export async function handleCatalogGet(request: Request) {
  try {
    await adminFrom(request);
    return json({ resources: await listCatalogResources() });
  } catch (caught) {
    return mapped(caught);
  }
}

export async function handleCatalogToggle(request: Request) {
  try {
    if (!hasTrustedOrigin(request))
      return error(403, "invalid_origin", "The request origin is not trusted.");
    const identity = await adminFrom(request);
    return json({
      result: await toggleCatalogAvailability(await jsonBody(request), adminDeps(identity)),
    });
  } catch (caught) {
    return mapped(caught);
  }
}

export async function handleScopeCreate(request: Request) {
  try {
    if (!hasTrustedOrigin(request))
      return error(403, "invalid_origin", "The request origin is not trusted.");
    const identity = await adminFrom(request);
    return json({
      result: await createScopeOption(await jsonBody(request), adminDeps(identity)),
    });
  } catch (caught) {
    return mapped(caught);
  }
}

export async function handleScopeList(request: Request) {
  try {
    await adminFrom(request);
    const resource = new URL(request.url).searchParams.get("resource") ?? "";
    return json({ options: await listScopeOptions(resource) });
  } catch (caught) {
    return mapped(caught);
  }
}

export async function handleResponsibilityList(request: Request) {
  try {
    const identity = await adminFrom(request);
    return json(
      await listResponsibilities(new URL(request.url).searchParams, adminDeps(identity)),
    );
  } catch (caught) {
    return mapped(caught);
  }
}

export async function handleResponsibilityCreate(request: Request) {
  try {
    if (!hasTrustedOrigin(request))
      return error(403, "invalid_origin", "The request origin is not trusted.");
    const identity = await adminFrom(request);
    return json({
      result: await createResponsibility(await jsonBody(request), adminDeps(identity)),
    });
  } catch (caught) {
    return mapped(caught);
  }
}

export async function handleResponsibilityEnd(
  request: Request,
  responsibilityId: string,
) {
  try {
    if (!hasTrustedOrigin(request))
      return error(403, "invalid_origin", "The request origin is not trusted.");
    if (!UUID.test(responsibilityId))
      return error(400, "invalid_input", "The responsibility identifier is invalid.");
    const identity = await adminFrom(request);
    return json({
      result: await endResponsibility(responsibilityId, adminDeps(identity)),
    });
  } catch (caught) {
    return mapped(caught);
  }
}

export async function handleDelegationList(request: Request) {
  try {
    const identity = await adminFrom(request);
    return json({ items: await listDelegations(adminDeps(identity)) });
  } catch (caught) {
    return mapped(caught);
  }
}

export async function handleDelegationCreate(request: Request) {
  try {
    if (!hasTrustedOrigin(request))
      return error(403, "invalid_origin", "The request origin is not trusted.");
    const identity = await adminFrom(request);
    return json({
      result: await createDelegation(await jsonBody(request), adminDeps(identity)),
    });
  } catch (caught) {
    return mapped(caught);
  }
}

export async function handleDelegationCancel(request: Request, delegationId: string) {
  try {
    if (!hasTrustedOrigin(request))
      return error(403, "invalid_origin", "The request origin is not trusted.");
    if (!UUID.test(delegationId))
      return error(400, "invalid_input", "The delegation identifier is invalid.");
    const identity = await adminFrom(request);
    return json({
      result: await cancelDelegation(delegationId, adminDeps(identity)),
    });
  } catch (caught) {
    return mapped(caught);
  }
}

export async function handleEligibleAssignees(request: Request, requestId: string) {
  try {
    await adminFrom(request);
    if (!UUID.test(requestId))
      return error(400, "invalid_input", "The request identifier is invalid.");
    return json({ items: await listEligibleAssignees(requestId) });
  } catch (caught) {
    return mapped(caught);
  }
}

export async function handleManualAssign(request: Request, requestId: string) {
  try {
    if (!hasTrustedOrigin(request))
      return error(403, "invalid_origin", "The request origin is not trusted.");
    if (!UUID.test(requestId))
      return error(400, "invalid_input", "The request identifier is invalid.");
    const identity = await adminFrom(request);
    return json({
      result: await assignUnassignedRequest(
        requestId,
        await jsonBody(request),
        adminDeps(identity),
      ),
    });
  } catch (caught) {
    return mapped(caught);
  }
}

export async function handleAnalytics(request: Request) {
  try {
    const identity = await adminFrom(request);
    return json(
      await getAnalyticsSummary(new URL(request.url).searchParams, adminDeps(identity)),
    );
  } catch (caught) {
    return mapped(caught);
  }
}

export async function handlePreferenceGet(request: Request) {
  try {
    const identity = await identityFrom(request);
    return json({ preference: await getNotificationPreferences(identity.id) });
  } catch (caught) {
    return mapped(caught);
  }
}

export async function handlePreferenceUpdate(request: Request) {
  try {
    if (!hasTrustedOrigin(request))
      return error(403, "invalid_origin", "The request origin is not trusted.");
    const identity = await identityFrom(request);
    return json({
      preference: await updateNotificationPreferences(await jsonBody(request), {
        requireIdentity: async () => identity,
      }),
    });
  } catch (caught) {
    return mapped(caught);
  }
}

export async function handleIdentifierList(request: Request, userId: string) {
  try {
    await adminFrom(request);
    if (!UUID.test(userId))
      return error(400, "invalid_input", "The account identifier is invalid.");
    return json({ items: await listUserIdentifiers(userId) });
  } catch (caught) {
    return mapped(caught);
  }
}

export async function handleIdentifierUpsert(request: Request, userId: string) {
  try {
    if (!hasTrustedOrigin(request))
      return error(403, "invalid_origin", "The request origin is not trusted.");
    if (!UUID.test(userId))
      return error(400, "invalid_input", "The account identifier is invalid.");
    const identity = await adminFrom(request);
    return json({
      items: await upsertUserIdentifier(
        userId,
        await jsonBody(request),
        adminDeps(identity),
      ),
    });
  } catch (caught) {
    return mapped(caught);
  }
}

export async function handleRetentionList(request: Request) {
  try {
    const identity = await adminFrom(request);
    return json({ items: await listRetentionPolicies(adminDeps(identity)) });
  } catch (caught) {
    return mapped(caught);
  }
}

export async function handleRetentionPreview(request: Request) {
  try {
    if (!hasTrustedOrigin(request))
      return error(403, "invalid_origin", "The request origin is not trusted.");
    const identity = await adminFrom(request);
    return json({
      result: await previewRetention(await jsonBody(request), adminDeps(identity)),
    });
  } catch (caught) {
    return mapped(caught);
  }
}
