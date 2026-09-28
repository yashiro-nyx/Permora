import "server-only";
import type { QueryResultRow } from "pg";
import {
  auditEventSummary,
  isSafeAuditEventType,
} from "@/lib/operations";
import { query } from "./db";
import type {
  AuditEntryDto,
  AuditFilters,
  AuditListDto,
  NotificationFilters,
  NotificationListDto,
  NotificationType,
  RequesterNotificationDto,
} from "./operations-types";

export {
  OperationsQueryError,
  parseAuditFilters,
  parseNotificationFilters,
} from "@/lib/operations";

type NotificationRow = QueryResultRow & {
  id: string;
  notification_type: NotificationType;
  title: string;
  body: string;
  created_at: Date | string;
  read_at: Date | string | null;
  request_id: string | null;
  display_id: string | null;
  total_count: number;
  unread_total: number;
};

const iso = (value: Date | string) => new Date(value).toISOString();

export async function listRequesterNotifications(
  userId: string,
  filters: NotificationFilters,
): Promise<NotificationListDto> {
  const values: unknown[] = [userId];
  const where = ["notification.recipient_user_id = $1"];
  if (filters.unreadOnly) where.push("notification.read_at IS NULL");
  values.push(filters.pageSize, (filters.page - 1) * filters.pageSize);
  const limit = `$${values.length - 1}`;
  const offset = `$${values.length}`;
  const result = await query<NotificationRow>(
    `SELECT notification.id, notification.notification_type,
            notification.title, notification.body, notification.created_at,
            notification.read_at, owned_request.id AS request_id,
            owned_request.display_id,
            count(*) OVER()::int AS total_count,
            (SELECT count(*)::int FROM user_notification unread
              WHERE unread.recipient_user_id = $1 AND unread.read_at IS NULL)
              AS unread_total
       FROM user_notification notification
       LEFT JOIN access_request owned_request
         ON owned_request.id = notification.request_id
        AND owned_request.requester_user_id = notification.recipient_user_id
      WHERE ${where.join(" AND ")}
      ORDER BY notification.created_at DESC, notification.id DESC
      LIMIT ${limit} OFFSET ${offset}`,
    values,
  );
  const total = Number(result.rows[0]?.total_count ?? 0);
  const items: RequesterNotificationDto[] = result.rows.map((row) => ({
    notificationId: row.id,
    type: row.notification_type,
    title: row.title,
    message: row.body,
    createdAt: iso(row.created_at),
    readAt: row.read_at ? iso(row.read_at) : null,
    request:
      row.request_id && row.display_id
        ? { requestId: row.request_id, displayId: row.display_id }
        : null,
  }));
  return {
    items,
    unreadTotal: Number(result.rows[0]?.unread_total ?? 0),
    pagination: {
      page: filters.page,
      pageSize: filters.pageSize,
      total,
      pageCount: Math.ceil(total / filters.pageSize),
    },
  };
}

export async function markRequesterNotificationRead(userId: string, id: string) {
  const result = await query<{ id: string }>(
    `UPDATE user_notification
        SET read_at = coalesce(read_at, now())
      WHERE id = $1 AND recipient_user_id = $2
      RETURNING id`,
    [id, userId],
  );
  return Boolean(result.rows[0]);
}

export async function markAllRequesterNotificationsRead(userId: string) {
  const result = await query(
    `UPDATE user_notification SET read_at = now()
      WHERE recipient_user_id = $1 AND read_at IS NULL`,
    [userId],
  );
  return result.rowCount ?? 0;
}

type AuditRow = QueryResultRow & {
  id: string;
  event_type: string;
  occurred_at: Date | string;
  actor_name: string | null;
  subject_name: string | null;
  display_id: string | null;
  resource_name: string | null;
  total_count: number;
};

export async function listAdministratorAuditEvents(
  filters: AuditFilters,
): Promise<AuditListDto> {
  const values: unknown[] = [];
  const where: string[] = [];
  const add = (condition: string, value: unknown) => {
    values.push(value);
    where.push(condition.replaceAll("?", `$${values.length}`));
  };
  if (filters.eventType) add("event.event_type = ?", filters.eventType);
  if (filters.from) add("event.occurred_at >= ?::date", filters.from);
  if (filters.to)
    add("event.occurred_at < (?::date + interval '1 day')", filters.to);
  if (filters.search) {
    values.push(filters.search);
    const parameter = `$${values.length}`;
    where.push(`(event.event_type ILIKE '%' || ${parameter} || '%'
      OR actor.name ILIKE '%' || ${parameter} || '%'
      OR subject.name ILIKE '%' || ${parameter} || '%'
      OR request.display_id ILIKE '%' || ${parameter} || '%'
      OR resource.name ILIKE '%' || ${parameter} || '%')`);
  }
  values.push(filters.pageSize, (filters.page - 1) * filters.pageSize);
  const limit = `$${values.length - 1}`;
  const offset = `$${values.length}`;
  const [events, types] = await Promise.all([
    query<AuditRow>(
      `SELECT event.id, event.event_type, event.occurred_at,
              actor.name AS actor_name, subject.name AS subject_name,
              request.display_id, resource.name AS resource_name,
              count(*) OVER()::int AS total_count
         FROM audit_event event
         LEFT JOIN "user" actor ON actor.id = event.actor_user_id
         LEFT JOIN "user" subject ON subject.id = event.subject_user_id
         LEFT JOIN access_request request ON request.id = event.request_id
         LEFT JOIN catalog_resource resource ON resource.id = request.resource_id
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY event.occurred_at DESC, event.id DESC
        LIMIT ${limit} OFFSET ${offset}`,
      values,
    ),
    query<{ event_type: string }>(
      "SELECT DISTINCT event_type FROM audit_event ORDER BY event_type",
    ),
  ]);
  const total = Number(events.rows[0]?.total_count ?? 0);
  const items: AuditEntryDto[] = events.rows.map((row) => ({
    eventId: row.id,
    occurredAt: iso(row.occurred_at),
    eventType: row.event_type,
    actor: { name: row.actor_name ?? "System" },
    target:
      row.display_id && row.resource_name
        ? { displayId: row.display_id, resourceName: row.resource_name }
        : null,
    summary: auditEventSummary({
      eventType: row.event_type,
      actorName: row.actor_name,
      subjectName: row.subject_name,
      displayId: row.display_id,
    }),
  }));
  return {
    items,
    eventTypes: types.rows
      .map((row) => row.event_type)
      .filter(isSafeAuditEventType),
    pagination: {
      page: filters.page,
      pageSize: filters.pageSize,
      total,
      pageCount: Math.ceil(total / filters.pageSize),
    },
  };
}
