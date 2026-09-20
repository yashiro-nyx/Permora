"use client";
import { useState } from "react";
import Link from "next/link";
import { useDemo } from "./demo-provider";
import {
  Category,
  Level,
  Resource,
  Role,
  User,
  initials,
  levelLabels,
  roleLabels,
} from "@/lib/model";
import {
  Alert,
  Badge,
  Button,
  Card,
  Confirm,
  Empty,
  Field,
  Icon,
  Modal,
  PageHeading,
  Pagination,
  exportCsv,
} from "./ui";
import { getCatalogResource, RESOURCE_CATALOG } from "@/lib/resource-catalog";

export function Users() {
  const { state, dispatch, setNotice } = useDemo();
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState<User | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");
  const filtered = state.users.filter(
    (u) =>
      `${u.name} ${u.email} ${u.department}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (!role || u.role === role) &&
      (!status || (status === "active") === u.active),
  );
  const current = Math.min(page, Math.max(1, Math.ceil(filtered.length / 5)));
  function save() {
    if (!edit) return;
    try {
      dispatch({ type: "user", user: edit });
      setEdit(null);
      setConfirm(false);
      setNotice(
        "Demo user saved. Related permissions were checked against the updated profile.",
      );
      setError("");
    } catch (e) {
      setConfirm(false);
      setError((e as Error).message);
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="ADMIN  ›  USERS"
        title="User management"
        description="Manage the people, roles, and departments in your demo workspace."
        action={
          <Button
            onClick={() => {
              setError("");
              setEdit({
                id: crypto.randomUUID(),
                name: "",
                email: "",
                role: "student",
                department: "",
                active: true,
              });
            }}
          >
            + Add new user
          </Button>
        }
      />
      <Card>
        <div className="filters">
          <div className="filter-field filter-search">
            <label htmlFor="user-search">Search directory</label>
            <input
              id="user-search"
              placeholder="Search by name, email, or department…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <div className="filter-field">
            <label htmlFor="user-role">Role</label>
            <select
              id="user-role"
              value={role}
              onChange={(e) => {
                setRole(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All roles</option>
              {Object.entries(roleLabels).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-field">
            <label htmlFor="user-status">Status</label>
            <select
              id="user-status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          <Button
            variant="secondary"
            onClick={() =>
              exportCsv("permora-users.csv", [
                ["Name", "Email", "Role", "Department", "Active"],
                ...filtered.map((u) => [
                  u.name,
                  u.email,
                  u.role,
                  u.department,
                  String(u.active),
                ]),
              ])
            }
          >
            Export ↓
          </Button>
        </div>
      </Card>
      <Card>
        {filtered.length ? (
          <>
            <div
              className="table-scroll"
              tabIndex={0}
              role="region"
              aria-label="User directory"
            >
              <table className="request-table">
                <caption className="sr-only">Demo user directory</caption>
                <thead>
                  <tr>
                    <th>User profile</th>
                    <th>Role</th>
                    <th>Department</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice((current - 1) * 5, current * 5).map((u) => (
                    <tr key={u.id}>
                      <td>
                        <div className="resource-name">
                          <span className="avatar">{initials(u.name)}</span>
                          <div>
                            <strong>{u.name}</strong>
                            <small>{u.email}</small>
                          </div>
                        </div>
                      </td>
                      <td>
                        <Badge
                          tone={
                            u.role === "admin"
                              ? "warning"
                              : u.role === "faculty"
                                ? "info"
                                : "neutral"
                          }
                          label={roleLabels[u.role]}
                        />
                      </td>
                      <td>{u.department}</td>
                      <td>
                        <Badge
                          tone={u.active ? "success" : "danger"}
                          label={u.active ? "Active" : "Inactive"}
                        />
                      </td>
                      <td>
                        <Button
                          variant="outline"
                          onClick={() => {
                            setError("");
                            setEdit(structuredClone(u));
                          }}
                        >
                          Edit<span className="sr-only"> {u.name}</span>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              total={filtered.length}
              page={current}
              onChange={setPage}
            />
          </>
        ) : (
          <Empty />
        )}
      </Card>
      {edit && (
        <Modal
          title={
            state.users.some((u) => u.id === edit.id)
              ? "Edit demo user"
              : "Add demo user"
          }
          onClose={() => {
            setEdit(null);
            setConfirm(false);
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setConfirm(true);
            }}
          >
            <div className="modal-body form-stack">
              {error && (
                <Alert title="User not saved" tone="danger">
                  {error}
                </Alert>
              )}
              <Field id="user-name" label="Full name" required>
                <input
                  id="user-name"
                  required
                  minLength={2}
                  value={edit.name}
                  onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                />
              </Field>
              <Field id="user-email" label="Email" required>
                <input
                  id="user-email"
                  type="email"
                  required
                  value={edit.email}
                  onChange={(e) => setEdit({ ...edit, email: e.target.value })}
                />
              </Field>
              <div className="form-grid">
                <Field id="edit-role" label="Role">
                  <select
                    id="edit-role"
                    value={edit.role}
                    onChange={(e) =>
                      setEdit({ ...edit, role: e.target.value as Role })
                    }
                  >
                    {Object.entries(roleLabels).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field id="department" label="Department" required>
                  <input
                    id="department"
                    required
                    value={edit.department}
                    onChange={(e) =>
                      setEdit({ ...edit, department: e.target.value })
                    }
                  />
                </Field>
              </div>
              <label className="row">
                <input
                  type="checkbox"
                  checked={edit.active}
                  onChange={(e) =>
                    setEdit({ ...edit, active: e.target.checked })
                  }
                />
                Active demo user
              </label>
              <Alert title="Profile changes affect access" tone="warning">
                Deactivation or an incompatible role change revokes related demo
                permissions. New directory users do not become login profiles.
              </Alert>
            </div>
            <div className="modal-actions">
              <Button variant="outline" onClick={() => setEdit(null)}>
                Cancel
              </Button>
              <Button type="submit">Review changes</Button>
            </div>
          </form>
        </Modal>
      )}
      {confirm && edit && (
        <Confirm
          title="Save user changes?"
          label="Save user"
          onClose={() => setConfirm(false)}
          onConfirm={save}
        >
          <p>
            {edit.name} · {roleLabels[edit.role]} ·{" "}
            {edit.active ? "Active" : "Inactive"}
          </p>
          <p className="muted">
            Any incompatible existing permissions will be revoked and recorded
            in demo history.
          </p>
        </Confirm>
      )}
    </>
  );
}

const categories: Category[] = RESOURCE_CATALOG.map(
  (resource) => resource.category,
);
export function Resources() {
  const { state, dispatch, setNotice } = useDemo();
  const [category, setCategory] = useState("All resources");
  const [query, setQuery] = useState("");
  const [edit, setEdit] = useState<Resource | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");
  const filtered = state.resources.filter(
    (r) =>
      (category === "All resources" || r.category === category) &&
      r.name.toLowerCase().includes(query.toLowerCase()),
  );
  function openNew() {
    setError("");
    setEdit({
      id: crypto.randomUUID(),
      name: "",
      description: "",
      owner: "",
      category: "Research Project Workspace",
      online: true,
      sensitivity: "Medium",
      maxDays: 30,
      permissions: {
        student: ["read"],
        faculty: ["read", "standard"],
        admin: ["read", "standard", "admin"],
      },
      icon: "database",
    });
  }
  function save() {
    if (!edit) return;
    try {
      dispatch({ type: "resource", resource: edit });
      setConfirm(false);
      setEdit(null);
      setNotice(
        "Resource policy saved. Incompatible demo permissions have been revoked.",
      );
    } catch (e) {
      setConfirm(false);
      setError((e as Error).message);
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="ADMIN  ›  RESOURCES"
        title="System resources"
        description="Manage resources, availability, and who can request access."
        action={<Button onClick={openNew}>+ Register resource</Button>}
      />
      <div className="resource-toolbar">
        <div className="category-tabs">
          {["All resources", ...categories].map((c) => (
            <button
              aria-pressed={category === c}
              className={category === c ? "active" : ""}
              key={c}
              onClick={() => setCategory(c)}
            >
              {c}
            </button>
          ))}
        </div>
        <label className="sr-only" htmlFor="resource-search">
          Search resources
        </label>
        <input
          id="resource-search"
          placeholder="Search resources…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="resource-grid">
        {filtered.map((r) => (
          <Card key={r.id} className="resource-card">
            <div className="card-body">
              <div className="spread">
                <span
                  className={`icon-tile ${r.category === "Databases" ? "tone-info" : r.category === "Servers" ? "tone-warning" : "tone-success"}`}
                >
                  <Icon name={r.icon} size={22} />
                </span>
                <Badge
                  label={r.online ? "Online" : "Offline"}
                  tone={r.online ? "success" : "danger"}
                />
              </div>
              <h2>{r.name}</h2>
              <p className="muted small">{r.description}</p>
              <div className="row resource-badges">
                <Badge
                  label={`${r.sensitivity} sensitivity`}
                  tone={
                    r.sensitivity === "High"
                      ? "danger"
                      : r.sensitivity === "Medium"
                        ? "warning"
                        : "info"
                  }
                />
                <span className="access-level">{r.category}</span>
              </div>
              <div className="resource-owner spread">
                <div>
                  <div className="eyebrow">Owner</div>
                  <strong>{r.owner}</strong>
                </div>
                <Link
                  className="text-link"
                  href={`/permissions?resource=${r.id}`}
                >
                  {
                    state.requests.filter(
                      (x) => x.resourceId === r.id && x.status === "active",
                    ).length
                  }{" "}
                  active
                </Link>
              </div>
              <div className="spread">
                <span className="small muted">Up to {r.maxDays} days</span>
                <Button
                  variant="outline"
                  onClick={() => {
                    setError("");
                    setEdit(structuredClone(r));
                  }}
                >
                  Manage<span className="sr-only"> {r.name}</span>
                </Button>
              </div>
            </div>
          </Card>
        ))}
        <button className="resource-add" onClick={openNew}>
          <span aria-hidden="true">+</span>Register a new resource
        </button>
      </div>
      {filtered.length === 0 && <Empty title="No matching resources" />}
      {edit && (
        <Modal
          title={
            state.resources.some((r) => r.id === edit.id)
              ? "Manage resource policy"
              : "Register resource"
          }
          onClose={() => {
            setEdit(null);
            setConfirm(false);
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setConfirm(true);
            }}
          >
            <div className="modal-body form-stack">
              {error && (
                <Alert title="Policy not saved" tone="danger">
                  {error}
                </Alert>
              )}
              <Field id="resource-name" label="Resource name" required>
                <input
                  id="resource-name"
                  minLength={3}
                  required
                  value={edit.name}
                  onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                />
              </Field>
              <Field id="resource-description" label="Description">
                <input
                  id="resource-description"
                  value={edit.description}
                  onChange={(e) =>
                    setEdit({ ...edit, description: e.target.value })
                  }
                />
              </Field>
              <div className="form-grid">
                <Field id="resource-owner" label="Owner" required>
                  <input
                    id="resource-owner"
                    required
                    value={edit.owner}
                    onChange={(e) =>
                      setEdit({ ...edit, owner: e.target.value })
                    }
                  />
                </Field>
                <Field id="resource-category" label="Category">
                  <select
                    id="resource-category"
                    value={edit.category}
                    onChange={(e) =>
                      setEdit({ ...edit, category: e.target.value as Category })
                    }
                  >
                    {categories.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </Field>
                <Field id="max-days" label="Maximum days" required>
                  <input
                    id="max-days"
                    type="number"
                    min={1}
                    max={90}
                    required
                    value={edit.maxDays}
                    onChange={(e) =>
                      setEdit({ ...edit, maxDays: Number(e.target.value) })
                    }
                  />
                </Field>
                <Field id="sensitivity" label="Sensitivity">
                  <select
                    id="sensitivity"
                    value={edit.sensitivity}
                    onChange={(e) =>
                      setEdit({
                        ...edit,
                        sensitivity: e.target.value as Resource["sensitivity"],
                      })
                    }
                  >
                    {["Low", "Medium", "High"].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <fieldset className="policy-fields">
                <legend>Allowed permissions by requester role</legend>
                {(["student", "faculty"] as Role[]).map((role) => (
                  <div key={role}>
                    <strong>{roleLabels[role]}</strong>
                    <div className="row wrap">
                      {(
                        getCatalogResource(edit.id)
                          ?.permissions.filter((permission) =>
                            permission.eligibleRoles.includes(
                              role as "student" | "faculty",
                            ),
                          )
                          .map((permission) => permission.id) ??
                        (["read", "standard", "admin"] as Level[])
                      ).map((level) => (
                        <label key={level} className="row">
                          <input
                            type="checkbox"
                            checked={
                              edit.permissions[role]?.includes(level) ?? false
                            }
                            onChange={(e) => {
                              const levels = edit.permissions[role] ?? [];
                              setEdit({
                                ...edit,
                                permissions: {
                                  ...edit.permissions,
                                  [role]: e.target.checked
                                    ? [...levels, level]
                                    : levels.filter((l) => l !== level),
                                },
                              });
                            }}
                          />
                          {levelLabels[level]}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </fieldset>
              <label className="row">
                <input
                  type="checkbox"
                  checked={edit.online}
                  onChange={(e) =>
                    setEdit({ ...edit, online: e.target.checked })
                  }
                />
                Resource online and available
              </label>
              <Alert
                title="Policy changes take effect immediately in the demo"
                tone="warning"
              >
                Going offline, removing permissions, or shortening the maximum
                duration revokes affected requests and grants. Each change is
                recorded in local history.
              </Alert>
            </div>
            <div className="modal-actions">
              <Button variant="outline" onClick={() => setEdit(null)}>
                Cancel
              </Button>
              <Button type="submit">Review policy</Button>
            </div>
          </form>
        </Modal>
      )}
      {confirm && edit && (
        <Confirm
          title="Apply this resource policy?"
          label="Apply policy"
          onClose={() => setConfirm(false)}
          onConfirm={save}
        >
          <p>
            <strong>{edit.name}</strong> · {edit.online ? "Online" : "Offline"}{" "}
            · {edit.maxDays} day maximum.
          </p>
          <p className="muted">
            Existing incompatible permissions will be revoked. Requesters
            receive an in-app demo notification.
          </p>
        </Confirm>
      )}
    </>
  );
}
