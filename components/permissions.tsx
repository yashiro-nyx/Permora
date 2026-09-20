"use client";
import { useState } from "react";
import { useDemo } from "./demo-provider";
import { Alert, Button, Card, Confirm, PageHeading } from "./ui";
import { dateLabel, dayOffset } from "@/lib/model";
import { RequestTable } from "./request-table";
export function Permissions({
  initialResource = "",
}: {
  initialResource?: string;
}) {
  const { state, dispatch, setNotice } = useDemo();
  const [resource, setResource] = useState(initialResource);
  const [status, setStatus] = useState("");
  const [advance, setAdvance] = useState(false);
  const [days, setDays] = useState(7);
  const [error, setError] = useState("");
  const rows = state.requests.filter(
    (r) =>
      ["active", "approved", "expired", "revoked"].includes(r.status) &&
      (!resource || r.resourceId === resource) &&
      (!status || r.status === status),
  );
  return (
    <>
      <PageHeading
        eyebrow="ADMIN  ›  PERMISSIONS"
        title="Permissions & expiration"
        description="Know who has access, what they can do, and when it ends."
      />
      <Alert title="Simulated expiration" tone="info">
        The demo clock is fixed at {dateLabel(state.clock)}, 09:00 UTC.
        Advancing it activates scheduled permissions and expires overdue
        requests. It does not change your device clock or enforce real access.
      </Alert>
      <Card>
        <div className="clock-controls">
          <div>
            <span className="eyebrow">Demo clock</span>
            <h2>{dateLabel(state.clock)}</h2>
          </div>
          <div className="row wrap">
            <label htmlFor="advance-days" className="small">
              Advance by
            </label>
            <select
              id="advance-days"
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
            >
              {[1, 3, 7, 30].map((n) => (
                <option value={n} key={n}>
                  {n} day{n > 1 ? "s" : ""}
                </option>
              ))}
            </select>
            <Button variant="secondary" onClick={() => setAdvance(true)}>
              Advance demo clock →
            </Button>
          </div>
        </div>
      </Card>
      {error && (
        <Alert title="Clock not advanced" tone="danger">
          {error}
        </Alert>
      )}
      <Card>
        <div className="filters">
          <div className="filter-field filter-search">
            <label htmlFor="permission-resource">Resource</label>
            <select
              id="permission-resource"
              value={resource}
              onChange={(e) => setResource(e.target.value)}
            >
              <option value="">All resources</option>
              {state.resources.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-field">
            <label htmlFor="permission-status">Permission state</label>
            <select
              id="permission-status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">All permission states</option>
              <option value="active">Active</option>
              <option value="approved">Scheduled</option>
              <option value="expired">Expired</option>
              <option value="revoked">Revoked</option>
            </select>
          </div>
        </div>
        <RequestTable
          key={`${resource}-${status}`}
          rows={rows}
          state={state}
          showRequester
        />
      </Card>
      {advance && (
        <Confirm
          title="Advance the demo clock?"
          label="Advance clock"
          onClose={() => setAdvance(false)}
          onConfirm={() => {
            try {
              dispatch({ type: "clock", days });
              setAdvance(false);
              setNotice(
                "Demo clock advanced. Permissions, notifications, and audit history are now up to date.",
              );
            } catch (e) {
              setAdvance(false);
              setError((e as Error).message);
            }
          }}
        >
          <p>
            The demo date will move to{" "}
            <strong>{dateLabel(dayOffset(state.clock, days))}</strong>. Expiring
            access will end in the simulation. Reset demo to restore the
            original date.
          </p>
        </Confirm>
      )}
    </>
  );
}
