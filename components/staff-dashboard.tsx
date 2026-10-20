import Link from "next/link";
import type { TrustedIdentity } from "@/lib/auth-types";
import { dateLabel } from "@/lib/model";
import { activationStatusSummary } from "@/lib/activation-presentation";
import type { ReviewQueueItemDto } from "@/lib/server/approval-read-types";
import { Alert, Badge, Card, Icon, LinkButton, PageHeading } from "./ui";

export interface StaffDashboardData {
  pending: number;
  approvedPendingActivation: number;
  denied: number;
  returnedForRevision: number;
  unassigned?: number;
  recent: ReviewQueueItemDto[];
  awaitingActivation?: number;
  scheduledProvisioning?: number;
  activationIssues?: number;
  unreadNotifications?: number;
}

export function StaffDashboard({
  identity,
  data,
  canReview,
  unavailable = false,
}: {
  identity: TrustedIdentity;
  data?: StaffDashboardData;
  canReview: boolean;
  unavailable?: boolean;
}) {
  const administrator = identity.roles.includes("admin");
  if (unavailable)
    return (
      <>
        <PageHeading
          eyebrow="STAFF › DASHBOARD"
          title="Review workspace"
          description="Live approval information could not be loaded."
        />
        <Alert title="Review data is temporarily unavailable" tone="danger">
          No counts were substituted. Reload the page to try the protected server
          query again.
        </Alert>
      </>
    );
  const metrics = administrator
    ? [
        {
          label: "Awaiting activation",
          value: data?.awaitingActivation ?? 0,
          icon: "key",
          tone: "success",
          href: "/admin/activations",
        },
        {
          label: "Scheduled provisioning",
          value: data?.scheduledProvisioning ?? 0,
          icon: "clock",
          tone: "info",
          href: "/admin/activations",
        },
        {
          label: "Unassigned requests",
          value: data?.unassigned ?? 0,
          icon: "clock",
          tone: "warning",
          href: "/admin/unassigned",
        },
        {
          label: "Activation issues",
          value: data?.activationIssues ?? 0,
          icon: "expire",
          tone: "danger",
          href: "/admin/activations",
        },
        {
          label: "Unread notifications",
          value: data?.unreadNotifications ?? 0,
          icon: "bell",
          tone: "info",
          href: "/notifications/staff?view=unread",
        },
      ]
    : [
        {
          label: "Assigned pending reviews",
          value: data?.pending ?? 0,
          icon: "requests",
          tone: "warning",
          href: "/review?status=pending_review",
        },
        {
          label: "Approved decisions",
          value: data?.approvedPendingActivation ?? 0,
          icon: "check",
          tone: "success",
          href: "/review?status=approved_pending_activation",
        },
        {
          label: "Denied decisions",
          value: data?.denied ?? 0,
          icon: "expire",
          tone: "danger",
          href: "/review?status=denied",
        },
        {
          label: "Returned for revision",
          value: data?.returnedForRevision ?? 0,
          icon: "review",
          tone: "neutral",
          href: "/review?status=returned_for_revision",
        },
      ];
  return (
    <>
      <PageHeading
        eyebrow={`${administrator ? "ADMINISTRATOR" : "APPROVER"} › DASHBOARD`}
        title={administrator ? "Approval overview" : "Your review workspace"}
        description="Live counts from requests within your server-enforced approval responsibility."
      />
      {!canReview && administrator && (
        <Alert title="No approval responsibility configured" tone="warning">
          You can inspect unassigned routing failures, but assigned review data
          remains unavailable until an active responsibility is configured.
          <p>
            <Link href="/admin/responsibilities">
              Configure an approver responsibility
            </Link>
          </p>
        </Alert>
      )}
      <section className="metric-grid staff-metric-grid" aria-label="Review summary">
        {metrics.map((metric) => (
          <Link className="card metric" href={metric.href} key={metric.label}>
            <span className={`icon-tile tone-${metric.tone}`}>
              <Icon name={metric.icon} size={20} />
            </span>
            <div>
              <div className="metric-label">{metric.label}</div>
              <div className="metric-value">
                {metric.value}
              </div>
            </div>
          </Link>
        ))}
      </section>
      <div className="dashboard-grid">
        <Card
          title={administrator ? "Operational attention" : "Requests awaiting your review"}
          action={
            administrator ? (
              <Link href="/admin/activations" className="text-link">
                Open activation queue →
              </Link>
            ) : canReview ? (
              <Link href="/review?status=pending_review" className="text-link">
                View queue →
              </Link>
            ) : undefined
          }
        >
          {administrator ? (
            <div className="quick-actions dashboard-priority-list">
              <LinkButton href="/admin/activations">
                <span className="row"><Icon name="key" /> Approved requests awaiting provisioning</span>
                <span aria-hidden="true">→</span>
              </LinkButton>
              <LinkButton href="/admin/unassigned" variant="outline">
                <span className="row"><Icon name="clock" /> Requests needing routing intervention</span>
                <span aria-hidden="true">→</span>
              </LinkButton>
              <LinkButton href="/notifications/staff" variant="outline">
                <span className="row"><Icon name="bell" /> Administrative notifications</span>
                <span aria-hidden="true">→</span>
              </LinkButton>
            </div>
          ) : !canReview || !data?.recent.length ? (
            <div className="empty compact-empty">
              <h2>No assigned pending reviews</h2>
              <p>
                New requests will appear here only after server routing assigns
                them to this account.
              </p>
            </div>
          ) : (
            <div className="table-scroll" tabIndex={0} role="region" aria-label="Recent assigned reviews">
              <table className="compact-table staff-dashboard-table">
                <thead>
                  <tr>
                    <th scope="col">Requester</th>
                    <th scope="col">Resource</th>
                    <th scope="col">Submitted</th>
                    <th scope="col">Status</th>
                    <th scope="col">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.map((request) => (
                    <tr key={request.requestId}>
                      <td>
                        <strong>{request.requester.name}</strong>
                        <small className="table-secondary">{request.displayId}</small>
                      </td>
                      <td>
                        <strong>{request.resource.name}</strong>
                        <small className="table-secondary">{request.permission.label}</small>
                      </td>
                      <td className="date-cell">{dateLabel(request.submittedAt)}</td>
                      <td>
                        {(() => {
                          const lifecycle = activationStatusSummary(
                            request.status,
                            request.activationStatus,
                            request.activationRetryable,
                            Date.parse(request.requestedValidity.startsAt) > Date.now(),
                          );
                          return <Badge label={lifecycle.label} tone={lifecycle.tone} />;
                        })()}
                      </td>
                      <td>
                        <Link className="table-link" href={`/review/${request.requestId}`}>
                          Review<span className="sr-only"> {request.displayId}</span>
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <aside className="stack dashboard-aside">
          <section className="quick-actions">
            <h2>Quick actions</h2>
            {administrator && (
              <LinkButton href="/users" variant="outline">
                <span className="row"><Icon name="users" /> User management</span>
                <span aria-hidden="true">→</span>
              </LinkButton>
            )}
            {administrator && (
              <LinkButton href="/resources" variant="outline">
                <span className="row"><Icon name="resources" /> Resource catalog</span>
                <span aria-hidden="true">→</span>
              </LinkButton>
            )}
            {!administrator && (
              <LinkButton href="/review">
                <span className="row"><Icon name="review" /> Review requests</span>
                <span aria-hidden="true">→</span>
              </LinkButton>
            )}
          </section>
          <Alert title="Approval does not activate access" tone="info">
            Approved requests wait for a separate downstream activation process.
            This stage creates no active grant.
          </Alert>
        </aside>
      </div>
    </>
  );
}
