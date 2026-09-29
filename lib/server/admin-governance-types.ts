export interface CatalogResourceDto {
  id: string;
  name: string;
  description: string;
  sensitivity: "Low" | "Medium" | "High";
  available: boolean;
  permissions: Array<{
    id: string;
    label: string;
    enabled: boolean;
    requesterRoles: Array<"student" | "faculty">;
  }>;
  scopeFields: Array<{
    fieldName: string;
    label: string;
    required: boolean;
  }>;
  scopeOptions: Array<{
    id: string;
    fieldName: string;
    institutionalCode: string;
    displayName: string;
    active: boolean;
  }>;
  currentPolicy: null | {
    id: string;
    version: number;
    effectiveFrom: string;
    effectiveUntil: string | null;
    defaultDays: number;
    maxDays: number;
    renewable: boolean;
    policyNote: string;
    provisional: true;
  };
}

export interface ApproverResponsibilityDto {
  id: string;
  approver: { id: string; name: string; active: boolean };
  resource: { id: string; name: string };
  permission: null | { id: string; label: string };
  scopes: Array<{ id: string; label: string; fieldName: string }>;
  validFrom: string;
  validUntil: string | null;
  active: boolean;
}

export interface DelegationDto {
  id: string;
  delegator: { id: string; name: string };
  substitute: { id: string; name: string };
  validFrom: string;
  validUntil: string;
  active: boolean;
  cancelledAt: string | null;
}

export interface AnalyticsSummaryDto {
  generatedAt: string;
  filters: {
    from?: string;
    to?: string;
    resource?: string;
    status?: string;
  };
  users: {
    total: number;
    active: number;
    inactive: number;
  };
  requests: {
    total: number;
    byStatus: Record<string, number>;
    pendingReview: number;
    pendingRouting: number;
    approvedPendingActivation: number;
    awaitingActivation: number;
  };
  entitlements: {
    active: number;
    expired: number;
    revoked: number;
  };
  activation: {
    activated: number;
    failed: number;
    activating: number;
  };
  approvalTurnaroundHours: number | null;
  approverWorkload: Array<{ approverName: string; openAssignments: number }>;
}

export interface NotificationPreferenceDto {
  inAppEnabled: boolean;
  externalEmailEnabled: boolean;
  externalSmsEnabled: boolean;
  externalPushEnabled: boolean;
  externalDeliveryConfigured: false;
  updatedAt: string;
}

export interface RetentionPolicyDto {
  recordClass: string;
  label: string;
  retentionDays: number | null;
  provisional: boolean;
  immutable: boolean;
  updatedAt: string;
}

export interface RetentionDryRunDto {
  recordClass: string;
  eligibleCount: number;
  immutable: boolean;
  applied: boolean;
  message: string;
}

export interface InstitutionalIdentifierDto {
  id: string;
  identifierType: "student_number" | "staff_number";
  issuer: string;
  identifier: string;
}

export interface EligibleApproverDto {
  responsibilityId: string;
  approverUserId: string;
  approverName: string;
  viaDelegation: boolean;
  delegatorName: string | null;
}

export interface UnassignedAssignmentResultDto {
  assignmentId: string;
  approverUserId: string;
  responsibilityId: string;
  version: number;
}
