import assert from "node:assert/strict";
import test from "node:test";
import {
  delegationCancelConfirmMessage,
  delegationMutationMessage,
  delegationStatusLabel,
  validateDelegationDraft,
} from "../lib/delegation-admin-ui";

const from = "2026-11-01T00:00:00.000Z";
const until = "2026-11-10T23:59:59.000Z";
const base = {
  delegatorUserId: "10000000-0000-4000-8000-000000000001",
  substituteUserId: "10000000-0000-4000-8000-000000000002",
  validFrom: from,
  validUntil: until,
};

test("delegation draft requires both parties, distinct people, and ordered dates", () => {
  assert.equal(validateDelegationDraft(base), "");
  assert.match(
    validateDelegationDraft({ ...base, delegatorUserId: "" }),
    /who will be absent/i,
  );
  assert.match(
    validateDelegationDraft({ ...base, substituteUserId: "" }),
    /substitute/i,
  );
  assert.match(
    validateDelegationDraft({ ...base, substituteUserId: base.delegatorUserId }),
    /different people/i,
  );
  assert.match(
    validateDelegationDraft({ ...base, validFrom: "" }),
    /start and an end/i,
  );
  assert.match(
    validateDelegationDraft({ ...base, validFrom: "not-a-date" }),
    /valid start and end/i,
  );
  assert.match(
    validateDelegationDraft({ ...base, validUntil: from }),
    /end after it starts/i,
  );
});

test("status label reflects schedule, activity, end, and cancellation", () => {
  const now = Date.parse("2026-11-05T00:00:00.000Z");
  assert.equal(
    delegationStatusLabel({ active: true, cancelledAt: null, validFrom: from, validUntil: until, now }),
    "Active",
  );
  assert.equal(
    delegationStatusLabel({ active: false, cancelledAt: "2026-11-02T00:00:00.000Z", validFrom: from, validUntil: until, now }),
    "Cancelled",
  );
  assert.equal(
    delegationStatusLabel({ active: false, cancelledAt: null, validFrom: from, validUntil: until, now: Date.parse("2026-10-01T00:00:00.000Z") }),
    "Scheduled",
  );
  assert.equal(
    delegationStatusLabel({ active: false, cancelledAt: null, validFrom: from, validUntil: until, now: Date.parse("2026-12-01T00:00:00.000Z") }),
    "Ended",
  );
});

test("cancel confirmation names both parties and preserves assignments", () => {
  const message = delegationCancelConfirmMessage("Dr. Cruz", "Prof. Reyes");
  assert.match(message, /Dr\. Cruz/);
  assert.match(message, /Prof\. Reyes/);
  assert.match(message, /not changed/i);
});

test("mutation messages map status and governance codes without leaking internals", () => {
  assert.match(delegationMutationMessage(401), /session ended/i);
  assert.match(delegationMutationMessage(403), /administrator access/i);
  assert.match(delegationMutationMessage(404), /no longer cancellable/i);
  assert.match(
    delegationMutationMessage(409, "circular_delegation"),
    /opposite direction/i,
  );
  assert.match(delegationMutationMessage(409), /overlapping absence/i);
  assert.match(delegationMutationMessage(400), /approvers and dates/i);
  assert.match(delegationMutationMessage(503), /temporarily unavailable/i);
});
