import "server-only";
import type { TrustedIdentity } from "@/lib/auth-types";
import { appUrl } from "./config";
import { getTrustedIdentityFromHeaders } from "./identity-data";
import {
  listAdministratorAuditEvents,
  listRequesterNotifications,
  markAllRequesterNotificationsRead,
  markRequesterNotificationRead,
  OperationsQueryError,
  parseAuditFilters,
  parseNotificationFilters,
} from "./operations-service";

type IdentityResolver = (headers: Headers) => Promise<TrustedIdentity | null>;

export interface OperationsDependencies {
  getIdentity: IdentityResolver;
  listNotifications: typeof listRequesterNotifications;
  markNotificationRead: typeof markRequesterNotificationRead;
  markAllNotificationsRead: typeof markAllRequesterNotificationsRead;
  listAudit: typeof listAdministratorAuditEvents;
}

const defaults: OperationsDependencies = {
  getIdentity: getTrustedIdentityFromHeaders,
  listNotifications: listRequesterNotifications,
  markNotificationRead: markRequesterNotificationRead,
  markAllNotificationsRead: markAllRequesterNotificationsRead,
  listAudit: listAdministratorAuditEvents,
};

const responseHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Vary: "Cookie, Origin",
};
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class OperationsAuthorizationError extends Error {
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

async function requesterIdentity(request: Request, deps: OperationsDependencies) {
  const identity = await deps.getIdentity(request.headers);
  if (!identity)
    throw new OperationsAuthorizationError(
      401,
      "unauthenticated",
      "Authentication is required.",
    );
  if (!identity.requesterRole)
    throw new OperationsAuthorizationError(
      403,
      "forbidden",
      "Requester notification access is not available for this account.",
    );
  return identity;
}

async function administratorIdentity(
  request: Request,
  deps: OperationsDependencies,
) {
  const identity = await deps.getIdentity(request.headers);
  if (!identity)
    throw new OperationsAuthorizationError(
      401,
      "unauthenticated",
      "Authentication is required.",
    );
  if (!identity.roles.includes("admin"))
    throw new OperationsAuthorizationError(
      403,
      "forbidden",
      "Administrator access is required.",
    );
  return identity;
}

function mappedError(caught: unknown, service: "notification" | "audit") {
  if (caught instanceof OperationsAuthorizationError)
    return error(caught.status, caught.code, caught.message);
  if (caught instanceof OperationsQueryError)
    return error(400, "invalid_query", caught.message);
  console.error(`${service === "audit" ? "Audit" : "Notification"} operation failed`, {
    error: caught instanceof Error ? caught.name : "UnknownError",
  });
  return error(
    503,
    "service_unavailable",
    service === "audit"
      ? "Audit history is temporarily unavailable."
      : "Notifications are temporarily unavailable.",
  );
}

async function requireJsonObject(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new OperationsQueryError("A JSON request is required.");
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new OperationsQueryError("The JSON request is invalid.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new OperationsQueryError("A JSON object is required.");
}

export async function handleNotificationListRequest(
  request: Request,
  dependencies: Partial<OperationsDependencies> = {},
) {
  const deps = { ...defaults, ...dependencies };
  try {
    const identity = await requesterIdentity(request, deps);
    const filters = parseNotificationFilters(new URL(request.url).searchParams);
    return json(await deps.listNotifications(identity.id, filters));
  } catch (caught) {
    return mappedError(caught, "notification");
  }
}

export async function handleNotificationReadRequest(
  request: Request,
  notificationId: string,
  dependencies: Partial<OperationsDependencies> = {},
) {
  const deps = { ...defaults, ...dependencies };
  try {
    if (!hasTrustedOrigin(request))
      return error(403, "forbidden", "The request origin is not allowed.");
    const identity = await requesterIdentity(request, deps);
    if (!UUID.test(notificationId))
      return error(400, "invalid_input", "The notification identifier is invalid.");
    await requireJsonObject(request);
    if (!(await deps.markNotificationRead(identity.id, notificationId)))
      return error(404, "not_found", "The notification was not found.");
    return json({ notificationId, read: true });
  } catch (caught) {
    return mappedError(caught, "notification");
  }
}

export async function handleAllNotificationsReadRequest(
  request: Request,
  dependencies: Partial<OperationsDependencies> = {},
) {
  const deps = { ...defaults, ...dependencies };
  try {
    if (!hasTrustedOrigin(request))
      return error(403, "forbidden", "The request origin is not allowed.");
    const identity = await requesterIdentity(request, deps);
    await requireJsonObject(request);
    const updated = await deps.markAllNotificationsRead(identity.id);
    return json({ read: true, updated });
  } catch (caught) {
    return mappedError(caught, "notification");
  }
}

export async function handleAuditListRequest(
  request: Request,
  dependencies: Partial<OperationsDependencies> = {},
) {
  const deps = { ...defaults, ...dependencies };
  try {
    await administratorIdentity(request, deps);
    const filters = parseAuditFilters(new URL(request.url).searchParams);
    return json(await deps.listAudit(filters));
  } catch (caught) {
    return mappedError(caught, "audit");
  }
}
