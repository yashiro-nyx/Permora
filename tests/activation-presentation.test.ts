import assert from "node:assert/strict";
import test from "node:test";
import {
  activationStatusSummary,
  notificationPresentation,
} from "../lib/activation-presentation";

test("activation summary distinguishes approval from each lifecycle state", () => {
  assert.deepEqual(
    activationStatusSummary("approved_pending_activation", null),
    {
      label: "Awaiting activation",
      description: "Approved, but access is not active yet.",
      tone: "warning",
      canStart: true,
      actionLabel: "Start activation",
    },
  );
  assert.equal(
    activationStatusSummary("approved_pending_activation", "activating").label,
    "Activation in progress",
  );
  assert.equal(
    activationStatusSummary("approved_pending_activation", "activated").label,
    "Active",
  );
  assert.equal(
    activationStatusSummary("approved_pending_activation", "expired").canStart,
    false,
  );
  assert.equal(
    activationStatusSummary("approved_pending_activation", "revoked").canStart,
    false,
  );
  assert.equal(
    activationStatusSummary("pending_review", null).canStart,
    false,
  );
});

test("only retryable failure exposes a retry action", () => {
  assert.deepEqual(
    activationStatusSummary("approved_pending_activation", "failed", true),
    {
      label: "Activation failed",
      description: "The activation may be retried by an administrator.",
      tone: "danger",
      canStart: true,
      actionLabel: "Retry activation",
    },
  );
  assert.equal(
    activationStatusSummary("approved_pending_activation", "failed", false)
      .canStart,
    false,
  );
  assert.equal(
    activationStatusSummary("approved_pending_activation", "failed", null)
      .canStart,
    false,
  );
});

test("notification rendering metadata distinguishes activation success and failure", () => {
  assert.deepEqual(notificationPresentation("activation_succeeded"), {
    icon: "check",
    tone: "success",
    label: "Activation succeeded",
  });
  assert.deepEqual(notificationPresentation("activation_failed"), {
    icon: "bell",
    tone: "danger",
    label: "Activation failed",
  });
});
