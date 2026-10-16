"use client";

import { useState } from "react";
import type { RetentionPolicyDto } from "@/lib/server/admin-governance-types";
import {
  describePreview,
  formatRetentionPeriod,
  retentionRequestMessage,
  retentionStatus,
  retentionStatusLabel,
  retentionStatusTone,
  supportsRetentionPreview,
} from "@/lib/retention-ui";
import { Alert, Card, Empty, PageHeading } from "./ui";

type PreviewState = ReturnType<typeof describePreview> & { recordClass: string };

async function errorCode(response: Response) {
  try {
    const body = (await response.json()) as { error?: { code?: unknown } };
    return typeof body.error?.code === "string" ? body.error.code : undefined;
  } catch {
    return undefined;
  }
}

export function AdminRetention({ policies }: { policies: RetentionPolicyDto[] }) {
  const [previews, setPreviews] = useState<Record<string, PreviewState>>({});
  const [busyClass, setBusyClass] = useState("");
  const [failure, setFailure] = useState("");

  async function preview(recordClass: string) {
    if (busyClass) return;
    setBusyClass(recordClass);
    setFailure("");
    try {
      // Always a non-destructive dry run: apply is never requested.
      const response = await fetch("/api/admin/retention", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recordClass, apply: false }),
      });
      if (!response.ok) {
        setFailure(retentionRequestMessage(response.status, await errorCode(response)));
        return;
      }
      const body = (await response.json()) as {
        result: Parameters<typeof describePreview>[0];
      };
      setPreviews((current) => ({
        ...current,
        [recordClass]: { ...describePreview(body.result), recordClass },
      }));
    } catch {
      setFailure("The preview could not run. Check your connection and try again.");
    } finally {
      setBusyClass("");
    }
  }

  return (
    <>
      <PageHeading
        eyebrow="ADMIN › GOVERNANCE"
        title="Retention management"
        description="Review provisional record-retention policy and run non-destructive retention previews. Archival execution is disabled until institutional policy is approved."
      />
      <Alert title="Preview only — no data is changed" tone="info">
        Retention previews are read-only dry runs that report how many records
        would match a provisional window. They never delete or archive data.
        Immutable accountability records cannot be archived at all.
      </Alert>
      {failure && <Alert title="Action not completed" tone="danger">{failure}</Alert>}
      {!policies.length ? (
        <Card title="Retention policies">
          <Empty
            title="No retention policies"
            description="Retention classes are seeded by guarded migrations."
          />
        </Card>
      ) : (
        <Card title="Retention policies" className="responsibility-list-card">
          <div className="table-scroll" role="region" aria-label="Retention policies" tabIndex={0}>
            <table className="responsibility-table">
              <caption className="sr-only">Provisional retention policy settings</caption>
              <thead>
                <tr>
                  <th scope="col">Record class</th>
                  <th scope="col">Retention period</th>
                  <th scope="col">Status</th>
                  <th scope="col">Dry-run preview</th>
                </tr>
              </thead>
              <tbody>
                {policies.map((policy) => {
                  const status = retentionStatus(policy);
                  const canPreview = supportsRetentionPreview(policy);
                  const result = previews[policy.recordClass];
                  return (
                    <tr key={policy.recordClass} data-record-class={policy.recordClass}>
                      <td>
                        <strong>{policy.label}</strong>
                        <small className="table-secondary"><code>{policy.recordClass}</code></small>
                        {policy.provisional && (
                          <small className="table-secondary">Provisional policy</small>
                        )}
                      </td>
                      <td>{formatRetentionPeriod(policy.retentionDays)}</td>
                      <td>
                        <span className={`badge ${retentionStatusTone(status)}`}>
                          {retentionStatusLabel(status)}
                        </span>
                      </td>
                      <td>
                        {canPreview ? (
                          <button
                            className="button button-outline"
                            type="button"
                            aria-label={`Run a retention preview for ${policy.label}`}
                            disabled={busyClass === policy.recordClass}
                            onClick={() => void preview(policy.recordClass)}
                          >
                            {busyClass === policy.recordClass ? "Previewing…" : "Run preview"}
                          </button>
                        ) : (
                          <span className="small muted">
                            {status === "immutable" ? "Not archivable" : "No period configured"}
                          </span>
                        )}
                        {result && (
                          <div
                            className={`retention-preview alert tone-${result.tone}`}
                            role="status"
                          >
                            <strong>{result.headline}</strong>
                            <p className="small">{result.detail}</p>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <Alert title="Governance boundary" tone="info">
        These settings are provisional until institutional retention policy,
        legal-hold rules, and archival ownership are approved. No destructive
        archival or retention-period editing is available in this interface.
      </Alert>
    </>
  );
}
