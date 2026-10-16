import assert from "node:assert/strict";
import test from "node:test";
import type { NotificationPreferenceDto } from "../lib/server/admin-governance-types";
import {
  buildPreferenceUpdateBody,
  channelAvailabilityLabel,
  externalDeliveryNotice,
  hasPreferenceChange,
  preferenceChannels,
  preferenceMutationMessage,
} from "../lib/notification-preferences-ui";

function pref(overrides: Partial<NotificationPreferenceDto> = {}): NotificationPreferenceDto {
  return {
    inAppEnabled: true,
    externalEmailEnabled: false,
    externalSmsEnabled: false,
    externalPushEnabled: false,
    externalDeliveryConfigured: false,
    updatedAt: new Date(0).toISOString(),
    ...overrides,
  };
}

test("only the in-app channel is editable and available", () => {
  const inApp = preferenceChannels.find((c) => c.key === "inAppEnabled");
  assert.ok(inApp);
  assert.equal(inApp.editable, true);
  assert.equal(inApp.available, true);
  for (const key of ["externalEmailEnabled", "externalSmsEnabled", "externalPushEnabled"] as const) {
    const channel = preferenceChannels.find((c) => c.key === key);
    assert.ok(channel);
    assert.equal(channel.editable, false, `${key} must not be editable`);
    assert.equal(channel.available, false, `${key} must not be available`);
  }
});

test("availability label marks unavailable external channels", () => {
  const email = preferenceChannels.find((c) => c.key === "externalEmailEnabled")!;
  assert.equal(channelAvailabilityLabel(email), "Not available yet");
  const inApp = preferenceChannels.find((c) => c.key === "inAppEnabled")!;
  assert.equal(channelAvailabilityLabel(inApp), "Available");
});

test("change detection only tracks the in-app field", () => {
  assert.equal(hasPreferenceChange(pref({ inAppEnabled: true }), true), false);
  assert.equal(hasPreferenceChange(pref({ inAppEnabled: true }), false), true);
});

test("update body sends only the editable in-app field, never external", () => {
  assert.deepEqual(buildPreferenceUpdateBody(false), { inAppEnabled: false });
  assert.deepEqual(buildPreferenceUpdateBody(true), { inAppEnabled: true });
  const body = buildPreferenceUpdateBody(true) as Record<string, unknown>;
  assert.equal("externalEmailEnabled" in body, false);
  assert.equal("externalSmsEnabled" in body, false);
  assert.equal("externalPushEnabled" in body, false);
});

test("external delivery notice never claims external delivery works when unconfigured", () => {
  const message = externalDeliveryNotice(pref());
  assert.match(message, /not configured/i);
  assert.match(message, /only in-app/i);
  assert.doesNotMatch(message, /is configured\./);
});

test("mutation messages map statuses and the external-rejection code safely", () => {
  assert.match(preferenceMutationMessage(401), /session ended/i);
  assert.match(preferenceMutationMessage(403), /could not be verified/i);
  assert.match(
    preferenceMutationMessage(400, "invalid_input"),
    /external notification delivery is not available/i,
  );
  assert.match(preferenceMutationMessage(503), /could not be saved/i);
});
