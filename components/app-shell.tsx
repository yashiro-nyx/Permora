"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import type { TrustedIdentity } from "@/lib/auth-types";
import { Alert, Button, Icon, Modal } from "./ui";
import { NotificationBell } from "./notification-bell";
import { StaffNotificationBell } from "./staff-notification-bell";
import { Brand } from "./brand";
import { initials, roleLabels } from "@/lib/model";
import {
  approverSettingsNavigation,
  administratorSettingsNavigation,
  navigationForIdentity,
  primaryRole,
  requesterSettingsNavigation,
} from "@/lib/navigation";
import type { NavigationItem } from "@/lib/navigation";

const SIDEBAR_PREF_KEY = "permora-sidebar-collapsed";

export function AppShell({
  children,
  identity,
  canReview,
  adminReviewEnabled,
}: {
  children: ReactNode;
  identity: TrustedIdentity;
  canReview: boolean;
  adminReviewEnabled: boolean;
}) {
  const path = usePathname();
  const router = useRouter();
  const [drawer, setDrawer] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const role = primaryRole(identity);
  const requester = role !== "admin" && role !== "approver";
  const focused = path === "/requests/new";

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

  const settingsPaths = role === "admin"
    ? administratorSettingsNavigation
    : role === "approver"
      ? approverSettingsNavigation
      : requesterSettingsNavigation;
  const adminSettingsPath = settingsPaths.some(
    ([href]) => path === href || path.startsWith(`${href}/`),
  ) || (role === "admin" && canReview && adminReviewEnabled && path.startsWith("/review"));

  useEffect(() => {
    if (adminSettingsPath) setSettingsOpen(true);
  }, [adminSettingsPath]);

  useEffect(() => {
    if (!profileOpen) return;
    function closeOnOutside(event: MouseEvent) {
      if (!profileRef.current?.contains(event.target as Node)) setProfileOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setProfileOpen(false);
    }
    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [profileOpen]);

  function toggleSidebar() {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    try {
      localStorage.setItem(SIDEBAR_PREF_KEY, String(next));
    } catch {
      /* storage unavailable */
    }
  }
  const navigation = navigationForIdentity(identity, canReview, adminReviewEnabled);
  const active = (href: string) =>
    href === "/requests"
      ? path === href || (path.startsWith("/requests/") && !focused)
      : path === href;
  const navLink = ([href, label, icon]: NavigationItem) => (
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
  );
  const settingsNavigation = settingsPaths;
  const settingsLabel = role === "admin" ? "System Settings" : "Settings";
  const settingsGroup = (
    <div className={`nav-group ${settingsOpen ? "open" : ""}`}>
      <button
        type="button"
        className={`nav-link nav-group-toggle ${adminSettingsPath ? "selected" : ""}`}
        onClick={() => setSettingsOpen((open) => !open)}
        aria-expanded={settingsOpen}
        title={settingsLabel}
      >
        <Icon name="settings" />
        <span className="nav-link-label">{settingsLabel}</span>
        <span className="nav-group-chevron" aria-hidden="true">{settingsOpen ? "⌃" : "⌄"}</span>
      </button>
      {settingsOpen && (
        <div className="nav-group-items">
          {role === "admin" && canReview && adminReviewEnabled && navLink(["/review", "Review Requests", "requests"])}
          {settingsNavigation.map(navLink)}
        </div>
      )}
    </div>
  );
  const navLinks = (
    <>
      {navigation.map(navLink)}
      {settingsGroup}
    </>
  );
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
          <Brand size="header" className="header-brand" />
          <span className="header-divider" />
          <span className="portal-name">
            {requester ? "Access workspace" : `${roleLabels[role]} workspace`}
          </span>
        </div>
        <div className="header-right">
          {requester ? (
            <NotificationBell canReceive={identity.requesterRole !== null} />
          ) : (
            <StaffNotificationBell />
          )}
          <div className="profile-menu" ref={profileRef}>
              <button
                type="button"
                className="profile-trigger"
                aria-label={`${identity.name} profile menu`}
                aria-haspopup="menu"
                aria-expanded={profileOpen}
                onClick={() => setProfileOpen((open) => !open)}
              >
                <span className="header-user">
                  <strong>{identity.name}</strong>
                  <small>{roleLabels[role]}</small>
                </span>
                <span className="avatar">{initials(identity.name)}</span>
                <span className="profile-chevron" aria-hidden="true">⌄</span>
              </button>
              {profileOpen && (
                <div className="profile-popover" role="menu" aria-label={`${roleLabels[role]} profile menu`}>
                  <div className="profile-popover-heading">
                    <strong>{identity.name}</strong>
                    <small>{identity.email}</small>
                  </div>
                  <Link href="/account/password" role="menuitem" onClick={() => setProfileOpen(false)}>
                    <Icon name="key" /> Account settings
                  </Link>
                  <Link href="/account/notifications" role="menuitem" onClick={() => setProfileOpen(false)}>
                    <Icon name="bell" /> Notification settings
                  </Link>
                  <Link href="/help" role="menuitem" onClick={() => setProfileOpen(false)}>
                    <Icon name="help" /> Help & support
                  </Link>
                  <div className="profile-popover-divider" />
                  {logout}
                </div>
              )}
          </div>
        </div>
      </header>
      {!focused && (
        <aside className="sidebar" aria-label="Main navigation">
          <div className="sidebar-brand">
            <Brand size="sidebar" className="sidebar-brand-link" />
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
          <div className="navigation-drawer-content">
            <Brand size="drawer" className="drawer-brand" />
            <nav aria-label="Mobile navigation">
              {navLinks}
            </nav>
            <div className="navigation-drawer-footer">{logout}</div>
          </div>
        </Modal>
      )}
    </div>
  );
}
