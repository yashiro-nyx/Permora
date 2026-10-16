import "server-only";
import { authorizeScheduledRequest } from "@/lib/scheduler-auth";
import { runActivationExpiration } from "./scheduled-maintenance";

const responseHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
};

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: responseHeaders });
}

export interface MaintenanceHandlerDependencies {
  runExpiration: typeof runActivationExpiration;
  secret: () => string | undefined;
}

const defaults: MaintenanceHandlerDependencies = {
  runExpiration: runActivationExpiration,
  secret: () => process.env.MAINTENANCE_SCHEDULER_SECRET,
};

/**
 * Protected scheduled-maintenance entrypoint for automatic access expiration.
 * Authorized by a shared bearer secret (disabled when unset); invokes the
 * existing idempotent expiry service and returns a sanitized summary.
 */
export async function handleScheduledExpiration(
  request: Request,
  overrides: Partial<MaintenanceHandlerDependencies> = {},
) {
  const deps = { ...defaults, ...overrides };
  const auth = authorizeScheduledRequest(
    request.headers.get("authorization"),
    deps.secret(),
  );
  if (!auth.ok) {
    const message =
      auth.code === "scheduler_disabled"
        ? "Scheduled maintenance is not enabled in this environment."
        : "A valid scheduler credential is required.";
    return json({ error: { code: auth.code, message } }, auth.status);
  }

  try {
    const summary = await deps.runExpiration();
    return json({
      operation: "expire-activations",
      examined: summary.examined,
      expired: summary.expired,
      ranAt: new Date().toISOString(),
    });
  } catch (caught) {
    console.error("Scheduled activation expiration failed", {
      error: caught instanceof Error ? caught.name : "UnknownError",
    });
    return json(
      {
        error: {
          code: "service_unavailable",
          message: "Scheduled expiration could not complete.",
        },
      },
      503,
    );
  }
}
