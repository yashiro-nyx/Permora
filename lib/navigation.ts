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
  ["/notifications", "Notifications", "bell"],
  ["/account/notifications", "Notification Settings", "bell"],
  ["/account/password", "Change Password", "key"],
];

export const approverNavigation: readonly NavigationItem[] = [
  ["/dashboard", "Dashboard", "dashboard"],
  ["/review", "Review Requests", "requests"],
  ["/notifications/staff", "Notifications", "bell"],
  ["/help", "Help & Support", "help"],
  ["/account/notifications", "Notification Settings", "bell"],
  ["/account/password", "Change Password", "key"],
];

export const administratorNavigation: readonly NavigationItem[] = [
  ["/dashboard", "Dashboard", "dashboard"],
  ["/review", "Review Requests", "requests"],
  ["/admin/activations", "Activations", "key"],
  ["/admin/unassigned", "Unassigned Requests", "expire"],
  ["/admin/responsibilities", "Approver Responsibilities", "users"],
  ["/admin/delegations", "Delegations & Absences", "clock"],
  ["/admin/identifiers", "Institutional Identifiers", "database"],
  ["/admin/retention", "Retention", "expire"],
  ["/resources", "Resource Catalog", "resources"],
  ["/permissions", "Permissions", "shield"],
  ["/users", "User Management", "users"],
  ["/reports", "Reports & Analytics", "reports"],
  ["/audit", "Audit Logs", "clock"],
  ["/notifications/staff", "Notifications", "bell"],
  ["/help", "Help & Support", "help"],
  ["/account/notifications", "Notification Settings", "bell"],
  ["/account/password", "Change Password", "key"],
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
  const mayOpenReview = canReview &&
    (role !== "admin" || adminReviewEnabled);
  return mayOpenReview ? navigation : navigation.filter(([href]) => href !== "/review");
}
