"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { activationStatusSummary } from "@/lib/activation-presentation";
import type { AdministratorActivationItem } from "@/lib/server/activation-read-service";
import { dateLabel } from "@/lib/model";
import { Alert, Badge, Card, Empty, Field, PageHeading } from "./ui";

function ActivationControls({ item }: { item: AdministratorActivationItem }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [externalReference, setExternalReference] = useState("");
  const [evidence, setEvidence] = useState("");
  const [message, setMessage] = useState("");
  const [failure, setFailure] = useState("");
  if (!item.activationStatus || (item.activationStatus === "failed" && item.retryable)) {
    async function submit(event: FormEvent<HTMLFormElement>) {
      event.preventDefault();
      setFailure("");
      setMessage("");
      if (!confirmed) {
        setFailure("Confirm that provisioning completed in the target system.");
        return;
      }
      if (!externalReference.trim() && !evidence.trim()) {
        setFailure("Enter an external reference or human-readable evidence.");
        return;
      }
      setBusy(true);
      try {
        const response = await fetch(
          `/api/admin/activations/${encodeURIComponent(item.requestId)}/activate`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "idempotency-key": crypto.randomUUID(),
            },
            body: JSON.stringify({
              operatorConfirmation: {
                provisioned: true,
                externalReference: externalReference.trim() || null,
                evidence: evidence.trim() || null,
              },
            }),
          },
        );
        const result = (await response.json()) as {
          status?: string;
          error?: { message?: string };
        };
        if (!response.ok)
          throw new Error(result.error?.message ?? "Activation could not be started.");
        setMessage(
          result.status === "activated"
            ? "Access activation recorded."
            : "Activation attempt recorded.",
        );
        router.refresh();
      } catch (error) {
        setFailure(
          error instanceof Error
            ? error.message
            : "Activation could not be started. Try again.",
        );
      } finally {
        setBusy(false);
      }
    }

    return (
      <details className="activation-controls">
        <summary>{item.activationStatus ? "Retry activation" : "Start activation"}</summary>
        <form className="form-stack" onSubmit={submit}>
          <p className="small muted">
            Confirm that access was provisioned outside Permora. This action records your confirmation; it does not contact the university system.
          </p>
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            <span>I confirm the requested access was provisioned.</span>
          </label>
          <Field id={`reference-${item.requestId}`} label="External reference">
            <input
              id={`reference-${item.requestId}`}
              value={externalReference}
              onChange={(event) => setExternalReference(event.target.value)}
              maxLength={500}
              autoComplete="off"
              placeholder="Ticket or system reference"
            />
          </Field>
          <Field
            id={`evidence-${item.requestId}`}
            label="Provisioning evidence"
            hint="Provide this when there is no external reference."
          >
            <textarea
              id={`evidence-${item.requestId}`}
              value={evidence}
              onChange={(event) => setEvidence(event.target.value)}
              maxLength={2000}
              rows={3}
              placeholder="Briefly describe the confirmation"
            />
          </Field>
          {failure && <p className="field-error" role="alert">{failure}</p>}
          {message && <p className="small" role="status">{message}</p>}
          <button className="button button-primary" type="submit" disabled={busy}>
            {busy ? "Recording…" : "Record activation"}
          </button>
        </form>
      </details>
    );
  }
  return <span className="small muted">No further activation action</span>;
}

export function AdminActivationQueue({
  items,
}: {
  items: AdministratorActivationItem[];
}) {
  return (
    <>
      <PageHeading
        eyebrow="ADMIN › LIFECYCLE"
        title="Activations"
        description="Review approved requests and record confirmed provisioning outcomes. Approval remains separate from active access."
      />
      <Alert title="Manual provisioning" tone="warning">
        Permora does not connect to university systems yet. Record success only after verifying access in the target system.
      </Alert>
      <Card className="staff-queue-card">
        {!items.length ? (
          <Empty
            title="No approved requests awaiting activation"
            description="Approved requests will appear here with their current lifecycle state."
          />
        ) : (
          <div className="table-scroll" role="region" aria-label="Activation lifecycle table" tabIndex={0}>
            <table className="staff-review-table">
              <caption className="sr-only">Approved request activation lifecycle</caption>
              <thead>
                <tr>
                  <th scope="col">Requester / request</th>
                  <th scope="col">Resource / permission</th>
                  <th scope="col">Validity</th>
                  <th scope="col">Lifecycle status</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const summary = activationStatusSummary(
                    item.approvalStatus,
                    item.activationStatus,
                    item.retryable,
                  );
                  return (
                    <tr key={item.requestId}>
                      <td>
                        <strong>{item.requesterName}</strong>
                        <small className="table-secondary">{item.displayId}</small>
                      </td>
                      <td>
                        <strong>{item.resourceName}</strong>
                        <small className="table-secondary">{item.permissionLabel}</small>
                      </td>
                      <td className="date-cell">
                        {dateLabel(item.startsAt)}–{dateLabel(item.expiresAt)}
                      </td>
                      <td>
                        <Badge label={summary.label} tone={summary.tone} />
                        <small className="table-secondary">{summary.description}</small>
                      </td>
                      <td>
                        {summary.canStart ? (
                          <ActivationControls item={item} />
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
      </Card>
    </>
  );
}
