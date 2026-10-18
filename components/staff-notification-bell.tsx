"use client";

/**
 * Staff notification bell + inbox popover for approver and administrator roles.
 *
 * Fetches from /api/notifications/staff which enforces approver/admin role
 * authorization server-side.  Only returns notifications whose
 * notification_type is in the staff set (request_assigned_for_review,
 * routing_unavailable).  Requester notifications are never shown here.
 *
 * Delivery model: polling + tab-visibility refresh (same as the requester
 * bell).  Polls every 15s while the tab is visible; pauses when hidden.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { notificationPresentation } from "@/lib/activation-presentation";
import type { StaffNotificationListDto } from "@/lib/server/operations-types";
import { Icon, Spinner } from "./ui";

const POLL_INTERVAL_MS = 15_000;
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

export function StaffNotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<StaffNotificationListDto | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [busy, setBusy] = useState<string | null>(null);
  const panelId = useId();
  const containerRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const response = await fetch(
        `/api/notifications/staff?view=all&page=1&pageSize=${PREVIEW_PAGE_SIZE}`,
        { headers: { accept: "application/json" }, cache: "no-store" },
      );
      if (!response.ok) throw new Error(`status ${response.status}`);
      const payload = (await response.json()) as StaffNotificationListDto;
      setData(payload);
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  }, []);

  // Initial fetch + poll with tab-visibility pause.
  useEffect(() => {
    void load();
    let timer: ReturnType<typeof setInterval> | undefined;
    function startPolling() {
      if (timer) return;
      timer = setInterval(() => void load(), POLL_INTERVAL_MS);
    }
    function stopPolling() {
      if (timer) { clearInterval(timer); timer = undefined; }
    }
    function onVisibility() {
      if (document.visibilityState === "visible") {
        void load();
        startPolling();
      } else {
        stopPolling();
      }
    }
    startPolling();
    document.addEventListener("visibilitychange", onVisibility);
    function onRefreshEvent() { void load(); }
    window.addEventListener("permora-notification-refresh", onRefreshEvent);
    return () => {
      stopPolling();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("permora-notification-refresh", onRefreshEvent);
    };
  }, [load]);

  // Refresh immediately when the panel is opened.
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
            ? `Staff notifications, ${unread} unread`
            : "Staff notifications"
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
          aria-label="Staff notifications"
        >
          <div className="notification-popover-head">
            <strong>Staff Notifications</strong>
            {unread > 0 && (
              <button
                type="button"
                className="text-button"
                disabled={busy !== null}
                onClick={() => post("/api/notifications/staff/read-all")}
              >
                Mark all as read
              </button>
            )}
          </div>
          <div className="notification-popover-body">
            {status === "loading" && !data ? (
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
                No staff notifications. New review assignments and routing
                failures will appear here.
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
                      {item.reviewHref ? (
                        <Link
                          href={item.reviewHref}
                          className="notification-popover-item"
                          onClick={() => {
                            if (unreadItem)
                              void post(
                                `/api/notifications/staff/${encodeURIComponent(item.notificationId)}/read`,
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
              href="/notifications/staff"
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
