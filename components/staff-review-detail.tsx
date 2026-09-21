import Link from "next/link";
import { dateLabel, initials, statusLabels, timeLabel } from "@/lib/model";
import type { ReviewRequestDetailDto } from "@/lib/server/approval-read-types";
import { Badge, Card, Icon, PageHeading } from "./ui";
import { ReviewDecisionPanel } from "./review-decision-panel";

function eventLabel(type: string) {
  const labels: Record<string, string> = {
    request_submitted: "Request submitted",
    request_routed: "Assigned for review",
    request_routing_unavailable: "Routing unavailable",
    review_approved: "Request approved",
    review_denied: "Request denied",
    review_returned_for_revision: "Returned for revision",
  };
  return labels[type] ?? "Request updated";
}

export function StaffReviewDetail({
  request,
}: {
  request: ReviewRequestDetailDto;
}) {
  const pending = request.status === "pending_review";
  return (
    <>
      <PageHeading
        eyebrow={`STAFF › REVIEW REQUESTS › ${request.displayId}`}
        title="Review access request"
        description="Review the server-verified request details and record one decision."
        action={
          <Link className="button button-outline" href="/review">
            ← Back to queue
          </Link>
        }
      />
      <div className="review-detail-grid">
        <div className="stack">
          <Card
            title="Request details"
            action={<Badge status={request.status} />}
          >
            <div className="detail-body">
              <section className="requester-profile" aria-label="Requester">
                <span className="avatar large">
                  {initials(request.requester.name)}
                </span>
                <div>
                  <span className="eyebrow">Requester</span>
                  <h2>{request.requester.name}</h2>
                  <p className="muted">
                    {request.requester.requesterRole} · {request.requester.email}
                  </p>
                  {request.requester.department && (
                    <p className="small muted">{request.requester.department}</p>
                  )}
                </div>
              </section>
              <dl className="detail-fields review-fields">
                <div>
                  <dt>Resource</dt>
                  <dd>
                    <Icon name="folder" /> {request.resource.name}
                    <small>{request.resource.sensitivity} sensitivity</small>
                  </dd>
                </div>
                <div>
                  <dt>Permission</dt>
                  <dd>
                    <Icon name="key" /> {request.permission.label}
                  </dd>
                </div>
                {request.scopes.map((scope) => (
                  <div key={scope.fieldName}>
                    <dt>{scope.label}</dt>
                    <dd>{scope.value}</dd>
                  </div>
                ))}
                <div className="span-full">
                  <dt>Purpose / justification</dt>
                  <dd className="purpose-quote">“{request.purpose}”</dd>
                </div>
                <div>
                  <dt>Requested start · UTC</dt>
                  <dd>{dateLabel(request.requestedValidity.startsAt)}</dd>
                </div>
                <div>
                  <dt>Requested expiration · UTC</dt>
                  <dd>{dateLabel(request.requestedValidity.expiresAt)}</dd>
                </div>
                <div>
                  <dt>Submitted · UTC</dt>
                  <dd>
                    {dateLabel(request.submittedAt)} at {timeLabel(request.submittedAt)}
                  </dd>
                </div>
                <div>
                  <dt>Assigned · UTC</dt>
                  <dd>
                    {dateLabel(request.assignment.assignedAt)} at{" "}
                    {timeLabel(request.assignment.assignedAt)}
                  </dd>
                </div>
              </dl>
            </div>
          </Card>
          <Card title="Request timeline">
            <div className="card-body timeline-section">
              <ol className="timeline">
                {request.timeline.map((event, index) => (
                  <li key={`${event.type}-${event.at}-${index}`}>
                    <span className="timeline-marker tone-neutral">
                      <Icon name="clock" size={14} />
                    </span>
                    <div>
                      <strong>{eventLabel(event.type)}</strong>
                      <p>{event.detail}</p>
                      <small>
                        {dateLabel(event.at)} at {timeLabel(event.at)} ·{" "}
                        {event.actorName}
                      </small>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </Card>
          {request.decision && (
            <Card title="Immutable decision history">
              <div className="card-body decision-history">
                <Badge
                  status={request.status}
                  label={statusLabels[request.status]}
                />
                <dl className="detail-fields">
                  <div>
                    <dt>Decision</dt>
                    <dd>{request.decision.action.replaceAll("_", " ")}</dd>
                  </div>
                  <div>
                    <dt>Recorded · UTC</dt>
                    <dd>
                      {dateLabel(request.decision.decidedAt)} at{" "}
                      {timeLabel(request.decision.decidedAt)}
                    </dd>
                  </div>
                  {request.decision.reason && (
                    <div className="span-full">
                      <dt>Reason</dt>
                      <dd>{request.decision.reason}</dd>
                    </div>
                  )}
                </dl>
              </div>
            </Card>
          )}
        </div>
        <aside className="stack">
          {pending ? (
            <ReviewDecisionPanel
              requestId={request.requestId}
              displayId={request.displayId}
              expectedVersion={request.version}
            />
          ) : (
            <div className="alert tone-info">
              <div>
                <strong>No decision controls available</strong>
                <p>
                  This request is {statusLabels[request.status].toLowerCase()} and
                  no longer accepts an approval decision.
                </p>
              </div>
            </div>
          )}
          <div className="alert tone-warning">
            <div>
              <strong>Decision boundary</strong>
              <p>
                Approval records authorization to proceed. It does not activate
                access, create an entitlement, or confirm downstream provisioning.
              </p>
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}
