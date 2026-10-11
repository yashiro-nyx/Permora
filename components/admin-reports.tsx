"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { AnalyticsSummaryDto } from "@/lib/server/admin-governance-types";
import {
  deriveRequestCounts,
  formatCount,
  formatGeneratedAt,
  formatTurnaround,
  hasAnyData,
  reportableRequestStatuses,
  statusBreakdown,
  validateReportFilters,
} from "@/lib/reports-ui";
import { Alert, Card, Empty, Icon, PageHeading } from "./ui";

interface StatCard {
  label: string;
  value: string;
  note: string;
  icon: string;
  tone: "info" | "success" | "warning" | "danger" | "neutral";
}

export function AdminReports({
  summary,
  resources,
  filters,
  filterError,
}: {
  summary: AnalyticsSummaryDto;
  resources: Array<{ id: string; name: string }>;
  filters: { from: string; to: string; resource: string; status: string };
  filterError?: string;
}) {
  const router = useRouter();
  const [from, setFrom] = useState(filters.from);
  const [to, setTo] = useState(filters.to);
  const [resource, setResource] = useState(filters.resource);
  const [status, setStatus] = useState(filters.status);
  const [formError, setFormError] = useState("");

  const requests = deriveRequestCounts(summary.requests);
  const breakdown = statusBreakdown(summary.requests);
  const breakdownMax = Math.max(1, ...breakdown.map((row) => row.count));
  const hasData = hasAnyData(summary);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validation = validateReportFilters({ from, to, resource, status });
    if (validation) {
      setFormError(validation);
      return;
    }
    setFormError("");
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (resource) params.set("resource", resource);
    if (status) params.set("status", status);
    const query = params.toString();
    router.push(`/reports${query ? `?${query}` : ""}`);
  }

  function clearFilters() {
    setFrom("");
    setTo("");
    setResource("");
    setStatus("");
    setFormError("");
    router.push("/reports");
  }

  const requestCards: StatCard[] = [
    {
      label: "Total requests",
      value: formatCount(requests.total),
      note: "All access requests in scope",
      icon: "requests",
      tone: "info",
    },
    {
      label: "Pending",
      value: formatCount(requests.pending),
      note: "Awaiting routing or review",
      icon: "clock",
      tone: "warning",
    },
    {
      label: "Approved (pending activation)",
      value: formatCount(requests.approvedPendingActivation),
      note: "Approved; not yet active access",
      icon: "check",
      tone: "success",
    },
    {
      label: "Denied",
      value: formatCount(requests.denied),
      note: "Declined by an approver",
      icon: "shield",
      tone: "danger",
    },
    {
      label: "Revision requested",
      value: formatCount(requests.returnedForRevision),
      note: "Returned to the requester",
      icon: "review",
      tone: "neutral",
    },
    {
      label: "Awaiting activation",
      value: formatCount(summary.requests.awaitingActivation),
      note: "Approved with no activation record",
      icon: "key",
      tone: "warning",
    },
  ];

  const activationCards: StatCard[] = [
    {
      label: "Activated",
      value: formatCount(summary.activation.activated),
      note: "Access successfully activated",
      icon: "check",
      tone: "success",
    },
    {
      label: "Activation failed",
      value: formatCount(summary.activation.failed),
      note: "Attempts recorded as failed",
      icon: "shield",
      tone: "danger",
    },
    {
      label: "Activating",
      value: formatCount(summary.activation.activating),
      note: "In-progress activation records",
      icon: "clock",
      tone: "info",
    },
    {
      label: "Active entitlements",
      value: formatCount(summary.entitlements.active),
      note: "Current, non-expired grants",
      icon: "key",
      tone: "success",
    },
    {
      label: "Expired entitlements",
      value: formatCount(summary.entitlements.expired),
      note: "Grants past their validity",
      icon: "expire",
      tone: "neutral",
    },
    {
      label: "Revoked",
      value: formatCount(summary.entitlements.revoked),
      note: "Deliberately revoked activations",
      icon: "shield",
      tone: "danger",
    },
  ];

  function renderCards(cards: StatCard[]) {
    return (
      <div className="metric-grid">
        {cards.map((card) => (
          <Card key={card.label}>
            <div className="metric">
              <span className={`icon-tile tone-${card.tone}`}>
                <Icon name={card.icon} size={24} />
              </span>
              <div>
                <div className="metric-label">{card.label}</div>
                <div className="metric-value">{card.value}</div>
                <div className="metric-note">{card.note}</div>
              </div>
            </div>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <>
      <PageHeading
        eyebrow="ADMIN › REPORTS"
        title="Reports & analytics"
        description="Operational metrics aggregated from live PostgreSQL records. Approval and successful activation are reported separately."
      />
      <Alert title="Live operational data" tone="info">
        These figures are computed from current database records when the page
        loads. Approval (approved — awaiting activation) is distinct from
        successful access activation. No personal request content is shown.
      </Alert>
      {filterError && (
        <Alert title="Filter not applied" tone="danger">
          {filterError} Showing the unfiltered summary.
        </Alert>
      )}
      <Card title="Filters">
        <form className="reports-filters" onSubmit={applyFilters}>
          <div className="reports-filter-grid">
            <div className="field">
              <label htmlFor="report-from">From</label>
              <input
                id="report-from"
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="report-to">Until</label>
              <input
                id="report-to"
                type="date"
                value={to}
                min={from || undefined}
                onChange={(event) => setTo(event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="report-resource">Resource</label>
              <select
                id="report-resource"
                value={resource}
                onChange={(event) => setResource(event.target.value)}
              >
                <option value="">All resources</option>
                {resources.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="report-status">Request status</label>
              <select
                id="report-status"
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                <option value="">All statuses</option>
                {reportableRequestStatuses.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </div>
          </div>
          {formError && <p className="field-error" role="alert">{formError}</p>}
          <div className="reports-filter-actions">
            <button className="button button-primary" type="submit">Apply filters</button>
            <button className="button button-ghost" type="button" onClick={clearFilters}>
              All time
            </button>
            <span className="small muted">
              Date range applies to request submission dates.
            </span>
          </div>
        </form>
      </Card>
      {!hasData ? (
        <Card>
          <Empty
            title="No data for this view"
            description="No records match the current filters. Adjust the range or clear the filters to see all activity."
          />
        </Card>
      ) : (
        <>
          <Card title="Requests">{renderCards(requestCards)}</Card>
          <Card title="Activation & entitlements">{renderCards(activationCards)}</Card>
          <div className="reports-grid">
            <Card title="Requests by status">
              {breakdown.length ? (
                <div className="bar-chart">
                  {breakdown.map((row) => (
                    <div key={row.status}>
                      <div className="spread">
                        <span>{row.label}</span>
                        <strong>{formatCount(row.count)} · {row.percentage}%</strong>
                      </div>
                      <div className="bar-track">
                        <div style={{ width: `${(row.count / breakdownMax) * 100}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty title="No requests in this view" />
              )}
            </Card>
            <Card title="Approver workload">
              {summary.approverWorkload.length ? (
                <div className="table-scroll" role="region" aria-label="Approver workload" tabIndex={0}>
                  <table className="responsibility-table">
                    <caption className="sr-only">Open assignments per approver</caption>
                    <thead>
                      <tr>
                        <th scope="col">Approver</th>
                        <th scope="col">Open assignments</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.approverWorkload.map((row) => (
                        <tr key={row.approverName}>
                          <td>{row.approverName}</td>
                          <td>{formatCount(row.openAssignments)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty
                  title="No open assignments"
                  description="No approver currently has an open review assignment."
                />
              )}
            </Card>
          </div>
          <div className="report-metrics">
            <Card>
              <div className="metric">
                <span className="icon-tile tone-info"><Icon name="clock" size={24} /></span>
                <div>
                  <div className="metric-label">Average approval turnaround</div>
                  <div className="metric-value">{formatTurnaround(summary.approvalTurnaroundHours)}</div>
                  <div className="metric-note">From submission to decision</div>
                </div>
              </div>
            </Card>
            <Card>
              <div className="metric">
                <span className="icon-tile tone-neutral"><Icon name="users" size={24} /></span>
                <div>
                  <div className="metric-label">Accounts</div>
                  <div className="metric-value">{formatCount(summary.users.total)}</div>
                  <div className="metric-note">
                    {formatCount(summary.users.active)} active · {formatCount(summary.users.inactive)} inactive
                  </div>
                </div>
              </div>
            </Card>
            <Card>
              <div className="metric">
                <span className="icon-tile tone-success"><Icon name="key" size={24} /></span>
                <div>
                  <div className="metric-label">Active access</div>
                  <div className="metric-value">{formatCount(summary.entitlements.active)}</div>
                  <div className="metric-note">Entitlements currently valid</div>
                </div>
              </div>
            </Card>
          </div>
        </>
      )}
      <p className="small muted" role="status">
        Generated {formatGeneratedAt(summary.generatedAt)} · Asia/Manila
      </p>
    </>
  );
}
