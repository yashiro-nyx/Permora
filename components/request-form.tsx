"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useDemo } from "./demo-provider";
import { validateDraft } from "@/lib/demo-service";
import {
  Level,
  RequestDraft,
  RequestScope,
  dayOffset,
  dateLabel,
  roleLabels,
} from "@/lib/model";
import {
  eligibleCatalogResources,
  getCatalogResource,
  getPermissionOptions,
  normalizeRequestScope,
  scopeSummary,
} from "@/lib/resource-catalog";
import {
  Alert,
  Badge,
  Button,
  Card,
  Confirm,
  ErrorSummary,
  Field,
  PageHeading,
} from "./ui";

export function RequestForm({
  initialResource = "",
  renewalId = "",
}: {
  initialResource?: string;
  renewalId?: string;
}) {
  const { state, user, dispatch, setNotice } = useDemo();
  const router = useRouter();
  const old = state.requests.find(
    (r) => r.id === renewalId && r.userId === user?.id,
  );
  const [resourceId, setResource] = useState(
    old?.resourceId ?? initialResource,
  );
  const initialCatalog = getCatalogResource(old?.resourceId ?? initialResource);
  const initialPermissions = getPermissionOptions(
    initialCatalog,
    user?.role ?? "student",
  );
  const [level, setLevel] = useState<Level>(
    old?.level ?? initialPermissions[0]?.id ?? "read",
  );
  const [scope, setScope] = useState<RequestScope>(old?.scope ?? {});
  const [purpose, setPurpose] = useState(old?.purpose ?? "");
  const firstDate =
    old && old.expiresAt > state.clock ? old.expiresAt : state.clock;
  const [start, setStart] = useState(firstDate.slice(0, 10));
  const [end, setEnd] = useState(dayOffset(firstDate, 7).slice(0, 10));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState(false);
  const [cancel, setCancel] = useState(false);
  const [failure, setFailure] = useState("");
  if (!user) return null;
  const resource = state.resources.find((r) => r.id === resourceId);
  const catalog = getCatalogResource(resourceId);
  const eligible = eligibleCatalogResources(state.resources, user);
  const available = getPermissionOptions(catalog, user.role).filter(
    (permission) =>
      resource?.permissions[user.role]?.includes(permission.id) ?? false,
  );
  const normalizedScope = catalog
    ? normalizeRequestScope(catalog, user, scope)
    : scope;
  const draft: RequestDraft = {
    resourceId,
    level,
    purpose,
    startsAt: start ? `${start}T09:00:00.000Z` : "",
    expiresAt: end ? `${end}T09:00:00.000Z` : "",
    scope: normalizedScope,
    ...(old ? { renewalOf: old.id } : {}),
  };
  function submit() {
    if (!user) return;
    const next = validateDraft(state, user, draft);
    setErrors(next);
    if (!Object.keys(next).length) setConfirm(true);
  }
  function commit() {
    try {
      const next = dispatch({ type: "request", draft });
      const request = next.requests[0];
      setConfirm(false);
      setNotice(`${request.id} submitted. Your request is ready for review.`);
      router.push(`/requests/${request.id}`);
    } catch (e) {
      setConfirm(false);
      setFailure((e as Error).message);
    }
  }
  return (
    <>
      <PageHeading
        title={old ? "Renew resource access" : "New resource access request"}
        description="Tell us what you need. We’ll help you get the right access, for the right amount of time."
      />
      {failure && (
        <Alert title="Request could not be saved" tone="danger">
          {failure}
        </Alert>
      )}
      <Card className="request-form-card">
        <div className="identity-summary">
          <div className="spread">
            <span className="eyebrow">Requester information</span>
            <Badge tone="neutral" label="Demo profile" />
          </div>
          <dl className="identity-grid">
            <div>
              <dt>Full name</dt>
              <dd>{user.name}</dd>
            </div>
            <div>
              <dt>Profile ID</dt>
              <dd>{user.id.toUpperCase()}</dd>
            </div>
            <div>
              <dt>Role</dt>
              <dd>{roleLabels[user.role]}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{user.email}</dd>
            </div>
          </dl>
        </div>
        <form
          noValidate
          className="request-form-body form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <ErrorSummary errors={errors} />
          {old && (
            <Alert title={`Renewing ${old.id}`} tone="info">
              The new request starts after your existing validity period to
              avoid overlapping permissions.
            </Alert>
          )}
          {!eligible.length && (
            <div className="empty" role="status">
              <h2>No resources are eligible for this profile</h2>
              <p>
                The proposed catalog does not offer requester permissions for
                this role, or every eligible resource is unavailable.
              </p>
            </div>
          )}
          <Field
            id="resourceId"
            label="Select resource"
            required
            hint={
              old
                ? "Renewals keep the original resource, permission, and scope."
                : "Only proposed resources eligible for the current requester role are listed."
            }
            error={errors.resourceId}
          >
            <select
              id="resourceId"
              value={resourceId}
              disabled={Boolean(old) || !eligible.length}
              aria-invalid={!!errors.resourceId}
              aria-describedby={`resourceId-hint${errors.resourceId ? " resourceId-error" : ""}`}
              onChange={(e) => {
                const nextId = e.target.value;
                const nextCatalog = getCatalogResource(nextId);
                const nextPermission = getPermissionOptions(
                  nextCatalog,
                  user.role,
                )[0];
                setResource(nextId);
                setLevel(nextPermission?.id ?? "read");
                setScope({});
                if (nextCatalog) {
                  setEnd(
                    dayOffset(
                      `${start || state.clock.slice(0, 10)}T09:00:00.000Z`,
                      nextCatalog.validity.defaultDays,
                    ).slice(0, 10),
                  );
                }
                setErrors({});
              }}
            >
              <option value="">Choose a resource…</option>
              {eligible.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </Field>
          {catalog && (
            <>
              <Alert title="When to request this access" tone="info">
                <p>{catalog.ordinaryAccess}</p>
                <p>{catalog.requestableAccess}</p>
                <p className="small">
                  Proposed Permora workflow; this is not an official university
                  policy.
                </p>
              </Alert>
              <fieldset
                id="level"
                aria-describedby={errors.level ? "level-error" : undefined}
              >
                <legend>
                  Permission requested <span className="required">*</span>
                </legend>
                <div className="choice-grid">
                  {available.map((permission) => (
                    <label className="choice" key={permission.id}>
                      <input
                        type="radio"
                        name="level"
                        value={permission.id}
                        checked={level === permission.id}
                        onChange={() => setLevel(permission.id)}
                        disabled={Boolean(old)}
                      />
                      <span>
                        <strong>{permission.label}</strong>
                        <small>{permission.description}</small>
                      </span>
                    </label>
                  ))}
                </div>
                {errors.level && (
                  <p id="level-error" className="field-error">
                    {errors.level}
                  </p>
                )}
              </fieldset>
              {catalog.fixedScope === "requester-own-account" && (
                <Alert title="Own account only" tone="warning">
                  This request is fixed to {user.name} ({user.id.toUpperCase()}
                  ). There is no field for another student account.
                </Alert>
              )}
              {catalog.scopeFields.length > 0 && (
                <div className="form-grid resource-scope-fields">
                  {catalog.scopeFields.map((scopeField) => (
                    <Field
                      id={scopeField.id}
                      key={scopeField.id}
                      label={scopeField.label}
                      required
                      hint={scopeField.hint}
                      error={errors[scopeField.id]}
                    >
                      <input
                        id={scopeField.id}
                        value={scope[scopeField.id] ?? ""}
                        placeholder={scopeField.placeholder}
                        disabled={Boolean(old)}
                        aria-invalid={Boolean(errors[scopeField.id])}
                        aria-describedby={`${scopeField.id}-hint${errors[scopeField.id] ? ` ${scopeField.id}-error` : ""}`}
                        onChange={(event) =>
                          setScope({
                            ...scope,
                            [scopeField.id]: event.target.value,
                          })
                        }
                      />
                    </Field>
                  ))}
                </div>
              )}
              {resourceId === "r-faculty-grading" && (
                <Alert title="Assignment verification required" tone="warning">
                  The current prototype records the section but cannot verify a
                  teaching assignment. Stage 2 must verify it on the server
                  before accepting or approving the request.
                </Alert>
              )}
            </>
          )}
          <Field
            id="purpose"
            label="Justification / purpose"
            required
            error={errors.purpose}
            hint="20–2,000 characters. Include your project and why this access is needed."
          >
            <textarea
              id="purpose"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="I need access for…"
              maxLength={2000}
              aria-invalid={!!errors.purpose}
              aria-describedby={`purpose-hint${errors.purpose ? " purpose-error" : ""}`}
            />
          </Field>
          <div className="form-grid">
            <Field
              id="startsAt"
              label="Access starts"
              required
              error={errors.startsAt}
            >
              <input
                id="startsAt"
                type="date"
                value={start}
                min={state.clock.slice(0, 10)}
                onChange={(e) => setStart(e.target.value)}
                aria-invalid={!!errors.startsAt}
                aria-describedby={
                  errors.startsAt ? "startsAt-error" : undefined
                }
              />
            </Field>
            <Field
              id="expiresAt"
              label="Expiration date"
              required
              error={errors.expiresAt}
            >
              <input
                id="expiresAt"
                type="date"
                value={end}
                min={start}
                max={
                  start && catalog
                    ? dayOffset(
                        `${start}T09:00:00Z`,
                        catalog.validity.maxDays,
                      ).slice(0, 10)
                    : undefined
                }
                onChange={(e) => setEnd(e.target.value)}
                aria-invalid={!!errors.expiresAt}
                aria-describedby={
                  errors.expiresAt ? "expiresAt-error" : undefined
                }
              />
            </Field>
          </div>
          <div className="expiration-summary">
            <div className="eyebrow">Scheduled expiration · demo policy</div>
            <p>
              {end
                ? `${dateLabel(end)} · 09:00 UTC`
                : "An expiration date is required"}
            </p>
            <small>
              Maximum {catalog?.validity.maxDays ?? "resource-specific"} days.
              No permanent access.
            </small>
          </div>
          <div className="form-footer">
            <p className="small muted">
              Requests are recorded in local demo history.
            </p>
            <div className="row">
              <Button variant="outline" onClick={() => setCancel(true)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!eligible.length}>
                Submit request <span aria-hidden="true">→</span>
              </Button>
            </div>
          </div>
        </form>
      </Card>
      <p className="small muted">
        Demo only. Your request does not grant access to a real system.
      </p>
      {confirm && (
        <Confirm
          title="Submit this access request?"
          label="Confirm request"
          onClose={() => setConfirm(false)}
          onConfirm={commit}
        >
          <div className="stack">
            <p>
              <strong>{resource?.name}</strong> ·{" "}
              {available.find((permission) => permission.id === level)?.label}
            </p>
            {scopeSummary(resourceId, normalizedScope).map((item) => (
              <p key={item.label}>
                <strong>{item.label}:</strong> {item.value}
              </p>
            ))}
            <p>
              {dateLabel(draft.startsAt)} → {dateLabel(draft.expiresAt)}, 09:00
              UTC
            </p>
            <p className="muted">
              A demo reviewer will see your purpose and requested permission.
              You can follow the decision in My Requests.
            </p>
          </div>
        </Confirm>
      )}
      {cancel && (
        <Confirm
          title="Discard this request?"
          label="Discard request"
          danger
          onClose={() => setCancel(false)}
          onConfirm={() => router.push("/requests")}
        >
          <p>Your unsubmitted changes will be lost.</p>
        </Confirm>
      )}
    </>
  );
}
