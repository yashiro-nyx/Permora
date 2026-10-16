import Link from "next/link";
import { RESOURCE_CATALOG } from "@/lib/resource-catalog";
import { dateLabel, statusLabels } from "@/lib/model";
import type {
  ApprovalListFilters,
  PaginatedDto,
  ReviewQueueItemDto,
  UnassignedRequestDto,
} from "@/lib/server/approval-read-types";
import { reviewQueueActionLabel } from "@/lib/review-ui";
import {
  Alert,
  Badge,
  Card,
  Empty,
  LinkButton,
  PageHeading,
  TablePagination,
} from "./ui";

type QueueData =
  | PaginatedDto<ReviewQueueItemDto>
  | PaginatedDto<UnassignedRequestDto>;

function assignmentAge(value: string) {
  const milliseconds = Math.max(0, Date.now() - Date.parse(value));
  const hours = Math.floor(milliseconds / 3_600_000);
  if (hours < 1) return "Less than 1 hour";
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

export function StaffReviewQueue({
  data,
  filters,
  mode = "assigned",
  invalidMessage,
}: {
  data: QueueData;
  filters: ApprovalListFilters;
  mode?: "assigned" | "unassigned";
  invalidMessage?: string;
}) {
  const unassigned = mode === "unassigned";
  const pathname = unassigned ? "/admin/unassigned" : "/review";
  const title = unassigned ? "Unassigned requests" : "Review requests";
  const description = unassigned
    ? "Requests awaiting valid approval routing. Assignment is allowed only for currently eligible approvers; routing rules are not bypassed."
    : "Review requests assigned to you and make decisions within your configured responsibilities.";
  return (
    <>
      <PageHeading
        eyebrow={unassigned ? "ADMIN › ROUTING" : "STAFF › REVIEW QUEUE"}
        title={title}
        description={description}
      />
      {invalidMessage && (
        <Alert title="Filters could not be applied" tone="danger">
          {invalidMessage}
        </Alert>
      )}
      {unassigned && (
        <Alert title="Routing must succeed before review" tone="warning">
          Manual approval and responsibility bypasses are unavailable. An
          administrator must correct the underlying responsibility or scope
          configuration, then run the controlled routing reconciliation.
        </Alert>
      )}
      <Card className="staff-queue-card">
        <form className="filters" method="get" action={pathname}>
          <div className="filter-field filter-search">
            <label htmlFor="review-search">Search</label>
            <input
              id="review-search"
              name="search"
              maxLength={100}
              placeholder="Request ID, requester, resource, or permission…"
              defaultValue={filters.search}
            />
          </div>
          {!unassigned && (
            <div className="filter-field">
              <label htmlFor="review-status">Status</label>
              <select
                id="review-status"
                name="status"
                defaultValue={filters.status}
              >
                <option value="">All statuses</option>
                {[
                  "pending_review",
                  "approved_pending_activation",
                  "denied",
                  "returned_for_revision",
                  "expired",
                  "cancelled",
                ].map((status) => (
                  <option key={status} value={status}>
                    {statusLabels[status as keyof typeof statusLabels]}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="filter-field">
            <label htmlFor="review-resource">Resource</label>
            <select
              id="review-resource"
              name="resource"
              defaultValue={filters.resource}
            >
              <option value="">All resources</option>
              {RESOURCE_CATALOG.map((resource) => (
                <option key={resource.id} value={resource.id}>
                  {resource.name}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-field">
            <label htmlFor="review-from">Submitted from</label>
            <input
              id="review-from"
              name="from"
              type="date"
              defaultValue={filters.from}
            />
          </div>
          <div className="filter-field">
            <label htmlFor="review-to">Submitted until</label>
            <input
              id="review-to"
              name="to"
              type="date"
              min={filters.from}
              defaultValue={filters.to}
            />
          </div>
          <button className="button button-outline" type="submit">
            Apply filters
          </button>
          <LinkButton href={pathname} variant="ghost">
            Clear
          </LinkButton>
        </form>
        <p className="sr-only" role="status">
          {data.pagination.total} matching requests
        </p>
        {!data.items.length ? (
          <Empty
            title={unassigned ? "No unassigned requests" : "No reviews to show"}
            description={
              unassigned
                ? "No pending routing failures match these filters."
                : "Assigned requests that match these filters will appear here."
            }
          />
        ) : (
          <div
            className="table-scroll"
            role="region"
            aria-label={`${title} table`}
            tabIndex={0}
          >
            <table className="staff-review-table">
              <caption className="sr-only">{description}</caption>
              <thead>
                <tr>
                  <th scope="col">Requester</th>
                  <th scope="col">Resource / permission</th>
                  <th scope="col">Submitted</th>
                  {!unassigned && <th scope="col">Requested validity</th>}
                  <th scope="col">Status</th>
                  <th scope="col">
                    {unassigned ? "Routing state" : "Assignment age"}
                  </th>
                  {unassigned && <th scope="col">Routing reason</th>}
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => {
                  const assigned = "assignedAt" in item ? item : null;
                  return (
                    <tr key={item.requestId}>
                      <td>
                        <strong>{item.requester.name}</strong>
                        <small className="table-secondary">
                          {item.requester.requesterRole} · {item.displayId}
                        </small>
                      </td>
                      <td>
                        <strong>{item.resource.name}</strong>
                        <small className="table-secondary">
                          {item.permission.label}
                        </small>
                      </td>
                      <td className="date-cell">{dateLabel(item.submittedAt)}</td>
                      {assigned && (
                        <td className="date-cell">
                          {dateLabel(assigned.requestedValidity.startsAt)}–
                          {dateLabel(assigned.requestedValidity.expiresAt)}
                        </td>
                      )}
                      <td>
                        <Badge status={item.status} />
                      </td>
                      <td className="date-cell">
                        {assigned
                          ? assignmentAge(assigned.assignedAt)
                          : "Awaiting eligible approver"}
                      </td>
                      {unassigned && (
                        <td className="table-secondary">
                          {"routingReason" in item && item.routingReason
                            ? item.routingReason
                            : "No fully eligible approver was available."}
                        </td>
                      )}
                      {assigned && (
                        <td>
                          <Link
                            href={`/review/${encodeURIComponent(item.requestId)}`}
                            className="table-link"
                          >
                            {reviewQueueActionLabel(assigned.status)}
                            <span className="sr-only">
                              {" "}
                              {item.displayId}
                            </span>
                          </Link>
                        </td>
                      )}
                      {unassigned && (
                        <td>
                          <Link
                            href={`/admin/unassigned/${encodeURIComponent(item.requestId)}`}
                            className="table-link"
                          >
                            Assign eligible approver
                            <span className="sr-only"> {item.displayId}</span>
                          </Link>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {data.items.length > 0 && (
          <TablePagination
            page={data.pagination.page}
            pageSize={data.pagination.pageSize}
            total={data.pagination.total}
            pageCount={data.pagination.pageCount}
            itemCount={data.items.length}
            label={`${title} pagination`}
          />
        )}
      </Card>
    </>
  );
}
