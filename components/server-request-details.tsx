import Link from "next/link";
import type { TrustedIdentity } from "@/lib/auth-types";
import type { AccessRequestDto } from "@/lib/server/request-types";
import { dateLabel, initials, roleLabels } from "@/lib/model";
import { activationStatusSummary } from "@/lib/activation-presentation";
import { Alert, Badge, Card, Icon, LinkButton, PageHeading } from "./ui";
import { ServerTimeline } from "./server-timeline";

export function ServerRequestDetails({
  request,
  identity,
  submitted = false,
}: {
  request: AccessRequestDto;
  identity: TrustedIdentity & { requesterRole: "student" | "faculty" };
  submitted?: boolean;
}) {
  const badgeStatus = request.status;
  const activationSummary = activationStatusSummary(
    request.status,
    request.activation?.status ?? null,
    request.activation?.retryable ?? null,
  );
  return (
    <>
      <Link className="text-link back-link" href="/requests">
        ← Back to my requests
      </Link>
      {submitted && (
        <Alert title="Request submitted" tone="success">
          {request.displayId} was saved
          {request.status === "pending_routing"
            ? ", but no fully eligible approver is currently configured. It remains safely unassigned."
            : " and assigned for review."} No approval or access grant has
          been created.
        </Alert>
      )}
      <PageHeading
        eyebrow={`REQUESTS  ›  ${request.displayId}`}
        title="Request details"
        description="This record is visible only to its owner in Stage 2A."
        action={<Badge status={badgeStatus} />}
      />
      <div className="detail-grid">
        <div className="stack">
          <Card title="Request details" action={<Badge status={badgeStatus} />}>
            <div className="card-body detail-body">
              <div className="requester-profile">
                <span className="avatar large">{initials(identity.name)}</span>
                <div>
                  <span className="eyebrow">Requester profile</span>
                  <h2>{identity.name}</h2>
                  <p className="small muted">
                    {roleLabels[identity.requesterRole]} ·{" "}
                    {identity.department || "Department not recorded"}
                  </p>
                </div>
              </div>
              <dl className="detail-fields">
                <div>
                  <dt>Target resource</dt>
                  <dd>
                    <Icon name={request.resourceIcon} /> {request.resourceName}
                  </dd>
                </div>
                <div>
                  <dt>Permission</dt>
                  <dd>
                    <Icon name="key" /> {request.permissionLabel}
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
                  <dt>Requested start</dt>
                  <dd>
                    {dateLabel(request.startsAt)}
                    <small>Requested period; no active grant</small>
                  </dd>
                </div>
                <div>
                  <dt>Requested expiration</dt>
                  <dd>
                    {dateLabel(request.expiresAt)}
                    <small>Not a completed expiration event</small>
                  </dd>
                </div>
              </dl>
            </div>
          </Card>
          <Card>
            <div className="card-body">
              <ServerTimeline request={request} title="Submission history" />
            </div>
          </Card>
        </div>
        <aside className="stack">
          {(request.status === "approved_pending_activation" ||
            request.activation) && (
            <Card title="Activation status" className="activation-status-card">
              <div className="card-body stack">
                <Badge
                  label={activationSummary.label}
                  tone={activationSummary.tone}
                />
                <p>{activationSummary.description}</p>
                {request.activation?.activatedAt && (
                  <p className="small muted">
                    Activated {dateLabel(request.activation.activatedAt)}
                  </p>
                )}
                {request.activation && (
                  <p className="small muted">
                    Valid through {dateLabel(request.activation.expiresAt)}
                  </p>
                )}
                <p className="small muted">
                  Approval state: {request.status.replaceAll("_", " ")}
                </p>
              </div>
            </Card>
          )}
          <Card className="tip-card">
            <div className="card-body">
              <h2>Approval and activation are separate</h2>
              <p>
                The approval status records the decision. The lifecycle status
                above reflects whether access is activating, active, failed,
                expired, or revoked.
              </p>
            </div>
          </Card>
          {request.status === "expired" && request.renewable && (
            <LinkButton
              href={`/requests/new?renew=${encodeURIComponent(request.id)}`}
            >
              Start renewal request
            </LinkButton>
          )}
        </aside>
      </div>
    </>
  );
}
