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
  ["/account/password", "Change Password", "key"],
];

export const approverNavigation: readonly NavigationItem[] = [
  ["/dashboard", "Dashboard", "dashboard"],
  ["/review", "Review Requests", "requests"],
  ["/help", "Help & Support", "help"],
  ["/account/password", "Change Password", "key"],
];

export const administratorNavigation: readonly NavigationItem[] = [
  ["/dashboard", "Dashboard", "dashboard"],
  ["/review", "Review Requests", "requests"],
  ["/admin/activations", "Activations", "key"],
  ["/admin/unassigned", "Unassigned Requests", "expire"],
  ["/admin/responsibilities", "Approver Responsibilities", "users"],
  ["/users", "User Management", "users"],
  ["/audit", "Audit Logs", "clock"],
  ["/help", "Help & Support", "help"],
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
) {
  const role = primaryRole(identity);
  const navigation =
    role === "admin"
      ? administratorNavigation
      : role === "approver"
        ? approverNavigation
        : requesterNavigation;
  return canReview ? navigation : navigation.filter(([href]) => href !== "/review");
}
