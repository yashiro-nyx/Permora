export type ActivationAdapterContext = {
  activationId: string;
  requestId: string;
  actorUserId: string;
  resourceId: string;
  permissionId: string;
  scopeFingerprint: string;
  startsAt: string;
  expiresAt: string;
};

export type ActivationAdapterResult =
  | {
      outcome: "success";
      externalReference: string | null;
      evidence: string | null;
    }
  | {
      outcome: "failure";
      failureCode:
        | "manual_provisioning_not_confirmed"
        | "manual_confirmation_evidence_required";
      message: string;
      retryable: boolean;
    };

export interface ActivationAdapter<
  TContext extends ActivationAdapterContext = ActivationAdapterContext,
> {
  readonly name: string;
  activate(context: TContext): Promise<ActivationAdapterResult>;
}

export type ManualActivationContext = ActivationAdapterContext & {
  operatorConfirmation: {
    provisioned: boolean;
    externalReference?: string | null;
    evidence?: string | null;
  };
};

const normalizeEvidence = (value: string | null | undefined, maximum: number) => {
  const normalized = value?.trim() ?? "";
  return normalized ? normalized.slice(0, maximum) : null;
};

export class ManualAdminActivationAdapter
  implements ActivationAdapter<ManualActivationContext>
{
  readonly name = "manual-admin";

  async activate(
    context: ManualActivationContext,
  ): Promise<ActivationAdapterResult> {
    const externalReference = normalizeEvidence(
      context.operatorConfirmation.externalReference,
      500,
    );
    const evidence = normalizeEvidence(context.operatorConfirmation.evidence, 2000);

    if (!context.operatorConfirmation.provisioned) {
      return {
        outcome: "failure",
        failureCode: "manual_provisioning_not_confirmed",
        message: "The administrator did not confirm that access was provisioned.",
        retryable: true,
      };
    }

    if (!externalReference && !evidence) {
      return {
        outcome: "failure",
        failureCode: "manual_confirmation_evidence_required",
        message:
          "Provide an external reference or human-readable evidence for the provisioning confirmation.",
        retryable: true,
      };
    }

    return {
      outcome: "success",
      externalReference,
      evidence,
    };
  }
}

export function invokeActivationAdapter<
  TContext extends ActivationAdapterContext,
>(adapter: ActivationAdapter<TContext>, context: TContext) {
  return adapter.activate(context);
}
