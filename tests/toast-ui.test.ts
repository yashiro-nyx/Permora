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

test("errors persist (no auto-dismiss) while routine toasts auto-dismiss", () => {
  assert.equal(DEFAULT_TOAST_DURATION.error, null);
  assert.equal(resolveToastDuration("error", undefined), null);
  assert.equal(resolveToastDuration("success", undefined), 5000);
  assert.equal(resolveToastDuration("info", undefined), 5000);
  assert.equal(resolveToastDuration("warning", undefined), 8000);
  // Explicit overrides win, including an explicit sticky request.
  assert.equal(resolveToastDuration("success", 1200), 1200);
  assert.equal(resolveToastDuration("success", null), null);
});

test("errors and warnings announce assertively; success/info politely", () => {
  assert.equal(TOAST_ROLE.error, "alert");
  assert.equal(TOAST_ROLE.warning, "alert");
  assert.equal(TOAST_ROLE.success, "status");
  assert.equal(TOAST_ROLE.info, "status");
});

test("every variant maps to an icon", () => {
  for (const variant of ["success", "error", "warning", "info"] as const)
    assert.ok(TOAST_ICON[variant]);
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

test("MAX_TOASTS eviction prefers dismissible toasts over sticky errors", () => {
  let counter = 0;
  const makeId = () => `id-${++counter}`;

  // Start with one sticky error, then fill remaining slots with success toasts.
  let result = upsertToast([], "error", { title: "Sticky error" }, makeId, 0);
  let list = result.next;
  for (let i = 0; i < MAX_TOASTS - 1; i++) {
    const r = upsertToast(list, "success", { title: `Success ${i}` }, makeId, i + 1);
    list = r.next;
  }
  assert.equal(list.length, MAX_TOASTS);

  // Adding a new toast should evict the oldest success, not the sticky error.
  const overflow = upsertToast(list, "info", { title: "Info" }, makeId, 100);
  assert.equal(overflow.next.length, MAX_TOASTS);
  assert.ok(overflow.next.some((t) => t.title === "Sticky error"), "sticky error must survive");
  assert.ok(!overflow.next.some((t) => t.title === "Success 0"), "oldest success should be evicted");
  assert.equal(overflow.evictedId, "id-2"); // id-1 is the error, id-2 is the first success
});

test("MAX_TOASTS evicts any oldest toast when all are sticky", () => {
  let counter = 0;
  const makeId = () => `id-${++counter}`;

  // All errors (sticky).
  let list: ToastRecord[] = [];
  for (let i = 0; i < MAX_TOASTS; i++) {
    const r = upsertToast(list, "error", { title: `Error ${i}` }, makeId, i);
    list = r.next;
  }
  const overflow = upsertToast(list, "error", { title: "Another error" }, makeId, 100);
  assert.equal(overflow.next.length, MAX_TOASTS);
  // Evicts the absolute oldest.
  assert.equal(overflow.evictedId, "id-1");
  assert.ok(!overflow.next.some((t) => t.id === "id-1"));
});
