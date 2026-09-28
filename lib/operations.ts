import type { AuditFilters, NotificationFilters } from "./server/operations-types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const EVENT_TYPE = /^[a-z0-9][a-z0-9._-]{0,99}$/;

export class OperationsQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperationsQueryError";
  }
}

function positiveInteger(value: string | null, fallback: number, maximum: number) {
  if (value === null || value === "") return fallback;
  if (!/^\d+$/.test(value))
    throw new OperationsQueryError("Pagination values must be positive integers.");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1)
    throw new OperationsQueryError("Pagination values must be positive integers.");
  return Math.min(parsed, maximum);
}

function validDate(value: string) {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export function parseNotificationFilters(searchParams: URLSearchParams) {
  const view = searchParams.get("view")?.trim() || "all";
  if (view !== "all" && view !== "unread")
    throw new OperationsQueryError("The notification filter is not supported.");
  return {
    unreadOnly: view === "unread",
    page: positiveInteger(searchParams.get("page"), 1, 10_000),
    pageSize: positiveInteger(searchParams.get("pageSize"), 20, 100),
  } satisfies NotificationFilters;
}

export function parseAuditFilters(searchParams: URLSearchParams) {
  const search = searchParams.get("search")?.trim() || undefined;
  if (search && search.length > 100)
    throw new OperationsQueryError("Search must be 100 characters or fewer.");
  const eventType = searchParams.get("eventType")?.trim() || undefined;
  if (eventType && !EVENT_TYPE.test(eventType))
    throw new OperationsQueryError("The event type filter is invalid.");
  const from = searchParams.get("from")?.trim() || undefined;
  const to = searchParams.get("to")?.trim() || undefined;
  if (from && !validDate(from))
    throw new OperationsQueryError("The start date filter is invalid.");
  if (to && !validDate(to))
    throw new OperationsQueryError("The end date filter is invalid.");
  if (from && to && from > to)
    throw new OperationsQueryError("The date filter range is invalid.");
  return {
    search,
    eventType,
    from,
    to,
    page: positiveInteger(searchParams.get("page"), 1, 10_000),
    pageSize: positiveInteger(searchParams.get("pageSize"), 20, 100),
  } satisfies AuditFilters;
}

export function isSafeAuditEventType(value: string) {
  return EVENT_TYPE.test(value);
}

export function auditEventSummary(input: {
  eventType: string;
  actorName: string | null;
  subjectName: string | null;
  displayId: string | null;
}) {
  const actor = input.actorName ?? "Permora";
  const request = input.displayId ? `request ${input.displayId}` : "a record";
  switch (input.eventType) {
    case "submitted": return `${actor} submitted ${request}.`;
    case "renewal_submitted": return `${actor} submitted a renewal for ${request}.`;
    case "request_routed": return `${request} was assigned to an eligible approver.`;
    case "request_routing_unavailable": return `${request} could not be assigned to an eligible approver.`;
    case "review_approved": return `${actor} approved ${request}; access is still awaiting activation.`;
    case "review_denied": return `${actor} denied ${request}.`;
    case "review_returned_for_revision": return `${actor} returned ${request} for revision.`;
    case "account.provisioned": return `${actor} provisioned an account${input.subjectName ? ` for ${input.subjectName}` : ""}.`;
    default:
      if (input.eventType.startsWith("configuration."))
        return `${actor} recorded an access configuration change.`;
      return `${actor} recorded ${input.eventType.replaceAll(/[._-]+/g, " ")}.`;
  }
}
