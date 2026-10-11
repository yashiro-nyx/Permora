import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_TOAST_DURATION,
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
});

test("upsertToast adds distinct toasts for different content", () => {
  let counter = 0;
  const makeId = () => `id-${++counter}`;
  const start: ToastRecord[] = [];
  const a = upsertToast(start, "success", { title: "Saved" }, makeId, 1);
  const b = upsertToast(a.next, "error", { title: "Failed" }, makeId, 2);
  assert.equal(b.next.length, 2);
  assert.equal(b.id, "id-2");
});
