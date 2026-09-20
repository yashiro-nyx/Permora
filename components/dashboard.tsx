"use client";
import Image from "next/image";
import Link from "next/link";
import { useDemo } from "./demo-provider";
import { Alert, Card, Icon, LinkButton, PageHeading } from "./ui";
import { dateLabel, isReviewer } from "@/lib/model";
import { RequestTable } from "./request-table";
import { ActivityChart } from "./charts";
export function Dashboard() {
  const { user, state } = useDemo();
  if (!user) return null;
  const reviewer = isReviewer(user.role);
  const requests = reviewer
    ? state.requests
    : state.requests.filter((r) => r.userId === user.id);
  const pending = requests.filter((r) => r.status === "pending").length;
  const expiring = requests.filter(
    (r) =>
      r.status === "active" &&
      Date.parse(r.expiresAt) - Date.parse(state.clock) <= 3 * 86400000,
  ).length;
  const metrics = reviewer
    ? [
        {
          label: user.role === "admin" ? "Active users" : "Requests to review",
          value:
            user.role === "admin"
              ? state.users.filter((u) => u.active).length
              : pending,
          icon: "users",
          tone: "neutral",
          href: user.role === "admin" ? "/users" : "/review",
        },
        {
          label: "Pending requests",
          value: pending,
          icon: "requests",
          tone: "warning",
          href: "/review",
        },
        {
          label: "Active permissions",
          value: requests.filter((r) => r.status === "active").length,
          icon: "check",
          tone: "success",
          href:
            user.role === "admin" ? "/permissions" : "/requests?status=active",
        },
        {
          label: "Expiring soon",
          value: expiring,
          icon: "expire",
          tone: "warning",
          href:
            user.role === "admin" ? "/permissions" : "/requests?status=active",
        },
      ]
    : [
        {
          label: "Total requests",
          value: requests.length,
          icon: "folder",
          tone: "neutral",
          href: "/requests",
        },
        {
          label: "Active access",
          value: requests.filter((r) => r.status === "active").length,
          icon: "check",
          tone: "success",
          href: "/requests?status=active",
        },
        {
          label: "Pending review",
          value: pending,
          icon: "clock",
          tone: "warning",
          href: "/requests?status=pending",
        },
        {
          label: "Expiring soon",
          value: expiring,
          icon: "expire",
          tone: "warning",
          href: "/requests?status=active",
        },
      ];
  return (
    <>
      <PageHeading
        eyebrow={
          reviewer
            ? `${user.role === "admin" ? "ADMIN" : "APPROVER"}  ›  DASHBOARD`
            : undefined
        }
        title={
          reviewer
            ? user.role === "admin"
              ? "System overview"
              : "Your review workspace"
            : `Welcome back, ${user.name.split(" ")[0]}!`
        }
        description={
          reviewer
            ? "A clear view of requests, permissions, and the people behind them."
            : "Manage your resource access and keep your next project moving."
        }
        action={
          <div className="dashboard-date">
            <span className="eyebrow">Demo date</span>
            <strong>{dateLabel(state.clock)}</strong>
          </div>
        }
      />
      <div className="metric-grid">
        {metrics.map((m) => (
          <Link className="card metric" href={m.href} key={m.label}>
            <span className={`icon-tile tone-${m.tone}`}>
              <Icon name={m.icon} size={21} />
            </span>
            <div>
              <div className="metric-label">{m.label}</div>
              <div className="metric-value">
                {String(m.value).padStart(2, "0")}
              </div>
            </div>
          </Link>
        ))}
      </div>
      <div className="dashboard-grid">
        <div className="stack">
          {reviewer ? (
            <Card title="Request activity · last 7 demo days">
              <ActivityChart requests={requests} state={state} />
            </Card>
          ) : (
            <Card
              title="Recent access requests"
              action={
                <Link href="/requests" className="text-link">
                  View all <span aria-hidden="true">↗</span>
                </Link>
              }
            >
              <RequestTable
                rows={requests.slice(0, 4)}
                state={state}
                compact
                paginate={false}
              />
            </Card>
          )}
          {reviewer ? (
            <Card
              title="Requests awaiting your review"
              action={
                <Link href="/review" className="text-link">
                  Review all
                </Link>
              }
            >
              <RequestTable
                rows={requests
                  .filter((r) => r.status === "pending")
                  .slice(0, 3)}
                state={state}
                compact
                paginate={false}
              />
            </Card>
          ) : (
            <Card title="Access trends · last 7 demo days">
              <ActivityChart requests={requests} state={state} />
            </Card>
          )}
        </div>
        <aside className="stack dashboard-aside">
          <section className="quick-actions">
            <h2>Quick actions</h2>
            <LinkButton href={reviewer ? "/review" : "/requests/new"}>
              <span className="row">
                <Icon name={reviewer ? "check" : "key"} />
                {reviewer ? "Review pending requests" : "Request new access"}
              </span>
              <span>→</span>
            </LinkButton>
            <LinkButton
              href={user.role === "admin" ? "/audit" : "/requests"}
              variant="outline"
            >
              <span className="row">
                <Icon name="clock" />
                View access history
              </span>
              <span>→</span>
            </LinkButton>
            {user.role === "admin" && (
              <LinkButton href="/resources" variant="outline">
                <span className="row">
                  <Icon name="database" />
                  Manage resources
                </span>
                <span>→</span>
              </LinkButton>
            )}
          </section>
          <Card className="tip-card">
            <div className="card-body">
              <h2>
                <span className="icon-tile tone-warning">
                  <Icon name="key" />
                </span>
                {reviewer
                  ? "Every decision matters"
                  : "A little access goes a long way"}
              </h2>
              <p>
                {reviewer
                  ? "Check the purpose, permission level, and expiration before making a decision. Your reason is shared with the requester."
                  : "Request only what you need, for as long as you need it. You can always submit a renewal when your project grows."}
              </p>
              <Link href="/help" className="text-link">
                Read access guidelines <span aria-hidden="true">→</span>
              </Link>
            </div>
          </Card>
          {!reviewer && (
            <Card className="feature-card">
              <div className="feature-image">
                <Image src="/assets/lab.png" alt="" fill sizes="350px" />
              </div>
              <div className="feature-content">
                <span className="eyebrow">Featured resource</span>
                <h2>Computer Laboratory Systems</h2>
                <p>
                  Request a designated lab account or approved course software.
                </p>
                <Link className="text-link" href="/requests/new?resource=r-lab">
                  Request lab access →
                </Link>
              </div>
            </Card>
          )}
          {reviewer && (
            <Alert title="A connected demo" tone="info">
              Decisions update requests, notifications, and local audit history
              together. No live permissions are granted.
            </Alert>
          )}
        </aside>
      </div>
    </>
  );
}
