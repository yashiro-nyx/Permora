"use client";
import { Fragment, useState } from "react";
import Link from "next/link";
import type { AccessRequestDto } from "@/lib/server/request-types";
import { dateLabel } from "@/lib/model";
import { Badge, Button, Empty, Icon, LinkButton, Pagination } from "./ui";
import { ServerTimeline } from "./server-timeline";

export function ServerRequestTable({
  rows,
  compact = false,
  paginate = true,
}: {
  rows: AccessRequestDto[];
  compact?: boolean;
  paginate?: boolean;
}) {
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const actualPage = Math.min(page, Math.max(1, Math.ceil(rows.length / 5)));
  const shown = paginate
    ? rows.slice((actualPage - 1) * 5, actualPage * 5)
    : rows;
  if (!rows.length)
    return (
      <Empty
        title="No requests to show"
        description="Requests that match your filters will appear here."
        action={
          <LinkButton href="/requests/new">Request new access</LinkButton>
        }
      />
    );
  return (
    <>
      <div
        className="table-scroll"
        tabIndex={0}
        role="region"
        aria-label="Access requests table"
      >
        <table
          className={
            compact ? "compact-table" : "request-table requester-table"
          }
        >
          <caption className="sr-only">
            Your access requests and their current status
          </caption>
          <thead>
            <tr>
              <th scope="col">Resource{!compact && " / permission"}</th>
              <th scope="col">Requested</th>
              {!compact && <th scope="col">Requested validity · UTC</th>}
              <th scope="col">Status</th>
              <th scope="col" className="request-actions-cell">
                <span className={compact ? "sr-only" : ""}>Action</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((request) => (
              <Fragment key={request.id}>
                <tr className={expanded === request.id ? "expanded-row" : ""}>
                  <td>
                    <div className="resource-name">
                      <span
                        className={`icon-tile ${request.sensitivity === "High" ? "tone-warning" : "tone-neutral"}`}
                      >
                        <Icon name={request.resourceIcon} size={16} />
                      </span>
                      <div>
                        <strong>{request.resourceName}</strong>
                        {!compact && (
                          <>
                            <small>{request.displayId}</small>
                            <span className="access-level">
                              {request.permissionLabel}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="date-cell">
                    {dateLabel(request.submittedAt)}
                  </td>
                  {!compact && (
                    <td className="date-cell">
                      {dateLabel(request.startsAt)}–
                      {dateLabel(request.expiresAt)}
                    </td>
                  )}
                  <td>
                    <Badge status={request.status} />
                    {request.status === "pending_review" && (
                      <p className="small muted">Awaiting a decision</p>
                    )}
                    {request.status === "pending_routing" && (
                      <p className="small muted">
                        An eligible approver must be configured
                      </p>
                    )}
                  </td>
                  <td className="request-actions-cell">
                    {compact ? (
                      <Link
                        className="table-link"
                        href={`/requests/${request.id}`}
                      >
                        View{" "}
                        <span className="sr-only">{request.displayId}</span>
                        <span aria-hidden="true">↗</span>
                      </Link>
                    ) : (
                      <div className="table-actions requester-actions">
                        <Button
                          variant="outline"
                          aria-expanded={expanded === request.id}
                          aria-controls={`history-${request.id}`}
                          onClick={() =>
                            setExpanded(
                              expanded === request.id ? null : request.id,
                            )
                          }
                        >
                          {expanded === request.id
                            ? "Hide details"
                            : "View details"}
                          <span className="sr-only">
                            {" "}
                            for {request.displayId}
                          </span>
                        </Button>
                        {request.status === "expired" && request.renewable && (
                          <LinkButton
                            href={`/requests/new?renew=${encodeURIComponent(request.id)}`}
                          >
                            Renew
                            <span className="sr-only">
                              {" "}
                              {request.displayId}
                            </span>
                          </LinkButton>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
                {!compact && (
                  <tr
                    hidden={expanded !== request.id}
                    className="request-detail-row"
                    id={`history-${request.id}`}
                  >
                    <td colSpan={5}>
                      <div className="inline-details">
                        <div>
                          <h3 className="eyebrow">Request information</h3>
                          <dl className="request-information">
                            <div>
                              <dt>Request ID</dt>
                              <dd>{request.displayId}</dd>
                            </div>
                            <div>
                              <dt>Resource</dt>
                              <dd>{request.resourceName}</dd>
                            </div>
                            <div>
                              <dt>Permission</dt>
                              <dd>{request.permissionLabel}</dd>
                            </div>
                            {request.scopes.map((scope) => (
                              <div key={scope.fieldName}>
                                <dt>{scope.label}</dt>
                                <dd>{scope.value}</dd>
                              </div>
                            ))}
                            <div>
                              <dt>Requested period · UTC</dt>
                              <dd>
                                {dateLabel(request.startsAt)} to{" "}
                                {dateLabel(request.expiresAt)}
                              </dd>
                            </div>
                            <div>
                              <dt>Purpose</dt>
                              <dd>{request.purpose}</dd>
                            </div>
                          </dl>
                          <Link
                            className="text-link"
                            href={`/requests/${request.id}`}
                          >
                            Open full request
                            <span className="sr-only">
                              {" "}
                              {request.displayId}
                            </span>
                          </Link>
                        </div>
                        <ServerTimeline
                          request={request}
                          title="Submission history"
                        />
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {paginate && (
        <Pagination page={actualPage} total={rows.length} onChange={setPage} />
      )}
    </>
  );
}
