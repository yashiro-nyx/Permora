export type NotificationType =
  | "request_approved_pending_activation"
  | "request_denied"
  | "request_returned_for_revision"
  | "activation_succeeded"
  | "activation_failed"
  | "request_assigned_for_review"
  | "routing_unavailable"
  | "activation_ready"
  | "activation_succeeded_for_approver";

export interface RequesterNotificationDto {
  notificationId: string;
  type: NotificationType;
  title: string;
  message: string;
  createdAt: string;
  readAt: string | null;
  request: null | {
    requestId: string;
    displayId: string;
  };
}

export interface NotificationFilters {
  unreadOnly: boolean;
  page: number;
  pageSize: number;
}

export interface NotificationListDto {
  items: RequesterNotificationDto[];
  unreadTotal: number;
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    pageCount: number;
  };
}

export interface AuditFilters {
  search?: string;
  eventType?: string;
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
}

export interface AuditEntryDto {
  eventId: string;
  occurredAt: string;
  eventType: string;
  actor: {
    name: string;
  };
  target: null | {
    displayId: string;
    resourceName: string;
  };
  summary: string;
}

export interface AuditListDto {
  items: AuditEntryDto[];
  eventTypes: string[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    pageCount: number;
  };
}

/**
 * Staff notification DTO for approvers and administrators.  Shares the same
 * underlying user_notification table but is queried through a separate service
 * and API that enforce approver/admin role authorization instead of requester
 * role.  The `reviewHref` provides a deep link to the relevant review or
 * admin page; it is null for events that have no actionable destination.
 */
export interface StaffNotificationDto {
  notificationId: string;
  type: NotificationType;
  title: string;
  message: string;
  createdAt: string;
  readAt: string | null;
  request: null | {
    requestId: string;
    displayId: string;
  };
  /** Deep link to the actionable page (e.g. /review/{id}) or null. */
  reviewHref: string | null;
}

export interface StaffNotificationListDto {
  items: StaffNotificationDto[];
  unreadTotal: number;
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    pageCount: number;
  };
}
