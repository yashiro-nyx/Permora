"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { EligibleApproverDto } from "@/lib/server/admin-governance-types";
import type { UnassignedRequestDto } from "@/lib/server/approval-read-types";

type ApiBody = {
  items?: EligibleApproverDto[];
  error?: { code?: unknown };
  result?: { approverUserId?: string };
};

function safeFailure(status: number, code?: string) {
  if (status === 401 || status === 403) return "Administrator access is required. Sign in again.";
  if (status === 404) return "This request is no longer pending routing. The queue has been refreshed.";
  if (status === 409 || code === "conflict") return "This request was already assigned or changed. The queue has been refreshed; review the current row before taking another action.";
  if (status === 400 || code === "invalid_input") return "The assignment details are no longer valid. Refresh the eligible assignees before trying again.";
  return "Eligible assignees could not be loaded or assigned. Try again later.";
}

async function readBody(response: Response): Promise<ApiBody> {
  try {
    return (await response.json()) as ApiBody;
  } catch {
    return {};
  }
}

export function AdminUnassignedAssignment({
  request,
}: {
  request: UnassignedRequestDto;
}) {
  const router = useRouter();
  const details = useRef<HTMLDetailsElement>(null);
  const currentVersion = useRef(request.version);
  const [items, setItems] = useState<EligibleApproverDto[]>([]);
  const [selectedResponsibility, setSelectedResponsibility] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [refreshRequired, setRefreshRequired] = useState(false);
  const [failure, setFailure] = useState("");
  const [outcome, setOutcome] = useState("");

  useEffect(() => {
    if (currentVersion.current === request.version) return;
    currentVersion.current = request.version;
    setItems([]);
    setSelectedResponsibility("");
    setLoaded(false);
    setRefreshRequired(true);
  }, [request.version]);

  async function loadEligible() {
    if (loading || submitting) return;
    setLoading(true);
    setFailure("");
    setOutcome("");
    try {
      const response = await fetch(
        `/api/admin/unassigned-requests/${encodeURIComponent(request.requestId)}/assign`,
        { cache: "no-store" },
      );
      const body = await readBody(response);
      if (!response.ok) {
        setFailure(safeFailure(response.status, typeof body.error?.code === "string" ? body.error.code : undefined));
        setLoaded(false);
        return;
      }
      setItems(Array.isArray(body.items) ? body.items : []);
      setSelectedResponsibility("");
      setLoaded(true);
      setRefreshRequired(false);
    } catch {
      setFailure("Eligible assignees could not be loaded. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  async function assign() {
    if (!selectedResponsibility || submitting || !loaded || refreshRequired) return;
    setSubmitting(true);
    setFailure("");
    setOutcome("");
    try {
      const response = await fetch(
        `/api/admin/unassigned-requests/${encodeURIComponent(request.requestId)}/assign`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            responsibilityId: selectedResponsibility,
            expectedVersion: request.version,
          }),
        },
      );
      const body = await readBody(response);
      if (!response.ok) {
        setFailure(safeFailure(response.status, typeof body.error?.code === "string" ? body.error.code : undefined));
        if (response.status === 409 || response.status === 404) {
          setItems([]);
          setSelectedResponsibility("");
          setLoaded(false);
          setRefreshRequired(true);
          router.refresh();
        }
        return;
      }
      const assignee = items.find((item) => item.responsibilityId === selectedResponsibility);
      setOutcome(`Assigned to ${assignee?.approverName ?? "the selected approver"}.`);
      setItems([]);
      setSelectedResponsibility("");
      setLoaded(false);
      router.refresh();
    } catch {
      setFailure("The request could not be assigned. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="admin-assignment-control">
      <p className="small muted">
        This request cannot be decided until it is assigned to an eligible
        approver.
      </p>
      <details
        ref={details}
        onToggle={(event) => {
          if (event.currentTarget.open && !loaded && !loading && !refreshRequired)
            void loadEligible();
        }}
      >
        <summary>Show eligible assignees</summary>
        <div className="admin-assignment-panel">
          {loading && <p className="small muted" role="status">Loading eligible assignees…</p>}
          {!loading && loaded && (
            items.length ? (
              <>
                <label className="small" htmlFor={`assignee-${request.requestId}`}>Eligible assignee</label>
                <select
                  id={`assignee-${request.requestId}`}
                  value={selectedResponsibility}
                  onChange={(event) => setSelectedResponsibility(event.target.value)}
                  disabled={submitting || refreshRequired}
                >
                  <option value="">Choose an eligible assignee</option>
                  {items.map((item) => (
                    <option key={item.responsibilityId} value={item.responsibilityId}>
                      {item.approverName}{item.viaDelegation && item.delegatorName ? ` (delegated by ${item.delegatorName})` : ""}
                    </option>
                  ))}
                </select>
                <button className="button button-primary" type="button" onClick={() => void assign()} disabled={!selectedResponsibility || submitting || refreshRequired}>
                  {submitting ? "Assigning…" : "Assign request"}
                </button>
              </>
            ) : <p className="small muted">No eligible assignees are currently available.</p>
          )}
          {refreshRequired && (
            <button className="button button-outline" type="button" onClick={() => void loadEligible()} disabled={loading || submitting}>
              {loading ? "Refreshing…" : "Refresh eligible assignees"}
            </button>
          )}
          {failure && <p className="admin-assignment-feedback" data-tone="danger" role="alert">{failure}</p>}
          {outcome && <p className="admin-assignment-feedback" data-tone="success" role="status">{outcome}</p>}
        </div>
      </details>
    </div>
  );
}