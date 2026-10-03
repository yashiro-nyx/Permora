"use client";

import Link from "next/link";
import type {
  ApprovalListFilters,
  PaginatedDto,
  UnassignedRequestDto,
} from "@/lib/server/approval-read-types";
import { AdminUnassignedAssignment } from "./admin-unassigned-assignment";
import { Alert, Card, Empty, LinkButton, PageHeading } from "./ui";

function hrefFor(filters: ApprovalListFilters, page: number) {
  const params = new URLSearchParams();
  if (filters.search) params.set("search", filters.search);
  if (filters.resource) params.set("resource", filters.resource);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  params.set("page", String(page));
  params.set("pageSize", String(filters.pageSize));
  return `/admin/unassigned?${params}`;
}

export function AdminUnassignedAssignments({
  data,
  filters,
  invalidMessage,
}: {
  data: PaginatedDto<UnassignedRequestDto>;
  filters: ApprovalListFilters;
  invalidMessage?: string;
}) {
  return (
    <>
      <PageHeading
        eyebrow="ADMIN › ROUTING"
        title="Unassigned requests"
        description="Assign pending-routing requests only to approvers currently eligible for the request’s resource, permission, and scope."
      />
      {invalidMessage && <Alert title="Filters could not be applied" tone="danger">{invalidMessage}</Alert>}
      <Alert title="Routing rules remain in force" tone="warning">
        Assignment does not bypass approver responsibilities or grant review authority outside the configured scope.
      </Alert>
      <Card title="Pending routing" className="staff-queue-card">
        <form className="filters" method="get" action="/admin/unassigned">
          <div className="filter-field filter-search">
            <label htmlFor="unassigned-search">Search</label>
            <input id="unassigned-search" name="search" maxLength={100} placeholder="Request ID, requester, resource, or permission…" defaultValue={filters.search} />
          </div>
          <div className="filter-field">
            <label htmlFor="unassigned-from">Submitted from</label>
            <input id="unassigned-from" name="from" type="date" defaultValue={filters.from} />
          </div>
          <div className="filter-field">
            <label htmlFor="unassigned-to">Submitted until</label>
            <input id="unassigned-to" name="to" type="date" min={filters.from} defaultValue={filters.to} />
          </div>
          <button className="button button-primary" type="submit">Apply filters</button>
          <LinkButton href="/admin/unassigned" variant="ghost">Clear</LinkButton>
        </form>
        <p className="sr-only" role="status">{data.pagination.total} pending-routing requests</p>
        {!data.items.length ? (
          <Empty title="No unassigned requests" description="Pending-routing requests matching these filters will appear here." />
        ) : (
          <div className="table-scroll" role="region" aria-label="Unassigned requests table" tabIndex={0}>
            <table className="staff-review-table">
              <caption className="sr-only">Pending-routing requests and currently eligible approvers</caption>
              <thead>
                <tr>
                  <th scope="col">Requester</th>
                  <th scope="col">Resource / permission</th>
                  <th scope="col">Submitted</th>
                  <th scope="col">Status</th>
                  <th scope="col">Routing reason</th>
                  <th scope="col">Eligible assignees</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.requestId} data-request-version={item.version}>
                    <td>
                      <strong>{item.requester.name}</strong>
                      <small className="table-secondary">{item.requester.requesterRole} · {item.displayId}</small>
                    </td>
                    <td>
                      <strong>{item.resource.name}</strong>
                      <small className="table-secondary">{item.permission.label}</small>
                    </td>
                    <td className="date-cell">{new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeZone: "Asia/Manila" }).format(new Date(item.submittedAt))}</td>
                    <td><span className="badge tone-warning"><span className="status-dot" aria-hidden="true" />Pending routing</span></td>
                    <td className="table-secondary">{item.routingReason ?? "No eligible approver was available during routing."}</td>
                    <td><AdminUnassignedAssignment request={item} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data.pagination.total > data.pagination.pageSize && (
          <div className="pagination staff-pagination">
            <span>Showing <strong>{data.items.length}</strong> of <strong>{data.pagination.total}</strong> results</span>
            <nav aria-label="Unassigned request pagination">
              <Link className={`button button-outline ${data.pagination.page <= 1 ? "disabled-link" : ""}`} aria-disabled={data.pagination.page <= 1} tabIndex={data.pagination.page <= 1 ? -1 : undefined} href={hrefFor(filters, Math.max(1, data.pagination.page - 1))}>Previous</Link>
              <span>Page {data.pagination.page} of {Math.max(1, data.pagination.pageCount)}</span>
              <Link className={`button button-outline ${data.pagination.page >= data.pagination.pageCount ? "disabled-link" : ""}`} aria-disabled={data.pagination.page >= data.pagination.pageCount} tabIndex={data.pagination.page >= data.pagination.pageCount ? -1 : undefined} href={hrefFor(filters, Math.min(data.pagination.pageCount, data.pagination.page + 1))}>Next</Link>
            </nav>
          </div>
        )}
      </Card>
    </>
  );
}