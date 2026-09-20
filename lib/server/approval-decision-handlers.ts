import "server-only";
import type { TrustedIdentity } from "@/lib/auth-types";
import {
  ApprovalDomainError,
  type ApprovalDecision,
} from "@/lib/approval-domain";
import { appUrl } from "./config";
import { decideAssignedRequest } from "./approval-service";
import {
  getTrustedIdentityFromHeaders,
  hasActiveApprovalResponsibility,
} from "./identity-data";

type DecisionResult = Awaited<ReturnType<typeof decideAssignedRequest>>;

export interface ApprovalDecisionDependencies {
  getIdentity: (headers: Headers) => Promise<TrustedIdentity | null>;
  hasResponsibility: (userId: string) => Promise<boolean>;
  decide: (
    actorUserId: string,
    input: {
      requestId: string;
      expectedVersion: number;
      decision: ApprovalDecision;
      reason?: string;
      idempotencyKey: string;
    },
  ) => Promise<DecisionResult>;
}

const defaults: ApprovalDecisionDependencies = {
  getIdentity: getTrustedIdentityFromHeaders,
  hasResponsibility: hasActiveApprovalResponsibility,
  decide: decideAssignedRequest,
};

const responseHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Vary: "Cookie, Origin",
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const decisions = new Set<ApprovalDecision>([
  "approve",
  "deny",
  "return_for_revision",
]);

class DecisionInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecisionInputError";
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

function parseInput(
  requestId: string,
  idempotencyKey: string | null,
  body: unknown,
) {
  if (!UUID.test(requestId))
    throw new ApprovalDomainError(
      "The assigned request is not available.",
      "not_assigned",
    );
  if (!idempotencyKey || !UUID.test(idempotencyKey))
    throw new DecisionInputError("A valid Idempotency-Key header is required.");
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new DecisionInputError("A JSON decision object is required.");
  const value = body as Record<string, unknown>;
  if (
    typeof value.expectedVersion !== "number" ||
    !Number.isSafeInteger(value.expectedVersion) ||
    value.expectedVersion < 1
  )
    throw new DecisionInputError("expectedVersion must be a positive integer.");
  if (
    typeof value.decision !== "string" ||
    !decisions.has(value.decision as ApprovalDecision)
  )
    throw new DecisionInputError("The decision is invalid.");
  if (value.reason !== undefined && typeof value.reason !== "string")
    throw new DecisionInputError("The reason must be text.");
  return {
    requestId,
    expectedVersion: value.expectedVersion,
    decision: value.decision as ApprovalDecision,
    reason: value.reason as string | undefined,
    idempotencyKey,
  };
}

function mappedDomainError(domainError: ApprovalDomainError) {
  switch (domainError.code) {
    case "not_assigned":
      return error(404, "not_found", "The assigned request was not found.");
    case "invalid_reason":
      return error(400, "invalid_decision", domainError.message);
    case "stale_decision":
      return error(
        409,
        "stale_decision",
        "This request changed after it was loaded. Reload it before deciding.",
      );
    case "invalid_transition":
      return error(
        409,
        "invalid_transition",
        "This request is no longer awaiting a decision.",
      );
    case "idempotency_conflict":
      return error(
        409,
        "idempotency_conflict",
        "This idempotency key was already used for another decision.",
      );
    case "approval_revalidation_failed":
      return error(409, "approval_revalidation_failed", domainError.message);
  }
}

export async function handleApprovalDecisionRequest(
  request: Request,
  requestId: string,
  dependencies: Partial<ApprovalDecisionDependencies> = {},
) {
  const deps = { ...defaults, ...dependencies };
  try {
    if (!hasTrustedOrigin(request))
      return error(403, "forbidden", "The request origin is not allowed.");
    const identity = await deps.getIdentity(request.headers);
    if (!identity)
      return error(401, "unauthenticated", "Authentication is required.");
    if (
      (!identity.roles.includes("approver") &&
        !identity.roles.includes("admin")) ||
      !(await deps.hasResponsibility(identity.id))
    )
      return error(
        403,
        "forbidden",
        "Approval access is not available for this account.",
      );
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      return error(415, "invalid_content_type", "A JSON request is required.");
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return error(400, "invalid_input", "The JSON request is invalid.");
    }
    const input = parseInput(
      requestId,
      request.headers.get("idempotency-key"),
      body,
    );
    return json(await deps.decide(identity.id, input));
  } catch (caught) {
    if (caught instanceof ApprovalDomainError) return mappedDomainError(caught);
    if (caught instanceof DecisionInputError)
      return error(400, "invalid_input", caught.message);
    console.error("Approval decision failed", {
      error: caught instanceof Error ? caught.name : "UnknownError",
    });
    return error(
      503,
      "service_unavailable",
      "The decision service is temporarily unavailable.",
    );
  }
}
