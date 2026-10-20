import type { AnalyticsSummaryDto } from "@/lib/server/admin-governance-types";

/**
 * Human labels for the raw request status keys returned in
 * `AnalyticsSummaryDto.requests.byStatus`. Mirrors `statusLabels` for the
 * subset of persisted request statuses, so the UI never shows a raw enum.
 */
const REQUEST_STATUS_LABELS: Record<string, string> = {
  pending_routing: "Pending configuration",
  pending_review: "Pending review",
  approved_pending_activation: "Approval decision recorded",
  denied: "Denied",
  returned_for_revision: "Revision requested",
  expired: "Expired",
  cancelled: "Cancelled",
  revoked: "Revoked",
};

export function requestStatusLabel(status: string): string {
  return (
    REQUEST_STATUS_LABELS[status] ??
    status.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())
  );
}

export interface DerivedRequestCounts {
  total: number;
  pending: number;
  approvedPendingActivation: number;
  denied: number;
  returnedForRevision: number;
}

/**
 * Derive the headline request counts strictly from the verified DTO. No value
 * is invented: pending combines the two persisted pending states, and the
 * approval/denial/revision counts come directly from `byStatus`.
 */
export function deriveRequestCounts(
  requests: AnalyticsSummaryDto["requests"],
): DerivedRequestCounts {
  const byStatus = requests.byStatus ?? {};
  return {
    total: requests.total,
    pending: (requests.pendingReview ?? 0) + (requests.pendingRouting ?? 0),
    approvedPendingActivation: requests.approvedPendingActivation ?? 0,
    denied: byStatus.denied ?? 0,
    returnedForRevision: byStatus.returned_for_revision ?? 0,
  };
}

export interface StatusBreakdownRow {
  status: string;
  label: string;
  count: number;
  percentage: number;
}

/**
 * Build an ordered, labelled breakdown of request statuses for a table/bar
 * display. Percentages are of the total; an empty dataset yields an empty list.
 */
export function statusBreakdown(
  requests: AnalyticsSummaryDto["requests"],
): StatusBreakdownRow[] {
  const total = requests.total || 0;
  const entries = Object.entries(requests.byStatus ?? {}).filter(
    ([, count]) => count > 0,
  );
  return entries
    .map(([status, count]) => ({
      status,
      label: requestStatusLabel(status),
      count,
      percentage: total ? Math.round((count / total) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function formatTurnaround(hours: number | null): string {
  if (hours === null || Number.isNaN(hours)) return "No decisions yet";
  if (hours < 1) {
    const minutes = Math.max(1, Math.round(hours * 60));
    return `${minutes} min`;
  }
  if (hours < 48) return `${hours.toFixed(1)} hours`;
  return `${(hours / 24).toFixed(1)} days`;
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat("en-PH").format(value);
}

export function formatGeneratedAt(iso: string): string {
  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Manila",
  }).format(new Date(iso));
}

export interface ReportFilterInput {
  from?: string;
  to?: string;
  resource?: string;
  status?: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Client-side filter validation mirroring `parseReportFilters`. Returns a
 * message when the date range is malformed or inverted; empty string is valid.
 */
export function validateReportFilters(filters: ReportFilterInput): string {
  if (filters.from && !DATE.test(filters.from))
    return "Enter the start date as YYYY-MM-DD.";
  if (filters.to && !DATE.test(filters.to))
    return "Enter the end date as YYYY-MM-DD.";
  if (
    filters.from &&
    filters.to &&
    DATE.test(filters.from) &&
    DATE.test(filters.to) &&
    filters.from > filters.to
  )
    return "The start date must be on or before the end date.";
  return "";
}

export const reportableRequestStatuses: ReadonlyArray<{
  value: string;
  label: string;
}> = [
  { value: "pending_routing", label: "Pending configuration" },
  { value: "pending_review", label: "Pending review" },
  { value: "approved_pending_activation", label: "Approval decision recorded" },
  { value: "denied", label: "Denied" },
  { value: "returned_for_revision", label: "Revision requested" },
  { value: "expired", label: "Expired" },
  { value: "cancelled", label: "Cancelled" },
  { value: "revoked", label: "Revoked" },
];

export function hasAnyData(summary: AnalyticsSummaryDto): boolean {
  return (
    summary.requests.total > 0 ||
    summary.users.total > 0 ||
    summary.entitlements.active > 0 ||
    summary.entitlements.expired > 0 ||
    summary.entitlements.revoked > 0 ||
    summary.activation.activated > 0 ||
    summary.activation.failed > 0 ||
    summary.activation.activating > 0
  );
}
