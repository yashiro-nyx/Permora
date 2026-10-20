import type { NotificationType } from "./server/operations-types";

export type ActivationLifecycleStatus =
  | "activating"
  | "activated"
  | "failed"
  | "expired"
  | "revoked";

export type ActivationStatusSummary = {
  label: string;
  description: string;
  tone: "info" | "success" | "warning" | "danger" | "neutral";
  canStart: boolean;
  actionLabel: "Start activation" | "Retry activation" | null;
};

export function activationStatusSummary(
  approvalStatus: string,
  lifecycleStatus: ActivationLifecycleStatus | null,
  retryable: boolean | null = null,
  startsAtFuture = false,
): ActivationStatusSummary {
  if (approvalStatus !== "approved_pending_activation") {
    const pending = approvalStatus === "pending_review";
    return {
      label:
        approvalStatus === "pending_routing"
          ? "Awaiting routing"
          : pending
            ? "Pending review"
            : approvalStatus === "denied"
              ? "Denied"
              : approvalStatus === "returned_for_revision"
                ? "Returned for revision"
                : approvalStatus === "expired"
                  ? "Expired"
                  : approvalStatus === "cancelled"
                    ? "Cancelled"
                    : "Not approved for activation",
      description: pending
        ? "An eligible approver has not recorded a decision yet."
        : approvalStatus === "pending_routing"
          ? "An eligible approver has not been assigned yet."
          : "This request is not eligible for activation.",
      tone: pending || approvalStatus === "pending_routing" ? "warning" : "neutral",
      canStart: false,
      actionLabel: null,
    };
  }
  if (!lifecycleStatus)
    return {
      label: "Approved — awaiting provisioning",
      description: startsAtFuture
        ? "Approval is recorded, but provisioning must be confirmed before the future validity period can begin."
        : "Approval is recorded, but provisioning has not been confirmed yet.",
      tone: "warning",
      canStart: true,
      actionLabel: "Start activation",
    };
  switch (lifecycleStatus) {
    case "activating":
      return {
        label: "Activation in progress",
        description: "An administrator is processing this activation.",
        tone: "info",
        canStart: false,
        actionLabel: null,
      };
    case "activated":
      if (startsAtFuture)
        return {
          label: "Provisioned — scheduled start",
          description:
            "Provisioning is confirmed; access becomes usable when the requested validity period starts.",
          tone: "info",
          canStart: false,
          actionLabel: null,
        };
      return {
        label: "Active",
        description: "Access has been activated for the approved validity period.",
        tone: "success",
        canStart: false,
        actionLabel: null,
      };
    case "failed":
      return {
        label: "Activation failed",
        description: retryable
          ? "The activation may be retried by an administrator."
          : "Current eligibility or policy requirements prevent another activation attempt.",
        tone: "danger",
        canStart: retryable === true,
        actionLabel: retryable === true ? "Retry activation" : null,
      };
    case "expired":
      return {
        label: "Expired",
        description: "The approved access validity period has ended.",
        tone: "neutral",
        canStart: false,
        actionLabel: null,
      };
    case "revoked":
      return {
        label: "Revoked",
        description: "Access was revoked by an administrator.",
        tone: "danger",
        canStart: false,
        actionLabel: null,
      };
  }
}

export function notificationPresentation(type: NotificationType) {
  switch (type) {
    case "request_approved_pending_activation":
      return { icon: "check", tone: "success", label: "Approval" } as const;
    case "activation_succeeded":
      return { icon: "check", tone: "success", label: "Activation succeeded" } as const;
    case "activation_succeeded_for_approver":
      return { icon: "check", tone: "success", label: "Access provisioned" } as const;
    case "activation_failed":
      return { icon: "bell", tone: "danger", label: "Activation failed" } as const;
    case "request_denied":
      return { icon: "bell", tone: "warning", label: "Request denied" } as const;
    case "request_returned_for_revision":
      return { icon: "bell", tone: "warning", label: "Revision requested" } as const;
    case "request_assigned_for_review":
      return { icon: "requests", tone: "info", label: "New assignment" } as const;
    case "routing_unavailable":
      return { icon: "expire", tone: "warning", label: "Routing failed" } as const;
    case "activation_ready":
      return { icon: "check", tone: "info", label: "Activation ready" } as const;
  }
}
