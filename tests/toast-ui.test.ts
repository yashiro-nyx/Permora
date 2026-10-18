import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_TOAST_DURATION,
  MAX_TOASTS,
  TOAST_ICON,
  TOAST_ROLE,
  resolveToastDuration,
  toastFingerprint,
  upsertToast,
  type ToastRecord,
} from "../lib/toast-ui";

test("all variants have positive auto-dismiss durations", () => {
  // Every variant must auto-dismiss by default (non-null, positive).
  // success/info: 5 s, warning: 7 s, error: 8 s.
  assert.equal(DEFAULT_TOAST_DURATION.success, 5000);
  assert.equal(DEFAULT_TOAST_DURATION.info, 5000);
  assert.equal(DEFAULT_TOAST_DURATION.warning, 7000);
  assert.equal(DEFAULT_TOAST_DURATION.error, 8000);

  for (const [variant, ms] of Object.entries(DEFAULT_TOAST_DURATION)) {
    assert.ok(
      typeof ms === "number" && ms > 0,
      `${variant} default duration must be a positive number (got ${ms})`,
    );
  }
});

test("resolveToastDuration returns variant default when durationMs is undefined", () => {
  assert.equal(resolveToastDuration("error", undefined), 8000);
  assert.equal(resolveToastDuration("warning", undefined), 7000);
  assert.equal(resolveToastDuration("success", undefined), 5000);
  assert.equal(resolveToastDuration("info", undefined), 5000);
});

test("explicit durationMs override wins over variant default", () => {
  // Explicit positive number.
  assert.equal(resolveToastDuration("success", 1200), 1200);
  assert.equal(resolveToastDuration("error", 3000), 3000);
  // Explicit null makes the toast sticky (no auto-dismiss).
  assert.equal(resolveToastDuration("success", null), null);
  assert.equal(resolveToastDuration("error", null), null);
});

test("errors and warnings announce assertively; success/info politely", () => {
  assert.equal(TOAST_ROLE.error, "alert");
  assert.equal(TOAST_ROLE.warning, "alert");
  assert.equal(TOAST_ROLE.success, "status");
  assert.equal(TOAST_ROLE.info, "status");
});

test("every variant maps to an icon", () => {
  for (const variant of ["success", "error", "warning", "info"] as const)
    assert.ok(TOAST_ICON[variant], `${variant} must have an icon`);
});

test("fingerprint distinguishes variant, title, and description", () => {
  assert.equal(
    toastFingerprint("success", { title: "Saved" }),
    toastFingerprint("success", { title: "Saved" }),
  );
  assert.notEqual(
    toastFingerprint("success", { title: "Saved" }),
    toastFingerprint("error", { title: "Saved" }),
  );
  assert.notEqual(
    toastFingerprint("success", { title: "Saved", description: "A" }),
    toastFingerprint("success", { title: "Saved", description: "B" }),
  );
});

test("upsertToast does not stack a duplicate; it refreshes the existing one", () => {
  let counter = 0;
  const makeId = () => `id-${++counter}`;
  const first = upsertToast([], "success", { title: "Saved" }, makeId, 1000);
  assert.equal(first.next.length, 1);
  assert.equal(first.id, "id-1");

  const dup = upsertToast(
    first.next,
    "success",
    { title: "Saved" },
    makeId,
    2000,
  );
  // Same id reused, length unchanged, timestamp refreshed.
  assert.equal(dup.next.length, 1);
  assert.equal(dup.id, "id-1");
  assert.equal(dup.next[0].createdAt, 2000);
  // No eviction when de-duping.
  assert.equal(dup.evictedId, undefined);
});

test("upsertToast adds distinct toasts for different content", () => {
  let counter = 0;
  const makeId = () => `id-${++counter}`;
  const start: ToastRecord[] = [];
  const a = upsertToast(start, "success", { title: "Saved" }, makeId, 1);
  const b = upsertToast(a.next, "error", { title: "Failed" }, makeId, 2);
  assert.equal(b.next.length, 2);
  assert.equal(b.id, "id-2");
  assert.equal(b.evictedId, undefined);
});

test("MAX_TOASTS cap is enforced — oldest dismissible toast is evicted", () => {
  let counter = 0;
  const makeId = () => `id-${++counter}`;
  // Fill to MAX_TOASTS with auto-dismiss success toasts.
  let list: ToastRecord[] = [];
  for (let i = 0; i < MAX_TOASTS; i++) {
    const result = upsertToast(list, "success", { title: `Toast ${i}` }, makeId, i);
    list = result.next;
  }
  assert.equal(list.length, MAX_TOASTS);

  // Adding one more evicts the oldest.
  const overflow = upsertToast(list, "success", { title: "New toast" }, makeId, MAX_TOASTS);
  assert.equal(overflow.next.length, MAX_TOASTS);
  // The oldest (createdAt=0, id-1) should be evicted.
  assert.equal(overflow.evictedId, "id-1");
  assert.ok(!overflow.next.some((t) => t.id === "id-1"));
  assert.ok(overflow.next.some((t) => t.title === "New toast"));
});

test("MAX_TOASTS eviction prefers dismissible toasts over explicitly sticky ones", () => {
  let counter = 0;
  const makeId = () => `id-${++counter}`;

  // One explicitly sticky toast (durationMs: null), then fill remaining with dismissible.
  let result = upsertToast([], "error", { title: "Sticky error", durationMs: null }, makeId, 0);
  let list = result.next;
  for (let i = 0; i < MAX_TOASTS - 1; i++) {
    const r = upsertToast(list, "success", { title: `Success ${i}` }, makeId, i + 1);
    list = r.next;
  }
  assert.equal(list.length, MAX_TOASTS);

  // Adding a new toast should evict the oldest dismissible (Success 0), not the sticky one.
  const overflow = upsertToast(list, "info", { title: "Info" }, makeId, 100);
  assert.equal(overflow.next.length, MAX_TOASTS);
  assert.ok(overflow.next.some((t) => t.title === "Sticky error"), "sticky toast must survive");
  assert.ok(!overflow.next.some((t) => t.title === "Success 0"), "oldest dismissible should be evicted");
  assert.equal(overflow.evictedId, "id-2"); // id-1 is the sticky, id-2 is the first success
});

test("MAX_TOASTS evicts oldest when all toasts are explicitly sticky", () => {
  let counter = 0;
  const makeId = () => `id-${++counter}`;

  // All explicitly sticky.
  let list: ToastRecord[] = [];
  for (let i = 0; i < MAX_TOASTS; i++) {
    const r = upsertToast(list, "error", { title: `Error ${i}`, durationMs: null }, makeId, i);
    list = r.next;
  }
  const overflow = upsertToast(list, "error", { title: "Another error", durationMs: null }, makeId, 100);
  assert.equal(overflow.next.length, MAX_TOASTS);
  // Evicts the absolute oldest.
  assert.equal(overflow.evictedId, "id-1");
  assert.ok(!overflow.next.some((t) => t.id === "id-1"));
});

test("all four default variants are auto-dismissible (eviction pool includes errors)", () => {
  let counter = 0;
  const makeId = () => `id-${++counter}`;

  // Fill with one of each variant (all auto-dismiss by default now).
  const variants = ["success", "error", "warning", "info"] as const;
  let list: ToastRecord[] = [];
  for (const [i, variant] of variants.slice(0, MAX_TOASTS).entries()) {
    const r = upsertToast(list, variant, { title: `${variant} toast` }, makeId, i);
    list = r.next;
  }
  assert.equal(list.length, MAX_TOASTS);

  // Adding a 4th (info) should evict the oldest (success, createdAt=0).
  const overflow = upsertToast(list, "info", { title: "Extra info" }, makeId, 100);
  assert.equal(overflow.next.length, MAX_TOASTS);
  // Oldest toast was the first success at createdAt=0.
  assert.ok(overflow.evictedId, "should evict one toast");
  assert.ok(!overflow.next.some((t) => t.createdAt === 0), "oldest toast must be gone");
});

test("error auto-dismiss duration is longer than warning, which is longer than success", () => {
  // Ordering contract: error (8s) > warning (7s) > success (5s) = info (5s).
  const error = resolveToastDuration("error", undefined) ?? 0;
  const warning = resolveToastDuration("warning", undefined) ?? 0;
  const success = resolveToastDuration("success", undefined) ?? 0;
  const info = resolveToastDuration("info", undefined) ?? 0;
  assert.ok(error > warning, `error (${error}ms) must outlast warning (${warning}ms)`);
  assert.ok(warning > success, `warning (${warning}ms) must outlast success (${success}ms)`);
  assert.equal(success, info, "success and info should share the same default");
});
