"use client";

import Image from "next/image";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import {
  loginErrorPresentation,
  SIGN_IN_SERVICE_ERROR,
} from "@/lib/login-error";
import { Alert, Button, ErrorSummary, Field, Modal } from "./ui";

export function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [help, setHelp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serviceError, setServiceError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      next.email = "Enter a valid email address.";
    if (!password) next.password = "Enter your password.";
    setErrors(next);
    setServiceError("");
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      const result = await authClient.signIn.email({
        email,
        password,
        callbackURL: "/dashboard",
      });
      if (result.error) {
        const presentation = loginErrorPresentation(result.error.status);
        if (presentation.kind === "credentials")
          setErrors({ password: presentation.message });
        else setServiceError(presentation.message);
        return;
      }
      router.replace("/dashboard");
      router.refresh();
    } catch {
      setServiceError(SIGN_IN_SERVICE_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-blueprint" aria-hidden="true">
        <Image
          src="/assets/login-blueprint.png"
          alt=""
          fill
          priority
          sizes="100vw"
        />
      </div>
      <header className="login-header">
        <span className="wordmark">Permora</span>
        <span className="header-divider" />
        <span>Access made clear.</span>
      </header>
      <main className="login-main">
        <div className="login-card">
          <div className="login-visual">
            <Image
              src="/assets/login-library.png"
              alt=""
              fill
              priority
              sizes="(min-width: 1050px) 500px, (min-width: 701px) 50vw, 1px"
            />
            <div className="photo-shade" />
            <div className="login-story">
              <h2>Permora</h2>
              <p>
                One place to request resources, track approval decisions, and
                review your access history.
              </p>
            </div>
          </div>
          <div className="login-form-panel">
            <div className="login-intro">
              <span className="eyebrow">WELCOME TO PERMORA</span>
              <h1>Welcome back!</h1>
              <p>
                Sign in with the account issued by your Permora administrator.
              </p>
            </div>
            {serviceError && (
              <Alert title="Sign-in unavailable" tone="danger">
                {serviceError}
              </Alert>
            )}
            <form noValidate onSubmit={submit}>
              <ErrorSummary errors={errors} />
              <Field id="email" label="Email address" error={errors.email}>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  aria-invalid={Boolean(errors.email)}
                  aria-describedby={errors.email ? "email-error" : undefined}
                />
              </Field>
              <Field id="password" label="Password" error={errors.password}>
                <div className="password-wrap">
                  <input
                    id="password"
                    name="password"
                    type={show ? "text" : "password"}
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    aria-invalid={Boolean(errors.password)}
                    aria-describedby={
                      errors.password ? "password-error" : undefined
                    }
                  />
                  <button
                    type="button"
                    onClick={() => setShow(!show)}
                    aria-label={show ? "Hide password" : "Show password"}
                  >
                    {show ? "Hide" : "Show"}
                  </button>
                </div>
              </Field>
              <p className="demo-credential">
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setHelp(true)}
                >
                  Need help signing in?
                </button>
              </p>
              <Button type="submit" className="login-submit" disabled={busy}>
                {busy ? "Signing in…" : "Sign in"}
                <span aria-hidden="true">→</span>
              </Button>
            </form>
            <p className="login-disclaimer">
              Accounts are provisioned by an authorized administrator. Public
              registration and password recovery are unavailable in Stage 2A.
            </p>
          </div>
        </div>
        <p className="login-bottom">
          For students, faculty, reviewers, and the teams that support them.
        </p>
      </main>
      <footer className="login-footer">
        <span>© 2026 Permora</span>
        <button className="text-button" onClick={() => setHelp(true)}>
          Account help & privacy
        </button>
      </footer>
      {help && (
        <Modal title="Account help" onClose={() => setHelp(false)}>
          <div className="modal-body prose">
            <p>
              There is no public registration or automated password recovery in
              Stage 2A.
            </p>
            <p>
              Ask an authorized Permora administrator to provision an account or
              help restore access. Permora will not report whether an email
              address exists.
            </p>
          </div>
          <div className="modal-actions">
            <Button onClick={() => setHelp(false)}>Close</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
