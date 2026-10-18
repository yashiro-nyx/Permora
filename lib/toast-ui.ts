/**
 * Pure, framework-free logic for the global toast system. Kept separate from
 * the React component so it can be unit-tested without a DOM and reused by both
 * the provider and tests.
 */

export type ToastVariant = "success" | "error" | "warning" | "info";

/** Maximum simultaneous toasts. Oldest non-sticky toasts are evicted first. */
export const MAX_TOASTS = 3;

export interface ToastInput {
  title: string;
  description?: string;
  /** Override auto-dismiss. null = sticky. undefined = variant default. */
  durationMs?: number | null;
}

export interface ToastRecord extends ToastInput {
  id: string;
  variant: ToastVariant;
  createdAt: number;
}

/**
 * Default auto-dismiss durations.
 * - success/info: 5 s (transient confirmations)
 * - warning: 7 s (slightly longer so the user can read context)
 * - error: 8 s (longest; inline field errors remain after the toast clears)
 *
 * All variants auto-dismiss. Pass `durationMs: null` explicitly to make a
 * toast persistent (sticky until the user closes it).
 */
export const DEFAULT_TOAST_DURATION: Record<ToastVariant, number | null> = {
  success: 5000,
  info: 5000,
  warning: 7000,
  error: 8000,
};

export const TOAST_ICON: Record<ToastVariant, string> = {
  success: "check",
  error: "key",
  warning: "expire",
  info: "bell",
};

/** Urgency → ARIA live politeness. Errors/warnings are assertive. */
export const TOAST_ROLE: Record<ToastVariant, "status" | "alert"> = {
  success: "status",
  info: "status",
  warning: "alert",
  error: "alert",
};

/** Identity of a toast for de-duplication (variant + title + description). */
export function toastFingerprint(
  variant: ToastVariant,
  input: Pick<ToastInput, "title" | "description">,
): string {
  return `${variant}::${input.title}::${input.description ?? ""}`;
}

/** Resolve the effective auto-dismiss duration for a toast. */
export function resolveToastDuration(
  variant: ToastVariant,
  durationMs: number | null | undefined,
): number | null {
  return durationMs === undefined ? DEFAULT_TOAST_DURATION[variant] : durationMs;
}

/**
 * Pure state transition for adding a toast with de-duplication and a MAX_TOASTS
 * cap. If an identical toast (same fingerprint) is still visible its timestamp
 * is refreshed rather than adding a duplicate. When the cap would be exceeded,
 * the oldest dismissible (non-sticky error) toast is evicted first; if no
 * dismissible toast exists, the oldest toast of any kind is removed.
 *
 * Returns the next list, the id that should be (re)scheduled for dismissal,
 * and an optional evictedId that the provider should cancel any pending timer
 * for.
 */
export function upsertToast(
  current: ToastRecord[],
  variant: ToastVariant,
  input: ToastInput,
  makeId: () => string,
  now: number = Date.now(),
): { next: ToastRecord[]; id: string; evictedId?: string } {
  const key = toastFingerprint(variant, input);
  const existing = current.find(
    (toast) => toastFingerprint(toast.variant, toast) === key,
  );
  if (existing) {
    return {
      id: existing.id,
      next: current.map((toast) =>
        toast.id === existing.id ? { ...toast, createdAt: now } : toast,
      ),
    };
  }

  // Need to add a new toast. If at cap, evict the oldest dismissible one first.
  let list = current;
  let evictedId: string | undefined;
  if (list.length >= MAX_TOASTS) {
    // Prefer evicting auto-dismissible toasts (non-null effective duration).
    const dismissible = list.filter(
      (t) => resolveToastDuration(t.variant, t.durationMs) !== null,
    );
    const evictPool = dismissible.length > 0 ? dismissible : list;
    // Oldest = smallest createdAt.
    const oldest = evictPool.reduce((a, b) => (a.createdAt <= b.createdAt ? a : b));
    evictedId = oldest.id;
    list = list.filter((t) => t.id !== oldest.id);
  }

  const id = makeId();
  return {
    id,
    evictedId,
    next: [...list, { ...input, id, variant, createdAt: now }],
  };
}
