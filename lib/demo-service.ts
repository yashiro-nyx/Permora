import {
  AccessRequest,
  AuditEvent,
  DemoCommand,
  DemoState,
  Notification,
  Level,
  RequestScope,
  Resource,
  User,
  dayOffset,
  isReviewer,
} from "./model";
import {
  CATALOG_RESOURCES,
  getCatalogResource,
  getPermissionOptions,
  normalizeRequestScope,
  requestScopeIsComplete,
  scopeSignature,
} from "./resource-catalog";

// A local simulation, not an authentication or authorization boundary.
export const STORAGE_KEY = "permora-demo-v1";
export function createSeed(): DemoState {
  const clock = "2026-09-13T09:00:00.000Z";
  const users: User[] = [
    {
      id: "u-student",
      name: "Alex Morgan",
      email: "alex@demo.permora.test",
      role: "student",
      department: "Computer Science",
      active: true,
    },
    {
      id: "u-faculty",
      name: "Sarah Chen",
      email: "sarah@demo.permora.test",
      role: "faculty",
      department: "Engineering",
      active: true,
    },
    {
      id: "u-approver",
      name: "Jordan Lee",
      email: "jordan@demo.permora.test",
      role: "approver",
      department: "Access Review",
      active: true,
    },
    {
      id: "u-admin",
      name: "Taylor Reed",
      email: "taylor@demo.permora.test",
      role: "admin",
      department: "IT Operations",
      active: true,
    },
    {
      id: "u-5",
      name: "Jamie Rivera",
      email: "jamie@demo.permora.test",
      role: "student",
      department: "Information Technology",
      active: true,
    },
    {
      id: "u-6",
      name: "Robin Ellis",
      email: "robin@demo.permora.test",
      role: "faculty",
      department: "Research",
      active: false,
    },
  ];
  const basic: Resource["permissions"] = {
    student: ["read", "standard"],
    faculty: ["read", "standard"],
    admin: ["read", "standard", "admin"],
  };
  const legacyResources: Resource[] = [
    {
      id: "r-records",
      name: "Student Records DB",
      description: "Legacy prototype resource · retained for request history",
      category: "Databases",
      owner: "IT Security",
      sensitivity: "High",
      online: true,
      maxDays: 14,
      permissions: { faculty: ["read"], admin: ["read", "admin"] },
      icon: "database",
      catalogKind: "legacy",
    },
    {
      id: "r-vpn",
      name: "Research VPN Gateway",
      description: "Legacy prototype resource · retained for request history",
      category: "Servers",
      owner: "Network Engineering",
      sensitivity: "High",
      online: true,
      maxDays: 30,
      permissions: basic,
      icon: "key",
      catalogKind: "legacy",
    },
    {
      id: "r-drive",
      name: "Faculty Shared Drive",
      description: "Legacy prototype resource · retained for request history",
      category: "Shared folders",
      owner: "Administrative Services",
      sensitivity: "Medium",
      online: false,
      maxDays: 30,
      permissions: {
        faculty: ["read", "standard"],
        admin: ["read", "standard", "admin"],
      },
      icon: "folder",
      catalogKind: "legacy",
    },
  ];
  const resources: Resource[] = [
    ...CATALOG_RESOURCES.map((resource) => structuredClone(resource)),
    ...legacyResources,
  ];
  const rows: [
    string,
    string,
    Level,
    RequestScope,
    AccessRequest["status"],
    number,
    number,
    number,
  ][] = [
    [
      "u-student",
      "r-lab",
      "lab:course-software",
      { laboratory: "Computer Laboratory 2", software: "Robotics Toolkit" },
      "pending",
      -1,
      0,
      7,
    ],
    [
      "u-student",
      "r-library",
      "library:subscribed-materials",
      {},
      "active",
      -3,
      -2,
      14,
    ],
    ["u-student", "r-vpn", "read", {}, "denied", -4, -3, 10],
    [
      "u-student",
      "r-lms",
      "lms:course-participation",
      { courseSection: "CS 301 · Section A" },
      "active",
      -10,
      -9,
      2,
    ],
    [
      "u-student",
      "r-lab",
      "lab:designated-account",
      {
        laboratory: "Robotics Laboratory",
        software: "Standard laboratory environment",
      },
      "expired",
      -25,
      -24,
      -2,
    ],
    ["u-student", "r-vpn", "read", {}, "approved", -2, 3, 20],
    ["u-faculty", "r-records", "read", {}, "pending", -1, 0, 7],
    [
      "u-faculty",
      "r-lab",
      "lab:course-software",
      { laboratory: "Engineering Laboratory", software: "MATLAB" },
      "active",
      -5,
      -4,
      10,
    ],
    [
      "u-5",
      "r-lms",
      "lms:course-participation",
      { courseSection: "IT 204 · Section B" },
      "pending",
      -2,
      0,
      30,
    ],
  ];
  const requests: AccessRequest[] = rows.map(
    ([userId, resourceId, level, scope, status, created, start, end], i) => ({
      id: `REQ-2026-${String(1042 - i).padStart(4, "0")}`,
      userId,
      resourceId,
      level,
      scope,
      purpose:
        "Access is required for my current research project and scheduled coursework. I will use only the resources needed for this work.",
      createdAt: dayOffset(clock, created),
      startsAt: dayOffset(clock, start),
      expiresAt: dayOffset(clock, end),
      status,
      version: 1,
      ...(status !== "pending"
        ? {
            decision: {
              by: "u-approver",
              at: dayOffset(clock, created + 1),
              outcome:
                status === "denied"
                  ? ("denied" as const)
                  : ("approved" as const),
              reason:
                status === "denied"
                  ? "Please provide the network training prerequisite before requesting VPN access."
                  : "Purpose and duration are appropriate for the requested resource.",
            },
          }
        : {}),
    }),
  );
  const audit: AuditEvent[] = requests
    .flatMap((r) => [
      {
        id: `seed-${r.id}`,
        at: r.createdAt,
        actor: r.userId,
        userId: r.userId,
        requestId: r.id,
        resourceId: r.resourceId,
        action: "Request submitted",
        detail: "Temporary access requested.",
        status: "pending" as const,
      },
      ...(r.decision
        ? [
            {
              id: `decision-${r.id}`,
              at: r.decision.at,
              actor: r.decision.by,
              userId: r.userId,
              requestId: r.id,
              resourceId: r.resourceId,
              action:
                r.decision.outcome === "approved"
                  ? "Request approved"
                  : "Request denied",
              detail: r.decision.reason,
              status: r.decision.outcome,
            },
          ]
        : []),
      ...(["active", "expired"].includes(r.status)
        ? [
            {
              id: `active-${r.id}`,
              at: r.startsAt,
              actor: "Demo clock",
              userId: r.userId,
              requestId: r.id,
              resourceId: r.resourceId,
              action: "Access activated",
              detail: "Demo validity period began.",
              status: "active" as const,
            },
          ]
        : []),
      ...(r.status === "expired"
        ? [
            {
              id: `expired-${r.id}`,
              at: r.expiresAt,
              actor: "Demo clock",
              userId: r.userId,
              requestId: r.id,
              resourceId: r.resourceId,
              action: "Access expired",
              detail: "Demo validity period ended.",
              status: "expired" as const,
            },
          ]
        : []),
    ])
    .sort((a, b) => b.at.localeCompare(a.at));
  const notifications: Notification[] = [
    {
      id: "n-1",
      userId: "u-student",
      title: "Your access is ready",
      message:
        "Library E-Resources access is active. Your next research session is ready to go.",
      at: dayOffset(clock, -2),
      read: false,
      tone: "success",
      requestId: requests[1].id,
      kind: "request",
    },
    {
      id: "n-2",
      userId: "u-student",
      title: "Access expiring soon",
      message:
        "Your Learning Management System access expires in 2 days. Submit a renewal if you need more time.",
      at: clock,
      read: false,
      tone: "warning",
      requestId: requests[3].id,
      kind: "request",
    },
    {
      id: "n-3",
      userId: "u-student",
      title: "Request needs another look",
      message: requests[2].decision!.reason,
      at: dayOffset(clock, -3),
      read: true,
      tone: "danger",
      requestId: requests[2].id,
      kind: "request",
    },
    ...users.map((u) => ({
      id: `welcome-${u.id}`,
      userId: u.id,
      title: "Welcome to your demo workspace",
      message:
        "Explore the complete access workflow. Changes are saved in this browser and can be reset at any time.",
      at: dayOffset(clock, -5),
      read: true,
      tone: "info" as const,
      kind: "system" as const,
    })),
  ];
  return {
    schema: 2,
    revision: 0,
    clock,
    users,
    resources,
    requests,
    audit,
    notifications,
  };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
export function validateDraft(
  state: DemoState,
  user: User,
  draft: import("./model").RequestDraft,
) {
  const errors: Record<string, string> = {};
  const resource = state.resources.find((r) => r.id === draft.resourceId);
  const catalog = getCatalogResource(draft.resourceId);
  if (!catalog || !resource?.online)
    errors.resourceId = "Choose an eligible, available catalog resource.";
  else if (!catalog.eligibleRoles.includes(user.role as "student" | "faculty"))
    errors.resourceId =
      "This resource is not available for your requester role.";
  const allowed = getPermissionOptions(catalog, user.role)
    .filter(
      (permission) =>
        resource?.permissions[user.role]?.includes(permission.id) ?? false,
    )
    .map((permission) => permission.id);
  if (!allowed.includes(draft.level))
    errors.level =
      "This permission is not available for your role and resource.";
  if (catalog) {
    for (const field of catalog.scopeFields) {
      if (!draft.scope[field.id]?.trim()) {
        errors[field.id] = `${field.label} is required for this resource.`;
      }
    }
    if (
      catalog.fixedScope === "requester-own-account" &&
      draft.scope.accountUserId !== user.id
    ) {
      errors.resourceId =
        "Student Portal access is limited to your own account.";
    }
  }
  if (draft.purpose.trim().length < 20)
    errors.purpose = "Explain your purpose in at least 20 characters.";
  if (draft.purpose.length > 2000)
    errors.purpose = "Keep the purpose within 2,000 characters.";
  const start = Date.parse(draft.startsAt),
    end = Date.parse(draft.expiresAt);
  if (!Number.isFinite(start) || start < Date.parse(state.clock))
    errors.startsAt = "Choose a start on or after the demo date.";
  if (!Number.isFinite(end) || end <= start)
    errors.expiresAt = "Expiration is required and must be after the start.";
  else if (catalog && end - start > catalog.validity.maxDays * 86400000)
    errors.expiresAt = `This resource allows at most ${catalog.validity.maxDays} days of access.`;
  if (
    state.requests.some(
      (r) =>
        r.userId === user.id &&
        r.resourceId === draft.resourceId &&
        r.level === draft.level &&
        scopeSignature(r.resourceId, r.scope) ===
          scopeSignature(draft.resourceId, draft.scope) &&
        ["pending", "approved", "active"].includes(r.status) &&
        start < Date.parse(r.expiresAt) &&
        end > Date.parse(r.startsAt),
    )
  )
    errors.resourceId =
      "You already have this permission for the same scope and overlapping dates.";
  if (draft.renewalOf) {
    const previous = state.requests.find((r) => r.id === draft.renewalOf);
    if (
      !previous ||
      previous.userId !== user.id ||
      previous.resourceId !== draft.resourceId ||
      previous.level !== draft.level ||
      scopeSignature(previous.resourceId, previous.scope) !==
        scopeSignature(draft.resourceId, draft.scope) ||
      !["active", "approved", "expired", "revoked"].includes(previous.status) ||
      catalog?.validity.renewable === false
    ) {
      errors.resourceId =
        "A renewal must keep the same eligible resource, permission, and scope.";
    }
  }
  return errors;
}

export function transition(
  current: DemoState,
  actorId: string,
  command: DemoCommand,
): DemoState {
  const state = structuredClone(current);
  const actor = state.users.find((u) => u.id === actorId);
  assert(
    actor?.active,
    "This demo profile is inactive. Switch to another active profile.",
  );
  const id = () => crypto.randomUUID();
  const event = (
    action: string,
    detail: string,
    request?: AccessRequest,
    by = actorId,
    at = state.clock,
  ) =>
    state.audit.unshift({
      id: id(),
      at,
      actor: by,
      action,
      detail,
      requestId: request?.id,
      resourceId: request?.resourceId,
      userId: request?.userId,
      status: request?.status,
    });
  const notify = (
    userId: string,
    title: string,
    message: string,
    tone: Notification["tone"],
    requestId?: string,
  ) =>
    state.notifications.unshift({
      id: id(),
      at: state.clock,
      userId,
      title,
      message,
      tone,
      read: false,
      requestId,
      kind: requestId ? "request" : "system",
    });
  if (command.type === "request") {
    assert(
      actor.role === "student" || actor.role === "faculty",
      "Switch to a requester profile to submit a request.",
    );
    const errors = validateDraft(state, actor, command.draft);
    assert(!Object.keys(errors).length, Object.values(errors)[0]);
    const next =
      Math.max(
        1042,
        ...state.requests.map((r) => Number(r.id.split("-").at(-1))),
      ) + 1;
    const catalog = getCatalogResource(command.draft.resourceId)!;
    const request: AccessRequest = {
      ...command.draft,
      scope: normalizeRequestScope(catalog, actor, command.draft.scope),
      purpose: command.draft.purpose.trim(),
      id: `REQ-2026-${next}`,
      userId: actorId,
      createdAt: state.clock,
      status: "pending",
      version: 1,
    };
    state.requests.unshift(request);
    event(
      command.draft.renewalOf ? "Renewal requested" : "Request submitted",
      request.purpose,
      request,
    );
    notify(
      actorId,
      "Request submitted",
      "Your request is in the review queue. You can follow its progress in My Requests.",
      "info",
      request.id,
    );
    state.users
      .filter((u) => u.active && isReviewer(u.role))
      .forEach((u) =>
        notify(
          u.id,
          "A request is ready for review",
          `${actor.name} requested ${state.resources.find((r) => r.id === request.resourceId)?.name}.`,
          "warning",
          request.id,
        ),
      );
  } else if (command.type === "decide") {
    assert(
      isReviewer(actor.role),
      "Only a demo reviewer can record a decision.",
    );
    const request = state.requests.find((r) => r.id === command.requestId);
    assert(
      request &&
        request.status === "pending" &&
        request.version === command.version,
      "This request has changed or was already reviewed. Refresh its details.",
    );
    assert(request.userId !== actorId, "You cannot review your own request.");
    assert(
      command.reason.trim().length >= 10,
      "Enter a decision reason of at least 10 characters.",
    );
    assert(
      command.reason.length <= 2000,
      "Keep the reason within 2,000 characters.",
    );
    if (command.outcome === "approved") {
      const owner = state.users.find((u) => u.id === request.userId);
      const resource = state.resources.find((r) => r.id === request.resourceId);
      assert(
        owner?.active &&
          resource?.online &&
          resource.permissions[owner.role]?.includes(request.level) &&
          requestScopeIsComplete(
            getCatalogResource(request.resourceId),
            owner,
            request.scope,
          ),
        "The requester or resource policy changed. This permission cannot be approved.",
      );
      assert(
        Date.parse(request.expiresAt) > Date.parse(state.clock),
        "This request has already expired. Ask the requester to submit a new one.",
      );
    }
    request.status = command.outcome;
    request.version += 1;
    request.decision = {
      by: actorId,
      at: state.clock,
      outcome: command.outcome,
      reason: command.reason.trim(),
    };
    event(
      command.outcome === "approved" ? "Request approved" : "Request denied",
      command.reason.trim(),
      request,
    );
    notify(
      request.userId,
      `Access request ${command.outcome}`,
      command.reason.trim(),
      command.outcome === "approved" ? "success" : "danger",
      request.id,
    );
    if (request.status === "approved" && request.startsAt <= state.clock) {
      request.status = "active";
      event(
        "Access activated",
        "The approved demo validity period has begun.",
        request,
        "Demo clock",
      );
    }
  } else if (command.type === "revoke") {
    assert(
      actor.role === "admin",
      "Only the administrator can revoke demo access.",
    );
    const request = state.requests.find((r) => r.id === command.requestId);
    assert(
      request && ["active", "approved"].includes(request.status),
      "Only an active or scheduled permission can be revoked.",
    );
    assert(
      command.reason.trim().length >= 10,
      "Explain the revocation in at least 10 characters.",
    );
    request.status = "revoked";
    request.version += 1;
    event("Access revoked", command.reason.trim(), request);
    notify(
      request.userId,
      "Access revoked",
      command.reason.trim(),
      "danger",
      request.id,
    );
  } else if (command.type === "clock") {
    assert(
      actor.role === "admin" &&
        Number.isInteger(command.days) &&
        command.days > 0 &&
        command.days <= 90,
      "Advance the demo clock by 1–90 days as an administrator.",
    );
    state.clock = dayOffset(state.clock, command.days);
    event(
      "Demo clock advanced",
      `${command.days} day(s). This does not change your device clock.`,
    );
    for (const r of state.requests) {
      if (r.status === "approved" && r.startsAt <= state.clock) {
        r.status = "active";
        r.version++;
        event(
          "Access activated",
          "Demo validity period began.",
          r,
          "Demo clock",
          r.startsAt,
        );
      }
      if (
        ["active", "pending"].includes(r.status) &&
        r.expiresAt <= state.clock
      ) {
        r.status = "expired";
        r.version++;
        event(
          "Access expired",
          "Demo validity period ended.",
          r,
          "Demo clock",
          r.expiresAt,
        );
        notify(
          r.userId,
          "Access expired",
          "Submit a renewal if you need access again.",
          "neutral",
          r.id,
        );
      } else if (
        r.status === "active" &&
        Date.parse(r.expiresAt) - Date.parse(state.clock) <= 3 * 86400000 &&
        !state.notifications.some(
          (n) => n.requestId === r.id && n.title === "Access expiring soon",
        )
      )
        notify(
          r.userId,
          "Access expiring soon",
          "Your access expires within three demo days.",
          "warning",
          r.id,
        );
    }
  } else if (command.type === "read") {
    state.notifications.forEach((n) => {
      if (n.userId === actorId && command.ids.includes(n.id)) n.read = true;
    });
  } else if (command.type === "user") {
    assert(actor.role === "admin", "Administrator profile required.");
    const u = command.user;
    assert(
      u.name.trim().length >= 2 &&
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u.email) &&
        u.department.trim(),
      "Provide a name, valid email and department.",
    );
    assert(
      !state.users.some(
        (x) => x.email.toLowerCase() === u.email.toLowerCase() && x.id !== u.id,
      ),
      "That email is already in the demo directory.",
    );
    assert(
      u.id !== actorId || (u.active && u.role === "admin"),
      "Keep your current administrator profile active.",
    );
    const index = state.users.findIndex((x) => x.id === u.id);
    if (index < 0) state.users.push(u);
    else state.users[index] = u;
    // A role/deactivation change invalidates grants and pending requests that no longer fit policy.
    for (const r of state.requests.filter(
      (r) =>
        r.userId === u.id &&
        ["pending", "approved", "active"].includes(r.status),
    )) {
      const res = state.resources.find((x) => x.id === r.resourceId);
      if (!u.active || !res?.permissions[u.role]?.includes(r.level)) {
        r.status = "revoked";
        r.version++;
        event(
          "Access revoked",
          "User status or role no longer permits this access.",
          r,
        );
        notify(
          u.id,
          "Access revoked",
          "Your demo profile or role has changed.",
          "warning",
          r.id,
        );
      }
    }
    event(
      index < 0 ? "User added" : "User updated",
      `${u.name} · ${u.role} · ${u.active ? "Active" : "Inactive"}`,
    );
  } else if (command.type === "resource") {
    assert(actor.role === "admin", "Administrator profile required.");
    const r = command.resource;
    assert(
      r.name.trim().length >= 3 &&
        r.owner.trim() &&
        r.maxDays >= 1 &&
        r.maxDays <= 90 &&
        Number.isInteger(r.maxDays),
      "Provide a resource name, owner and maximum duration of 1–90 days.",
    );
    assert(
      !state.resources.some(
        (x) => x.id !== r.id && x.name.toLowerCase() === r.name.toLowerCase(),
      ),
      "A resource with this name already exists.",
    );
    const index = state.resources.findIndex((x) => x.id === r.id);
    if (index < 0) state.resources.push(r);
    else state.resources[index] = r;
    for (const request of state.requests.filter(
      (x) =>
        x.resourceId === r.id &&
        ["active", "approved", "pending"].includes(x.status),
    )) {
      const u = state.users.find((x) => x.id === request.userId);
      if (
        !r.online ||
        !u ||
        !r.permissions[u.role]?.includes(request.level) ||
        Date.parse(request.expiresAt) - Date.parse(request.startsAt) >
          r.maxDays * 86400000
      ) {
        request.status = "revoked";
        request.version++;
        event(
          "Access revoked",
          "Resource availability or permission policy changed.",
          request,
        );
        notify(
          request.userId,
          "Resource access changed",
          "Your permission was revoked following a resource policy update.",
          "warning",
          request.id,
        );
      }
    }
    event(
      index < 0 ? "Resource registered" : "Resource policy updated",
      `${r.name} · ${r.online ? "Online" : "Offline"} · ${r.maxDays} day maximum`,
    );
  }
  state.audit.sort((a, b) => b.at.localeCompare(a.at));
  state.revision += 1;
  return state;
}

function migratePermission(
  resourceId: string,
  level: Level,
  requesterRole?: User["role"],
): Level {
  if (!["read", "standard", "admin"].includes(level)) return level;
  if (resourceId === "r-lms")
    return requesterRole === "faculty"
      ? "lms:assigned-teaching"
      : "lms:course-participation";
  if (resourceId === "r-library") return "library:subscribed-materials";
  if (resourceId === "r-lab")
    return level === "standard"
      ? "lab:course-software"
      : "lab:designated-account";
  return level;
}

function legacyScope(resourceId: string): RequestScope {
  if (resourceId === "r-lms") {
    return { courseSection: "Legacy record · section not captured" };
  }
  if (resourceId === "r-lab") {
    return {
      laboratory: "Legacy record · laboratory not captured",
      software: "Legacy record · software not captured",
    };
  }
  return {};
}

export function parseStored(raw: string): DemoState {
  const state: unknown = JSON.parse(raw);
  assert(
    state &&
      typeof state === "object" &&
      "schema" in state &&
      (state.schema === 1 || state.schema === 2),
    "Unsupported demo data. Reset the workspace.",
  );
  const s = state as Omit<DemoState, "schema"> & { schema: 1 | 2 };
  assert(
    Number.isInteger(s.revision) &&
      Number.isFinite(Date.parse(s.clock)) &&
      [s.users, s.resources, s.requests, s.audit, s.notifications].every(
        Array.isArray,
      ),
    "Saved demo data is invalid. Reset the workspace.",
  );
  if (s.schema === 2) return s as DemoState;
  const currentById = new Map(
    s.resources.map((resource) => [resource.id, resource]),
  );
  const proposed = CATALOG_RESOURCES.map((resource) => ({
    ...structuredClone(resource),
    online: currentById.get(resource.id)?.online ?? resource.online,
  }));
  const proposedIds = new Set(proposed.map((resource) => resource.id));
  const retained = s.resources
    .filter((resource) => !proposedIds.has(resource.id))
    .map((resource) => ({
      ...resource,
      catalogKind: resource.catalogKind ?? ("legacy" as const),
    }));
  return {
    ...s,
    schema: 2,
    resources: [...proposed, ...retained],
    requests: s.requests.map((request) => ({
      ...request,
      level: migratePermission(
        request.resourceId,
        request.level,
        s.users.find((user) => user.id === request.userId)?.role,
      ),
      scope: request.scope ?? legacyScope(request.resourceId),
    })),
  };
}
