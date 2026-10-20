"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireRequester } from "@/lib/server/identity";
import {
  createAccessRequest,
  RequestPolicyError,
} from "@/lib/server/request-service";
import { extractRequestInput } from "@/lib/request-input";

export interface SubmitRequestState {
  ok: boolean;
  attemptId?: string;
  requestId?: string;
  displayId?: string;
  message?: string;
  field?: string;
}

function requestFailureDiagnostics(error: unknown) {
  const value = error as {
    name?: unknown;
    code?: unknown;
    constraint?: unknown;
  } | null;
  const postgresCode =
    typeof value?.code === "string" && /^[0-9A-Z]{5}$/.test(value.code)
      ? value.code
      : undefined;
  const constraint =
    typeof value?.constraint === "string" &&
    /^[a-zA-Z0-9_]+$/.test(value.constraint)
      ? value.constraint
      : undefined;
  return {
    stage: "create_access_request_transaction",
    errorType:
      error instanceof Error && error.constructor.name
        ? error.constructor.name
        : typeof value?.name === "string"
          ? value.name
          : "UnknownError",
    postgresCode,
    constraint,
    classification:
      postgresCode === "23505"
        ? "database_constraint_violation"
        : "unexpected_request_submission_failure",
  };
}

export async function submitRequestAction(
  _previous: SubmitRequestState,
  formData: FormData,
): Promise<SubmitRequestState> {
  const attemptId = randomUUID();
  const identity = await requireRequester();
  const input = extractRequestInput(formData.entries());
  try {
    const request = await createAccessRequest(identity, input);
    revalidatePath("/dashboard");
    revalidatePath("/requests");
    return {
      ok: true,
      requestId: request.id,
      displayId: request.displayId,
      attemptId,
    };
  } catch (error) {
    if (error instanceof RequestPolicyError)
      return {
        ok: false,
        message: error.message,
        field: error.field,
        attemptId,
      };
    console.error("Request submission failed", requestFailureDiagnostics(error));
    return {
      ok: false,
      message:
        "The request could not be saved. No request was created. Try again or contact support.",
      field: "form",
      attemptId,
    };
  }
}
