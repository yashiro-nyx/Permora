import type { NotificationPreferenceDto } from "@/lib/server/admin-governance-types";

export type PreferenceChannelKey =
  | "inAppEnabled"
  | "externalEmailEnabled"
  | "externalSmsEnabled"
  | "externalPushEnabled";

export interface PreferenceChannel {
  key: PreferenceChannelKey;
  label: string;
  description: string;
  /** Whether the channel can currently be toggled by the user. */
  editable: boolean;
  /** Whether downstream delivery for this channel is operational. */
  available: boolean;
}

/**
 * Channel catalogue for the preferences UI. In-app notifications are
 * operational and editable; external channels are intentionally not available
 * because delivery is not configured, and the backend rejects enabling them.
 * This metadata must never imply external delivery works.
 */
export const preferenceChannels: ReadonlyArray<PreferenceChannel> = [
  {
    key: "inAppEnabled",
    label: "In-app notifications",
    description:
      "Show request, decision, and activation updates in your Permora notification center.",
    editable: true,
    available: true,
  },
  {
    key: "externalEmailEnabled",
    label: "Email",
    description: "External email delivery is not configured in this environment.",
    editable: false,
    available: false,
  },
  {
    key: "externalSmsEnabled",
    label: "SMS",
    description: "External SMS delivery is not configured in this environment.",
    editable: false,
    available: false,
  },
  {
    key: "externalPushEnabled",
    label: "Push",
    description: "External push delivery is not configured in this environment.",
    editable: false,
    available: false,
  },
];

export function channelAvailabilityLabel(channel: PreferenceChannel): string {
  if (!channel.available) return "Not available yet";
  return channel.editable ? "Available" : "Available";
}

/**
 * Determine whether an edited preference differs from the stored one for the
 * only user-editable field (in-app). Used to enable/disable the Save button.
 */
export function hasPreferenceChange(
  current: NotificationPreferenceDto,
  draftInAppEnabled: boolean,
): boolean {
  return current.inAppEnabled !== draftInAppEnabled;
}

/**
 * Build the request body for a preference update. Only the editable in-app
 * field is sent; external channels are never submitted as enabled, matching
 * the server contract that rejects enabling unavailable channels.
 */
export function buildPreferenceUpdateBody(draftInAppEnabled: boolean): {
  inAppEnabled: boolean;
} {
  return { inAppEnabled: draftInAppEnabled };
}

/**
 * Translate a preferences mutation response status into a safe, non-leaking
 * message. Mirrors the governance error contract in `mapGovernanceError`.
 */
export function preferenceMutationMessage(status: number, code?: string): string {
  if (status === 401)
    return "Your session ended. Sign in again to update your preferences.";
  if (status === 403)
    return "This request could not be verified. Reload the page and try again.";
  if (status === 400 || code === "invalid_input")
    return "External notification delivery is not available yet, so only in-app notifications can be changed.";
  if (status === 415)
    return "The server rejected the request format. Reload and try again.";
  if (status === 429)
    return "Too many attempts were made. Wait briefly before trying again.";
  return "Your preferences could not be saved. Try again later.";
}

export function externalDeliveryNotice(
  preference: NotificationPreferenceDto,
): string {
  return preference.externalDeliveryConfigured
    ? "External delivery is configured."
    : "External notification channels (email, SMS, push) are not configured in this environment. Only in-app notifications are delivered.";
}
