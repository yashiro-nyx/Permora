/**
 * Pure, framework-free logic for the global toast system. Kept separate from
 * the React component so it can be unit-tested without a DOM and reused by both
 * the provider and tests.
 */

export type ToastVariant = "success" | "error" | "warning" | "info";

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
 * Default auto-dismiss durations. Routine success/info dismiss quickly; warnings
 * linger; errors stay until the user dismisses them so failures are not missed.
 */
export const DEFAULT_TOAST_DURATION: Record<ToastVariant, number | null> = {
  success: 5000,
  info: 5000,
  warning: 8000,
  error: null,
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
 * Pure state transition for adding a toast with de-duplication: if an identical
 * toast (same fingerprint) is still visible, its timestamp is refreshed instead
 * of adding a duplicate. Returns the next list and the id that should be
 * (re)scheduled for dismissal.
 */
export function upsertToast(
  current: ToastRecord[],
  variant: ToastVariant,
  input: ToastInput,
  makeId: () => string,
  now: number = Date.now(),
): { next: ToastRecord[]; id: string } {
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
  const id = makeId();
  return {
    id,
    next: [...current, { ...input, id, variant, createdAt: now }],
  };
}
