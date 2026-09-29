"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AccountUserDto } from "@/lib/server/account-types";
import { Alert, Button, Card, Confirm } from "./ui";

function message(body: unknown, fallback: string) {
  if (!body || typeof body !== "object") return fallback;
  const error = (body as { error?: { message?: unknown } }).error;
  return typeof error?.message === "string" ? error.message : fallback;
}

function expirationLabel(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function InvitationControls({ user }: { user: AccountUserDto }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [oneTimeLink, setOneTimeLink] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function issue() {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    setOneTimeLink("");
    try {
      const response = await fetch(`/api/admin/users/${user.id}/invitations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(message(body, "The invitation could not be issued."));
      const rawToken = (body as { rawToken?: unknown }).rawToken;
      if (typeof rawToken !== "string")
        throw new Error("The invitation was created, but its one-time link is unavailable. Revoke it and issue a new invitation.");
      setOneTimeLink(`${window.location.origin}/accept-invitation#${rawToken}`);
      setNotice("Copy or open this link now. It will not be shown again.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The invitation could not be issued.");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!user.invitation || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        `/api/admin/users/${user.id}/invitations/${user.invitation.id}/revoke`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        },
      );
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(message(body, "The invitation could not be revoked."));
      setConfirmRevoke(false);
      setOneTimeLink("");
      setNotice("Invitation revoked.");
      router.refresh();
    } catch (caught) {
      setConfirmRevoke(false);
      setError(caught instanceof Error ? caught.message : "The invitation could not be revoked.");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (user.hasCredential) return null;

  return (
    <Card title="Password setup" className="invitation-controls">
      {error && <Alert title="Invitation action not completed" tone="danger">{error}</Alert>}
      {notice && <Alert title="Invitation status" tone="success">{notice}</Alert>}
      {!user.active ? (
        <p className="field-hint">Reactivate the account before issuing an invitation.</p>
      ) : user.invitation ? (
        <div className="invitation-pending">
          <div>
            <strong>Invitation outstanding</strong>
            <p className="field-hint">Expires {expirationLabel(user.invitation.expiresAt)}. Its link cannot be retrieved again.</p>
          </div>
          <Button variant="danger" onClick={() => setConfirmRevoke(true)} disabled={busy}>
            Revoke invitation
          </Button>
        </div>
      ) : (
        <div className="invitation-issue">
          <p className="field-hint">The invitee will choose a password through the one-time link.</p>
          <Button onClick={issue} disabled={busy}>{busy ? "Issuing…" : "Issue invitation"}</Button>
        </div>
      )}
      {oneTimeLink && (
        <div className="invitation-once" role="status" aria-live="polite">
          <strong>One-time invitation link</strong>
          <p>{oneTimeLink}</p>
          <a className="button button-outline" href={oneTimeLink} target="_blank" rel="noreferrer">
            Open invitation
          </a>
        </div>
      )}
      {confirmRevoke && (
        <Confirm
          title="Revoke this invitation?"
          onClose={() => !busy && setConfirmRevoke(false)}
          onConfirm={revoke}
          label={busy ? "Revoking…" : "Revoke invitation"}
          danger
          busy={busy}
        >
          <p>The outstanding link will stop working. A replacement can be issued afterward.</p>
        </Confirm>
      )}
    </Card>
  );
}
