export type Role = "student" | "faculty" | "approver" | "admin";
export type Status =
  | "pending"
  | "pending_routing"
  | "pending_review"
  | "approved"
  | "approved_pending_activation"
  | "active"
  | "denied"
  | "returned_for_revision"
  | "expired"
  | "cancelled"
  | "revoked";
export type LegacyLevel = "read" | "standard" | "admin";
export type Level =
  | LegacyLevel
  | "lms:course-participation"
  | "lms:assigned-teaching"
  | "portal:view-own-academic-information"
  | "grading:encode-assigned-section"
  | "grading:submit-assigned-section"
  | "library:subscribed-materials"
  | "library:restricted-collections"
  | "lab:designated-account"
  | "lab:course-software"
  | "research:view-project"
  | "research:contribute-project"
  | "research:manage-project-files";
export type Tone = "neutral" | "success" | "warning" | "danger" | "info";
export type CatalogCategory =
  | "Learning Management System"
  | "Student Portal"
  | "Faculty Grading System"
  | "Library E-Resources"
  | "Computer Laboratory Systems"
  | "Research Project Workspace";
export type LegacyCategory =
  "Databases" | "Servers" | "Applications" | "Shared folders";
export type Category = CatalogCategory | LegacyCategory;
export type ScopeFieldName =
  "courseSection" | "laboratory" | "software" | "researchProject";
export interface RequestScope {
  courseSection?: string;
  laboratory?: string;
  software?: string;
  researchProject?: string;
  accountUserId?: string;
}
export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  department: string;
  active: boolean;
}
export interface Resource {
  id: string;
  name: string;
  description: string;
  category: Category;
  owner: string;
  sensitivity: "Low" | "Medium" | "High";
  online: boolean;
  permissions: Partial<Record<Role, Level[]>>;
  maxDays: number;
  icon: string;
  catalogKind?: "proposed" | "legacy" | "custom";
}
export interface AccessRequest {
  id: string;
  userId: string;
  resourceId: string;
  level: Level;
  purpose: string;
  createdAt: string;
  startsAt: string;
  expiresAt: string;
  status: Status;
  version: number;
  decision?: {
    by: string;
    at: string;
    reason: string;
    outcome: "approved" | "denied";
  };
  renewalOf?: string;
  scope?: RequestScope;
}
export interface AuditEvent {
  id: string;
  at: string;
  actor: string;
  userId?: string;
  requestId?: string;
  resourceId?: string;
  action: string;
  detail: string;
  status?: Status;
}
export interface Notification {
  id: string;
  userId: string;
  title: string;
  message: string;
  at: string;
  read: boolean;
  tone: Tone;
  requestId?: string;
  kind: "request" | "system";
}
export interface DemoState {
  schema: 2;
  revision: number;
  clock: string;
  users: User[];
  resources: Resource[];
  requests: AccessRequest[];
  audit: AuditEvent[];
  notifications: Notification[];
}
export interface RequestDraft {
  resourceId: string;
  level: Level;
  purpose: string;
  startsAt: string;
  expiresAt: string;
  renewalOf?: string;
  scope: RequestScope;
}
export type DemoCommand =
  | { type: "request"; draft: RequestDraft }
  | {
      type: "decide";
      requestId: string;
      version: number;
      outcome: "approved" | "denied";
      reason: string;
    }
  | { type: "revoke"; requestId: string; reason: string }
  | { type: "clock"; days: number }
  | { type: "read"; ids: string[] }
  | { type: "user"; user: User }
  | { type: "resource"; resource: Resource };
export const roleLabels: Record<Role, string> = {
  student: "Student",
  faculty: "Faculty",
  approver: "Approver",
  admin: "Administrator",
};
export const levelLabels: Record<Level, string> = {
  read: "Read only",
  standard: "Standard",
  admin: "Administrative",
  "lms:course-participation": "Course participation",
  "lms:assigned-teaching": "Assigned teaching access",
  "portal:view-own-academic-information": "View own academic information",
  "grading:encode-assigned-section": "Encode grades for assigned section",
  "grading:submit-assigned-section": "Submit grades for assigned section",
  "library:subscribed-materials": "Use subscribed academic materials",
  "library:restricted-collections": "Use restricted academic collections",
  "lab:designated-account": "Use designated laboratory account",
  "lab:course-software": "Use approved course software",
  "research:view-project": "View project files and datasets",
  "research:contribute-project": "Contribute project files and datasets",
  "research:manage-project-files": "Manage project files and membership",
};
export const statusLabels: Record<Status, string> = {
  pending: "Pending review",
  pending_routing: "Pending configuration",
  pending_review: "Pending review",
  approved: "Approved",
  approved_pending_activation: "Approved — awaiting activation",
  active: "Active",
  denied: "Denied",
  returned_for_revision: "Revision requested",
  expired: "Expired",
  cancelled: "Cancelled",
  revoked: "Revoked",
};
export const profiles: Record<Role, string> = {
  student: "u-student",
  faculty: "u-faculty",
  approver: "u-approver",
  admin: "u-admin",
};
export const isReviewer = (role: Role) =>
  role === "approver" || role === "admin";
export const dateLabel = (value: string) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
export const timeLabel = (value: string) =>
  new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(value));
export const dayOffset = (value: string, days: number) =>
  new Date(new Date(value).getTime() + days * 86400000).toISOString();
export const initials = (name: string) =>
  name
    .split(" ")
    .slice(0, 2)
    .map((n) => n[0])
    .join("");
