"use client";

import { useState } from "react";
import Link from "next/link";
import type { NotificationPreferenceDto } from "@/lib/server/admin-governance-types";
import {
  buildPreferenceUpdateBody,
  channelAvailabilityLabel,
  externalDeliveryNotice,
  hasPreferenceChange,
  preferenceChannels,
  preferenceMutationMessage,
} from "@/lib/notification-preferences-ui";
import { Alert, Card, PageHeading } from "./ui";

async function errorCode(response: Response) {
  try {
    const body = (await response.json()) as { error?: { code?: unknown } };
    return typeof body.error?.code === "string" ? body.error.code : undefined;
  } catch {
    return undefined;
  }
}

export function NotificationPreferencesForm({
  preference,
}: {
  preference: NotificationPreferenceDto;
}) {
  // Track the saved baseline locally so the Save button can disable after a
  // successful save without a router.refresh(), which would briefly unmount
  // this component via the route loading boundary and clear the success notice.
  const [savedInApp, setSavedInApp] = useState(preference.inAppEnabled);
  const [inAppEnabled, setInAppEnabled] = useState(preference.inAppEnabled);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [success, setSuccess] = useState("");

  const changed = hasPreferenceChange({ ...preference, inAppEnabled: savedInApp }, inAppEnabled);

  async function save() {
    if (busy || !changed) return;
    setBusy(true);
    setFailure("");
    setSuccess("");
    try {
      const response = await fetch("/api/notifications/preferences", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildPreferenceUpdateBody(inAppEnabled)),
      });
      if (!response.ok) {
        setFailure(preferenceMutationMessage(response.status, await errorCode(response)));
        return;
      }
      const body = (await response.json()) as {
        preference?: { inAppEnabled?: boolean };
      };
      const confirmed = body.preference?.inAppEnabled ?? inAppEnabled;
      setInAppEnabled(confirmed);
      setSavedInApp(confirmed);
      setSuccess("Your notification preferences were saved.");
    } catch {
      setFailure("Your preferences could not be saved. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeading
        eyebrow="ACCOUNT › NOTIFICATIONS"
        title="Notification settings"
        description="Choose how Permora notifies you. In-app notifications appear in your notification center."
      />
      <Alert title="External delivery not configured" tone="info">
        {externalDeliveryNotice(preference)}
      </Alert>
      {failure && <Alert title="Not saved" tone="danger">{failure}</Alert>}
      {success && (
        <div role="status">
          <Alert title="Preferences saved" tone="success">{success}</Alert>
        </div>
      )}
      <Card title="Notification channels">
        <ul className="preference-list">
          {preferenceChannels.map((channel) => {
            const checked = channel.key === "inAppEnabled" ? inAppEnabled : false;
            const controlId = `preference-${channel.key}`;
            return (
              <li className="preference-row" key={channel.key}>
                <div className="preference-copy">
                  <label htmlFor={controlId}>
                    <strong>{channel.label}</strong>
                  </label>
                  <p className="small muted">{channel.description}</p>
                </div>
                <div className="preference-control">
                  <span
                    className={`badge ${channel.available ? "tone-success" : "tone-neutral"}`}
                  >
                    {channelAvailabilityLabel(channel)}
                  </span>
                  <label className="preference-toggle">
                    <input
                      id={controlId}
                      type="checkbox"
                      checked={checked}
                      disabled={!channel.editable || busy}
                      aria-describedby={`${controlId}-hint`}
                      onChange={(event) => {
                        if (channel.key === "inAppEnabled")
                          setInAppEnabled(event.target.checked);
                      }}
                    />
                    <span id={`${controlId}-hint`}>
                      {channel.editable
                        ? checked
                          ? "On"
                          : "Off"
                        : "Unavailable"}
                    </span>
                  </label>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="preference-actions">
          <button
            className="button button-primary"
            type="button"
            onClick={() => void save()}
            disabled={busy || !changed}
          >
            {busy ? "Saving…" : "Save preferences"}
          </button>
          <Link className="button button-ghost" href="/notifications">
            View notification center
          </Link>
        </div>
      </Card>
    </>
  );
}
