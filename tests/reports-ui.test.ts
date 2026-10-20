import assert from "node:assert/strict";
import test from "node:test";
import type { AnalyticsSummaryDto } from "../lib/server/admin-governance-types";
import {
  deriveRequestCounts,
  formatTurnaround,
  hasAnyData,
  requestStatusLabel,
  statusBreakdown,
  validateReportFilters,
} from "../lib/reports-ui";

function summary(overrides: Partial<AnalyticsSummaryDto> = {}): AnalyticsSummaryDto {
  return {
    generatedAt: "2026-10-10T00:00:00.000Z",
    filters: {},
    users: { total: 0, active: 0, inactive: 0 },
    requests: {
      total: 0,
      byStatus: {},
      pendingReview: 0,
      pendingRouting: 0,
      approvedPendingActivation: 0,
      awaitingActivation: 0,
    },
    entitlements: { active: 0, expired: 0, revoked: 0 },
    activation: { activated: 0, failed: 0, activating: 0 },
    approvalTurnaroundHours: null,
    approverWorkload: [],
    ...overrides,
  };
}

test("derived request counts come only from the DTO, never invented", () => {
  const counts = deriveRequestCounts({
    total: 12,
    byStatus: {
      pending_review: 2,
      pending_routing: 1,
      approved_pending_activation: 4,
      denied: 3,
      returned_for_revision: 2,
    },
    pendingReview: 2,
    pendingRouting: 1,
    approvedPendingActivation: 4,
    awaitingActivation: 1,
  });
  assert.deepEqual(counts, {
    total: 12,
    pending: 3,
    approvedPendingActivation: 4,
    denied: 3,
    returnedForRevision: 2,
  });
});

test("empty analytics derive all-zero counts and no breakdown rows", () => {
  const empty = summary();
  assert.deepEqual(deriveRequestCounts(empty.requests), {
    total: 0,
    pending: 0,
    approvedPendingActivation: 0,
    denied: 0,
    returnedForRevision: 0,
  });
  assert.deepEqual(statusBreakdown(empty.requests), []);
  assert.equal(hasAnyData(empty), false);
});

test("status breakdown labels, computes percentages, and sorts by count", () => {
  const rows = statusBreakdown({
    total: 10,
    byStatus: { denied: 2, approved_pending_activation: 5, pending_review: 3, cancelled: 0 },
    pendingReview: 3,
    pendingRouting: 0,
    approvedPendingActivation: 5,
    awaitingActivation: 0,
  });
  assert.deepEqual(
    rows.map((r) => [r.status, r.count, r.percentage]),
    [
      ["approved_pending_activation", 5, 50],
      ["pending_review", 3, 30],
      ["denied", 2, 20],
    ],
  );
  assert.equal(rows[0].label, "Approval decision recorded");
});

test("request status label maps known keys and humanizes unknown ones", () => {
  assert.equal(requestStatusLabel("returned_for_revision"), "Revision requested");
  assert.equal(requestStatusLabel("denied"), "Denied");
  assert.equal(requestStatusLabel("some_future_state"), "Some future state");
});

test("turnaround formatting handles null, minutes, hours, and days", () => {
  assert.equal(formatTurnaround(null), "No decisions yet");
  assert.equal(formatTurnaround(0.5), "30 min");
  assert.equal(formatTurnaround(5), "5.0 hours");
  assert.equal(formatTurnaround(72), "3.0 days");
});

test("filter validation enforces date format and ordering", () => {
  assert.equal(validateReportFilters({}), "");
  assert.equal(validateReportFilters({ from: "2026-01-01", to: "2026-02-01" }), "");
  assert.match(validateReportFilters({ from: "2026-1-1" }), /start date/i);
  assert.match(validateReportFilters({ to: "nope" }), /end date/i);
  assert.match(
    validateReportFilters({ from: "2026-03-01", to: "2026-02-01" }),
    /on or before/i,
  );
});

test("hasAnyData is true when any tracked metric is non-zero", () => {
  assert.equal(hasAnyData(summary({ users: { total: 1, active: 1, inactive: 0 } })), true);
  assert.equal(
    hasAnyData(summary({ activation: { activated: 1, failed: 0, activating: 0 } })),
    true,
  );
});
