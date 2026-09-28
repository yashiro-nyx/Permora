import assert from "node:assert/strict";
import test from "node:test";
import {
  auditEventSummary,
  OperationsQueryError,
  parseAuditFilters,
  parseNotificationFilters,
} from "../lib/operations";

test("notification filters parse unread state and bound pagination", () => {
  const filters = parseNotificationFilters(
    new URLSearchParams("view=unread&page=2&pageSize=999"),
  );
  assert.deepEqual(filters, { unreadOnly: true, page: 2, pageSize: 100 });
  assert.throws(
    () => parseNotificationFilters(new URLSearchParams("view=someone-else")),
    OperationsQueryError,
  );
});

test("audit filters validate search, event type, dates, and pagination", () => {
  const filters = parseAuditFilters(
    new URLSearchParams(
      "search=OPS-A&eventType=review_approved&from=2026-09-01&to=2026-09-30&page=3&pageSize=10",
    ),
  );
  assert.equal(filters.eventType, "review_approved");
  assert.equal(filters.page, 3);
  assert.throws(
    () =>
      parseAuditFilters(
        new URLSearchParams("from=2026-10-01&to=2026-09-01"),
      ),
    /date filter range is invalid/,
  );
  assert.throws(
    () => parseAuditFilters(new URLSearchParams("eventType=unsafe value")),
    /event type filter is invalid/,
  );
});

test("audit display mapping uses safe human-readable summaries", () => {
  assert.equal(
    auditEventSummary({
      eventType: "review_approved",
      actorName: "Avery Administrator",
      subjectName: "Sam Requester",
      displayId: "REQ-2026-000001",
    }),
    "Avery Administrator approved request REQ-2026-000001; access is still awaiting activation.",
  );
  assert.equal(
    auditEventSummary({
      eventType: "configuration.approver.created",
      actorName: "Avery Administrator",
      subjectName: null,
      displayId: null,
    }),
    "Avery Administrator recorded an access configuration change.",
  );
});

test("validation errors are actionable and contain no input values", () => {
  const secretLikeInput = "postgresql://user:password@example.invalid/database";
  assert.throws(
    () =>
      parseAuditFilters(
        new URLSearchParams({ eventType: secretLikeInput }),
      ),
    (error: unknown) => {
      assert.ok(error instanceof OperationsQueryError);
      assert.equal(error.message, "The event type filter is invalid.");
      assert.doesNotMatch(error.message, /password|postgresql/i);
      return true;
    },
  );
});
