"use client";

/**
 * Global toast notification system.
 *
 * Design intent:
 * - Toasts are TRANSIENT action-result feedback (distinct from the persistent
 *   notification inbox/bell). They never replace inline field validation or
 *   confirmation dialogs.
 * - Only emit a success toast AFTER the server confirms success; callers decide
 *   when to call `toast.success(...)`.
 * - Bottom-right on desktop; full-width bottom on small screens (CSS).
 * - Accessible: the viewport is an aria-live region. Routine success/info use
 *   polite; errors/warnings use assertive. A visually hidden duplicate is not
 *   needed because the toast text itself lives in the live region.
 * - No duplicate toasts: an identical (variant+title+description) toast that is
 *   still visible is refreshed rather than stacked again.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Icon } from "./ui";
import {
  resolveToastDuration,
  TOAST_ICON,
  TOAST_ROLE,
  upsertToast,
  type ToastInput,
  type ToastRecord,
  type ToastVariant,
} from "@/lib/toast-ui";

export type { ToastVariant, ToastInput } from "@/lib/toast-ui";

interface ToastApi {
  show: (variant: ToastVariant, input: ToastInput) => string;
  success: (input: ToastInput) => string;
  error: (input: ToastInput) => string;
  warning: (input: ToastInput) => string;
  info: (input: ToastInput) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

function makeId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const scheduledAt = useRef(new Map<string, number>());
  const toastClock = useRef(0);

  const clearTimer = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const dismiss = useCallback(
    (id: string) => {
      clearTimer(id);
      setToasts((current) => current.filter((toast) => toast.id !== id));
    },
    [clearTimer],
  );

  const scheduleDismiss = useCallback(
    (id: string, variant: ToastVariant, durationMs: number | null | undefined) => {
      const duration = resolveToastDuration(variant, durationMs);
      if (duration === null) return;
      clearTimer(id);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), duration),
      );
    },
    [clearTimer, dismiss],
  );

  // Schedule from committed toast state, not from the state updater. This
  // keeps the timer tied to the toast's creation/refresh timestamp and makes
  // it independent of React batching, navigation, and unrelated rerenders.
  useEffect(() => {
    const visibleIds = new Set(toasts.map((toast) => toast.id));
    for (const id of timers.current.keys()) {
      if (!visibleIds.has(id)) {
        clearTimer(id);
        scheduledAt.current.delete(id);
      }
    }
    for (const toast of toasts) {
      const duration = resolveToastDuration(toast.variant, toast.durationMs);
      if (duration === null) {
        clearTimer(toast.id);
        scheduledAt.current.delete(toast.id);
        continue;
      }
      if (scheduledAt.current.get(toast.id) === toast.createdAt) continue;
      scheduleDismiss(toast.id, toast.variant, toast.durationMs);
      scheduledAt.current.set(toast.id, toast.createdAt);
    }
  }, [clearTimer, scheduleDismiss, toasts]);

  const show = useCallback(
    (variant: ToastVariant, input: ToastInput) => {
      const now = Math.max(Date.now(), toastClock.current + 1);
      toastClock.current = now;
      let resultId = "";
      let evictedId: string | undefined;
      setToasts((current) => {
        const { next, id, evictedId: ev } = upsertToast(
          current,
          variant,
          input,
          makeId,
          now,
        );
        resultId = id;
        evictedId = ev;
        return next;
      });
      // Timer creation happens after the state update commits in the effect
      // above. Cancel an evicted toast immediately when its ID is known.
      if (evictedId) clearTimer(evictedId);
      return resultId;
    },
    [clearTimer],
  );

  useEffect(() => {
    const map = timers.current;
    const scheduled = scheduledAt.current;
    return () => {
      for (const timer of map.values()) clearTimeout(timer);
      map.clear();
      scheduled.clear();
    };
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (input) => show("success", input),
      error: (input) => show("error", input),
      warning: (input) => show("warning", input),
      info: (input) => show("info", input),
      dismiss,
    }),
    [show, dismiss],
  );

  // Split by urgency so assertive and polite announcements use separate live
  // regions (a single region cannot mix politeness levels reliably).
  const polite = toasts.filter((toast) => TOAST_ROLE[toast.variant] === "status");
  const assertive = toasts.filter(
    (toast) => TOAST_ROLE[toast.variant] === "alert",
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-viewport" data-testid="toast-viewport">
        <div aria-live="polite" aria-relevant="additions text" role="status">
          {polite.map((toast) => (
            <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
          ))}
        </div>
        <div aria-live="assertive" aria-relevant="additions text" role="alert">
          {assertive.map((toast) => (
            <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
          ))}
        </div>
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: ToastRecord;
  onDismiss: (id: string) => void;
}) {
  const duration = resolveToastDuration(toast.variant, toast.durationMs);
  return (
    <div className={`toast toast-${toast.variant}`}>
      <span className="toast-icon" aria-hidden="true">
        <Icon name={TOAST_ICON[toast.variant]} size={18} />
      </span>
      <div className="toast-body">
        <strong>{toast.title}</strong>
        {toast.description && <span className="toast-message">{toast.description}</span>}
      </div>
      <button
        type="button"
        className="toast-dismiss"
        onClick={() => onDismiss(toast.id)}
        aria-label={`Dismiss notification: ${toast.title}`}
      >
        <span aria-hidden="true">×</span>
      </button>
      {duration !== null && (
        <span
          className="toast-progress"
          aria-hidden="true"
          style={{ animationDuration: `${duration}ms` }}
        />
      )}
    </div>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api)
    throw new Error("useToast must be used within a ToastProvider.");
  return api;
}

/**
 * Optional non-throwing accessor for components that may render outside the
 * provider (e.g. shared components used on both authenticated and public
 * pages). Returns null when no provider is present.
 */
export function useOptionalToast(): ToastApi | null {
  return useContext(ToastContext);
}
