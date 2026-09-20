import type {
  AccessRequestDto,
  RequestCountsDto,
} from "@/lib/server/request-types";
import { statusLabels } from "@/lib/model";
import { Card, Icon, LinkButton, PageHeading } from "./ui";
import { ServerRequestTable } from "./server-request-table";

export function ServerRequestsList({
  rows,
  counts,
  filters,
  resources,
}: {
  rows: AccessRequestDto[];
  counts: RequestCountsDto;
  filters: Record<string, string | undefined>;
  resources: { id: string; name: string }[];
}) {
  return (
    <>
      <PageHeading
        title="My access requests"
        description="Track your submitted requests. Approval and access activation are separate later-stage actions."
        action={
          <LinkButton href="/requests/new">+ Request new access</LinkButton>
        }
      />
      <section
        className="request-summary metric-grid"
        aria-label="Request summary"
      >
        {[
          {
            label: "Total requests",
            value: counts.total,
            icon: "folder",
            tone: "neutral",
            hint: "All your persisted requests",
          },
          {
            label: "Pending review",
            value: counts.pending,
            icon: "clock",
            tone: "warning",
            hint: "Awaiting a decision",
          },
          {
            label: "Approved decisions",
            value: counts.approved,
            icon: "check",
            tone: "success",
            hint: "Approval is deferred in Stage 2A",
          },
          {
            label: "Expired",
            value: counts.expired,
            icon: "expire",
            tone: "neutral",
            hint: "Renewal creates a new request",
          },
        ].map((metric) => (
          <Card
            key={metric.label}
            className={`request-summary-card summary-${metric.tone}`}
          >
            <div className="spread">
              <h2>{metric.label}</h2>
              <Icon name={metric.icon} size={18} />
            </div>
            <p className="metric-value">
              {String(metric.value).padStart(2, "0")}
            </p>
            <p className="small muted">{metric.hint}</p>
          </Card>
        ))}
      </section>
      <Card className="requester-list-card">
        <form className="filters" method="get" action="/requests">
          <div className="filter-field filter-search">
            <label htmlFor="request-search">Search requests</label>
            <input
              id="request-search"
              name="query"
              placeholder="Search by resource, request ID, or permission…"
              defaultValue={filters.query}
            />
          </div>
          <div className="filter-field">
            <label htmlFor="status-filter">Status</label>
            <select
              id="status-filter"
              name="status"
              defaultValue={filters.status}
            >
              <option value="">All statuses</option>
              {["pending", "denied", "expired"].map((key) => (
                <option key={key} value={key}>
                  {statusLabels[key as keyof typeof statusLabels]}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-field">
            <label htmlFor="resource-filter">Resource</label>
            <select
              id="resource-filter"
              name="resource"
              defaultValue={filters.resource}
            >
              <option value="">All resources</option>
              {resources.map((resource) => (
                <option key={resource.id} value={resource.id}>
                  {resource.name}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-field">
            <label htmlFor="date-from">Requested from</label>
            <input
              id="date-from"
              name="from"
              type="date"
              defaultValue={filters.from}
            />
          </div>
          <div className="filter-field">
            <label htmlFor="date-to">Requested until</label>
            <input
              id="date-to"
              name="to"
              type="date"
              defaultValue={filters.to}
              min={filters.from}
            />
          </div>
          <button className="button button-outline" type="submit">
            Apply filters
          </button>
          <LinkButton href="/requests" variant="ghost">
            Clear
          </LinkButton>
        </form>
        <p className="sr-only" role="status">
          {rows.length} matching requests
        </p>
        <ServerRequestTable rows={rows} />
      </Card>
    </>
  );
}
