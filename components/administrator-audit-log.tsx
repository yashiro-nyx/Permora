import Link from "next/link";
import type {
  AuditFilters,
  AuditListDto,
} from "@/lib/server/operations-types";
import { Alert, Card, Empty, LinkButton, PageHeading } from "./ui";

function dateTimeLabel(value: string) {
  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Manila",
  }).format(new Date(value));
}

function hrefFor(filters: AuditFilters, page: number) {
  const params = new URLSearchParams();
  if (filters.search) params.set("search", filters.search);
  if (filters.eventType) params.set("eventType", filters.eventType);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  params.set("page", String(page));
  params.set("pageSize", String(filters.pageSize));
  return `/audit?${params}`;
}

export function AdministratorAuditLog({
  data,
  filters,
  invalidMessage,
}: {
  data: AuditListDto;
  filters: AuditFilters;
  invalidMessage?: string;
}) {
  return (
    <>
      <PageHeading
        eyebrow="ADMIN › AUDIT"
        title="Audit logs"
        description="Read-only, immutable records of access-request and administrative activity."
      />
      {invalidMessage && (
        <Alert title="Filters could not be applied" tone="danger">
          {invalidMessage}
        </Alert>
      )}
      <Card className="audit-log-card">
        <form className="filters" method="get" action="/audit">
          <div className="filter-field filter-search">
            <label htmlFor="audit-search">Search audit logs</label>
            <input
              id="audit-search"
              name="search"
              maxLength={100}
              placeholder="Event, actor, request, or resource…"
              defaultValue={filters.search}
            />
          </div>
          <div className="filter-field">
            <label htmlFor="audit-event-type">Event type</label>
            <select
              id="audit-event-type"
              name="eventType"
              defaultValue={filters.eventType}
            >
              <option value="">All event types</option>
              {data.eventTypes.map((type) => (
                <option key={type} value={type}>
                  {type.replaceAll(/[._-]+/g, " ")}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-field">
            <label htmlFor="audit-from">From</label>
            <input
              id="audit-from"
              name="from"
              type="date"
              defaultValue={filters.from}
            />
          </div>
          <div className="filter-field">
            <label htmlFor="audit-to">Until</label>
            <input
              id="audit-to"
              name="to"
              type="date"
              min={filters.from}
              defaultValue={filters.to}
            />
          </div>
          <button className="button button-primary" type="submit">
            Apply filters
          </button>
          <LinkButton href="/audit" variant="ghost">
            Clear
          </LinkButton>
        </form>
        <p className="sr-only" role="status">
          {data.pagination.total} matching audit events
        </p>
        {!data.items.length ? (
          <Empty
            title="No audit events to show"
            description="Immutable audit events matching the selected filters will appear here."
          />
        ) : (
          <div
            className="table-scroll"
            role="region"
            aria-label="Audit log table"
            tabIndex={0}
          >
            <table className="audit-table">
              <caption className="sr-only">
                Read-only administrator audit history
              </caption>
              <thead>
                <tr>
                  <th scope="col">Date and time</th>
                  <th scope="col">Event</th>
                  <th scope="col">Actor</th>
                  <th scope="col">Target</th>
                  <th scope="col">Summary</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.eventId}>
                    <td className="date-cell">
                      <time dateTime={item.occurredAt}>
                        {dateTimeLabel(item.occurredAt)}
                      </time>
                    </td>
                    <td>
                      <span className="access-level">
                        {item.eventType.replaceAll(/[._-]+/g, " ")}
                      </span>
                    </td>
                    <td>{item.actor.name}</td>
                    <td>
                      {item.target ? (
                        <>
                          <strong>{item.target.displayId}</strong>
                          <small className="table-secondary">
                            {item.target.resourceName}
                          </small>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="audit-detail">{item.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="pagination staff-pagination">
          <span>
            Showing <strong>{data.items.length}</strong> of{" "}
            <strong>{data.pagination.total}</strong> events
          </span>
          <nav aria-label="Audit pagination">
            <Link
              className={`button button-outline ${data.pagination.page <= 1 ? "disabled-link" : ""}`}
              aria-disabled={data.pagination.page <= 1}
              tabIndex={data.pagination.page <= 1 ? -1 : undefined}
              href={hrefFor(
                filters,
                Math.max(1, data.pagination.page - 1),
              )}
            >
              Previous
            </Link>
            <span>
              Page {data.pagination.page} of{" "}
              {Math.max(1, data.pagination.pageCount)}
            </span>
            <Link
              className={`button button-outline ${data.pagination.page >= data.pagination.pageCount ? "disabled-link" : ""}`}
              aria-disabled={
                data.pagination.page >= data.pagination.pageCount
              }
              tabIndex={
                data.pagination.page >= data.pagination.pageCount
                  ? -1
                  : undefined
              }
              href={hrefFor(
                filters,
                Math.min(
                  Math.max(1, data.pagination.pageCount),
                  data.pagination.page + 1,
                ),
              )}
            >
              Next
            </Link>
          </nav>
        </div>
      </Card>
      <Alert title="Immutable and read-only" tone="info">
        Audit records cannot be edited or deleted here. Administrator access
        does not grant approval authority outside configured responsibilities.
      </Alert>
    </>
  );
}
