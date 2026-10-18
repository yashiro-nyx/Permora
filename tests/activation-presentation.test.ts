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

test("staff notification types map to correct presentation", () => {
  const assignment = notificationPresentation("request_assigned_for_review");
  assert.equal(assignment.tone, "info");
  assert.equal(assignment.label, "New assignment");

  const routing = notificationPresentation("routing_unavailable");
  assert.equal(routing.tone, "warning");
  assert.equal(routing.label, "Routing failed");
});

test("all notification types have a presentation entry", () => {
  const allTypes = [
    "request_approved_pending_activation",
    "request_denied",
    "request_returned_for_revision",
    "activation_succeeded",
    "activation_failed",
    "request_assigned_for_review",
    "routing_unavailable",
  ] as const;
  for (const type of allTypes) {
    const p = notificationPresentation(type);
    assert.ok(p.icon, `${type} must have an icon`);
    assert.ok(p.tone, `${type} must have a tone`);
    assert.ok(p.label, `${type} must have a label`);
  }
});
