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
): ActivationStatusSummary {
  if (approvalStatus !== "approved_pending_activation")
    return {
      label: "Not approved for activation",
      description: "Only an approved request can be activated.",
      tone: "neutral",
      canStart: false,
      actionLabel: null,
    };
  if (!lifecycleStatus)
    return {
      label: "Awaiting activation",
      description: "Approved, but access is not active yet.",
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
    case "activation_failed":
      return { icon: "bell", tone: "danger", label: "Activation failed" } as const;
    case "request_denied":
      return { icon: "bell", tone: "warning", label: "Request denied" } as const;
    case "request_returned_for_revision":
      return { icon: "bell", tone: "warning", label: "Revision requested" } as const;
  }
}
