"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { CatalogResourceDto } from "@/lib/server/admin-governance-types";
import {
  availabilityLabel,
  catalogMutationMessage,
  catalogToggleConfirmMessage,
  normalizeInstitutionalCode,
  validateScopeOptionDraft,
} from "@/lib/catalog-admin-ui";
import { useToast } from "./toast";
import { Alert, Button, Card, Confirm, Empty, Field, PageHeading } from "./ui";

async function errorCode(response: Response) {
  try {
    const body = (await response.json()) as { error?: { code?: unknown } };
    return typeof body.error?.code === "string" ? body.error.code : undefined;
  } catch {
    return undefined;
  }
}

function dateLabel(value: string | null) {
  if (!value) return "No end date";
  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium",
    timeZone: "Asia/Manila",
  }).format(new Date(value));
}

interface PendingToggle {
  kind: "resource";
  id: string;
  label: string;
  enabled: boolean;
}

export function AdminResourceCatalog({
  resources,
}: {
  resources: CatalogResourceDto[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [scopeResourceId, setScopeResourceId] = useState("");
  const [scopeFieldName, setScopeFieldName] = useState("");
  const [institutionalCode, setInstitutionalCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [toggleBusy, setToggleBusy] = useState(false);
  const [pendingToggle, setPendingToggle] = useState<PendingToggle | null>(null);
  const [failure, setFailure] = useState("");
  const [success, setSuccess] = useState("");

  const scopeResource = resources.find((item) => item.id === scopeResourceId);
  const scopeFields = scopeResource?.scopeFields ?? [];

  async function addScopeOption(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFailure("");
    setSuccess("");
    const draft = {
      resourceId: scopeResourceId,
      fieldName: scopeFieldName,
      institutionalCode,
      displayName,
    };
    const validation = validateScopeOptionDraft(draft);
    if (validation) {
      setFailure(validation);
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/admin/catalog/scopes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!response.ok) {
        const scopeErrMsg = catalogMutationMessage(response.status, await errorCode(response));
        setFailure(scopeErrMsg);
        toast.error({ title: "Scope option not added", description: scopeErrMsg });
        if (response.status === 404) router.refresh();
        return;
      }
      const addedMsg = `Scope “${displayName.trim()}” added to ${scopeResource?.name ?? "the resource"}.`;
      setSuccess(addedMsg);
      toast.success({ title: "Scope option added", description: addedMsg });
      setInstitutionalCode("");
      setDisplayName("");
      router.refresh();
    } catch {
      const scopeFallback = "The scope could not be saved. Check your connection and try again.";
      setFailure(scopeFallback);
      toast.error({ title: "Scope option not saved", description: scopeFallback });
    } finally {
      setBusy(false);
    }
  }

  async function confirmToggle() {
    if (!pendingToggle || toggleBusy) return;
    setFailure("");
    setSuccess("");
    setToggleBusy(true);
    try {
      const response = await fetch("/api/admin/catalog", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: pendingToggle.kind,
          id: pendingToggle.id,
          enabled: pendingToggle.enabled,
        }),
      });
      if (!response.ok) {
        const toggleErrMsg = catalogMutationMessage(response.status, await errorCode(response));
        setFailure(toggleErrMsg);
        toast.error({ title: "Catalog change not saved", description: toggleErrMsg });
        if (response.status === 404) router.refresh();
        return;
      }
      const toggleMsg = `${pendingToggle.label} is now ${availabilityLabel(pendingToggle.enabled).toLowerCase()}.`;
      setSuccess(toggleMsg);
      toast.success({ title: "Catalog updated", description: toggleMsg });
      setPendingToggle(null);
      router.refresh();
    } catch {
      const toggleFallback = "The change could not be saved. Check your connection and try again.";
      setFailure(toggleFallback);
      toast.error({ title: "Catalog change not saved", description: toggleFallback });
    } finally {
      setToggleBusy(false);
    }
  }

  return (
    <>
      <PageHeading
        eyebrow="ADMIN › GOVERNANCE"
        title="Resource catalog"
        description="Review the proposed institutional resource catalog, manage request availability, and add institutional scope options. Policy durations are read-only and remain migration-controlled."
      />
      <Alert title="Server-enforced administration" tone="info">
        Availability and scope changes are validated and audited on the server.
        Hiding a control here is never the security boundary. Existing requests,
        decisions, and entitlements are not altered by availability changes.
      </Alert>
      {failure && !pendingToggle && (
        <Alert title="Action not completed" tone="danger">{failure}</Alert>
      )}
      {success && (
        <div role="status">
          <Alert title="Update complete" tone="success">{success}</Alert>
        </div>
      )}
      <Card title="Add scope option" className="responsibility-form-card">
        <form className="responsibility-form" onSubmit={addScopeOption}>
          <div className="responsibility-form-grid">
            <Field id="scope-resource" label="Resource" required>
              <select
                id="scope-resource"
                value={scopeResourceId}
                onChange={(event) => {
                  setScopeResourceId(event.target.value);
                  setScopeFieldName("");
                }}
                required
              >
                <option value="">Choose a resource</option>
                {resources.map((resource) => (
                  <option key={resource.id} value={resource.id}>
                    {resource.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              id="scope-field"
              label="Scope field"
              required
              hint={
                scopeResource && !scopeFields.length
                  ? "This resource defines no scope fields."
                  : undefined
              }
            >
              <select
                id="scope-field"
                value={scopeFieldName}
                onChange={(event) => setScopeFieldName(event.target.value)}
                disabled={!scopeResource || !scopeFields.length}
                required
              >
                <option value="">Choose a scope field</option>
                {scopeFields.map((field) => (
                  <option key={field.fieldName} value={field.fieldName}>
                    {field.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              id="scope-code"
              label="Institutional code"
              required
              hint="Stored upper-cased and unique per resource field."
            >
              <input
                id="scope-code"
                type="text"
                value={institutionalCode}
                onChange={(event) => setInstitutionalCode(event.target.value)}
                onBlur={() =>
                  setInstitutionalCode((current) => normalizeInstitutionalCode(current))
                }
                maxLength={80}
                required
              />
            </Field>
            <Field id="scope-name" label="Display name" required>
              <input
                id="scope-name"
                type="text"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                maxLength={200}
                required
              />
            </Field>
          </div>
          <div className="responsibility-actions">
            <Button type="submit" disabled={busy}>
              {busy ? "Adding…" : "Add scope option"}
            </Button>
          </div>
        </form>
      </Card>
      {!resources.length ? (
        <Card title="Resources">
          <Empty
            title="No catalog resources"
            description="Resources are created through guarded migrations and configuration tools."
          />
        </Card>
      ) : (
        resources.map((resource) => (
          <Card
            key={resource.id}
            title={resource.name}
            className="responsibility-list-card"
            action={
              <span className={`badge ${resource.available ? "tone-success" : "tone-neutral"}`}>
                {availabilityLabel(resource.available)}
              </span>
            }
          >
            <p className="small muted">{resource.description}</p>
            <div className="resource-badges">
              <span className="access-level">Sensitivity: {resource.sensitivity}</span>
              {resource.currentPolicy ? (
                <span className="access-level">
                  Policy v{resource.currentPolicy.version}: {resource.currentPolicy.defaultDays}d
                  default / {resource.currentPolicy.maxDays}d max
                  {resource.currentPolicy.renewable ? " · renewable" : ""}
                  {" · "}provisional
                </span>
              ) : (
                <span className="access-level">No active policy version</span>
              )}
            </div>
            {resource.currentPolicy && (
              <p className="small muted">
                Effective {dateLabel(resource.currentPolicy.effectiveFrom)} –{" "}
                {dateLabel(resource.currentPolicy.effectiveUntil)}. {resource.currentPolicy.policyNote}
              </p>
            )}
            <div className="responsibility-actions">
              <Button
                variant={resource.available ? "danger" : "primary"}
                type="button"
                disabled={toggleBusy || busy}
                aria-label={`Make ${resource.name} ${resource.available ? "unavailable" : "available"}`}
                onClick={() =>
                  setPendingToggle({
                    kind: "resource",
                    id: resource.id,
                    label: resource.name,
                    enabled: !resource.available,
                  })
                }
              >
                {resource.available ? "Make unavailable" : "Make available"}
              </Button>
            </div>
            {resource.scopeFields.length > 0 && (
              <div className="table-scroll" role="region" aria-label={`${resource.name} scope options`} tabIndex={0}>
                <table className="responsibility-table">
                  <caption className="sr-only">Scope options for {resource.name}</caption>
                  <thead>
                    <tr>
                      <th scope="col">Scope field</th>
                      <th scope="col">Institutional code</th>
                      <th scope="col">Display name</th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resource.scopeOptions.length ? (
                      resource.scopeOptions.map((scope) => {
                        const field = resource.scopeFields.find(
                          (entry) => entry.fieldName === scope.fieldName,
                        );
                        return (
                          <tr key={scope.id}>
                            <td>{field?.label ?? scope.fieldName}</td>
                            <td><code>{scope.institutionalCode}</code></td>
                            <td>{scope.displayName}</td>
                            <td>
                              <span className={`badge ${scope.active ? "tone-success" : "tone-neutral"}`}>
                                {scope.active ? "Active" : "Inactive"}
                              </span>
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={4} className="small muted">
                          No scope options yet. Add one above.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        ))
      )}
      {pendingToggle && (
        <Confirm
          title="Confirm availability change"
          label={toggleBusy ? "Saving…" : "Confirm change"}
          danger={!pendingToggle.enabled}
          busy={toggleBusy}
          onClose={() => setPendingToggle(null)}
          onConfirm={() => void confirmToggle()}
        >
          <p>
            {catalogToggleConfirmMessage(
              pendingToggle.kind,
              pendingToggle.label,
              pendingToggle.enabled,
            )}
          </p>
          {failure && <p className="field-error" role="alert">{failure}</p>}
        </Confirm>
      )}
    </>
  );
}
