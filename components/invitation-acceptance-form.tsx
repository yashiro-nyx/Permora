"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { Alert, Button, Field } from "./ui";

const INVALID_INVITATION =
  "This invitation is invalid or expired. Ask an administrator to issue a new one.";

function responseMessage(body: unknown) {
  if (!body || typeof body !== "object") return INVALID_INVITATION;
  const error = (body as { error?: { message?: unknown } }).error;
  return typeof error?.message === "string" ? error.message : INVALID_INVITATION;
}

export function InvitationAcceptanceForm() {
  const [token, setToken] = useState("");
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    const fragment = window.location.hash.slice(1);
    window.history.replaceState(null, "", window.location.pathname);
    setToken(fragment);
    setReady(true);
    if (!/^[A-Za-z0-9_-]{43}$/.test(fragment)) setError(INVALID_INVITATION);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!token) {
      setError(INVALID_INVITATION);
      return;
    }
    if (password.length < 12 || password.length > 128) {
      setError("Choose a password between 12 and 128 characters.");
      return;
    }
    if (password !== confirmation) {
      setError("The passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/invitations/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(responseMessage(body));
      setPassword("");
      setConfirmation("");
      setToken("");
      setAccepted(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : INVALID_INVITATION);
    } finally {
      setBusy(false);
    }
  }

  if (!ready) return <p role="status">Loading invitation…</p>;
  if (accepted)
    return (
      <div className="invitation-result" role="status">
        <Alert title="Password set" tone="success">
          You can now sign in with your email address and new password.
        </Alert>
        <Link className="button button-primary" href="/login">Go to sign in</Link>
      </div>
    );

  return (
    <form className="invitation-acceptance-form" onSubmit={submit}>
      {error && <Alert title="Invitation not accepted" tone="danger">{error}</Alert>}
      <Field id="invite-password" label="New password" hint="Use 12–128 characters." required>
        <input
          id="invite-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          minLength={12}
          maxLength={128}
          autoComplete="new-password"
          required
          disabled={!token || busy}
        />
      </Field>
      <Field id="invite-password-confirm" label="Confirm new password" required>
        <input
          id="invite-password-confirm"
          type="password"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          minLength={12}
          maxLength={128}
          autoComplete="new-password"
          required
          disabled={!token || busy}
        />
      </Field>
      <Button type="submit" disabled={!token || busy}>
        {busy ? "Setting password…" : "Set password"}
      </Button>
    </form>
  );
}
