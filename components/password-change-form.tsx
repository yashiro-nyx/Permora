"use client";

import { useId, useMemo, useState, type FormEvent } from "react";
import {
  allRequirementsMet,
  estimatePasswordStrength,
  evaluatePasswordRequirements,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  type PasswordStrengthLevel,
} from "@/lib/password-strength";
import { Alert, Button, Card, Field, Icon, PageHeading } from "./ui";
import { useToast } from "./toast";

function responseMessage(body: unknown) {
  if (!body || typeof body !== "object") return "The password could not be changed.";
  const error = (body as { error?: { message?: unknown } }).error;
  return typeof error?.message === "string" ? error.message : "The password could not be changed.";
}

const STRENGTH_TONE: Record<PasswordStrengthLevel, string> = {
  weak: "tone-danger",
  fair: "tone-warning",
  good: "tone-info",
  strong: "tone-success",
};

function StrengthMeter({ password }: { password: string }) {
  const descriptionId = useId();
  const result = useMemo(() => estimatePasswordStrength(password), [password]);
  if (!password) return null;
  return (
    <div className="password-strength" aria-live="polite">
      <div className="password-strength-head">
        <span className="password-strength-label">
          <Icon name="shield" size={16} />
          Password strength: <strong>{result.label}</strong>
        </span>
        <span className="sr-only" id={descriptionId}>
          Estimated strength {result.label}. This indicator is guidance only and
          does not guarantee your password is secure.
        </span>
      </div>
      <div
        className="password-strength-meter"
        role="meter"
        aria-valuemin={1}
        aria-valuemax={4}
        aria-valuenow={result.filledSegments}
        aria-valuetext={result.label}
        aria-describedby={descriptionId}
      >
        {[1, 2, 3, 4].map((segment) => (
          <span
            key={segment}
            className={`password-strength-segment ${
              segment <= result.filledSegments ? STRENGTH_TONE[result.level] : "is-empty"
            }`}
          />
        ))}
      </div>
      {result.suggestions.length > 0 && (
        <ul className="password-strength-tips">
          {result.suggestions.map((tip) => (
            <li key={tip}>{tip}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function PasswordChangeForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [warning, setWarning] = useState(false);
  const toast = useToast();

  const requirements = useMemo(
    () => evaluatePasswordRequirements({ currentPassword, newPassword, confirmation }),
    [currentPassword, newPassword, confirmation],
  );
  const mandatoryMet = allRequirementsMet(requirements) && currentPassword.length > 0;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setWarning(false);
    // Mirror the server contract; the submit button is already disabled until
    // these hold, but re-check defensively.
    if (!currentPassword) {
      setError("Enter your current password.");
      return;
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH || newPassword.length > MAX_PASSWORD_LENGTH) {
      setError(`Choose a password between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (currentPassword === newPassword) {
      setError("Choose a password different from your current password.");
      return;
    }
    if (newPassword !== confirmation) {
      setError("The new passwords do not match.");
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
      setShowCurrent(false);
      setShowNew(false);
      const warningText = (body as { warning?: unknown }).warning;
      if (typeof warningText === "string") {
        setWarning(true);
        setNotice(warningText);
        toast.warning({ title: "Password changed", description: warningText });
      } else {
        setNotice("Password changed. Other active sessions were signed out.");
        toast.success({ title: "Password changed", description: "Other active sessions were signed out." });
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "The password could not be changed.";
      setError(message);
      toast.error({ title: "Password not changed", description: message });
    } finally {
      setBusy(false);
    }
  }

  const confirmError =
    confirmation.length > 0 && newPassword !== confirmation
      ? "The confirmation does not match the new password."
      : undefined;
  const sameError =
    newPassword.length > 0 && newPassword === currentPassword
      ? "Choose a password different from your current one."
      : undefined;

  return (
    <>
      <PageHeading
        eyebrow="ACCOUNT / SECURITY"
        title="Change password"
        description="Confirm your current password and choose a new one. Other active sessions will be revoked."
      />
      {error && <Alert title="Password not changed" tone="danger">{error}</Alert>}
      {notice && (
        <div role="status">
          <Alert
            title={warning ? "Password changed; audit needs attention" : "Password changed"}
            tone={warning ? "warning" : "success"}
          >
            {notice}
          </Alert>
        </div>
      )}
      <Card className="password-change-card">
        <form className="password-change-form form-stack" onSubmit={submit} noValidate>
          <Field id="current-password" label="Current password" required>
            <div className="password-input">
              <input
                id="current-password"
                type={showCurrent ? "text" : "password"}
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                autoComplete="current-password"
                required
                disabled={busy}
              />
              <button
                type="button"
                className="password-reveal"
                aria-pressed={showCurrent}
                onClick={() => setShowCurrent((value) => !value)}
                disabled={busy}
              >
                {showCurrent ? "Hide" : "Show"}
              </button>
            </div>
          </Field>

          <Field
            id="new-password"
            label="New password"
            hint="Use 12–128 characters. A long, unique passphrase is best."
            error={sameError}
            required
          >
            <div className="password-input">
              <input
                id="new-password"
                type={showNew ? "text" : "password"}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                minLength={MIN_PASSWORD_LENGTH}
                maxLength={MAX_PASSWORD_LENGTH}
                autoComplete="new-password"
                aria-describedby="password-requirements"
                required
                disabled={busy}
              />
              <button
                type="button"
                className="password-reveal"
                aria-pressed={showNew}
                aria-label={showNew ? "Hide new and confirmation passwords" : "Show new and confirmation passwords"}
                onClick={() => setShowNew((value) => !value)}
                disabled={busy}
              >
                {showNew ? "Hide" : "Show"}
              </button>
            </div>
          </Field>

          <StrengthMeter password={newPassword} />

          <Field
            id="confirm-password"
            label="Confirm new password"
            error={confirmError}
            required
          >
            <input
              id="confirm-password"
              type={showNew ? "text" : "password"}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              minLength={MIN_PASSWORD_LENGTH}
              maxLength={MAX_PASSWORD_LENGTH}
              autoComplete="new-password"
              required
              disabled={busy}
            />
          </Field>

          <div className="password-requirements" id="password-requirements">
            <p className="eyebrow">Password requirements</p>
            <ul>
              {requirements.map((requirement) => (
                <li
                  key={requirement.id}
                  className={requirement.met ? "requirement-met" : "requirement-unmet"}
                >
                  <span className="requirement-icon" aria-hidden="true">
                    {requirement.met ? <Icon name="check" size={14} /> : "○"}
                  </span>
                  <span>{requirement.label}</span>
                  <span className="sr-only">{requirement.met ? " — met" : " — not met"}</span>
                </li>
              ))}
            </ul>
            <p className="small muted">
              The strength indicator is guidance only and does not guarantee security.
            </p>
          </div>

          <Button type="submit" disabled={busy || !mandatoryMet}>
            {busy ? "Changing password…" : "Change password"}
          </Button>
        </form>
      </Card>
    </>
  );
}
