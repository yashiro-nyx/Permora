"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import type { TrustedIdentity } from "@/lib/auth-types";
import { Alert, Button, Icon, Modal } from "./ui";
import { NotificationBell } from "./notification-bell";
import { StaffNotificationBell } from "./staff-notification-bell";
import { initials, roleLabels } from "@/lib/model";
import {
  navigationForIdentity,
  primaryRole,
  requesterNavigation,
} from "@/lib/navigation";

const SIDEBAR_PREF_KEY = "permora-sidebar-collapsed";

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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Restore sidebar preference from localStorage (after mount to avoid SSR mismatch)
  useEffect(() => {
    try {
      setSidebarCollapsed(
        localStorage.getItem(SIDEBAR_PREF_KEY) === "true",
      );
    } catch {
      /* storage unavailable */
    }
  }, []);

  function toggleSidebar() {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    try {
      localStorage.setItem(SIDEBAR_PREF_KEY, String(next));
    } catch {
      /* storage unavailable */
    }
  }
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
      title={label}
    >
      <Icon name={icon} />
      <span className="nav-link-label">{label}</span>
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
    <button className="nav-link logout" onClick={signOut} disabled={signingOut} title="Log out">
      <Icon name="logout" />
      <span className="nav-link-label">{signingOut ? "Signing out…" : "Log out"}</span>
    </button>
  );
  return (
    <div
      className={`app-shell ${requester ? "requester-shell" : "admin-shell"} ${focused ? "focused-shell" : ""} ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}
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
          {requester ? (
            <NotificationBell canReceive={identity.requesterRole !== null} />
          ) : (
            <StaffNotificationBell />
          )}
          <div className="header-user">
            <strong>{identity.name}</strong>
            <small>{roleLabels[role]}</small>
          </div>
          <span className="avatar">{initials(identity.name)}</span>
        </div>
      </header>
      {!focused && (
        <aside className="sidebar" aria-label="Main navigation">
          <div className="sidebar-brand">
            <Link className="wordmark" href="/dashboard">
              Permora
            </Link>
            <span>ACCESS MANAGEMENT</span>
          </div>
          <div className="sidebar-header-row">
            <div className="eyebrow nav-label">Main menu</div>
            <button
              className="sidebar-collapse-btn"
              onClick={toggleSidebar}
              aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              <span className="sidebar-collapse-icon" aria-hidden="true">
                {sidebarCollapsed ? "›" : "‹"}
              </span>
            </button>
          </div>
          <nav aria-label="Main navigation">{navLinks}</nav>
          <div className="sidebar-bottom">
            <span className="eyebrow">Support</span>
            {requester && (
              <Link className="nav-link" href="/help">
                <Icon name="help" />
                <span className="nav-link-label">Help & guidelines</span>
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
