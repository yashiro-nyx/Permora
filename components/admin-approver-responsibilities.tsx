"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type {
  ApproverResponsibilityDto,
  CatalogResourceDto,
} from "@/lib/server/admin-governance-types";
import { Alert, Card, Confirm, Empty, Field, PageHeading } from "./ui";

type ResponsibilityList = Awaited<
  ReturnType<typeof import("@/lib/server/admin-governance-service").listResponsibilities>
>;

function safeMutationMessage(status: number, code?: string) {
  if (status === 401 || status === 403) return "Administrator access is required. Sign in with an active administrator account.";
  if (status === 404) return "This responsibility is no longer active. The list has been refreshed.";
  if (status === 409 || code === "conflict") return "An overlapping responsibility already exists for this approver, resource, and permission.";
  if (status === 400 || code === "invalid_input") return "Some selected responsibility details are no longer valid. Review the form and try again.";
  return "The responsibility could not be saved. Try again later.";
}

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

export function AdminApproverResponsibilities({
  data,
  approvers,
  resources,
}: {
  data: ResponsibilityList;
  approvers: Array<{ id: string; name: string }>;
  resources: CatalogResourceDto[];
}) {
  const router = useRouter();
  const [approverUserId, setApproverUserId] = useState("");
  const [resourceId, setResourceId] = useState("");
  const [permissionId, setPermissionId] = useState("");
  const [scopeMode, setScopeMode] = useState<"" | "scoped" | "resource-wide">("");
  const [scopeOptionIds, setScopeOptionIds] = useState<string[]>([]);
  const [confirmResourceWide, setConfirmResourceWide] = useState(false);
  const [ending, setEnding] = useState<ApproverResponsibilityDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [endBusy, setEndBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [success, setSuccess] = useState("");
  const selectedResource = resources.find((resource) => resource.id === resourceId);
  const availableScopes = selectedResource?.scopeOptions.filter((scope) => scope.active) ?? [];

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFailure("");
    setSuccess("");
    if (!approverUserId || !resourceId || !scopeMode) {
      setFailure("Choose an approver, a resource, and a scope mode before adding the responsibility.");
      return;
    }
    if (scopeMode === "scoped" && !scopeOptionIds.length) {
      setFailure("Choose at least one scope, or explicitly confirm a resource-wide responsibility.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/admin/responsibilities", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          approverUserId,
          resourceId,
          permissionId: permissionId || null,
          scopeOptionIds: scopeMode === "resource-wide" ? [] : scopeOptionIds,
        }),
      });
      if (!response.ok) {
        setFailure(safeMutationMessage(response.status, await errorCode(response)));
        if (response.status === 404) router.refresh();
        return;
      }
      setSuccess("Responsibility added.");
      setApproverUserId("");
      setResourceId("");
      setPermissionId("");
      setScopeMode("");
      setScopeOptionIds([]);
      router.refresh();
    } catch {
      setFailure("The responsibility could not be saved. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function endResponsibility() {
    if (!ending || endBusy) return;
    setFailure("");
    setSuccess("");
    setEndBusy(true);
    try {
      const response = await fetch(
        `/api/admin/responsibilities/${encodeURIComponent(ending.id)}/end`,
        { method: "POST" },
      );
      if (!response.ok) {
        setFailure(safeMutationMessage(response.status, await errorCode(response)));
        if (response.status === 404) router.refresh();
        return;
      }
      setSuccess("Responsibility ended.");
      setEnding(null);
      router.refresh();
    } catch {
      setFailure("The responsibility could not be ended. Check your connection and try again.");
    } finally {
      setEndBusy(false);
    }
  }

  const page = data.pagination.page;
  const pageCount = Math.max(1, data.pagination.pageCount);

  return (
    <>
      <PageHeading
        eyebrow="ADMIN › GOVERNANCE"
        title="Approver responsibilities"
        description="Define which active approvers may review requests by resource, permission, and scope."
      />
      {failure && !ending && <Alert title="Action not completed" tone="danger">{failure}</Alert>}
      {success && <div role="status"><Alert title="Update complete" tone="success">{success}</Alert></div>}
      <Card title="Add responsibility" className="responsibility-form-card">
        <form className="responsibility-form" onSubmit={create}>
          <div className="responsibility-form-grid">
            <Field id="responsibility-approver" label="Approver" required>
              <select
                id="responsibility-approver"
                value={approverUserId}
                onChange={(event) => setApproverUserId(event.target.value)}
                required
              >
                <option value="">Choose an approver</option>
                {approvers.map((approver) => (
                  <option key={approver.id} value={approver.id}>{approver.name}</option>
                ))}
              </select>
            </Field>
            <Field id="responsibility-resource" label="Resource" required>
              <select
                id="responsibility-resource"
                value={resourceId}
                onChange={(event) => {
                  setResourceId(event.target.value);
                  setPermissionId("");
                  setScopeMode("");
                  setScopeOptionIds([]);
                }}
                required
              >
                <option value="">Choose a resource</option>
                {resources.map((resource) => (
                  <option key={resource.id} value={resource.id} disabled={!resource.available}>
                    {resource.name}{resource.available ? "" : " (Unavailable)"}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="responsibility-permission" label="Permission">
              <select
                id="responsibility-permission"
                value={permissionId}
                onChange={(event) => setPermissionId(event.target.value)}
                disabled={!selectedResource}
              >
                <option value="">All permissions</option>
                {selectedResource?.permissions.map((permission) => (
                  <option key={permission.id} value={permission.id} disabled={!permission.enabled}>
                    {permission.label}{permission.enabled ? "" : " (Disabled)"}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <fieldset className="field">
            <legend>Responsibility scope <span className="required">*</span></legend>
            <p className="field-hint">Choose one scope mode. Resource-wide access is never selected by default.</p>
            <div className="responsibility-scope-modes">
              <label className="responsibility-scope-mode">
                <input
                  type="radio"
                  name="responsibility-scope-mode"
                  value="scoped"
                  checked={scopeMode === "scoped"}
                  onChange={() => {
                    setScopeMode("scoped");
                    setScopeOptionIds([]);
                  }}
                />
                <span>
                  <strong>Limit to selected scopes</strong>
                  <small>Select at least one active scope below.</small>
                </span>
              </label>
              <label className="responsibility-scope-mode">
                <input
                  type="radio"
                  name="responsibility-scope-mode"
                  value="resource-wide"
                  checked={scopeMode === "resource-wide"}
                  onChange={() => setConfirmResourceWide(true)}
                />
                <span>
                  <strong>Resource-wide responsibility</strong>
                  <small>Applies across the selected resource; confirmation is required.</small>
                </span>
              </label>
            </div>
            {scopeMode === "scoped" && (
              <div className="responsibility-scope-list" aria-label="Available scopes">
                {availableScopes.length ? availableScopes.map((scope) => {
                  const field = selectedResource?.scopeFields.find(
                    (entry) => entry.fieldName === scope.fieldName,
                  );
                  const checked = scopeOptionIds.includes(scope.id);
                  return (
                    <label className="responsibility-scope-option" key={scope.id}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => setScopeOptionIds((current) => checked
                          ? current.filter((id) => id !== scope.id)
                          : [...current, scope.id])}
                      />
                      <span>
                        <strong>{scope.displayName}</strong>
                        <small>{field?.label ?? scope.fieldName}</small>
                      </span>
                    </label>
                  );
                }) : (
                  <p className="small muted">No active scopes are available for this resource.</p>
                )}
              </div>
            )}
          </fieldset>
          <div className="responsibility-actions">
            <button className="button button-primary" type="submit" disabled={busy}>
              {busy ? "Adding…" : "Add responsibility"}
            </button>
          </div>
        </form>
      </Card>
      <Card title="Current and past responsibilities" className="responsibility-list-card">
        {!data.items.length ? (
          <Empty
            title="No responsibilities to show"
            description="Responsibilities added by administrators will appear here."
          />
        ) : (
          <div className="table-scroll" role="region" aria-label="Approver responsibilities table" tabIndex={0}>
            <table className="responsibility-table">
              <caption className="sr-only">Current and past approver responsibilities</caption>
              <thead>
                <tr>
                  <th scope="col">Approver</th>
                  <th scope="col">Resource / permission</th>
                  <th scope="col">Scope</th>
                  <th scope="col">Effective period</th>
                  <th scope="col">Status</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.id} data-responsibility-id={item.id}>
                    <td>
                      <strong>{item.approver.name}</strong>
                      {!item.approver.active && <small className="table-secondary">Inactive account</small>}
                    </td>
                    <td>
                      <strong>{item.resource.name}</strong>
                      <small className="table-secondary">{item.permission?.label ?? "All permissions"}</small>
                    </td>
                    <td>
                      {item.scopes.length ? item.scopes.map((scope) => (
                        <small className="table-secondary" key={scope.id}>{scope.fieldName}: {scope.label}</small>
                      )) : <span className="access-level">Resource-wide</span>}
                    </td>
                    <td className="date-cell">
                      {dateLabel(item.validFrom)} – {dateLabel(item.validUntil)}
                    </td>
                    <td><span className={`badge ${item.active ? "tone-success" : "tone-neutral"}`}>{item.active ? "Active" : "Ended"}</span></td>
                    <td>
                      {item.active ? (
                        <button
                          className="button button-danger"
                          type="button"
                          aria-label={`End responsibility for ${item.approver.name} on ${item.resource.name}`}
                          onClick={() => setEnding(item)}
                          disabled={busy || endBusy}
                        >
                          End responsibility
                        </button>
                      ) : <span className="small muted">No action available</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data.pagination.total > data.pagination.pageSize && (
          <div className="pagination staff-pagination">
            <span>Page {page} of {pageCount} · {data.pagination.total} responsibilities</span>
            <nav aria-label="Responsibility pagination">
              <Link className={`button button-outline ${page <= 1 ? "disabled-link" : ""}`} aria-disabled={page <= 1} tabIndex={page <= 1 ? -1 : undefined} href={`?page=${Math.max(1, page - 1)}`}>Previous</Link>
              <Link className={`button button-outline ${page >= pageCount ? "disabled-link" : ""}`} aria-disabled={page >= pageCount} tabIndex={page >= pageCount ? -1 : undefined} href={`?page=${Math.min(pageCount, page + 1)}`}>Next</Link>
            </nav>
          </div>
        )}
      </Card>
      {confirmResourceWide && (
        <Confirm
          title="Confirm resource-wide responsibility"
          label="Confirm resource-wide scope"
          onClose={() => setConfirmResourceWide(false)}
          onConfirm={() => {
            setScopeMode("resource-wide");
            setScopeOptionIds([]);
            setConfirmResourceWide(false);
          }}
        >
          <p>This responsibility will apply across {selectedResource?.name ?? "the selected resource"}, without scope restrictions.</p>
        </Confirm>
      )}
      {ending && (
        <Confirm
          title="End responsibility?"
          label={endBusy ? "Ending…" : "End responsibility"}
          danger
          busy={endBusy}
          onClose={() => setEnding(null)}
          onConfirm={() => void endResponsibility()}
        >
          <p>End {ending.approver.name}&apos;s responsibility for {ending.resource.name}?</p>
          <p className="small muted">This takes effect immediately and cannot be undone here.</p>
          {failure && <p className="field-error" role="alert">{failure}</p>}
        </Confirm>
      )}
    </>
  );
}