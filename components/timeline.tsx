"use client";
import { AccessRequest, DemoState, dateLabel, timeLabel } from "@/lib/model";
import { Icon } from "./ui";
export function Timeline({
  request,
  state,
  title = "Activity timeline",
}: {
  request: AccessRequest;
  state: DemoState;
  title?: string;
}) {
  const events = state.audit
    .filter((e) => e.requestId === request.id && e.at <= state.clock)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return (
    <section className="timeline-section">
      <h2>{title}</h2>
      {!events.length && (
        <p className="muted">
          No recorded activity is available for this request.
        </p>
      )}
      <ol className="timeline">
        {events.map((e) => (
          <li key={e.id}>
            <span
              className={`timeline-marker ${e.status === "denied" || e.status === "revoked" ? "tone-danger" : e.status === "pending" ? "tone-warning" : "tone-success"}`}
            >
              <Icon
                name={e.status === "pending" ? "clock" : "check"}
                size={13}
              />
            </span>
            <div>
              <strong>{e.action}</strong>
              <p>
                <time dateTime={e.at}>
                  {dateLabel(e.at)} · {timeLabel(e.at)} UTC
                </time>
              </p>
              <small>
                {state.users.find((u) => u.id === e.actor)?.name ?? e.actor}
              </small>
              <p>{e.detail}</p>
            </div>
          </li>
        ))}
        {["pending", "active", "approved"].includes(request.status) && (
          <li>
            <span className="timeline-marker tone-neutral">
              <Icon name="expire" size={13} />
            </span>
            <div>
              <strong>Scheduled expiration</strong>
              <p>
                {dateLabel(request.expiresAt)} · {timeLabel(request.expiresAt)}{" "}
                UTC
              </p>
              <small>Planned event, not yet recorded</small>
            </div>
          </li>
        )}
      </ol>
    </section>
  );
}
