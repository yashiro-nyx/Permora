"use client";
import Link from "next/link";
import { useState } from "react";
import { useDemo } from "./demo-provider";
import {
  Badge,
  Button,
  Card,
  Empty,
  PageHeading,
  Pagination,
  exportCsv,
  Alert,
} from "./ui";
import { dateLabel, timeLabel } from "@/lib/model";
export function Audit() {
  const { state } = useDemo();
  const [query, setQuery] = useState("");
  const [action, setAction] = useState("");
  const [resource, setResource] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const invalid = from && to && from > to;
  const filtered = state.audit.filter(
    (e) =>
      (!action || e.action === action) &&
      (!resource || e.resourceId === resource) &&
      (!from || e.at.slice(0, 10) >= from) &&
      (!to || e.at.slice(0, 10) <= to) &&
      `${e.action} ${e.detail} ${e.requestId ?? ""} ${state.users.find((u) => u.id === e.actor)?.name ?? e.actor} ${state.resources.find((r) => r.id === e.resourceId)?.name ?? ""}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const current = Math.min(page, Math.max(1, Math.ceil(filtered.length / 8)));
  return (
    <>
      <PageHeading
        eyebrow="ADMIN  ›  HISTORY"
        title="History / audit logs"
        description="A clear record of decisions and changes in your demo workspace."
        action={
          <>
            <Button
              variant="outline"
              onClick={() =>
                exportCsv("permora-audit.csv", [
                  [
                    "Timestamp UTC",
                    "Actor",
                    "Action",
                    "Request",
                    "Resource",
                    "Status",
                    "Detail",
                  ],
                  ...filtered.map((e) => [
                    e.at,
                    state.users.find((u) => u.id === e.actor)?.name ?? e.actor,
                    e.action,
                    e.requestId ?? "",
                    state.resources.find((r) => r.id === e.resourceId)?.name ??
                      "",
                    e.status ?? "",
                    e.detail,
                  ]),
                ])
              }
            >
              Export logs ↓
            </Button>
            <Button variant="secondary" onClick={() => window.print()}>
              Print report
            </Button>
          </>
        }
      />
      <Card>
        <div className="filters">
          <div className="filter-field filter-search">
            <label htmlFor="audit-search">Search history</label>
            <input
              id="audit-search"
              placeholder="Search user, action, request or resource…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <div className="filter-field">
            <label htmlFor="audit-action">Action</label>
            <select
              id="audit-action"
              value={action}
              onChange={(e) => {
                setAction(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All actions</option>
              {[...new Set(state.audit.map((e) => e.action))].map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </div>
          <div className="filter-field">
            <label htmlFor="audit-resource">Resource</label>
            <select
              id="audit-resource"
              value={resource}
              onChange={(e) => {
                setResource(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All resources</option>
              {state.resources.map((r) => (
                <option value={r.id} key={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <Button
            variant="ghost"
            onClick={() => {
              setQuery("");
              setResource("");
              setAction("");
              setFrom("");
              setTo("");
              setPage(1);
            }}
          >
            Clear all
          </Button>
          <div className="date-filters">
            <div className="filter-field">
              <label htmlFor="audit-from">From</label>
              <input
                type="date"
                id="audit-from"
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  setPage(1);
                }}
              />
            </div>
            <div className="filter-field">
              <label htmlFor="audit-to">Until</label>
              <input
                type="date"
                id="audit-to"
                min={from}
                value={to}
                onChange={(e) => {
                  setTo(e.target.value);
                  setPage(1);
                }}
              />
            </div>
            {invalid && (
              <p role="alert" className="field-error">
                End date must be on or after start date.
              </p>
            )}
          </div>
        </div>
      </Card>
      <Card>
        {filtered.length && !invalid ? (
          <>
            <div
              className="table-scroll"
              role="region"
              aria-label="Audit history"
              tabIndex={0}
            >
              <table className="audit-table">
                <caption className="sr-only">
                  Local simulated audit records
                </caption>
                <thead>
                  <tr>
                    <th>Date / time</th>
                    <th>Performed by</th>
                    <th>Action</th>
                    <th>Resource / request</th>
                    <th>Resulting status</th>
                    <th>Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice((current - 1) * 8, current * 8).map((e) => (
                    <tr key={e.id}>
                      <td className="date-cell">
                        {dateLabel(e.at)}
                        <br />
                        {timeLabel(e.at)} UTC
                      </td>
                      <td>
                        <strong>
                          {state.users.find((u) => u.id === e.actor)?.name ??
                            e.actor}
                        </strong>
                      </td>
                      <td>{e.action}</td>
                      <td>
                        {state.resources.find((r) => r.id === e.resourceId)
                          ?.name ?? "Workspace"}
                        {e.requestId && (
                          <>
                            <br />
                            <Link
                              className="table-link"
                              href={`/requests/${e.requestId}`}
                            >
                              {e.requestId}
                            </Link>
                          </>
                        )}
                      </td>
                      <td>
                        {e.status ? (
                          <Badge status={e.status} />
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="audit-detail">{e.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              total={filtered.length}
              page={current}
              pageSize={8}
              onChange={setPage}
            />
          </>
        ) : (
          <Empty />
        )}
      </Card>
      <Alert title="Local demo history" tone="info">
        These events are simulated and stored in your browser. They are not
        tamper-proof, independently verified, or suitable for production
        compliance.
      </Alert>
    </>
  );
}
