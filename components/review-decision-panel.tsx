"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ApprovalDecision } from "@/lib/approval-domain";
import {
  decisionFailureMessage,
  validateDecisionReason,
} from "@/lib/review-ui";
import { Alert, Button, Confirm, Field, Icon } from "./ui";

type Attempt = { decision: ApprovalDecision; idempotencyKey: string };

const labels: Record<ApprovalDecision, string> = {
  approve: "Approve request",
  deny: "Deny access",
  return_for_revision: "Return for revision",
};

export function ReviewDecisionPanel({
  requestId,
  displayId,
  expectedVersion,
}: {
  requestId: string;
  displayId: string;
  expectedVersion: number;
}) {
  const router = useRouter();
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState("");
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{
    tone: "success" | "danger" | "warning";
    title: string;
    text: string;
  } | null>(null);

  function begin(decision: ApprovalDecision) {
    const error = validateDecisionReason(decision, reason);
    setReasonError(error);
    setMessage(null);
    if (error) {
      reasonRef.current?.focus();
      return;
    }
    setAttempt({ decision, idempotencyKey: crypto.randomUUID() });
  }

  async function submit() {
    if (!attempt || submitting) return;
    setSubmitting(true);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/review/requests/${encodeURIComponent(requestId)}/decision`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "Idempotency-Key": attempt.idempotencyKey,
          },
          body: JSON.stringify({
            expectedVersion,
            decision: attempt.decision,
            reason: reason.trim() || undefined,
          }),
        },
      );
      const payload = (await response.json().catch(() => null)) as
        | { error?: { code?: string } }
        | null;
      if (!response.ok) {
        const stale = response.status === 409;
        setMessage({
          tone: stale ? "warning" : "danger",
          title: stale ? "Request refreshed" : "Decision not saved",
          text: decisionFailureMessage(response.status, payload?.error?.code),
        });
        if (response.status === 401) router.replace("/login");
        if (stale || response.status === 404) {
          setAttempt(null);
          router.refresh();
        }
        return;
      }
      setAttempt(null);
      setMessage({
        tone: "success",
        title: "Decision recorded",
        text:
          attempt.decision === "approve"
            ? "The request is approved and awaiting activation. No access has been activated."
            : "The requester-visible decision and audit event were recorded.",
      });
      router.refresh();
    } catch {
      setMessage({
        tone: "danger",
        title: "Decision not saved",
        text: decisionFailureMessage(503),
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="card decision-panel" aria-labelledby="decision-title">
      <div className="card-heading">
        <h2 id="decision-title">
          <Icon name="review" /> Review decision
        </h2>
      </div>
      <div className="card-body form-stack">
        {message && (
          <Alert title={message.title} tone={message.tone}>
            {message.text}
          </Alert>
        )}
        <Field
          id="decision-reason"
          label="Decision reason"
          hint="Required for denial and return for revision. Visible to the requester and retained in audit history."
          error={reasonError}
        >
          <textarea
            ref={reasonRef}
            id="decision-reason"
            value={reason}
            maxLength={2000}
            aria-invalid={Boolean(reasonError)}
            aria-describedby={`decision-reason-hint${reasonError ? " decision-reason-error" : ""}`}
            onChange={(event) => {
              setReason(event.target.value);
              if (reasonError) setReasonError("");
            }}
            placeholder="Explain the decision when context will help the requester."
          />
        </Field>
        <p className="reason-counter" aria-live="polite">
          {reason.length.toLocaleString()} / 2,000 characters
        </p>
        <div className="decision-actions">
          <Button
            variant="approve"
            disabled={submitting}
            onClick={() => begin("approve")}
          >
            <Icon name="check" /> Approve
          </Button>
          <Button
            variant="danger"
            disabled={submitting}
            onClick={() => begin("deny")}
          >
            Deny
          </Button>
          <Button
            variant="outline"
            disabled={submitting}
            onClick={() => begin("return_for_revision")}
          >
            Return for revision
          </Button>
        </div>
        <p className="small muted">
          Approval records a decision only. Access remains inactive until a
          separate activation process succeeds.
        </p>
      </div>
      {attempt && (
        <Confirm
          title={labels[attempt.decision]}
          label={submitting ? "Saving…" : "Confirm decision"}
          danger={attempt.decision === "deny"}
          busy={submitting}
          onClose={() => {
            if (!submitting) setAttempt(null);
          }}
          onConfirm={submit}
        >
          <div className="confirmation-copy">
            <p>
              Confirm this decision for <strong>{displayId}</strong>.
            </p>
            {attempt.decision === "approve" && (
              <p>
                Approval moves the request to awaiting activation. It does not
                grant or activate access.
              </p>
            )}
            {attempt.decision !== "approve" && (
              <p>
                Reason: <strong>{reason.trim()}</strong>
              </p>
            )}
            {message && <p className="field-error">{message.text}</p>}
          </div>
        </Confirm>
      )}
      <div className="sr-only" role="status" aria-live="polite">
        {submitting ? "Saving decision" : message?.text}
      </div>
    </section>
  );
}
