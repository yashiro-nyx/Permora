export type RequestStatus =
  | "pending_routing"
  | "pending_review"
  | "approved_pending_activation"
  | "denied"
  | "returned_for_revision"
  | "expired"
  | "cancelled";

export interface ScopeOptionDto {
  id: string;
  fieldName: string;
  label: string;
  code: string;
  displayName: string;
}

export interface RequestPermissionDto {
  id: string;
  label: string;
  description: string;
}

export interface RequestableResourceDto {
  id: string;
  name: string;
  description: string;
  owner: string;
  sensitivity: "Low" | "Medium" | "High";
  icon: string;
  defaultDays: number;
  maxDays: number;
  renewable: boolean;
  permissions: RequestPermissionDto[];
  scopeFields: {
    fieldName: string;
    label: string;
    options: ScopeOptionDto[];
  }[];
  fixedOwnAccount: boolean;
  blockedReasons: string[];
}

export interface RequestEventDto {
  id: string;
  type:
    | "submitted"
    | "renewal_submitted"
    | "request_routed"
    | "request_routing_unavailable"
    | "review_approved"
    | "review_denied"
    | "review_returned_for_revision"
    | "activation_succeeded"
    | "activation_failed";
  at: string;
  actorName: string;
  detail: string;
}

export interface AccessRequestDto {
  id: string;
  displayId: string;
  resourceId: string;
  resourceName: string;
  resourceIcon: string;
  sensitivity: "Low" | "Medium" | "High";
  permissionId: string;
  permissionLabel: string;
  purpose: string;
  startsAt: string;
  expiresAt: string;
  submittedAt: string;
  status: RequestStatus;
  activation: null | {
    status: "activating" | "activated" | "failed" | "expired" | "revoked";
    startedAt: string;
    activatedAt: string | null;
    expiresAt: string;
    retryable: boolean | null;
  };
  renewable: boolean;
  renewalOf: string | null;
  scopes: {
    fieldName: string;
    label: string;
    value: string;
    optionId: string;
  }[];
  events: RequestEventDto[];
}

export interface RequestCountsDto {
  total: number;
  pending: number;
  denied: number;
  expired: number;
  approved: number;
  active: number;
}
