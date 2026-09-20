"use client";
import Link from "next/link";
import { Fragment, useState } from "react";
import { AccessRequest, DemoState, dateLabel, levelLabels } from "@/lib/model";
import { Badge, Button, Empty, Icon, LinkButton, Pagination } from "./ui";
import { Timeline } from "./timeline";
import {
  getCatalogResource,
  getPermissionLabel,
  scopeSummary,
} from "@/lib/resource-catalog";
export function RequestTable({
  rows,
  state,
  compact = false,
  showRequester = false,
  paginate = true,
  requesterDetails = false,
}: {
  rows: AccessRequest[];
  state: DemoState;
  compact?: boolean;
  showRequester?: boolean;
  paginate?: boolean;
  requesterDetails?: boolean;
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
            compact
              ? "compact-table"
              : `request-table ${requesterDetails ? "requester-table" : ""}`
          }
        >
          <caption className="sr-only">
            Access requests and their current status
          </caption>
          <thead>
            <tr>
              {showRequester && <th scope="col">Requester</th>}
              <th scope="col">Resource{!compact && " / permission"}</th>
              <th scope="col">Requested</th>
              {!compact && <th scope="col">Validity · UTC</th>}
              <th scope="col">Status</th>
              <th
                scope="col"
                className={
                  requesterDetails ? "request-actions-cell" : undefined
                }
              >
                <span className={compact ? "sr-only" : ""}>Action</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const resource = state.resources.find(
                (x) => x.id === r.resourceId,
              );
              const owner = state.users.find((u) => u.id === r.userId);
              return (
                <Fragment key={r.id}>
                  <tr className={expanded === r.id ? "expanded-row" : ""}>
                    {showRequester && (
                      <td>
                        <strong>{owner?.name}</strong>
                        <div className="muted small">{owner?.department}</div>
                      </td>
                    )}
                    <td>
                      <div className="resource-name">
                        <span
                          className={`icon-tile ${resource?.sensitivity === "High" ? "tone-warning" : resource?.category === "Applications" ? "tone-info" : "tone-neutral"}`}
                        >
                          <Icon name={resource?.icon ?? "folder"} size={16} />
                        </span>
                        <div>
                          <strong>
                            {resource?.name ?? "Removed resource"}
                          </strong>
                          {!compact && (
                            <>
                              <small>{r.id}</small>
                              <span className="access-level">
                                {getPermissionLabel(r.resourceId, r.level) ??
                                  levelLabels[r.level]}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="date-cell">{dateLabel(r.createdAt)}</td>
                    {!compact && (
                      <td className="date-cell">
                        {requesterDetails &&
                        ["pending", "denied"].includes(r.status) ? (
                          <>
                            <span aria-hidden="true">—</span>
                            <span className="sr-only">
                              No granted validity period
                            </span>
                          </>
                        ) : (
                          <>
                            {dateLabel(r.startsAt)}
                            <br />
                            <span className="muted">
                              to {dateLabel(r.expiresAt)}
                            </span>
                          </>
                        )}
                      </td>
                    )}
                    <td>
                      <Badge status={r.status} />
                      {requesterDetails &&
                        r.status === "denied" &&
                        r.decision && (
                          <p className="request-denial">
                            <strong>Reason:</strong> {r.decision.reason}
                          </p>
                        )}
                      {requesterDetails && r.status === "approved" && (
                        <p className="small muted">Approved · not yet active</p>
                      )}
                    </td>
                    <td
                      className={
                        requesterDetails ? "request-actions-cell" : undefined
                      }
                    >
                      {compact ? (
                        <Link
                          className="table-link"
                          href={`/requests/${r.id}`}
                          aria-label={`View ${r.id}`}
                        >
                          View <span aria-hidden="true">↗</span>
                        </Link>
                      ) : requesterDetails ? (
                        <div className="table-actions requester-actions">
                          <Button
                            variant="outline"
                            aria-expanded={expanded === r.id}
                            aria-controls={`history-${r.id}`}
                            onClick={() =>
                              setExpanded(expanded === r.id ? null : r.id)
                            }
                          >
                            {expanded === r.id
                              ? "Hide details"
                              : "View details"}
                            <span className="sr-only"> for {r.id}</span>
                          </Button>
                          {r.status === "expired" &&
                            getCatalogResource(r.resourceId)?.validity
                              .renewable !== false && (
                              <LinkButton
                                href={`/requests/new?renew=${encodeURIComponent(r.id)}`}
                              >
                                Renew<span className="sr-only"> {r.id}</span>
                              </LinkButton>
                            )}
                        </div>
                      ) : (
                        <div className="table-actions">
                          <Link
                            className="table-link"
                            href={`/requests/${r.id}`}
                          >
                            View details
                            <span className="sr-only"> for {r.id}</span>
                          </Link>
                          <Button
                            variant="ghost"
                            aria-label={`${expanded === r.id ? "Collapse" : "Expand"} history for ${r.id}`}
                            aria-expanded={expanded === r.id}
                            aria-controls={`history-${r.id}`}
                            onClick={() =>
                              setExpanded(expanded === r.id ? null : r.id)
                            }
                          >
                            {expanded === r.id ? "−" : "+"}
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                  <tr
                    hidden={expanded !== r.id}
                    className="request-detail-row"
                    id={`history-${r.id}`}
                  >
                    <td colSpan={showRequester ? 6 : 5}>
                      <div className="inline-details">
                        <div>
                          <h3 className="eyebrow">Request information</h3>
                          <dl className="request-information">
                            <div>
                              <dt>Request ID</dt>
                              <dd>{r.id}</dd>
                            </div>
                            <div>
                              <dt>Resource</dt>
                              <dd>{resource?.name ?? "Removed resource"}</dd>
                            </div>
                            <div>
                              <dt>Permission</dt>
                              <dd>
                                {getPermissionLabel(r.resourceId, r.level) ??
                                  levelLabels[r.level]}
                              </dd>
                            </div>
                            {scopeSummary(r.resourceId, r.scope).map((item) => (
                              <div key={item.label}>
                                <dt>{item.label}</dt>
                                <dd>{item.value}</dd>
                              </div>
                            ))}
                            <div>
                              <dt>Requested period · UTC</dt>
                              <dd>
                                {dateLabel(r.startsAt)} to{" "}
                                {dateLabel(r.expiresAt)}
                              </dd>
                            </div>
                            <div>
                              <dt>Purpose</dt>
                              <dd>{r.purpose}</dd>
                            </div>
                          </dl>
                          {r.decision && (
                            <p>
                              <strong>Decision reason:</strong>{" "}
                              {r.decision.reason}
                            </p>
                          )}
                          <Link
                            className="text-link"
                            href={`/requests/${r.id}`}
                          >
                            Open full request
                            <span className="sr-only"> {r.id}</span>
                          </Link>
                        </div>
                        <Timeline
                          request={r}
                          state={state}
                          title={
                            requesterDetails
                              ? "Approval timeline"
                              : "Activity timeline"
                          }
                        />
                      </div>
                    </td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {paginate && (
        <Pagination page={actualPage} total={rows.length} onChange={setPage} />
      )}
    </>
  );
}
