import Link from "next/link";
import type { TrustedIdentity } from "@/lib/auth-types";
import type {
  AccessRequestDto,
  RequestCountsDto,
} from "@/lib/server/request-types";
import { Card, Icon, LinkButton, PageHeading, Alert } from "./ui";
import { ServerRequestTable } from "./server-request-table";

export function ServerDashboard({
  identity,
  counts,
  recent,
}: {
  identity: TrustedIdentity;
  counts?: RequestCountsDto;
  recent?: AccessRequestDto[];
}) {
  if (!identity.requesterRole)
    return (
      <>
        <PageHeading
          eyebrow="STAGE 2A"
          title={`${identity.roles.includes("admin") ? "Administrator" : "Approver"} account ready`}
          description="Your account and revocable server session are active."
        />
        <Alert title="Workflow deferred" tone="info">
          Approver decisions, activation, and the full administrator dashboard
          belong to the next stage. No demo controls or mock records are exposed
          here.
        </Alert>
      </>
    );
  const metrics = [
    {
      label: "Total requests",
      value: counts?.total ?? 0,
      icon: "folder",
      tone: "neutral",
      href: "/requests",
    },
    {
      label: "Active access",
      value: 0,
      icon: "check",
      tone: "success",
      href: "/requests",
    },
    {
      label: "Pending review",
      value: counts?.pending ?? 0,
      icon: "clock",
      tone: "warning",
      href: "/requests?status=pending",
    },
    {
      label: "Expired",
      value: counts?.expired ?? 0,
      icon: "expire",
      tone: "neutral",
      href: "/requests?status=expired",
    },
  ];
  return (
    <>
      <PageHeading
        title={`Welcome back, ${identity.name.split(" ")[0]}!`}
        description="Manage your resource access and keep your next project moving."
      />
      <div className="metric-grid">
        {metrics.map((metric) => (
          <Link className="card metric" href={metric.href} key={metric.label}>
            <span className={`icon-tile tone-${metric.tone}`}>
              <Icon name={metric.icon} size={21} />
            </span>
            <div>
              <div className="metric-label">{metric.label}</div>
              <div className="metric-value">
                {String(metric.value).padStart(2, "0")}
              </div>
            </div>
          </Link>
        ))}
      </div>
      <div className="dashboard-grid">
        <div className="stack">
          <Card
            title="Recent access requests"
            action={
              <Link href="/requests" className="text-link">
                View all <span aria-hidden="true">↗</span>
              </Link>
            }
          >
            <ServerRequestTable rows={recent ?? []} compact paginate={false} />
          </Card>
        </div>
        <aside className="stack dashboard-aside">
          <section className="quick-actions">
            <h2>Quick actions</h2>
            <LinkButton href="/requests/new">
              <span className="row">
                <Icon name="key" />
                Request new access
              </span>
              <span>→</span>
            </LinkButton>
            <LinkButton href="/requests" variant="outline">
              <span className="row">
                <Icon name="clock" />
                View request history
              </span>
              <span>→</span>
            </LinkButton>
          </section>
          <Card className="tip-card">
            <div className="card-body">
              <h2>
                <span className="icon-tile tone-warning">
                  <Icon name="key" />
                </span>
                Request the minimum access
              </h2>
              <p>
                Choose only the assigned scope and time you need. Every
                submission is checked against current server records.
              </p>
            </div>
          </Card>
        </aside>
      </div>
    </>
  );
}
