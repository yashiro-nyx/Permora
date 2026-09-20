"use client";

import {
  useActionState,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import type { TrustedIdentity } from "@/lib/auth-types";
import type {
  AccessRequestDto,
  RequestableResourceDto,
} from "@/lib/server/request-types";
import {
  submitRequestAction,
  type SubmitRequestState,
} from "@/app/actions/requests";
import { dayOffset, dateLabel, roleLabels } from "@/lib/model";
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

const initialState: SubmitRequestState = { ok: false };
const today = () => new Date().toISOString().slice(0, 10);

export function ServerRequestForm({
  identity,
  resources,
  initialResource = "",
  renewal,
}: {
  identity: TrustedIdentity & { requesterRole: "student" | "faculty" };
  resources: RequestableResourceDto[];
  initialResource?: string;
  renewal?: AccessRequestDto | null;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, actionPending] = useActionState(
    submitRequestAction,
    initialState,
  );
  const [transitionPending, startTransition] = useTransition();
  const pending = actionPending || transitionPending;
  const [confirm, setConfirm] = useState(false);
  const [resourceId, setResourceId] = useState(
    renewal?.resourceId ?? initialResource,
  );
  const selected = resources.find((resource) => resource.id === resourceId);
  const renewalPermission = renewal?.permissionId;
  const [permissionId, setPermissionId] = useState(
    renewalPermission ?? selected?.permissions[0]?.id ?? "",
  );
  const firstDate = today();
  const [startsAt, setStartsAt] = useState(firstDate);
  const [expiresAt, setExpiresAt] = useState(() =>
    dayOffset(`${firstDate}T00:00:00.000Z`, selected?.defaultDays ?? 7).slice(
      0,
      10,
    ),
  );
  const [scopes, setScopes] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      renewal?.scopes.map((scope) => [scope.fieldName, scope.optionId]) ?? [],
    ),
  );
  const errors = state.message
    ? { [state.field ?? "form"]: state.message }
    : {};
  const blocked = selected?.blockedReasons ?? [];
  const available = resources.filter(
    (resource) => !renewal || resource.id === renewal.resourceId,
  );
  const selectedPermission = selected?.permissions.find(
    (permission) => permission.id === permissionId,
  );

  useEffect(() => {
    if (state.ok && state.requestId) {
      router.replace(`/requests/${state.requestId}?submitted=1`);
      router.refresh();
    }
  }, [state, router]);

  function chooseResource(nextId: string) {
    const next = resources.find((resource) => resource.id === nextId);
    setResourceId(nextId);
    setPermissionId(next?.permissions[0]?.id ?? "");
    setScopes({});
    setExpiresAt(
      dayOffset(`${startsAt}T00:00:00.000Z`, next?.defaultDays ?? 7).slice(
        0,
        10,
      ),
    );
  }

  function prepare() {
    if (!formRef.current?.reportValidity()) return;
    setConfirm(true);
  }

  function commit() {
    if (!formRef.current) return;
    setConfirm(false);
    startTransition(() => action(new FormData(formRef.current!)));
  }

  return (
    <>
      <PageHeading
        title={
          renewal ? "Renew resource access" : "New resource access request"
        }
        description="Tell us what you need. Eligibility, current assignments, conflicts, dates, and routing are verified again on the server."
      />
      {state.message && (
        <Alert title="Request not submitted" tone="danger">
          {state.message}
        </Alert>
      )}
      <Card className="request-form-card">
        <div className="identity-summary">
          <div className="spread">
            <span className="eyebrow">Requester information</span>
            <Badge tone="neutral" label="Verified account" />
          </div>
          <dl className="identity-grid">
            <div>
              <dt>Full name</dt>
              <dd>{identity.name}</dd>
            </div>
            <div>
              <dt>Internal account ID</dt>
              <dd>{identity.id}</dd>
            </div>
            <div>
              <dt>Requester role</dt>
              <dd>{roleLabels[identity.requesterRole]}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{identity.email}</dd>
            </div>
          </dl>
        </div>
        <form
          ref={formRef}
          className="request-form-body form-stack"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            prepare();
          }}
        >
          <ErrorSummary errors={errors} />
          {renewal && (
            <Alert title={`Renewing ${renewal.displayId}`} tone="info">
              This creates a new pending request. Locked values are revalidated
              against current assignments and policy.
            </Alert>
          )}
          {!resources.length && (
            <div className="empty" role="status">
              <h2>No eligible resources are configured</h2>
              <p>
                Your trusted requester role has no active catalog permissions.
                Contact an administrator; no request can be submitted.
              </p>
            </div>
          )}
          <Field
            id="resourceId"
            label="Select resource"
            required
            error={state.field === "resourceId" ? state.message : undefined}
            hint={
              renewal
                ? "Renewals keep the prior resource, permission, and scope."
                : "Only resources compatible with your server-assigned requester role are shown."
            }
          >
            <select
              id="resourceId"
              name="resourceId"
              value={resourceId}
              disabled={Boolean(renewal) || !resources.length}
              required
              onChange={(event) => chooseResource(event.target.value)}
            >
              <option value="">Choose a resource…</option>
              {available.map((resource) => (
                <option key={resource.id} value={resource.id}>
                  {resource.name}
                </option>
              ))}
            </select>
            {renewal && (
              <input type="hidden" name="resourceId" value={resourceId} />
            )}
          </Field>
          {selected && (
            <>
              <Alert title="Proposed access policy" tone="info">
                <p>{selected.description}</p>
                <p className="small">
                  These are proposed Permora rules, not an official policy of a
                  particular university.
                </p>
              </Alert>
              {blocked.length > 0 && (
                <Alert title="Submission blocked" tone="warning">
                  <ul>
                    {blocked.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                </Alert>
              )}
              <fieldset
                aria-describedby={
                  state.field === "permissionId"
                    ? "permissionId-error"
                    : undefined
                }
              >
                <legend>
                  Permission requested <span className="required">*</span>
                </legend>
                <div className="choice-grid">
                  {selected.permissions.map((permission) => (
                    <label className="choice" key={permission.id}>
                      <input
                        type="radio"
                        name="permissionId"
                        value={permission.id}
                        checked={permissionId === permission.id}
                        disabled={Boolean(renewal)}
                        required
                        onChange={() => setPermissionId(permission.id)}
                      />
                      <span>
                        <strong>{permission.label}</strong>
                        <small>{permission.description}</small>
                      </span>
                    </label>
                  ))}
                </div>
                {renewal && (
                  <input
                    type="hidden"
                    name="permissionId"
                    value={permissionId}
                  />
                )}
              </fieldset>
              {selected.fixedOwnAccount && (
                <Alert title="Own account only" tone="warning">
                  The server derives Student Portal ownership from{" "}
                  {identity.name}’s authenticated internal account. Another
                  student identifier cannot be submitted.
                </Alert>
              )}
              {selected.scopeFields.length > 0 && (
                <div className="form-grid resource-scope-fields">
                  {selected.scopeFields.map((field) => (
                    <Field
                      key={field.fieldName}
                      id={field.fieldName}
                      label={field.label}
                      required
                      error={
                        state.field === field.fieldName
                          ? state.message
                          : undefined
                      }
                      hint="Only current assignments recorded by an administrator are available."
                    >
                      <select
                        id={field.fieldName}
                        name={`scope:${field.fieldName}`}
                        value={scopes[field.fieldName] ?? ""}
                        disabled={Boolean(renewal)}
                        required
                        onChange={(event) =>
                          setScopes((current) => ({
                            ...current,
                            [field.fieldName]: event.target.value,
                          }))
                        }
                      >
                        <option value="">
                          Choose {field.label.toLowerCase()}…
                        </option>
                        {field.options.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.code} · {option.displayName}
                          </option>
                        ))}
                      </select>
                      {renewal && (
                        <input
                          type="hidden"
                          name={`scope:${field.fieldName}`}
                          value={scopes[field.fieldName] ?? ""}
                        />
                      )}
                    </Field>
                  ))}
                </div>
              )}
            </>
          )}
          {renewal && (
            <input type="hidden" name="renewalOf" value={renewal.id} />
          )}
          <Field
            id="purpose"
            label="Justification / purpose"
            required
            error={state.field === "purpose" ? state.message : undefined}
            hint="20–2,000 characters. Explain the additional or temporary access need."
          >
            <textarea
              id="purpose"
              name="purpose"
              defaultValue={renewal?.purpose ?? ""}
              minLength={20}
              maxLength={2000}
              required
              placeholder="I need access for…"
            />
          </Field>
          <div className="form-grid">
            <Field
              id="startsAt"
              label="Access starts"
              required
              error={state.field === "startsAt" ? state.message : undefined}
            >
              <input
                id="startsAt"
                name="startsAt"
                type="date"
                value={startsAt}
                min={today()}
                required
                onChange={(event) => setStartsAt(event.target.value)}
              />
            </Field>
            <Field
              id="expiresAt"
              label="Expiration date"
              required
              error={state.field === "expiresAt" ? state.message : undefined}
              hint={
                selected
                  ? `Maximum ${selected.maxDays} days under the current policy.`
                  : undefined
              }
            >
              <input
                id="expiresAt"
                name="expiresAt"
                type="date"
                value={expiresAt}
                min={startsAt}
                required
                onChange={(event) => setExpiresAt(event.target.value)}
              />
            </Field>
          </div>
          <div className="form-actions">
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push("/requests")}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={prepare}
              disabled={!selected || blocked.length > 0 || pending}
            >
              {pending
                ? "Submitting…"
                : renewal
                  ? "Review renewal"
                  : "Review request"}
            </Button>
          </div>
        </form>
      </Card>
      {confirm && selected && (
        <Confirm
          title={
            renewal
              ? "Submit this renewal request?"
              : "Submit this access request?"
          }
          label="Submit request"
          onClose={() => setConfirm(false)}
          onConfirm={commit}
        >
          <p>
            <strong>{selected.name}</strong> · {selectedPermission?.label}
          </p>
          <p>
            Requested from {dateLabel(`${startsAt}T00:00:00Z`)} to{" "}
            {dateLabel(`${expiresAt}T00:00:00Z`)}. Submission creates a pending
            database record; it does not approve or activate access.
          </p>
        </Confirm>
      )}
    </>
  );
}
