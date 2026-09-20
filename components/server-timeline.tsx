import type { AccessRequestDto } from "@/lib/server/request-types";
import { dateLabel, timeLabel } from "@/lib/model";
import { Icon } from "./ui";

export function ServerTimeline({
  request,
  title = "Activity timeline",
}: {
  request: AccessRequestDto;
  title?: string;
}) {
  const labels: Record<AccessRequestDto["events"][number]["type"], string> = {
    submitted: "Request submitted",
    renewal_submitted: "Renewal submitted",
    request_routed: "Assigned for review",
    request_routing_unavailable: "Awaiting routing configuration",
    review_approved: "Request approved — awaiting activation",
    review_denied: "Request denied",
    review_returned_for_revision: "Revision requested",
  };
  return (
    <section className="timeline-section">
      <h2>{title}</h2>
      {!request.events.length && (
        <p className="muted">
          No recorded activity is available for this request.
        </p>
      )}
      <ol className="timeline">
        {request.events.map((event) => (
          <li key={event.id}>
            <span className="timeline-marker tone-warning">
              <Icon name="clock" size={13} />
            </span>
            <div>
              <strong>
                {labels[event.type]}
              </strong>
              <p>
                <time dateTime={event.at}>
                  {dateLabel(event.at)} · {timeLabel(event.at)} UTC
                </time>
              </p>
              <small>{event.actorName}</small>
              <p>{event.detail}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
