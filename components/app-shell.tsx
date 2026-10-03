"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import type { TrustedIdentity } from "@/lib/auth-types";
import { Alert, Button, Icon, Modal } from "./ui";
import { initials, roleLabels } from "@/lib/model";
import {
  navigationForIdentity,
  primaryRole,
  requesterNavigation,
} from "@/lib/navigation";

export function AppShell({
  children,
  identity,
  canReview,
}: {
  children: ReactNode;
  identity: TrustedIdentity;
  canReview: boolean;
}) {
  const path = usePathname();
  const router = useRouter();
  const [drawer, setDrawer] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  const role = primaryRole(identity);
  const requester = role !== "admin" && role !== "approver";
  const focused = path === "/requests/new";
  const navigation = navigationForIdentity(identity, canReview);
  const active = (href: string) =>
    href === "/requests"
      ? path === href || (path.startsWith("/requests/") && !focused)
      : path === href;
  const navLinks = navigation.map(([href, label, icon]) => (
    <Link
      key={href}
      href={href}
      onClick={() => setDrawer(false)}
      className={`nav-link ${active(href) ? "selected" : ""}`}
      aria-current={active(href) ? "page" : undefined}
    >
      <Icon name={icon} />
      <span>{label}</span>
    </Link>
  ));
  async function signOut() {
    setSigningOut(true);
    setSignOutError("");
    const result = await authClient.signOut();
    if (result.error) {
      setSignOutError(
        "Your session could not be revoked. Try signing out again.",
      );
      setSigningOut(false);
      return;
    }
    router.replace("/login");
    router.refresh();
  }
  const logout = (
    <button className="nav-link logout" onClick={signOut} disabled={signingOut}>
      <Icon name="logout" />
      {signingOut ? "Signing out…" : "Log out"}
    </button>
  );
  return (
    <div
      className={`app-shell ${requester ? "requester-shell" : "admin-shell"} ${focused ? "focused-shell" : ""}`}
    >
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="app-header">
        <div className="header-left">
          <Button
            variant="ghost"
            className="mobile-menu"
            onClick={() => setDrawer(true)}
            aria-label="Open navigation"
            aria-expanded={drawer}
          >
            <span aria-hidden="true">☰</span>
          </Button>
          <Link href="/dashboard" className="wordmark">
            Permora
          </Link>
          <span className="header-divider" />
          <span className="portal-name">
            {requester ? "Access workspace" : `${roleLabels[role]} workspace`}
          </span>
          {requester && (
            <nav className="top-nav" aria-label="Quick navigation">
              {requesterNavigation.slice(0, 3).map(([href, label]) => (
                <Link
                  key={href}
                  href={href}
                  aria-current={active(href) ? "page" : undefined}
                >
                  {label}
                </Link>
              ))}
            </nav>
          )}
        </div>
        <div className="header-right">
          <div className="header-user">
            <strong>{identity.name}</strong>
            <small>{roleLabels[role]}</small>
          </div>
          <span className="avatar">{initials(identity.name)}</span>
        </div>
      </header>
      {!focused && (
        <aside className="sidebar">
          <div className="sidebar-brand">
            <Link className="wordmark" href="/dashboard">
              Permora
            </Link>
            <span>ACCESS MANAGEMENT</span>
          </div>
          <div className="eyebrow nav-label">Main menu</div>
          <nav aria-label="Main navigation">{navLinks}</nav>
          <div className="sidebar-bottom">
            <span className="eyebrow">Support</span>
            {requester && (
              <Link className="nav-link" href="/help">
                <Icon name="help" />
                Help & guidelines
              </Link>
            )}
            {logout}
          </div>
        </aside>
      )}
      <div className="workspace">
        <main id="main" className="main-content" tabIndex={-1}>
          {signOutError && (
            <Alert title="Sign-out failed" tone="danger">
              {signOutError}
            </Alert>
          )}
          {children}
        </main>
        <footer className="app-footer">
          <span>
            © 2026 Permora <span className="footer-dot">·</span> Access made
            clear.
          </span>
          <Link href="/help">Privacy & guidelines</Link>
        </footer>
      </div>
      {drawer && (
        <Modal
          title="Your workspace"
          onClose={() => setDrawer(false)}
          className="navigation-drawer"
        >
          <nav aria-label="Mobile navigation">
            {navLinks}
            {requester && (
              <Link
                href="/help"
                className="nav-link"
                onClick={() => setDrawer(false)}
              >
                <Icon name="help" />
                Help & guidelines
              </Link>
            )}
            {logout}
          </nav>
        </Modal>
      )}
    </div>
  );
}
