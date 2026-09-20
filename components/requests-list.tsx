"use client";
import { useState } from "react";
import { useDemo } from "./demo-provider";
import { isReviewer, statusLabels } from "@/lib/model";
import {
  Alert,
  Button,
  Card,
  Icon,
  LinkButton,
  PageHeading,
  exportCsv,
} from "./ui";
import { RequestTable } from "./request-table";
import { getPermissionLabel, scopeSummary } from "@/lib/resource-catalog";
export function RequestsList({
  initialStatus = "",
  review = false,
}: {
  initialStatus?: string;
  review?: boolean;
}) {
  const { state, user, setNotice } = useDemo();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState(review ? "pending" : initialStatus);
  const [resource, setResource] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [dates, setDates] = useState(false);
  if (!user) return null;
  const reviewer = isReviewer(user.role);
  const dateError = from && to && from > to;
  const owned = state.requests.filter((r) => reviewer || r.userId === user.id);
  const filterResources = state.resources.filter((candidate) =>
    owned.some((request) => request.resourceId === candidate.id),
  );
  const rows = owned.filter(
    (r) =>
      (!status || r.status === status) &&
      (!resource || r.resourceId === resource) &&
      (!from || r.createdAt.slice(0, 10) >= from) &&
      (!to || r.createdAt.slice(0, 10) <= to) &&
      `${r.id} ${state.resources.find((x) => x.id === r.resourceId)?.name} ${getPermissionLabel(r.resourceId, r.level) ?? ""} ${scopeSummary(
        r.resourceId,
        r.scope,
      )
        .map((item) => item.value)
        .join(" ")} ${state.users.find((u) => u.id === r.userId)?.name}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  const clear = () => {
    setQuery("");
    setStatus(review ? "pending" : "");
    setResource("");
    setFrom("");
    setTo("");
  };
  return (
    <>
      <PageHeading
        eyebrow={reviewer ? "WORKSPACE  ›  ACCESS REQUESTS" : undefined}
        title={
          review
            ? "Review requests"
            : reviewer
              ? "Access requests"
              : "My access requests"
        }
        description={
          review
            ? "The next step starts with your decision. Review the requests below."
            : "Track and manage resource permissions, from request to expiration."
        }
        action={
          reviewer ? (
            <Button
              variant="secondary"
              onClick={() => {
                exportCsv("permora-requests.csv", [
                  ["Request", "Resource", "Requester", "Status", "Expiration"],
                  ...rows.map((r) => [
                    r.id,
                    state.resources.find((x) => x.id === r.resourceId)?.name ??
                      "",
                    state.users.find((u) => u.id === r.userId)?.name ?? "",
                    r.status,
                    r.expiresAt,
                  ]),
                ]);
                setNotice("Filtered requests exported as CSV.");
              }}
            >
              Export list ↓
            </Button>
          ) : (
            <LinkButton href="/requests/new">+ Request new access</LinkButton>
          )
        }
      />
      {!reviewer && (
        <section
          className="request-summary metric-grid"
          aria-label="Request summary"
        >
          {[
            {
              label: "Total requests",
              value: owned.length,
              icon: "folder",
              tone: "neutral",
              hint: "All your requests",
            },
            {
              label: "Pending review",
              value: owned.filter((r) => r.status === "pending").length,
              icon: "clock",
              tone: "warning",
              hint: "Awaiting a decision",
            },
            {
              label: "Approved decisions",
              value: owned.filter((r) => r.decision?.outcome === "approved")
                .length,
              icon: "check",
              tone: "success",
              hint: `${owned.filter((r) => r.status === "active").length} active · ${owned.filter((r) => r.status === "approved").length} awaiting activation`,
            },
            {
              label: "Expired",
              value: owned.filter((r) => r.status === "expired").length,
              icon: "expire",
              tone: "neutral",
              hint: "Renewal requires a new request",
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
      )}
      <Card className={!reviewer ? "requester-list-card" : ""}>
        <div className="filters">
          <div className="filter-field filter-search">
            <label htmlFor="request-search">Search requests</label>
            <input
              id="request-search"
              placeholder="Search by resource, request ID, or name…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="filter-field">
            <label htmlFor="status-filter">Status</label>
            <select
              id="status-filter"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">All statuses</option>
              {Object.entries(statusLabels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-field">
            <label htmlFor="resource-filter">Resource</label>
            <select
              id="resource-filter"
              value={resource}
              onChange={(e) => setResource(e.target.value)}
            >
              <option value="">All resources</option>
              {filterResources.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                  {r.catalogKind === "legacy" ? " · Legacy" : ""}
                </option>
              ))}
            </select>
          </div>
          <Button
            variant="outline"
            onClick={() => setDates(!dates)}
            aria-expanded={dates}
            aria-controls="request-date-filters"
          >
            <Icon name="clock" size={14} />
            Date range
          </Button>
          <Button variant="ghost" onClick={clear}>
            Clear
          </Button>
          <div
            id="request-date-filters"
            className="date-filters"
            hidden={!dates}
          >
            <div className="filter-field">
              <label htmlFor="date-from">Requested from</label>
              <input
                id="date-from"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div className="filter-field">
              <label htmlFor="date-to">Requested until</label>
              <input
                id="date-to"
                type="date"
                value={to}
                min={from}
                aria-invalid={!!dateError}
                aria-describedby={dateError ? "request-date-error" : undefined}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
            {dateError && (
              <p id="request-date-error" role="alert" className="field-error">
                End date must be on or after the start.
              </p>
            )}
          </div>
        </div>
        <p className="sr-only" role="status">
          {dateError
            ? "Invalid date range"
            : `${rows.length} matching requests`}
        </p>
        <RequestTable
          key={`${query}-${status}-${resource}-${from}-${to}`}
          rows={dateError ? [] : rows}
          state={state}
          showRequester={reviewer}
          requesterDetails={!reviewer}
        />
      </Card>
      <Alert
        title={review ? "Review with context" : "About request processing"}
        tone="warning"
      >
        {review
          ? "Check resource compatibility, dates, and the requester’s purpose. A reason is required for both approval and denial in this prototype."
          : "These records come from the existing browser demo, not a server. Approval is a decision; activation is a separate event. Future expiration is scheduled. Renewal opens a new request and does not restore access."}
      </Alert>
    </>
  );
}
