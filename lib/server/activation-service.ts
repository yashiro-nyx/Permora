import "server-only";
import {
  invokeActivationAdapter,
  ManualAdminActivationAdapter,
  type ManualActivationContext,
} from "../activation-adapter";
import {
  prepareApprovedActivation,
  recordActivationOutcome,
} from "../activation-lifecycle";
import { revokeActivatedEntitlement } from "../activation-maintenance";
import type { StartActivationInput } from "../activation-domain";
import { requireAdmin } from "./identity";
import { transaction } from "./db";

export {
  ActivationDomainError,
  type ActivationStartResult,
  type StartActivationInput,
} from "../activation-domain";
export type {
  ActivationCompletionResult,
  PreparedActivationAttempt,
} from "../activation-lifecycle";

export type ActivateApprovedRequestInput = StartActivationInput & {
  operatorConfirmation: ManualActivationContext["operatorConfirmation"];
};

const manualAdminAdapter = new ManualAdminActivationAdapter();

export async function activateApprovedRequest(
  input: ActivateApprovedRequestInput,
) {
  const identity = await requireAdmin();
  const prepared = await transaction((client) =>
    prepareApprovedActivation(client, identity.id, input),
  );
  if (prepared.result.replayed || !prepared.adapterContext)
    return prepared.result;

  const adapterOutcome = await invokeActivationAdapter(manualAdminAdapter, {
    ...prepared.adapterContext,
    operatorConfirmation: input.operatorConfirmation,
  });

  return transaction((client) =>
    recordActivationOutcome(
      client,
      identity.id,
      prepared.result.activationId,
      input.idempotencyKey,
      adapterOutcome,
    ),
  );
}

export async function revokeActivatedRequest(
  activationId: string,
  reason: string,
) {
  const identity = await requireAdmin();
  return transaction((client) =>
    revokeActivatedEntitlement(client, identity.id, activationId, reason),
  );
}
