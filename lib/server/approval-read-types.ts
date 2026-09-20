export type ReviewQueueStatus =
  | "pending_review"
  | "approved_pending_activation"
  | "denied"
  | "returned_for_revision"
  | "expired"
  | "cancelled";

export interface ReviewQueueItemDto {
  requestId: string;
  displayId: string;
  requester: {
    name: string;
    requesterRole: "student" | "faculty";
  };
  resource: {
    id: string;
    name: string;
  };
  permission: {
    id: string;
    label: string;
  };
  requestedValidity: {
    startsAt: string;
    expiresAt: string;
  };
  submittedAt: string;
  assignedAt: string;
  status: ReviewQueueStatus;
  version: number;
}

export interface UnassignedRequestDto {
  requestId: string;
  displayId: string;
  requester: {
    name: string;
    requesterRole: "student" | "faculty";
  };
  resource: {
    id: string;
    name: string;
  };
  permission: {
    id: string;
    label: string;
  };
  submittedAt: string;
  status: "pending_routing";
  version: number;
}

export interface ReviewTimelineEventDto {
  type: string;
  at: string;
  actorName: string;
  detail: string;
}

export interface ReviewRequestDetailDto {
  requestId: string;
  displayId: string;
  requester: {
    name: string;
    email: string;
    department: string;
    requesterRole: "student" | "faculty";
  };
  resource: {
    id: string;
    name: string;
    sensitivity: "Low" | "Medium" | "High";
  };
  permission: {
    id: string;
    label: string;
  };
  scopes: Array<{
    fieldName: string;
    label: string;
    value: string;
  }>;
  purpose: string;
  requestedValidity: {
    startsAt: string;
    expiresAt: string;
  };
  submittedAt: string;
  assignment: {
    assignedAt: string;
  };
  status: ReviewQueueStatus;
  version: number;
  timeline: ReviewTimelineEventDto[];
  decision: null | {
    action: "approve" | "deny" | "return_for_revision";
    reason: string | null;
    decidedAt: string;
  };
}

export interface ApprovalListFilters {
  status?: ReviewQueueStatus | "pending_routing";
  resource?: string;
  from?: string;
  to?: string;
  search?: string;
  page: number;
  pageSize: number;
}

export interface PaginatedDto<T> {
  items: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    pageCount: number;
  };
}
