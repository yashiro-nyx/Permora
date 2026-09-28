"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type {
  NotificationFilters,
  NotificationListDto,
} from "@/lib/server/operations-types";
import { Alert, Badge, Button, Card, Empty, Icon, PageHeading } from "./ui";

function dateTimeLabel(value: string) {
  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Manila",
  }).format(new Date(value));
}

function hrefFor(filters: NotificationFilters, page: number) {
  const params = new URLSearchParams({
    view: filters.unreadOnly ? "unread" : "all",
    page: String(page),
    pageSize: String(filters.pageSize),
  });
  return `/notifications?${params}`;
}

export function RequesterNotifications({
  data,
  filters,
  invalidMessage,
}: {
  data: NotificationListDto;
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
          ? `/api/notifications/${encodeURIComponent(id)}/read`
          : "/api/notifications/read-all",
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
        eyebrow="REQUESTER › NOTIFICATIONS"
        title="Notifications"
        description="Persisted updates about decisions on your access requests."
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
          href="/notifications?view=all"
          className={`button ${filters.unreadOnly ? "button-outline" : "button-secondary"}`}
          aria-current={!filters.unreadOnly ? "page" : undefined}
        >
          All
        </Link>
        <Link
          href="/notifications?view=unread"
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
              filters.unreadOnly ? "You’re all caught up" : "No notifications yet"
            }
            description="Decision notifications from your persisted requests will appear here."
          />
        ) : (
          <ul className="notification-list">
            {data.items.map((item) => {
              const unread = item.readAt === null;
              const approved =
                item.type === "request_approved_pending_activation";
              return (
                <li
                  key={item.notificationId}
                  className={unread ? "unread" : ""}
                >
                  <span
                    className={`icon-tile tone-${approved ? "success" : "warning"}`}
                  >
                    <Icon name={approved ? "check" : "bell"} />
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
                      <span>{item.type.replaceAll("_", " ")}</span>
                      {item.request && <span>{item.request.displayId}</span>}
                    </div>
                    <div className="row wrap">
                      {item.request && (
                        <Link
                          className="text-link"
                          href={`/requests/${item.request.requestId}`}
                        >
                          View request →
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
        <div className="pagination staff-pagination">
          <span>
            Showing <strong>{data.items.length}</strong> of{" "}
            <strong>{data.pagination.total}</strong> notifications
          </span>
          <nav aria-label="Notification pagination">
            <Link
              className={`button button-outline ${data.pagination.page <= 1 ? "disabled-link" : ""}`}
              aria-disabled={data.pagination.page <= 1}
              tabIndex={data.pagination.page <= 1 ? -1 : undefined}
              href={hrefFor(
                filters,
                Math.max(1, data.pagination.page - 1),
              )}
            >
              Previous
            </Link>
            <span>
              Page {data.pagination.page} of{" "}
              {Math.max(1, data.pagination.pageCount)}
            </span>
            <Link
              className={`button button-outline ${data.pagination.page >= data.pagination.pageCount ? "disabled-link" : ""}`}
              aria-disabled={
                data.pagination.page >= data.pagination.pageCount
              }
              tabIndex={
                data.pagination.page >= data.pagination.pageCount
                  ? -1
                  : undefined
              }
              href={hrefFor(
                filters,
                Math.min(
                  Math.max(1, data.pagination.pageCount),
                  data.pagination.page + 1,
                ),
              )}
            >
              Next
            </Link>
          </nav>
        </div>
      </Card>
      <Alert title="In-app records only" tone="warning">
        Permora does not send these notifications by email, SMS, or push
        notification.
      </Alert>
    </>
  );
}
