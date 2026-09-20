import type {
  CatalogCategory,
  Level,
  RequestScope,
  Resource,
  Role,
  ScopeFieldName,
  User,
} from "./model";

export type RequesterRole = Extract<Role, "student" | "faculty">;
export type ProposedApproverRole =
  | "course-owner"
  | "academic-unit-approver"
  | "registrar"
  | "library-access-approver"
  | "laboratory-coordinator"
  | "research-project-owner"
  | "data-steward"
  | "it-access-administrator";

export interface CatalogPermission {
  id: Level;
  label: string;
  description: string;
  eligibleRoles: readonly RequesterRole[];
}

export interface CatalogScopeField {
  id: ScopeFieldName;
  label: string;
  placeholder: string;
  hint: string;
  required: true;
}

export interface ValidityPolicy {
  defaultDays: number;
  maxDays: number;
  expirationRequired: true;
  renewable: boolean;
  basis: string;
}

export interface ResourceCatalogEntry {
  id:
    | "r-lms"
    | "r-student-portal"
    | "r-faculty-grading"
    | "r-library"
    | "r-lab"
    | "r-research-workspace";
  name: CatalogCategory;
  category: CatalogCategory;
  description: string;
  owner: string;
  sensitivity: Resource["sensitivity"];
  icon: string;
  eligibleRoles: readonly RequesterRole[];
  permissions: readonly CatalogPermission[];
  scopeFields: readonly CatalogScopeField[];
  fixedScope?: "requester-own-account";
  approvers: readonly {
    role: ProposedApproverRole;
    responsibility: string;
  }[];
  validity: ValidityPolicy;
  ordinaryAccess: string;
  requestableAccess: string;
  backendChecks: readonly string[];
}

const courseSection: CatalogScopeField = {
  id: "courseSection",
  label: "Course and section",
  placeholder: "e.g. CS 301 · Section A",
  hint: "Use the course code and official section identifier.",
  required: true,
};

export const RESOURCE_CATALOG: readonly ResourceCatalogEntry[] = [
  {
    id: "r-lms",
    name: "Learning Management System",
    category: "Learning Management System",
    description:
      "Course-specific participation for students or assigned teaching access for faculty.",
    owner: "Academic Technology",
    sensitivity: "Medium",
    icon: "folder",
    eligibleRoles: ["student", "faculty"],
    permissions: [
      {
        id: "lms:course-participation",
        label: "Course participation",
        description:
          "Participate in the named course section when normal enrollment access is missing or delayed.",
        eligibleRoles: ["student"],
      },
      {
        id: "lms:assigned-teaching",
        label: "Assigned teaching access",
        description:
          "Manage learning activities for a section the faculty member is assigned to teach.",
        eligibleRoles: ["faculty"],
      },
    ],
    scopeFields: [courseSection],
    approvers: [
      {
        role: "course-owner",
        responsibility:
          "Confirm enrollment or teaching assignment for the named section.",
      },
      {
        role: "academic-unit-approver",
        responsibility: "Resolve exceptional or cross-unit course access.",
      },
    ],
    validity: {
      defaultDays: 30,
      maxDays: 90,
      expirationRequired: true,
      renewable: true,
      basis: "No later than the approved course or teaching assignment period.",
    },
    ordinaryAccess:
      "Enrollment and assigned teaching access should normally be provisioned without a Permora request.",
    requestableAccess:
      "Use Permora only for missing, additional, cross-listed, or temporary course access.",
    backendChecks: [
      "Verify current enrollment or assigned teaching section.",
      "Reject a duplicate of access already provisioned by the LMS.",
    ],
  },
  {
    id: "r-student-portal",
    name: "Student Portal",
    category: "Student Portal",
    description: "Access to the requester's own academic information.",
    owner: "Registrar and Student Services",
    sensitivity: "High",
    icon: "database",
    eligibleRoles: ["student"],
    permissions: [
      {
        id: "portal:view-own-academic-information",
        label: "View own academic information",
        description:
          "Restore or temporarily enable access to the signed-in student's own portal account.",
        eligibleRoles: ["student"],
      },
    ],
    scopeFields: [],
    fixedScope: "requester-own-account",
    approvers: [
      {
        role: "registrar",
        responsibility:
          "Confirm student status and that the account belongs to the requester.",
      },
      {
        role: "it-access-administrator",
        responsibility:
          "Resolve account access without exposing another student's records.",
      },
    ],
    validity: {
      defaultDays: 7,
      maxDays: 30,
      expirationRequired: true,
      renewable: false,
      basis: "Exception access should end after the account issue is resolved.",
    },
    ordinaryAccess:
      "An active student should normally receive access to their own portal account through enrollment.",
    requestableAccess:
      "Use Permora only for an approved exception affecting the requester's own account.",
    backendChecks: [
      "Derive the account owner from the authenticated user; never accept another student ID.",
      "Check whether ordinary portal access is already active before accepting a request.",
    ],
  },
  {
    id: "r-faculty-grading",
    name: "Faculty Grading System",
    category: "Faculty Grading System",
    description: "Grade encoding or submission for an assigned course section.",
    owner: "Registrar and Academic Affairs",
    sensitivity: "High",
    icon: "key",
    eligibleRoles: ["faculty"],
    permissions: [
      {
        id: "grading:encode-assigned-section",
        label: "Encode grades for assigned section",
        description:
          "Create and revise grade entries before formal submission.",
        eligibleRoles: ["faculty"],
      },
      {
        id: "grading:submit-assigned-section",
        label: "Submit grades for assigned section",
        description: "Formally submit grades for registrar processing.",
        eligibleRoles: ["faculty"],
      },
    ],
    scopeFields: [courseSection],
    approvers: [
      {
        role: "academic-unit-approver",
        responsibility:
          "Verify the faculty member's teaching assignment and requested capability.",
      },
      {
        role: "registrar",
        responsibility:
          "Approve submission access and enforce grading windows.",
      },
    ],
    validity: {
      defaultDays: 14,
      maxDays: 60,
      expirationRequired: true,
      renewable: true,
      basis:
        "Bound to the assigned section and the applicable grade-entry window.",
    },
    ordinaryAccess:
      "Faculty assigned to a section should normally receive the standard grading access for that assignment.",
    requestableAccess:
      "Use Permora for missing assignment access, additional submission authority, or a time-limited exception.",
    backendChecks: [
      "Verify the faculty role from trusted identity data.",
      "Verify the named section is assigned to the requester and the grading window is open.",
      "Students must never receive a grading permission.",
    ],
  },
  {
    id: "r-library",
    name: "Library E-Resources",
    category: "Library E-Resources",
    description:
      "Subscribed academic materials and approved restricted collections.",
    owner: "Library Services",
    sensitivity: "Low",
    icon: "book",
    eligibleRoles: ["student", "faculty"],
    permissions: [
      {
        id: "library:subscribed-materials",
        label: "Use subscribed academic materials",
        description:
          "Read journals, ebooks, and databases covered by active subscriptions.",
        eligibleRoles: ["student", "faculty"],
      },
      {
        id: "library:restricted-collections",
        label: "Use restricted academic collections",
        description:
          "Use licensed or controlled collections approved for the stated work.",
        eligibleRoles: ["faculty"],
      },
    ],
    scopeFields: [],
    approvers: [
      {
        role: "library-access-approver",
        responsibility:
          "Check subscription terms and restricted-collection eligibility.",
      },
    ],
    validity: {
      defaultDays: 30,
      maxDays: 90,
      expirationRequired: true,
      renewable: true,
      basis:
        "No longer than enrollment, employment, license, or project eligibility.",
    },
    ordinaryAccess:
      "Standard subscribed materials are normally available through active enrollment or employment.",
    requestableAccess:
      "Use Permora for missing remote access or an additional restricted collection needed for academic work.",
    backendChecks: [
      "Check current enrollment or employment and the applicable license terms.",
      "Reject duplicate access already supplied by the library identity system.",
    ],
  },
  {
    id: "r-lab",
    name: "Computer Laboratory Systems",
    category: "Computer Laboratory Systems",
    description: "Designated laboratory accounts and approved course software.",
    owner: "Laboratory Operations",
    sensitivity: "Medium",
    icon: "lab",
    eligibleRoles: ["student", "faculty"],
    permissions: [
      {
        id: "lab:designated-account",
        label: "Use designated laboratory account",
        description: "Sign in to the named computer laboratory environment.",
        eligibleRoles: ["student", "faculty"],
      },
      {
        id: "lab:course-software",
        label: "Use approved course software",
        description:
          "Run the named licensed or restricted software in the selected laboratory.",
        eligibleRoles: ["student", "faculty"],
      },
    ],
    scopeFields: [
      {
        id: "laboratory",
        label: "Laboratory",
        placeholder: "e.g. Computing Laboratory 2",
        hint: "Identify the designated laboratory or account environment.",
        required: true,
      },
      {
        id: "software",
        label: "Software or environment",
        placeholder: "e.g. MATLAB and Robotics Toolkit",
        hint: "Name the required software or standard laboratory environment.",
        required: true,
      },
    ],
    approvers: [
      {
        role: "laboratory-coordinator",
        responsibility:
          "Confirm laboratory designation, course need, training, and software availability.",
      },
      {
        role: "it-access-administrator",
        responsibility: "Provision the approved account and software scope.",
      },
    ],
    validity: {
      defaultDays: 14,
      maxDays: 60,
      expirationRequired: true,
      renewable: true,
      basis:
        "Bound to the laboratory activity, course, or approved project period.",
    },
    ordinaryAccess:
      "General laboratory access and standard course software should be supplied through current course assignments.",
    requestableAccess:
      "Use Permora for a designated account, additional licensed software, or temporary laboratory access.",
    backendChecks: [
      "Verify laboratory/course eligibility, prerequisites, and software licensing.",
      "Provision only the laboratory and software recorded on the approved request.",
    ],
  },
  {
    id: "r-research-workspace",
    name: "Research Project Workspace",
    category: "Research Project Workspace",
    description:
      "Files and datasets belonging to one identified research project.",
    owner: "Research Services",
    sensitivity: "High",
    icon: "folder",
    eligibleRoles: ["student", "faculty"],
    permissions: [
      {
        id: "research:view-project",
        label: "View project files and datasets",
        description: "Read materials belonging only to the identified project.",
        eligibleRoles: ["student", "faculty"],
      },
      {
        id: "research:contribute-project",
        label: "Contribute project files and datasets",
        description:
          "Create and revise materials belonging only to the identified project.",
        eligibleRoles: ["student", "faculty"],
      },
      {
        id: "research:manage-project-files",
        label: "Manage project files and membership",
        description:
          "Organize the project workspace and manage membership within the approved project.",
        eligibleRoles: ["faculty"],
      },
    ],
    scopeFields: [
      {
        id: "researchProject",
        label: "Research project",
        placeholder: "e.g. PROJECT-2026-014 · Coastal Data Study",
        hint: "Use the approved project name or identifier. Access remains limited to this project.",
        required: true,
      },
    ],
    approvers: [
      {
        role: "research-project-owner",
        responsibility:
          "Confirm project membership and the minimum permission needed.",
      },
      {
        role: "data-steward",
        responsibility:
          "Review sensitive datasets, sharing limits, and retention conditions.",
      },
    ],
    validity: {
      defaultDays: 30,
      maxDays: 90,
      expirationRequired: true,
      renewable: true,
      basis:
        "No later than the verified project membership or data-use period.",
    },
    ordinaryAccess:
      "Members should normally receive the base workspace access defined by their approved project assignment.",
    requestableAccess:
      "Use Permora for missing membership, an elevated project-specific permission, or temporary external work.",
    backendChecks: [
      "Verify membership in the selected project and any data-use approval.",
      "Enforce permissions against the selected project ID, not the whole research repository.",
    ],
  },
];

export const getCatalogResource = (id: string) =>
  RESOURCE_CATALOG.find((resource) => resource.id === id);

export const getPermissionOptions = (
  resource: ResourceCatalogEntry | undefined,
  role: Role,
) =>
  resource?.permissions.filter((permission) =>
    permission.eligibleRoles.includes(role as RequesterRole),
  ) ?? [];

export const getPermissionLabel = (resourceId: string, permissionId: Level) =>
  getCatalogResource(resourceId)?.permissions.find(
    (permission) => permission.id === permissionId,
  )?.label;

export function catalogEntryToResource(entry: ResourceCatalogEntry): Resource {
  const permissions: Resource["permissions"] = {};
  for (const role of entry.eligibleRoles) {
    permissions[role] = entry.permissions
      .filter((permission) => permission.eligibleRoles.includes(role))
      .map((permission) => permission.id);
  }
  return {
    id: entry.id,
    name: entry.name,
    description: entry.description,
    category: entry.category,
    owner: entry.owner,
    sensitivity: entry.sensitivity,
    online: true,
    permissions,
    maxDays: entry.validity.maxDays,
    icon: entry.icon,
    catalogKind: "proposed",
  };
}

export const CATALOG_RESOURCES = RESOURCE_CATALOG.map(catalogEntryToResource);

export const eligibleCatalogResources = (resources: Resource[], user: User) =>
  RESOURCE_CATALOG.filter((entry) => {
    const resource = resources.find((candidate) => candidate.id === entry.id);
    return (
      entry.eligibleRoles.includes(user.role as RequesterRole) &&
      resource?.online === true &&
      getPermissionOptions(entry, user.role).some((permission) =>
        resource.permissions[user.role]?.includes(permission.id),
      )
    );
  });

export function normalizeRequestScope(
  entry: ResourceCatalogEntry,
  user: User,
  scope: RequestScope,
): RequestScope {
  const normalized: RequestScope = {};
  for (const field of entry.scopeFields) {
    normalized[field.id] = scope[field.id]?.trim();
  }
  if (entry.fixedScope === "requester-own-account") {
    normalized.accountUserId = user.id;
  }
  return normalized;
}

export function scopeSignature(resourceId: string, scope: RequestScope = {}) {
  const entry = getCatalogResource(resourceId);
  if (!entry) return "legacy";
  const values = entry.scopeFields.map(
    (field) => scope[field.id]?.trim() ?? "",
  );
  if (entry.fixedScope === "requester-own-account") {
    values.push(scope.accountUserId ?? "");
  }
  return values.join("|").toLocaleLowerCase();
}

export function scopeSummary(resourceId: string, scope: RequestScope = {}) {
  const entry = getCatalogResource(resourceId);
  if (!entry) return [];
  const lines = entry.scopeFields.flatMap((field) => {
    const value = scope[field.id]?.trim();
    return value ? [{ label: field.label, value }] : [];
  });
  if (entry.fixedScope === "requester-own-account") {
    lines.push({ label: "Account scope", value: "Requester's own account" });
  }
  return lines;
}

export function requestScopeIsComplete(
  entry: ResourceCatalogEntry | undefined,
  user: User,
  scope: RequestScope = {},
) {
  if (!entry) return true;
  return (
    entry.scopeFields.every((field) => Boolean(scope[field.id]?.trim())) &&
    (entry.fixedScope !== "requester-own-account" ||
      scope.accountUserId === user.id)
  );
}
