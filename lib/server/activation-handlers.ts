import "server-only";
import type { TrustedIdentity } from "@/lib/auth-types";
import { ActivationDomainError } from "../activation-domain";
import type { ActivateApprovedRequestInput } from "./activation-service";
import { appUrl } from "./config";
import { getTrustedIdentityFromHeaders } from "./identity-data";

export interface ActivationHandlerDependencies {
  getIdentity: (headers: Headers) => Promise<TrustedIdentity | null>;
  activate: (input: ActivateApprovedRequestInput) => Promise<unknown>;
}

const defaults: ActivationHandlerDependencies = {
  getIdentity: getTrustedIdentityFromHeaders,
  activate: (input) =>
    import("./activation-service").then(({ activateApprovedRequest }) =>
      activateApprovedRequest(input),
    ),
};

const responseHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Vary: "Cookie, Origin",
};
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function domainError(error: ActivationDomainError) {
  switch (error.code) {
    case "not_authorized":
    case "activation_forbidden":
      return json({ error: { code: error.code, message: error.message } }, 403);
    case "request_unavailable":
      return json(
        { error: { code: "not_found", message: "The approved request was not found." } },
        404,
      );
    case "invalid_outcome":
      return json({ error: { code: error.code, message: error.message } }, 400);
    case "invalid_transition":
    case "activation_in_progress":
    case "idempotency_conflict":
    case "activation_revalidation_failed":
    case "activation_conflict":
    case "activation_attempt_not_current":
      return json({ error: { code: error.code, message: error.message } }, 409);
  }
}

function parseInput(requestId: string, key: string | null, body: unknown) {
  if (!UUID.test(requestId)) throw new Error("The request identifier is invalid.");
  if (!key || !UUID.test(key))
    throw new Error("A valid Idempotency-Key header is required.");
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new Error("A JSON activation object is required.");
  const value = body as Record<string, unknown>;
  const confirmation = value.operatorConfirmation;
  if (!confirmation || typeof confirmation !== "object" || Array.isArray(confirmation))
    throw new Error("An explicit administrator confirmation is required.");
  const input = confirmation as Record<string, unknown>;
  if (typeof input.provisioned !== "boolean")
    throw new Error("The provisioning confirmation must be boolean.");
  if (
    input.externalReference !== undefined &&
    input.externalReference !== null &&
    typeof input.externalReference !== "string"
  )
    throw new Error("The external reference must be text.");
  if (input.evidence !== undefined && input.evidence !== null && typeof input.evidence !== "string")
    throw new Error("The provisioning evidence must be text.");
  return {
    requestId,
    idempotencyKey: key,
    operatorConfirmation: {
      provisioned: input.provisioned,
      externalReference: input.externalReference as string | null | undefined,
      evidence: input.evidence as string | null | undefined,
    },
  } satisfies ActivateApprovedRequestInput;
}

export async function handleActivationStartRequest(
  request: Request,
  requestId: string,
  dependencies: Partial<ActivationHandlerDependencies> = {},
) {
  const deps = { ...defaults, ...dependencies };
  if (!hasTrustedOrigin(request))
    return json(
      { error: { code: "forbidden", message: "The request origin is not allowed." } },
      403,
    );
  let identity: TrustedIdentity | null;
  try {
    identity = await deps.getIdentity(request.headers);
  } catch (caught) {
    console.error("Activation identity lookup failed", {
      error: caught instanceof Error ? caught.name : "UnknownError",
    });
    return json(
      {
        error: {
          code: "service_unavailable",
          message: "The activation service is temporarily unavailable.",
        },
      },
      503,
    );
  }
  if (!identity)
    return json(
      { error: { code: "unauthenticated", message: "Authentication is required." } },
      401,
    );
  if (!identity.roles.includes("admin"))
    return json(
      { error: { code: "forbidden", message: "Administrator access is required." } },
      403,
    );
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return json(
      { error: { code: "invalid_content_type", message: "A JSON request is required." } },
      415,
    );

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(
      { error: { code: "invalid_input", message: "The JSON request is invalid." } },
      400,
    );
  }
  let input: ActivateApprovedRequestInput;
  try {
    input = parseInput(requestId, request.headers.get("idempotency-key"), body);
  } catch (error) {
    return json(
      {
        error: {
          code: "invalid_input",
          message: error instanceof Error ? error.message : "The activation input is invalid.",
        },
      },
      400,
    );
  }

  try {
    return json(await deps.activate(input));
  } catch (caught) {
    if (caught instanceof ActivationDomainError) return domainError(caught);
    console.error("Activation request failed", {
      error: caught instanceof Error ? caught.name : "UnknownError",
    });
    return json(
      {
        error: {
          code: "service_unavailable",
          message: "The activation service is temporarily unavailable.",
        },
      },
      503,
    );
  }
}
