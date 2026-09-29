"use client";

import { useState, type FormEvent } from "react";
import { Alert, Button, Card, Field, PageHeading } from "./ui";

function responseMessage(body: unknown) {
  if (!body || typeof body !== "object") return "The password could not be changed.";
  const error = (body as { error?: { message?: unknown } }).error;
  return typeof error?.message === "string" ? error.message : "The password could not be changed.";
}

export function PasswordChangeForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [warning, setWarning] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setWarning(false);
    if (newPassword.length < 12 || newPassword.length > 128) {
      setError("Choose a password between 12 and 128 characters.");
      return;
    }
    if (newPassword !== confirmation) {
      setError("The new passwords do not match.");
      return;
    }
    if (currentPassword === newPassword) {
      setError("Choose a password different from your current password.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/account/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(responseMessage(body));
      setCurrentPassword("");
      setNewPassword("");
      setConfirmation("");
      const warningText = (body as { warning?: unknown }).warning;
      if (typeof warningText === "string") {
        setWarning(true);
        setNotice(warningText);
      } else {
        setNotice("Password changed. Other active sessions were signed out.");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The password could not be changed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeading
        eyebrow="ACCOUNT / SECURITY"
        title="Change password"
        description="Confirm your current password and choose a new one. Other active sessions will be revoked."
      />
      {error && <Alert title="Password not changed" tone="danger">{error}</Alert>}
      {notice && <Alert title={warning ? "Password changed; audit needs attention" : "Password changed"} tone={warning ? "warning" : "success"}>{notice}</Alert>}
      <Card className="password-change-card">
        <form className="password-change-form form-stack" onSubmit={submit}>
          <Field id="current-password" label="Current password" required>
            <input
              id="current-password"
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              autoComplete="current-password"
              required
              disabled={busy}
            />
          </Field>
          <Field id="new-password" label="New password" hint="Use 12–128 characters." required>
            <input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
              required
              disabled={busy}
            />
          </Field>
          <Field id="confirm-password" label="Confirm new password" required>
            <input
              id="confirm-password"
              type="password"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
              required
              disabled={busy}
            />
          </Field>
          <Button type="submit" disabled={busy}>
            {busy ? "Changing password…" : "Change password"}
          </Button>
        </form>
      </Card>
    </>
  );
}
