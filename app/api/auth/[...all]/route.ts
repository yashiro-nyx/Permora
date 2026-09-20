import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/server/auth";
import { backendConfigurationErrors } from "@/lib/server/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handler = toNextJsHandler(auth);

function unavailable() {
  return Response.json(
    { error: "Authentication service is not configured." },
    { status: 503 },
  );
}

function unavailableAccountFlow(request: Request) {
  const path = new URL(request.url).pathname;
  return (
    path.includes("/sign-up/") ||
    path.includes("/request-password-reset") ||
    path.includes("/reset-password")
  );
}

function accountFlowUnavailable() {
  return Response.json(
    { error: "This account flow is not available." },
    { status: 404 },
  );
}

export function GET(request: Request) {
  if (unavailableAccountFlow(request)) return accountFlowUnavailable();
  return backendConfigurationErrors().length
    ? unavailable()
    : handler.GET(request);
}

export function POST(request: Request) {
  if (unavailableAccountFlow(request)) return accountFlowUnavailable();
  return backendConfigurationErrors().length
    ? unavailable()
    : handler.POST(request);
}
