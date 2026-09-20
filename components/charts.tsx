"use client";
import { useState } from "react";
import { AccessRequest, DemoState, dayOffset } from "@/lib/model";
import { Button } from "./ui";
export function ActivityChart({
  requests,
  state,
}: {
  requests: AccessRequest[];
  state: DemoState;
}) {
  const [table, setTable] = useState(false);
  const days = Array.from({ length: 7 }, (_, i) =>
    dayOffset(state.clock, i - 6).slice(0, 10),
  );
  const values = days.map((day) => ({
    label: new Date(day).toLocaleDateString("en-US", {
      weekday: "short",
      timeZone: "UTC",
    }),
    day,
    requests: requests.filter((r) => r.createdAt.startsWith(day)).length,
    approvals: requests.filter(
      (r) =>
        r.decision?.outcome === "approved" && r.decision.at.startsWith(day),
    ).length,
  }));
  const max = Math.max(
    4,
    ...values.map((v) => Math.max(v.requests, v.approvals)),
  );
  const points = (key: "requests" | "approvals") =>
    values
      .map((v, i) => `${45 + i * 75},${195 - (v[key] / max) * 150}`)
      .join(" ");
  return (
    <div className="chart-panel">
      <div className="chart-legend">
        <span>
          <i className="legend-yellow" />
          Requests
        </span>
        <span>
          <i className="legend-dark" />
          Approvals
        </span>
      </div>
      <svg
        viewBox="0 0 540 235"
        role="img"
        aria-label={`Requests and approvals over the last seven demo days. ${values.reduce((n, v) => n + v.requests, 0)} requests and ${values.reduce((n, v) => n + v.approvals, 0)} approvals. Data table follows.`}
      >
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i}>
            <line
              x1="40"
              x2="510"
              y1={195 - i * 37.5}
              y2={195 - i * 37.5}
              className="chart-gridline"
            />
            <text x="20" y={199 - i * 37.5} className="chart-text">
              {Math.round((max * i) / 4)}
            </text>
          </g>
        ))}
        {values.map((v, i) => (
          <g key={v.day}>
            <line
              x1={45 + i * 75}
              x2={45 + i * 75}
              y1="40"
              y2="195"
              className="chart-gridline"
            />
            <text
              x={45 + i * 75}
              y="222"
              textAnchor="middle"
              className="chart-text"
            >
              {v.label}
            </text>
          </g>
        ))}
        <polyline
          points={points("requests")}
          fill="none"
          className="chart-line-primary"
          strokeWidth="3"
        />
        <polyline
          points={points("approvals")}
          fill="none"
          className="chart-line-secondary"
          strokeWidth="2"
          strokeDasharray="4 3"
        />
        {values.map((v, i) => (
          <circle
            key={v.day}
            cx={45 + i * 75}
            cy={195 - (v.requests / max) * 150}
            r="4"
            className="chart-point"
          />
        ))}
      </svg>
      <Button
        variant="ghost"
        className="chart-data-toggle"
        aria-expanded={table}
        onClick={() => setTable(!table)}
      >
        {table ? "Hide" : "View"} chart data
      </Button>
      {table && (
        <table>
          <caption className="sr-only">Seven-day activity data</caption>
          <thead>
            <tr>
              <th>Date</th>
              <th>Requests</th>
              <th>Approvals</th>
            </tr>
          </thead>
          <tbody>
            {values.map((v) => (
              <tr key={v.day}>
                <th>{v.day}</th>
                <td>{v.requests}</td>
                <td>{v.approvals}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
