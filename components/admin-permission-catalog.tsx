"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { CatalogResourceDto } from "@/lib/server/admin-governance-types";
import {
  availabilityLabel,
  catalogMutationMessage,
  catalogToggleConfirmMessage,
  requesterRolesLabel,
} from "@/lib/catalog-admin-ui";
import { Alert, Card, Confirm, Empty, PageHeading } from "./ui";

async function errorCode(response: Response) {
  try {
    const body = (await response.json()) as { error?: { code?: unknown } };
    return typeof body.error?.code === "string" ? body.error.code : undefined;
  } catch {
    return undefined;
  }
}

interface PendingToggle {
  id: string;
  label: string;
  enabled: boolean;
}

export function AdminPermissionCatalog({
  resources,
}: {
  resources: CatalogResourceDto[];
}) {
  const router = useRouter();
  const [pendingToggle, setPendingToggle] = useState<PendingToggle | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [success, setSuccess] = useState("");

  const hasPermissions = resources.some((resource) => resource.permissions.length);

  async function confirmToggle() {
    if (!pendingToggle || busy) return;
    setFailure("");
    setSuccess("");
    setBusy(true);
    try {
      const response = await fetch("/api/admin/catalog", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "permission",
          id: pendingToggle.id,
          enabled: pendingToggle.enabled,
        }),
      });
      if (!response.ok) {
        setFailure(catalogMutationMessage(response.status, await errorCode(response)));
        if (response.status === 404) router.refresh();
        return;
      }
      setSuccess(
        `${pendingToggle.label} is now ${(pendingToggle.enabled ? "enabled" : "disabled")}.`,
      );
      setPendingToggle(null);
      router.refresh();
    } catch {
      setFailure("The change could not be saved. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeading
        eyebrow="ADMIN › GOVERNANCE"
        title="Permissions & eligibility"
        description="Review resource-specific permissions, the requester roles each permits, and enable or disable permissions for new requests. Scope restrictions are managed per responsibility; entitlement grants remain approval-controlled."
      />
      <Alert title="Server-enforced administration" tone="info">
        Enabling or disabling a permission is validated and audited on the
        server and only affects new request eligibility. It does not grant
        roles, bypass approval, or alter existing entitlements, decisions, or
        audit evidence.
      </Alert>
      {failure && !pendingToggle && (
        <Alert title="Action not completed" tone="danger">{failure}</Alert>
      )}
      {success && (
        <div role="status">
          <Alert title="Update complete" tone="success">{success}</Alert>
        </div>
      )}
      {!hasPermissions ? (
        <Card title="Permissions">
          <Empty
            title="No catalog permissions"
            description="Permissions are created through guarded migrations and configuration tools."
          />
        </Card>
      ) : (
        resources
          .filter((resource) => resource.permissions.length)
          .map((resource) => (
            <Card
              key={resource.id}
              title={resource.name}
              className="responsibility-list-card"
              action={
                <span className={`badge ${resource.available ? "tone-success" : "tone-neutral"}`}>
                  Resource {availabilityLabel(resource.available).toLowerCase()}
                </span>
              }
            >
              {!resource.available && (
                <p className="small muted">
                  This resource is unavailable, so no permission below accepts
                  new requests regardless of its own state.
                </p>
              )}
              <div className="table-scroll" role="region" aria-label={`${resource.name} permissions`} tabIndex={0}>
                <table className="responsibility-table">
                  <caption className="sr-only">Permissions for {resource.name}</caption>
                  <thead>
                    <tr>
                      <th scope="col">Permission</th>
                      <th scope="col">Applicable roles</th>
                      <th scope="col">Status</th>
                      <th scope="col">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resource.permissions.map((permission) => (
                      <tr key={permission.id} data-permission-id={permission.id}>
                        <td>
                          <strong>{permission.label}</strong>
                          <small className="table-secondary"><code>{permission.id}</code></small>
                        </td>
                        <td>
                          <span className="access-level">
                            {requesterRolesLabel(permission.requesterRoles)}
                          </span>
                        </td>
                        <td>
                          <span className={`badge ${permission.enabled ? "tone-success" : "tone-neutral"}`}>
                            {permission.enabled ? "Enabled" : "Disabled"}
                          </span>
                        </td>
                        <td>
                          <button
                            className={`button ${permission.enabled ? "button-danger" : "button-primary"}`}
                            type="button"
                            disabled={busy}
                            aria-label={`${permission.enabled ? "Disable" : "Enable"} ${permission.label}`}
                            onClick={() =>
                              setPendingToggle({
                                id: permission.id,
                                label: permission.label,
                                enabled: !permission.enabled,
                              })
                            }
                          >
                            {permission.enabled ? "Disable" : "Enable"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ))
      )}
      {pendingToggle && (
        <Confirm
          title="Confirm permission change"
          label={busy ? "Saving…" : "Confirm change"}
          danger={!pendingToggle.enabled}
          busy={busy}
          onClose={() => setPendingToggle(null)}
          onConfirm={() => void confirmToggle()}
        >
          <p>
            {catalogToggleConfirmMessage(
              "permission",
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
