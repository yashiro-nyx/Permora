import "server-only";
import type { TrustedIdentity } from "@/lib/auth-types";
import {
  getTrustedIdentityFromHeaders,
  hasActiveApprovalResponsibility,
} from "./identity-data";
import {
  ApprovalQueryError,
  getAssignedReviewRequest,
  listAssignedReviewRequests,
  listUnassignedRoutingFailures,
  parseApprovalListFilters,
} from "./approval-read-service";

type IdentityResolver = (headers: Headers) => Promise<TrustedIdentity | null>;

export interface ApprovalReadDependencies {
  getIdentity: IdentityResolver;
  hasResponsibility: (userId: string) => Promise<boolean>;
  listAssigned: typeof listAssignedReviewRequests;
  getAssigned: typeof getAssignedReviewRequest;
  listUnassigned: typeof listUnassignedRoutingFailures;
}

const defaults: ApprovalReadDependencies = {
  getIdentity: getTrustedIdentityFromHeaders,
  hasResponsibility: hasActiveApprovalResponsibility,
  listAssigned: listAssignedReviewRequests,
  getAssigned: getAssignedReviewRequest,
  listUnassigned: listUnassignedRoutingFailures,
};

class ReadAuthorizationError extends Error {
  constructor(
    readonly status: 401 | 403,
    readonly code: "unauthenticated" | "forbidden",
    message: string,
  ) {
    super(message);
  }
}

const responseHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Vary: "Cookie",
};

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: responseHeaders });
}

async function approverIdentity(request: Request, deps: ApprovalReadDependencies) {
  const identity = await deps.getIdentity(request.headers);
  if (!identity)
    throw new ReadAuthorizationError(
      401,
      "unauthenticated",
      "Authentication is required.",
    );
  if (
    !identity.roles.includes("approver") &&
    !identity.roles.includes("admin")
  )
    throw new ReadAuthorizationError(
      403,
      "forbidden",
      "Approval access is not available for this account.",
    );
  if (!(await deps.hasResponsibility(identity.id)))
    throw new ReadAuthorizationError(
      403,
      "forbidden",
      "Approval access is not available for this account.",
    );
  return identity;
}

async function administratorIdentity(
  request: Request,
  deps: ApprovalReadDependencies,
) {
  const identity = await deps.getIdentity(request.headers);
  if (!identity)
    throw new ReadAuthorizationError(
      401,
      "unauthenticated",
      "Authentication is required.",
    );
  if (!identity.roles.includes("admin"))
    throw new ReadAuthorizationError(
      403,
      "forbidden",
      "Administrator access is required.",
    );
  return identity;
}

function mappedError(error: unknown) {
  if (error instanceof ReadAuthorizationError)
    return json({ error: { code: error.code, message: error.message } }, error.status);
  if (error instanceof ApprovalQueryError)
    return json(
      { error: { code: "invalid_query", message: error.message } },
      400,
    );
  console.error("Approval read failed", {
    error: error instanceof Error ? error.name : "UnknownError",
  });
  return json(
    {
      error: {
        code: "service_unavailable",
        message: "Approval information is temporarily unavailable.",
      },
    },
    503,
  );
}

export async function handleAssignedQueueRequest(
  request: Request,
  dependencies: Partial<ApprovalReadDependencies> = {},
) {
  const deps = { ...defaults, ...dependencies };
  try {
    const identity = await approverIdentity(request, deps);
    const filters = parseApprovalListFilters(
      new URL(request.url).searchParams,
      "assigned",
    );
    return json(await deps.listAssigned(identity, filters));
  } catch (error) {
    return mappedError(error);
  }
}

export async function handleAssignedDetailRequest(
  request: Request,
  id: string,
  dependencies: Partial<ApprovalReadDependencies> = {},
) {
  const deps = { ...defaults, ...dependencies };
  try {
    const identity = await approverIdentity(request, deps);
    const detail = await deps.getAssigned(identity, id);
    if (!detail)
      return json(
        {
          error: {
            code: "not_found",
            message: "The review request was not found.",
          },
        },
        404,
      );
    return json(detail);
  } catch (error) {
    return mappedError(error);
  }
}

export async function handleUnassignedQueueRequest(
  request: Request,
  dependencies: Partial<ApprovalReadDependencies> = {},
) {
  const deps = { ...defaults, ...dependencies };
  try {
    await administratorIdentity(request, deps);
    const filters = parseApprovalListFilters(
      new URL(request.url).searchParams,
      "unassigned",
    );
    return json(await deps.listUnassigned(filters));
  } catch (error) {
    return mappedError(error);
  }
}
