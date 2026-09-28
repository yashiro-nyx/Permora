export type NotificationType =
  | "request_approved_pending_activation"
  | "request_denied"
  | "request_returned_for_revision";

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
