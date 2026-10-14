"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { DelegationDto } from "@/lib/server/admin-governance-types";
import type { PaginationMeta } from "@/lib/pagination";
import {
  delegationCancelConfirmMessage,
  delegationMutationMessage,
  delegationStatusLabel,
  validateDelegationDraft,
} from "@/lib/delegation-admin-ui";
import { useToast } from "./toast";
import {
  Alert,
  Button,
  Card,
  Confirm,
  Empty,
  Field,
  PageHeading,
  TablePagination,
} from "./ui";

async function errorCode(response: Response) {
  try {
    const body = (await response.json()) as { error?: { code?: unknown } };
    return typeof body.error?.code === "string" ? body.error.code : undefined;
  } catch {
    return undefined;
  }
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium",
    timeZone: "Asia/Manila",
  }).format(new Date(value));
}

const statusTone: Record<string, string> = {
  Active: "tone-success",
  Scheduled: "tone-warning",
  Ended: "tone-neutral",
  Cancelled: "tone-neutral",
};

export function AdminDelegations({
  delegations,
  approvers,
  pagination,
}: {
  delegations: DelegationDto[];
  approvers: Array<{ id: string; name: string }>;
  pagination: PaginationMeta;
}) {
  const router = useRouter();
  const toast = useToast();
  const [delegatorUserId, setDelegatorUserId] = useState("");
  const [substituteUserId, setSubstituteUserId] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [busy, setBusy] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelling, setCancelling] = useState<DelegationDto | null>(null);
  const [failure, setFailure] = useState("");
  const [success, setSuccess] = useState("");

  function toIso(dateValue: string, endOfDay: boolean) {
    // Date inputs provide YYYY-MM-DD; anchor to local midnight / end of day.
    return new Date(`${dateValue}T${endOfDay ? "23:59:59" : "00:00:00"}`).toISOString();
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFailure("");
    setSuccess("");
    const draft = {
      delegatorUserId,
      substituteUserId,
      validFrom: validFrom ? toIso(validFrom, false) : "",
      validUntil: validUntil ? toIso(validUntil, true) : "",
    };
    const validation = validateDelegationDraft(draft);
    if (validation) {
      setFailure(validation);
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/admin/delegations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!response.ok) {
        const message = delegationMutationMessage(response.status, await errorCode(response));
        setFailure(message);
        toast.error({ title: "Delegation not added", description: message });
        return;
      }
      setSuccess("Delegation added. Existing assignments are unchanged.");
      toast.success({
        title: "Delegation added",
        description: "The substitute can review during the absence window. Existing assignments are unchanged.",
      });
      setDelegatorUserId("");
      setSubstituteUserId("");
      setValidFrom("");
      setValidUntil("");
      router.refresh();
    } catch {
      const message = "The delegation could not be saved. Check your connection and try again.";
      setFailure(message);
      toast.error({ title: "Delegation not added", description: message });
    } finally {
      setBusy(false);
    }
  }

  async function cancelDelegation() {
    if (!cancelling || cancelBusy) return;
    setFailure("");
    setSuccess("");
    setCancelBusy(true);
    try {
      const response = await fetch(
        `/api/admin/delegations/${encodeURIComponent(cancelling.id)}/cancel`,
        { method: "POST" },
      );
      if (!response.ok) {
        const message = delegationMutationMessage(response.status, await errorCode(response));
        setFailure(message);
        toast.error({ title: "Delegation not cancelled", description: message });
        if (response.status === 404) router.refresh();
        return;
      }
      setSuccess("Delegation cancelled.");
      toast.success({
        title: "Delegation cancelled",
        description: "Substitute review eligibility for this delegation has ended.",
      });
      setCancelling(null);
      router.refresh();
    } catch {
      const message = "The delegation could not be cancelled. Check your connection and try again.";
      setFailure(message);
      toast.error({ title: "Delegation not cancelled", description: message });
    } finally {
      setCancelBusy(false);
    }
  }

  return (
    <>
      <PageHeading
        eyebrow="ADMIN › GOVERNANCE"
        title="Delegation & absence management"
        description="Record an approver absence by delegating their review eligibility to a substitute for a fixed period. Both parties must be active approvers or administrators."
      />
      <Alert title="Server-enforced delegation" tone="info">
        Delegations are validated and audited on the server. A delegation grants
        substitute review eligibility for the absence window only; it does not
        reassign existing review assignments, bypass responsibility coverage, or
        permit self or circular delegation.
      </Alert>
      {failure && !cancelling && (
        <Alert title="Action not completed" tone="danger">{failure}</Alert>
      )}
      {success && (
        <div role="status">
          <Alert title="Update complete" tone="success">{success}</Alert>
        </div>
      )}
      <Card title="Record an absence delegation" className="responsibility-form-card">
        <form className="responsibility-form" onSubmit={create}>
          <div className="responsibility-form-grid">
            <Field id="delegation-delegator" label="Absent approver" required>
              <select
                id="delegation-delegator"
                value={delegatorUserId}
                onChange={(event) => setDelegatorUserId(event.target.value)}
                required
              >
                <option value="">Choose the absent approver</option>
                {approvers.map((approver) => (
                  <option
                    key={approver.id}
                    value={approver.id}
                    disabled={approver.id === substituteUserId}
                  >
                    {approver.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="delegation-substitute" label="Substitute approver" required>
              <select
                id="delegation-substitute"
                value={substituteUserId}
                onChange={(event) => setSubstituteUserId(event.target.value)}
                required
              >
                <option value="">Choose the substitute</option>
                {approvers.map((approver) => (
                  <option
                    key={approver.id}
                    value={approver.id}
                    disabled={approver.id === delegatorUserId}
                  >
                    {approver.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="delegation-from" label="Absence start" required>
              <input
                id="delegation-from"
                type="date"
                value={validFrom}
                onChange={(event) => setValidFrom(event.target.value)}
                required
              />
            </Field>
            <Field id="delegation-until" label="Absence end" required>
              <input
                id="delegation-until"
                type="date"
                value={validUntil}
                min={validFrom || undefined}
                onChange={(event) => setValidUntil(event.target.value)}
                required
              />
            </Field>
          </div>
          <div className="responsibility-actions">
            <Button type="submit" disabled={busy}>
              {busy ? "Adding…" : "Add delegation"}
            </Button>
          </div>
        </form>
      </Card>
      <Card title="Current and past delegations" className="responsibility-list-card">
        {!delegations.length ? (
          <Empty
            title="No delegations to show"
            description="Absence delegations added by administrators will appear here."
          />
        ) : (
          <div className="table-scroll" role="region" aria-label="Delegations table" tabIndex={0}>
            <table className="responsibility-table">
              <caption className="sr-only">Current and past approver delegations</caption>
              <thead>
                <tr>
                  <th scope="col">Absent approver</th>
                  <th scope="col">Substitute</th>
                  <th scope="col">Absence period</th>
                  <th scope="col">Status</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {delegations.map((delegation) => {
                  const status = delegationStatusLabel(delegation);
                  const cancellable = status === "Active" || status === "Scheduled";
                  return (
                    <tr key={delegation.id} data-delegation-id={delegation.id}>
                      <td><strong>{delegation.delegator.name}</strong></td>
                      <td>{delegation.substitute.name}</td>
                      <td className="date-cell">
                        {dateLabel(delegation.validFrom)} – {dateLabel(delegation.validUntil)}
                      </td>
                      <td>
                        <span className={`badge ${statusTone[status] ?? "tone-neutral"}`}>
                          {status}
                        </span>
                      </td>
                      <td>
                        {cancellable ? (
                          <button
                            className="button button-danger"
                            type="button"
                            aria-label={`Cancel delegation from ${delegation.delegator.name} to ${delegation.substitute.name}`}
                            onClick={() => setCancelling(delegation)}
                            disabled={busy || cancelBusy}
                          >
                            Cancel delegation
                          </button>
                        ) : (
                          <span className="small muted">No action available</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {delegations.length > 0 && (
          <TablePagination
            page={pagination.page}
            pageSize={pagination.pageSize}
            total={pagination.total}
            pageCount={pagination.pageCount}
            itemCount={delegations.length}
            label="Delegation pagination"
          />
        )}
      </Card>
      {cancelling && (
        <Confirm
          title="Cancel delegation?"
          label={cancelBusy ? "Cancelling…" : "Cancel delegation"}
          danger
          busy={cancelBusy}
          onClose={() => setCancelling(null)}
          onConfirm={() => void cancelDelegation()}
        >
          <p>
            {delegationCancelConfirmMessage(
              cancelling.delegator.name,
              cancelling.substitute.name,
            )}
          </p>
          {failure && <p className="field-error" role="alert">{failure}</p>}
        </Confirm>
      )}
    </>
  );
}
