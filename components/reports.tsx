"use client";
import { useState } from "react";
import Link from "next/link";
import { useDemo } from "./demo-provider";
import { ActivityChart } from "./charts";
import {
  Alert,
  Badge,
  Button,
  Card,
  Empty,
  Icon,
  PageHeading,
  exportCsv,
} from "./ui";
import { dateLabel } from "@/lib/model";
export function Reports() {
  const { state } = useDemo();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const requests = state.requests.filter(
    (r) =>
      (!from || r.createdAt.slice(0, 10) >= from) &&
      (!to || r.createdAt.slice(0, 10) <= to),
  );
  const reviewed = requests.filter((r) => r.decision);
  const approved = reviewed.filter(
    (r) => r.decision?.outcome === "approved",
  ).length;
  const denied = reviewed.length - approved;
  const pending = requests.filter((r) => r.status === "pending").length;
  const hours = reviewed.length
    ? reviewed.reduce(
        (n, r) =>
          n + (Date.parse(r.decision!.at) - Date.parse(r.createdAt)) / 3600000,
        0,
      ) / reviewed.length
    : 0;
  const total = approved + denied + pending;
  const approvalAngle = total ? (approved / total) * 360 : 0;
  const denialAngle = total ? ((approved + denied) / total) * 360 : 0;
  const events = state.audit.filter(
    (e) =>
      (!from || e.at.slice(0, 10) >= from) && (!to || e.at.slice(0, 10) <= to),
  );
  const counts = state.resources
    .map((r) => ({
      name: r.name,
      count: requests.filter((q) => q.resourceId === r.id).length,
    }))
    .sort((a, b) => b.count - a.count);
  const max = Math.max(1, ...counts.map((c) => c.count));
  return (
    <>
      <PageHeading
        eyebrow="ADMIN  ›  REPORTS"
        title="Reports & analytics"
        description="Understand access patterns and decisions across your demo workspace."
        action={
          <>
            <Button
              variant="secondary"
              onClick={() =>
                exportCsv("permora-report.csv", [
                  ["Metric", "Value"],
                  ["Requests", requests.length],
                  ["Approved", approved],
                  ["Denied", denied],
                  ["Pending", pending],
                  ["Average review hours", hours.toFixed(1)],
                  ...counts.map((c) => [c.name, c.count]),
                ])
              }
            >
              Export CSV ↓
            </Button>
            <Button onClick={() => window.print()}>Print / save PDF</Button>
          </>
        }
      />
      <Card>
        <div className="filters">
          <div className="filter-field">
            <label htmlFor="report-from">From</label>
            <input
              id="report-from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div className="filter-field">
            <label htmlFor="report-to">Until</label>
            <input
              id="report-to"
              type="date"
              value={to}
              min={from}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
          <Button
            variant="ghost"
            onClick={() => {
              setFrom("");
              setTo("");
            }}
          >
            All time
          </Button>
          <span className="small muted">
            Based on request submission dates · UTC
          </span>
        </div>
      </Card>
      {from && to && from > to ? (
        <Alert title="Invalid date range" tone="danger">
          Choose an end date on or after the start.
        </Alert>
      ) : (
        <>
          <div className="report-metrics">
            {[
              {
                label: "Average review time",
                value: reviewed.length
                  ? `${hours.toFixed(1)} hours`
                  : "No decisions",
                icon: "clock",
                tone: "info",
              },
              {
                label: "Recorded demo events",
                value: events.length,
                icon: "audit",
                tone: "success",
              },
              {
                label: "Requests with expiration",
                value: requests.length
                  ? `${Math.round((requests.filter((r) => r.expiresAt).length / requests.length) * 100)}%`
                  : "No requests",
                icon: "expire",
                tone: "warning",
              },
            ].map((m) => (
              <Card key={m.label}>
                <div className="metric">
                  <span className={`icon-tile tone-${m.tone}`}>
                    <Icon name={m.icon} size={24} />
                  </span>
                  <div>
                    <div className="metric-label">{m.label}</div>
                    <div className="metric-value">{m.value}</div>
                    <div className="metric-note">Calculated from demo data</div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
          <div className="reports-grid">
            <Card title="Request volume · last 7 demo days">
              <ActivityChart requests={requests} state={state} />
            </Card>
            <Card title="Approval vs. denial">
              <div className="donut-panel">
                {total ? (
                  <div
                    className="donut"
                    role="img"
                    aria-label={`${approved} approved, ${denied} denied, ${pending} pending`}
                    style={{
                      background: `conic-gradient(var(--success) 0deg ${approvalAngle}deg,var(--danger) ${approvalAngle}deg ${denialAngle}deg,var(--primary) ${denialAngle}deg 360deg)`,
                    }}
                  >
                    <div>
                      <strong>{total}</strong>
                      <span>requests</span>
                    </div>
                  </div>
                ) : (
                  <Empty title="No decision data" />
                )}
                <div className="donut-legend">
                  <Badge tone="success" label={`${approved} approved`} />
                  <Badge tone="danger" label={`${denied} denied`} />
                  <Badge tone="warning" label={`${pending} pending`} />
                </div>
                <p className="small muted">
                  Decision outcomes; active and expired grants retain their
                  approval history.
                </p>
              </div>
            </Card>
            <Card title="Most requested resources">
              <div className="bar-chart">
                {counts.map((c) => (
                  <div key={c.name}>
                    <div className="spread">
                      <span>{c.name}</span>
                      <strong>{c.count}</strong>
                    </div>
                    <div className="bar-track">
                      <div style={{ width: `${(c.count / max) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </Card>
            <Card
              title="Recent policy & access events"
              action={
                <Link className="text-link" href="/audit">
                  View all
                </Link>
              }
            >
              <ul className="report-events">
                {events.slice(0, 5).map((e) => (
                  <li key={e.id}>
                    <span className="icon-tile tone-neutral">
                      <Icon name="clock" size={16} />
                    </span>
                    <div>
                      <strong>{e.action}</strong>
                      <p>{e.detail}</p>
                      <small>{dateLabel(e.at)}</small>
                    </div>
                  </li>
                ))}
              </ul>
              {!events.length && <Empty title="No events in this period" />}
            </Card>
          </div>
        </>
      )}
      <Alert title="Prototype reporting" tone="info">
        Metrics come from the saved demo requests and events. They do not
        represent live security monitoring or a compliance certification.
      </Alert>
    </>
  );
}
