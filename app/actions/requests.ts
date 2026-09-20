"use server";

import { revalidatePath } from "next/cache";
import { requireRequester } from "@/lib/server/identity";
import {
  createAccessRequest,
  RequestPolicyError,
} from "@/lib/server/request-service";
import { extractRequestInput } from "@/lib/request-input";

export interface SubmitRequestState {
  ok: boolean;
  requestId?: string;
  displayId?: string;
  message?: string;
  field?: string;
}

export async function submitRequestAction(
  _previous: SubmitRequestState,
  formData: FormData,
): Promise<SubmitRequestState> {
  const identity = await requireRequester();
  const input = extractRequestInput(formData.entries());
  try {
    const request = await createAccessRequest(identity, input);
    revalidatePath("/dashboard");
    revalidatePath("/requests");
    return { ok: true, requestId: request.id, displayId: request.displayId };
  } catch (error) {
    if (error instanceof RequestPolicyError)
      return { ok: false, message: error.message, field: error.field };
    console.error("Request submission failed", {
      error: error instanceof Error ? error.name : "UnknownError",
    });
    return {
      ok: false,
      message:
        "The request could not be saved. No request was created. Try again or contact support.",
      field: "form",
    };
  }
}
