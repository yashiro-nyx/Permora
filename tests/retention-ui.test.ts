import assert from "node:assert/strict";
import test from "node:test";
import type {
  RetentionDryRunDto,
  RetentionPolicyDto,
} from "../lib/server/admin-governance-types";
import {
  describePreview,
  formatRetentionPeriod,
  retentionRequestMessage,
  retentionStatus,
  retentionStatusLabel,
  supportsRetentionPreview,
} from "../lib/retention-ui";

function policy(overrides: Partial<RetentionPolicyDto> = {}): RetentionPolicyDto {
  return {
    recordClass: "user_notification",
    label: "In-app notifications (provisional)",
    retentionDays: 730,
    provisional: true,
    immutable: false,
    updatedAt: new Date(0).toISOString(),
    ...overrides,
  };
}

test("status classification distinguishes immutable, unconfigured, and provisional", () => {
  assert.equal(retentionStatus(policy({ immutable: true, retentionDays: null })), "immutable");
  assert.equal(retentionStatus(policy({ immutable: false, retentionDays: null })), "no-retention");
  assert.equal(retentionStatus(policy({ immutable: false, retentionDays: 730 })), "provisional");
  assert.equal(retentionStatusLabel("immutable"), "Immutable");
  assert.equal(retentionStatusLabel("no-retention"), "No retention period");
  assert.equal(retentionStatusLabel("provisional"), "Provisional");
});

test("preview is only supported for mutable, configured classes", () => {
  assert.equal(supportsRetentionPreview(policy({ immutable: false, retentionDays: 730 })), true);
  assert.equal(supportsRetentionPreview(policy({ immutable: true, retentionDays: null })), false);
  assert.equal(supportsRetentionPreview(policy({ immutable: false, retentionDays: null })), false);
});

test("retention period formats days and approximate years", () => {
  assert.equal(formatRetentionPeriod(null), "Not configured");
  assert.equal(formatRetentionPeriod(90), "90 days");
  assert.equal(formatRetentionPeriod(730), "730 days (~2.0 years)");
});

function dryRun(overrides: Partial<RetentionDryRunDto> = {}): RetentionDryRunDto {
  return {
    recordClass: "user_notification",
    eligibleCount: 0,
    immutable: false,
    applied: false,
    message: "No eligible records.",
    ...overrides,
  };
}

test("preview description always frames results as non-destructive", () => {
  const immutable = describePreview(dryRun({ immutable: true, message: "Immutable accountability records cannot be archived." }));
  assert.equal(immutable.headline, "Not archivable");
  assert.equal(immutable.tone, "info");

  const none = describePreview(dryRun({ eligibleCount: 0, message: "No retention period is configured for this class." }));
  assert.equal(none.headline, "No eligible records");

  const some = describePreview(
    dryRun({ eligibleCount: 5, message: "5 in-app notifications would match this provisional dry-run. No records were changed." }),
  );
  assert.match(some.headline, /5 records would match/);
  assert.match(some.detail, /No records were changed/);

  const one = describePreview(dryRun({ eligibleCount: 1 }));
  assert.match(one.headline, /1 record would match/);
});

test("request messages map statuses and the apply-disabled immutable code", () => {
  assert.match(retentionRequestMessage(403), /administrator access/i);
  assert.match(retentionRequestMessage(401), /session ended/i);
  assert.match(retentionRequestMessage(404), /not found/i);
  assert.match(
    retentionRequestMessage(409, "immutable"),
    /destructive archival is disabled/i,
  );
  assert.match(retentionRequestMessage(400, "invalid_input"), /invalid/i);
  assert.match(retentionRequestMessage(503), /temporarily unavailable/i);
});
