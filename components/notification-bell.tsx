"use client";

/**
 * Header notification bell + inbox popover.
 *
 * Reuses the EXISTING requester notification system end to end:
 *   GET  /api/notifications?view=all&page=1&pageSize=…   (listRequesterNotifications)
 *   POST /api/notifications/:id/read                     (mark one read)
 *   POST /api/notifications/read-all                     (mark all read)
 *
 * Privacy & role correctness:
 * - The API resolves the recipient from the trusted session and only ever
 *   returns the signed-in user's own notifications. No client-supplied user id.
 * - The underlying user_notification table is requester-scoped (recipient is
 *   the request owner). Approver/admin accounts without a requester role get a
 *   403 from the API; this component treats that as "no notifications" and
 *   never fabricates items. `canReceive` (derived server-side from whether the
 *   identity has a requester role) gates polling so non-requesters issue no
 *   requests at all.
 *
 * Delivery model: polling/refresh based. Fetches on open and on a slow
 * interval while mounted. This is NOT real-time and is not presented as such.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { notificationPresentation } from "@/lib/activation-presentation";
import type { NotificationListDto } from "@/lib/server/operations-types";
import { Icon, Spinner } from "./ui";

const POLL_INTERVAL_MS = 60_000;
const PREVIEW_PAGE_SIZE = 6;

function relativeTime(value: string) {
  const then = new Date(value).getTime();
  const diff = Date.now() - then;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "Just now";
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    timeZone: "Asia/Manila",
  }).format(new Date(value));
}

type Status = "idle" | "loading" | "error";

export function NotificationBell({ canReceive }: { canReceive: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<NotificationListDto | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [busy, setBusy] = useState<string | null>(null);
  const panelId = useId();
  const containerRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!canReceive) return;
    setStatus("loading");
    try {
      const response = await fetch(
        `/api/notifications?view=all&page=1&pageSize=${PREVIEW_PAGE_SIZE}`,
        { headers: { accept: "application/json" }, cache: "no-store" },
      );
      if (!response.ok) throw new Error(`status ${response.status}`);
      const payload = (await response.json()) as NotificationListDto;
      setData(payload);
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  }, [canReceive]);

  // Initial fetch + slow poll (only when the user can receive notifications).
  useEffect(() => {
    if (!canReceive) return;
    void load();
    const timer = setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [canReceive, load]);

  // Refresh immediately when the panel is opened so counts are current.
  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  // Close on outside click and on Escape.
  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const unread = data?.unreadTotal ?? 0;

  async function post(url: string) {
    setBusy(url);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (!response.ok) throw new Error(`status ${response.status}`);
      await load();
      router.refresh();
    } catch {
      setStatus("error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="notification-bell" ref={containerRef}>
      <button
        type="button"
        className="notification-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={
          unread > 0
            ? `Notifications, ${unread} unread`
            : "Notifications"
        }
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="bell" size={20} />
        {unread > 0 && (
          <span aria-hidden="true">{unread > 99 ? "99+" : unread}</span>
        )}
      </button>
      {open && (
        <div
          className="notification-popover"
          id={panelId}
          role="dialog"
          aria-label="Notifications"
        >
          <div className="notification-popover-head">
            <strong>Notifications</strong>
            {canReceive && unread > 0 && (
              <button
                type="button"
                className="text-button"
                disabled={busy !== null}
                onClick={() => post("/api/notifications/read-all")}
              >
                Mark all as read
              </button>
            )}
          </div>
          <div className="notification-popover-body">
            {!canReceive ? (
              <p className="notification-popover-empty">
                You have no notifications. Updates about your own access
                requests will appear here.
              </p>
            ) : status === "loading" && !data ? (
              <div className="notification-popover-loading">
                <Spinner label="Loading notifications…" />
              </div>
            ) : status === "error" ? (
              <div className="notification-popover-empty">
                <p>Notifications could not be loaded.</p>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => void load()}
                >
                  Try again
                </button>
              </div>
            ) : !data || data.items.length === 0 ? (
              <p className="notification-popover-empty">
                You’re all caught up. No notifications yet.
              </p>
            ) : (
              <ul className="notification-popover-list">
                {data.items.map((item) => {
                  const presentation = notificationPresentation(item.type);
                  const unreadItem = item.readAt === null;
                  const body = (
                    <>
                      <span className={`icon-tile tone-${presentation.tone}`}>
                        <Icon name={presentation.icon} size={16} />
                      </span>
                      <span className="notification-popover-text">
                        <span className="notification-popover-title">
                          {item.title}
                        </span>
                        <span className="notification-popover-message">
                          {item.message}
                        </span>
                        <time
                          className="notification-popover-time"
                          dateTime={item.createdAt}
                        >
                          {relativeTime(item.createdAt)}
                        </time>
                      </span>
                      {unreadItem && (
                        <span
                          className="notification-popover-dot"
                          aria-label="Unread"
                        />
                      )}
                    </>
                  );
                  return (
                    <li
                      key={item.notificationId}
                      className={unreadItem ? "unread" : ""}
                    >
                      {item.request ? (
                        <Link
                          href={`/requests/${item.request.requestId}`}
                          className="notification-popover-item"
                          onClick={() => {
                            if (unreadItem)
                              void post(
                                `/api/notifications/${encodeURIComponent(item.notificationId)}/read`,
                              );
                            setOpen(false);
                          }}
                        >
                          {body}
                        </Link>
                      ) : (
                        <div className="notification-popover-item">{body}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="notification-popover-foot">
            <Link
              href="/notifications"
              className="text-link"
              onClick={() => setOpen(false)}
            >
              View all notifications →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
