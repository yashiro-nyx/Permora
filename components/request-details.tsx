"use client";
import { useState } from "react";
import Link from "next/link";
import { useDemo } from "./demo-provider";
import {
  dateLabel,
  initials,
  isReviewer,
  levelLabels,
  roleLabels,
} from "@/lib/model";
import {
  Alert,
  Badge,
  Button,
  Card,
  Confirm,
  Field,
  Icon,
  LinkButton,
  PageHeading,
} from "./ui";
import { Timeline } from "./timeline";
import {
  getCatalogResource,
  getPermissionLabel,
  requestScopeIsComplete,
  scopeSummary,
} from "@/lib/resource-catalog";
export function RequestDetails({ id }: { id: string }) {
  const { state, user, dispatch, setNotice } = useDemo();
  const [reason, setReason] = useState("");
  const [decision, setDecision] = useState<
    "approved" | "denied" | "revoked" | null
  >(null);
  const [error, setError] = useState("");
  if (!user) return null;
  const reviewer = isReviewer(user.role);
  const request = state.requests.find(
    (r) => r.id === id && (reviewer || r.userId === user.id),
  );
  if (!request)
    return (
      <div className="empty">
        <h1>Request not available</h1>
        <p>This request does not exist or belongs to another demo profile.</p>
        <LinkButton href="/requests">Back to requests</LinkButton>
      </div>
    );
  const resource = state.resources.find((r) => r.id === request.resourceId)!;
  const owner = state.users.find((u) => u.id === request.userId)!;
  const compatible =
    owner.active &&
    resource.online &&
    resource.permissions[owner.role]?.includes(request.level) &&
    requestScopeIsComplete(
      getCatalogResource(request.resourceId),
      owner,
      request.scope,
    ) &&
    request.expiresAt > state.clock;
  const catalog = getCatalogResource(request.resourceId);
  const permissionLabel =
    getPermissionLabel(request.resourceId, request.level) ??
    levelLabels[request.level];
  const requestScope = scopeSummary(request.resourceId, request.scope);
  function prepare(outcome: "approved" | "denied" | "revoked") {
    if (reason.trim().length < 10) {
      setError("Please give a reason of at least 10 characters.");
      document.getElementById("reason")?.focus();
      return;
    }
    setError("");
    setDecision(outcome);
  }
  function commit() {
    if (!decision || !request) return;
    try {
      dispatch(
        decision === "revoked"
          ? { type: "revoke", requestId: id, reason }
          : {
              type: "decide",
              requestId: id,
              version: request.version,
              outcome: decision,
              reason,
            },
      );
      setDecision(null);
      setNotice(
        `Request ${decision}. The requester’s notifications and demo audit history have been updated.`,
      );
    } catch (e) {
      setDecision(null);
      setError((e as Error).message);
    }
  }
  return (
    <>
      <Link
        className="text-link back-link"
        href={reviewer ? "/review" : "/requests"}
      >
        ← Back to {reviewer ? "review queue" : "my requests"}
      </Link>
      <PageHeading
        eyebrow={`REQUESTS  ›  ${id}`}
        title={reviewer ? "Review access request" : "Request details"}
        description={
          reviewer
            ? "Review the details and make a clear, informed decision."
            : "Everything you need to know about this access request."
        }
        action={<Badge status={request.status} />}
      />
      <div className="detail-grid">
        <div className="stack">
          <Card
            title="Request details"
            action={<Badge status={request.status} />}
          >
            <div className="card-body detail-body">
              <div className="requester-profile">
                <span className="avatar large">{initials(owner.name)}</span>
                <div>
                  <span className="eyebrow">Requester profile</span>
                  <h2>{owner.name}</h2>
                  <p className="small muted">
                    {roleLabels[owner.role]} · {owner.department}
                  </p>
                </div>
              </div>
              <dl className="detail-fields">
                <div>
                  <dt>Target resource</dt>
                  <dd>
                    <Icon name={resource.icon} /> {resource.name}
                  </dd>
                </div>
                <div>
                  <dt>Access level</dt>
                  <dd>
                    <Icon name="key" /> {permissionLabel}
                  </dd>
                </div>
                {requestScope.map((item) => (
                  <div key={item.label}>
                    <dt>{item.label}</dt>
                    <dd>{item.value}</dd>
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
                    <small>09:00 UTC</small>
                  </dd>
                </div>
                <div>
                  <dt>Access duration</dt>
                  <dd>
                    {Math.round(
                      (Date.parse(request.expiresAt) -
                        Date.parse(request.startsAt)) /
                        86400000,
                    )}{" "}
                    days<small>Maximum policy: {resource.maxDays} days</small>
                  </dd>
                </div>
              </dl>
              <div className="expiration-row">
                <span className="eyebrow">Expiration date</span>
                <span className="expiration-chip">
                  {dateLabel(request.expiresAt)} · 09:00 UTC
                </span>
              </div>
              {request.decision && (
                <Alert
                  title={`Decision: ${request.decision.outcome}`}
                  tone={
                    request.decision.outcome === "approved"
                      ? "success"
                      : "danger"
                  }
                >
                  {request.decision.reason}
                  <p className="small">
                    {
                      state.users.find((u) => u.id === request.decision?.by)
                        ?.name
                    }{" "}
                    · {dateLabel(request.decision.at)}
                  </p>
                </Alert>
              )}
            </div>
          </Card>
          <Card>
            <div className="card-body">
              <Timeline request={request} state={state} />
            </div>
          </Card>
        </div>
        <aside className="stack">
          {reviewer && request.status === "pending" ? (
            <Card className="decision-card">
              <div className="card-body form-stack">
                <h2>
                  <Icon name="check" /> Review decision
                </h2>
                <Field
                  id="reason"
                  label="Decision reason"
                  required
                  error={error}
                  hint="Visible to the requester and recorded in demo audit history."
                >
                  <textarea
                    id="reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    maxLength={2000}
                    placeholder="Explain why you are approving or denying this request…"
                    aria-invalid={!!error}
                    aria-describedby={`reason-hint${error ? " reason-error" : ""}`}
                  />
                </Field>
                {!compatible && (
                  <Alert title="Approval unavailable" tone="warning">
                    The resource, requester, permission, or expiration no longer
                    meets the demo policy. You can deny this request with a
                    reason.
                  </Alert>
                )}
                <div className="stack decision-actions">
                  <Button
                    variant="approve"
                    disabled={!compatible}
                    onClick={() => prepare("approved")}
                  >
                    <Icon name="check" />
                    Approve request
                  </Button>
                  <Button variant="danger" onClick={() => prepare("denied")}>
                    <span aria-hidden="true">×</span> Deny access
                  </Button>
                </div>
                <div className="review-checks">
                  <span className="eyebrow">Demo policy checks</span>
                  <p>{owner.active ? "✓" : "×"} Requester profile active</p>
                  <p>{resource.online ? "✓" : "×"} Resource available</p>
                  <p>
                    {resource.permissions[owner.role]?.includes(request.level)
                      ? "✓"
                      : "×"}{" "}
                    Role and permission compatible
                  </p>
                  <p>
                    {requestScopeIsComplete(catalog, owner, request.scope)
                      ? "✓"
                      : "×"}{" "}
                    Required resource scope provided
                  </p>
                  {request.resourceId === "r-faculty-grading" && (
                    <p>
                      ◌ Assigned-section verification requires the Stage 2
                      backend
                    </p>
                  )}
                  <p>
                    {request.expiresAt > state.clock ? "✓" : "×"} Expiration is
                    in the future
                  </p>
                  <small>Simulated checks, not production verification.</small>
                </div>
              </div>
            </Card>
          ) : (
            <Card title="Next steps">
              <div className="card-body stack">
                <p className="muted">
                  {request.status === "pending"
                    ? "Your request is waiting for a reviewer. Switch to the Approver demo role to continue the workflow."
                    : request.status === "active"
                      ? "This permission is active in the demo. It will expire at the time shown."
                      : request.status === "approved"
                        ? "Approved and scheduled. Access becomes active when the demo clock reaches the start date."
                        : request.status === "denied"
                          ? "Read the reviewer’s reason and submit a new request with the required information."
                          : "This permission no longer grants demo access. Request a renewal if you need more time."}
                </p>
                {!reviewer &&
                  (request.status !== "expired" ||
                    catalog?.validity.renewable !== false) && (
                    <LinkButton
                      href={
                        request.status === "denied"
                          ? `/requests/new?resource=${resource.id}`
                          : `/requests/new?renew=${request.id}`
                      }
                      variant="outline"
                      className={request.status === "pending" ? "hidden" : ""}
                    >
                      {request.status === "denied"
                        ? "Submit a new request"
                        : "Request renewal"}
                    </LinkButton>
                  )}
                {reviewer && (
                  <LinkButton href="/review">Return to review queue</LinkButton>
                )}
              </div>
            </Card>
          )}
          {user.role === "admin" &&
            ["active", "approved"].includes(request.status) && (
              <Card title="Manage permission">
                <div className="card-body form-stack">
                  <Field id="reason" label="Revocation reason" error={error}>
                    <textarea
                      id="reason"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Explain why this access should end…"
                    />
                  </Field>
                  <Button variant="danger" onClick={() => prepare("revoked")}>
                    Revoke access
                  </Button>
                </div>
              </Card>
            )}
          <Alert title="Temporary by design" tone="warning">
            Access is scoped to a resource, permission level, and expiration.
            This prototype never grants real resource access.
          </Alert>
          <Link className="text-link" href="/help">
            Read access and review guidelines →
          </Link>
        </aside>
      </div>
      {error && request.status !== "pending" && user.role !== "admin" && (
        <Alert title="Action not completed" tone="danger">
          {error}
        </Alert>
      )}
      {decision && (
        <Confirm
          title={`${decision === "approved" ? "Approve" : decision === "denied" ? "Deny" : "Revoke"} this request?`}
          label={
            decision === "approved"
              ? "Confirm approval"
              : decision === "denied"
                ? "Confirm denial"
                : "Confirm revocation"
          }
          danger={decision !== "approved"}
          onClose={() => setDecision(null)}
          onConfirm={commit}
        >
          <div className="stack">
            <p>
              <strong>{owner.name}</strong> · {resource.name}
              <br />
              {permissionLabel} · until {dateLabel(request.expiresAt)}
            </p>
            <p>{reason}</p>
            <p className="muted">
              This decision updates local demo state and notifies the requester
              inside the prototype.
            </p>
          </div>
        </Confirm>
      )}
    </>
  );
}
