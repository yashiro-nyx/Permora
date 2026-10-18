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
import { useToast } from "./toast";
import {
  Alert,
  Badge,
  Button,
  Card,
  Confirm,
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
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, actionPending] = useActionState(
    submitRequestAction,
    initialState,
  );
  const notifiedRef = useRef<string | null>(null);
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
  // Controlled value for the purpose textarea so it can be reset on resource
  // change. Renewals pre-fill the previous justification.
  const [purpose, setPurpose] = useState(renewal?.purpose ?? "");

  const blocked = selected?.blockedReasons ?? [];
  const available = resources.filter(
    (resource) => !renewal || resource.id === renewal.resourceId,
  );
  const selectedPermission = selected?.permissions.find(
    (permission) => permission.id === permissionId,
  );

  useEffect(() => {
    if (state.ok && state.requestId) {
      // Fire the success toast once. The ToastProvider lives in the portal
      // layout above this route segment so it survives the navigation.
      if (notifiedRef.current !== state.requestId) {
        notifiedRef.current = state.requestId;
        toast.success({
          title: renewal ? "Renewal submitted" : "Request submitted",
          description: state.displayId
            ? `${state.displayId} is now awaiting review and routing.`
            : "Your request is now awaiting review and routing.",
        });
        // Signal the notification bell to refresh its unread count.
        window.dispatchEvent(new Event("permora-notification-refresh"));
      }
      // router.replace navigates to the submitted request's detail page.
      // router.refresh() is intentionally omitted here: it would cause a
      // scroll-to-top on the incoming detail page before the replace completes.
      router.replace(`/requests/${state.requestId}?submitted=1`);
    } else if (!state.ok && state.message) {
      // Emit one error toast per unique error. The inline field errors in the
      // form remain visible after the toast auto-dismisses (8 s). The toast
      // fires at most once per unique field+message key, even if the effect
      // re-runs due to an unrelated re-render.
      const key = `${state.field ?? "form"}:${state.message}`;
      if (notifiedRef.current !== key) {
        notifiedRef.current = key;
        toast.error({
          title: "Request not submitted",
          description: state.message,
        });
      }
    }
  }, [state, router, toast, renewal]);

  function chooseResource(nextId: string) {
    const next = resources.find((resource) => resource.id === nextId);
    setResourceId(nextId);
    setPermissionId(next?.permissions[0]?.id ?? "");
    setScopes({});
    setPurpose("");
    // Reset expiry to the new resource's default duration; keep startsAt as-is
    // (the start date is user-specific, not resource-specific).
    setExpiresAt(
      dayOffset(`${startsAt}T00:00:00.000Z`, next?.defaultDays ?? 7).slice(
        0,
        10,
      ),
    );
    // Clear the notifiedRef so switching resources resets the error toast guard.
    notifiedRef.current = null;
  }

  function prepare() {
    // Use constraint-validation API to highlight the first invalid field.
    // reportValidity() focuses the invalid element; the browser scrolls to it,
    // which is intentional and accessible. The page should not scroll
    // unexpectedly when the form is valid.
    if (!formRef.current?.reportValidity()) return;
    setConfirm(true);
  }

  function commit() {
    if (!formRef.current) return;
    setConfirm(false);
    startTransition(() => action(new FormData(formRef.current!)));
  }

  // Field-level error from the last server action response.
  const fieldError = (fieldName: string) =>
    state.field === fieldName ? state.message : undefined;

  return (
    <>
      <PageHeading
        title={
          renewal ? "Renew resource access" : "New resource access request"
        }
        description="Tell us what you need. Eligibility, current assignments, conflicts, dates, and routing are verified again on the server."
      />
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
          {renewal && (
            <Alert title={`Renewing ${renewal.displayId}`} tone="info">
              This creates a new pending request. Locked values are revalidated
              against current assignments and policy.
            </Alert>
          )}
          {/* Show a form-level alert only when the server returns a generic
              error with no specific field (field="form"). Field-specific errors
              appear inline next to their respective inputs; only the toast fires
              for those. This avoids redundant triple-display of the same
              message. */}
          {!state.ok && state.field === "form" && state.message && (
            <Alert title="Request not submitted" tone="danger">
              {state.message}
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
            error={fieldError("resourceId")}
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
                {state.field === "permissionId" && state.message && (
                  <p id="permissionId-error" className="field-error">
                    {state.message}
                  </p>
                )}
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
                  {identity.name}&apos;s authenticated internal account. Another
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
                      error={fieldError(field.fieldName)}
                      hint="Only assignments recorded by an administrator for your account are shown. Contact an administrator if the expected option is missing."
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
            error={fieldError("purpose")}
            hint="20–2,000 characters. Explain the additional or temporary access need."
          >
            <textarea
              id="purpose"
              name="purpose"
              value={purpose}
              minLength={20}
              maxLength={2000}
              required
              placeholder="I need access for…"
              onChange={(event) => setPurpose(event.target.value)}
            />
          </Field>
          <div className="form-grid">
            <Field
              id="startsAt"
              label="Access starts"
              required
              error={fieldError("startsAt")}
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
              error={fieldError("expiresAt")}
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
