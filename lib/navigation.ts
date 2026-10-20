import type { TrustedIdentity } from "./auth-types";
import type { Role } from "./model";

export type NavigationItem = readonly [
  href: string,
  label: string,
  icon: string,
];

export const requesterNavigation: readonly NavigationItem[] = [
  ["/dashboard", "Dashboard", "dashboard"],
  ["/requests", "My Requests", "requests"],
  ["/requests/new", "Request Access", "key"],
];

export const requesterSettingsNavigation: readonly NavigationItem[] = [
  ["/account/notifications", "Notification Preferences", "bell"],
  ["/account/password", "Change Password", "key"],
];

export const approverNavigation: readonly NavigationItem[] = [
  ["/dashboard", "Dashboard", "dashboard"],
  ["/review", "Review Requests", "requests"],
];

export const approverSettingsNavigation: readonly NavigationItem[] = [
  ["/account/notifications", "Notification Preferences", "bell"],
  ["/account/password", "Change Password", "key"],
];

export const administratorNavigation: readonly NavigationItem[] = [
  ["/dashboard", "Dashboard", "dashboard"],
  ["/admin/activations", "Activations", "key"],
  ["/admin/unassigned", "Request Routing", "expire"],
  ["/audit", "Audit Logs", "clock"],
  ["/users", "User Management", "users"],
];

export const administratorSettingsNavigation: readonly NavigationItem[] = [
  ["/resources", "Resource Catalog", "resources"],
  ["/admin/responsibilities", "Approver Responsibilities", "users"],
  ["/admin/delegations", "Delegations & Absences", "clock"],
  ["/admin/identifiers", "Institutional Identifiers", "database"],
  ["/permissions", "Permissions", "shield"],
  ["/admin/retention", "Retention", "expire"],
  ["/reports", "Reports & Analytics", "reports"],
];

export function primaryRole(identity: TrustedIdentity): Role {
  if (identity.roles.includes("admin")) return "admin";
  if (identity.roles.includes("approver")) return "approver";
  return identity.requesterRole ?? "student";
}

export function navigationForIdentity(
  identity: TrustedIdentity,
  canReview: boolean,
  adminReviewEnabled = true,
) {
  const role = primaryRole(identity);
  const navigation =
    role === "admin"
      ? administratorNavigation
      : role === "approver"
        ? approverNavigation
        : requesterNavigation;
  // Administrator review access is rendered inside the settings group only
  // when both the persisted responsibility and explicit fallback policy allow
  // it. The primary navigation remains the compact six-item admin shell.
  void canReview;
  void adminReviewEnabled;
  return navigation;
}
