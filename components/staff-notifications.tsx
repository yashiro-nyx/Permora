"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { notificationPresentation } from "@/lib/activation-presentation";
import type {
  NotificationFilters,
  StaffNotificationListDto,
} from "@/lib/server/operations-types";
import {
  Alert,
  Badge,
  Button,
  Card,
  Empty,
  Icon,
  PageHeading,
  TablePagination,
} from "./ui";

function dateTimeLabel(value: string) {
  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Manila",
  }).format(new Date(value));
}

export function StaffNotifications({
  data,
  filters,
  invalidMessage,
}: {
  data: StaffNotificationListDto;
  filters: NotificationFilters;
  invalidMessage?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [failure, setFailure] = useState("");

  async function markRead(id?: string) {
    setPending(id ?? "all");
    setFailure("");
    setMessage("");
    try {
      const response = await fetch(
        id
          ? `/api/notifications/staff/${encodeURIComponent(id)}/read`
          : "/api/notifications/staff/read-all",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        },
      );
      if (!response.ok) throw new Error("Notification update failed.");
      setMessage(
        id
          ? "Notification marked as read."
          : "All notifications marked as read.",
      );
      router.refresh();
    } catch {
      setFailure("The notification could not be updated. Try again.");
    } finally {
      setPending(null);
    }
  }

  return (
    <>
      <PageHeading
        eyebrow="STAFF › NOTIFICATIONS"
        title="Staff Notifications"
        description="Review assignments, routing failures, and operational alerts requiring your attention."
        action={
          <Button
            variant="outline"
            disabled={data.unreadTotal === 0 || pending !== null}
            onClick={() => markRead()}
          >
            {pending === "all" ? "Updating…" : "Mark all as read"}
          </Button>
        }
      />
      <div className="sr-only" role="status" aria-live="polite">
        {message}
      </div>
      {invalidMessage && (
        <Alert title="Filters could not be applied" tone="danger">
          {invalidMessage}
        </Alert>
      )}
      {failure && (
        <Alert title="Could not update notifications" tone="danger">
          {failure}
        </Alert>
      )}
      {message && (
        <Alert title="Notification updated" tone="success">
          {message}
        </Alert>
      )}
      <nav className="tabs" aria-label="Notification filters">
        <Link
          href="/notifications/staff?view=all"
          className={`button ${filters.unreadOnly ? "button-outline" : "button-secondary"}`}
          aria-current={!filters.unreadOnly ? "page" : undefined}
        >
          All
        </Link>
        <Link
          href="/notifications/staff?view=unread"
          className={`button ${filters.unreadOnly ? "button-secondary" : "button-outline"}`}
          aria-current={filters.unreadOnly ? "page" : undefined}
        >
          Unread <span className="tab-count">{data.unreadTotal}</span>
        </Link>
      </nav>
      <Card>
        {!data.items.length ? (
          <Empty
            title={
              filters.unreadOnly ? "You're all caught up" : "No notifications yet"
            }
            description="Review assignments and routing alerts will appear here."
          />
        ) : (
          <ul className="notification-list">
            {data.items.map((item) => {
              const unread = item.readAt === null;
              const presentation = notificationPresentation(item.type);
              return (
                <li
                  key={item.notificationId}
                  className={unread ? "unread" : ""}
                >
                  <span
                    className={`icon-tile tone-${presentation.tone}`}
                  >
                    <Icon name={presentation.icon} />
                  </span>
                  <div className="notification-content">
                    <div className="spread">
                      <h2>{item.title}</h2>
                      <time className="small muted" dateTime={item.createdAt}>
                        {dateTimeLabel(item.createdAt)}
                      </time>
                    </div>
                    <p>{item.message}</p>
                    <div className="notification-meta">
                      <span>{presentation.label}</span>
                      {item.request && <span>{item.request.displayId}</span>}
                    </div>
                    <div className="row wrap">
                      {item.reviewHref && (
                        <Link
                          className="text-link"
                          href={item.reviewHref}
                        >
                          {item.type === "routing_unavailable"
                            ? "View unassigned requests →"
                            : "Review request →"}
                        </Link>
                      )}
                      {unread && (
                        <button
                          className="text-button"
                          disabled={pending !== null}
                          onClick={() => markRead(item.notificationId)}
                        >
                          {pending === item.notificationId
                            ? "Updating…"
                            : "Mark as read"}
                          <span className="sr-only">: {item.title}</span>
                        </button>
                      )}
                    </div>
                  </div>
                  {unread && <Badge label="Unread" tone="warning" />}
                </li>
              );
            })}
          </ul>
        )}
        {data.items.length > 0 && (
          <TablePagination
            page={data.pagination.page}
            pageSize={data.pagination.pageSize}
            total={data.pagination.total}
            pageCount={data.pagination.pageCount}
            itemCount={data.items.length}
            label="Notification pagination"
          />
        )}
      </Card>
      <Alert title="In-app records only" tone="warning">
        Permora does not send these notifications by email, SMS, or push
        notification.
      </Alert>
    </>
  );
}
