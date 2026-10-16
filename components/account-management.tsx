"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { Role } from "@/lib/model";
import type {
  AccountUserDto,
  UserListDto,
  UserListFilters,
} from "@/lib/server/account-types";
import { InvitationControls } from "./invitation-controls";
import { useToast } from "./toast";
import {
  Alert,
  Badge,
  Button,
  Card,
  Confirm,
  Empty,
  Field,
  LinkButton,
  PageHeading,
  TablePagination,
} from "./ui";

const roleNames: Record<Role, string> = {
  student: "Student",
  faculty: "Faculty",
  approver: "Approver",
  admin: "Administrator",
};
const roleOptions = Object.keys(roleNames) as Role[];

function roleText(roles: Role[]) {
  return roles.map((role) => roleNames[role]).join(", ");
}

function UserActions({ user }: { user: AccountUserDto }) {
  return (
    <div className="account-row-actions">
      <Link className="table-link" href={`/users/${user.id}`}>
        Edit
      </Link>
    </div>
  );
}

export function AccountDirectory({
  data,
  filters,
  invalidMessage,
}: {
  data: UserListDto;
  filters: UserListFilters;
  invalidMessage?: string;
}) {
  return (
    <>
      <PageHeading
        eyebrow="ADMIN / ACCOUNTS"
        title="User management"
        description="Manage account profiles and access roles. Password setup is handled separately."
        action={
          <LinkButton href="/users/new">
            <span aria-hidden="true">+</span> Create user
          </LinkButton>
        }
      />
      {invalidMessage && (
        <Alert title="Filters could not be applied" tone="danger">
          {invalidMessage}
        </Alert>
      )}
      <Card className="account-directory-card">
        <form className="filters account-filters" method="get" action="/users">
          <div className="filter-field filter-search">
            <label htmlFor="account-search">Search accounts</label>
            <input
              id="account-search"
              name="search"
              type="search"
              maxLength={100}
              placeholder="Name, email, or department"
              defaultValue={filters.search}
            />
          </div>
          <div className="filter-field">
            <label htmlFor="account-role">Role</label>
            <select id="account-role" name="role" defaultValue={filters.role ?? ""}>
              <option value="">All roles</option>
              {roleOptions.map((role) => (
                <option key={role} value={role}>
                  {roleNames[role]}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-field">
            <label htmlFor="account-status">Status</label>
            <select
              id="account-status"
              name="status"
              defaultValue={filters.status ?? ""}
            >
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="deactivated">Deactivated</option>
            </select>
          </div>
          <input type="hidden" name="pageSize" value={filters.pageSize} />
          <input type="hidden" name="page" value="1" />
          <Button type="submit">Apply filters</Button>
          <LinkButton href="/users" variant="ghost">
            Clear
          </LinkButton>
        </form>
        {!data.items.length ? (
          <Empty
            title="No accounts found"
            description="Try adjusting the search or filters."
          />
        ) : (
          <>
            <div
              className="table-scroll account-desktop-list"
              role="region"
              aria-label="User directory"
              tabIndex={0}
            >
              <table className="account-table">
                <caption className="sr-only">Permora user accounts</caption>
                <thead>
                  <tr>
                    <th scope="col">Name / email</th>
                    <th scope="col">Role</th>
                    <th scope="col">Department</th>
                    <th scope="col">Status</th>
                    <th scope="col"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((user) => (
                    <tr key={user.id}>
                      <td>
                        <strong>{user.name}</strong>
                        <small className="table-secondary">{user.email}</small>
                      </td>
                      <td>{roleText(user.roles)}</td>
                      <td>{user.department || "Not set"}</td>
                      <td>
                        <Badge
                          label={user.active ? "Active" : "Deactivated"}
                          tone={user.active ? "success" : "neutral"}
                        />
                      </td>
                      <td><UserActions user={user} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="account-mobile-list" aria-label="User directory">
              {data.items.map((user) => (
                <li key={user.id}>
                  <div className="account-mobile-heading">
                    <div>
                      <strong>{user.name}</strong>
                      <a href={`mailto:${user.email}`}>{user.email}</a>
                    </div>
                    <Badge
                      label={user.active ? "Active" : "Deactivated"}
                      tone={user.active ? "success" : "neutral"}
                    />
                  </div>
                  <dl>
                    <div><dt>Role</dt><dd>{roleText(user.roles)}</dd></div>
                    <div><dt>Department</dt><dd>{user.department || "Not set"}</dd></div>
                  </dl>
                  <UserActions user={user} />
                </li>
              ))}
            </ul>
          </>
        )}
        <TablePagination
          page={data.pagination.page}
          pageSize={data.pagination.pageSize}
          total={data.pagination.total}
          pageCount={data.pagination.pageCount}
          itemCount={data.items.length}
          label="User directory pagination"
        />
      </Card>
    </>
  );
}

function failureMessage(body: unknown, fallback: string) {
  if (!body || typeof body !== "object") return fallback;
  const error = (body as { error?: { message?: unknown } }).error;
  return typeof error?.message === "string" ? error.message : fallback;
}

function responseBodyMessage(body: unknown, fallback: string) {
  if (!body || typeof body !== "object") return fallback;
  const warning = (body as { warning?: unknown }).warning;
  return typeof warning === "string" ? warning : fallback;
}

function RoleChoices({
  selected,
  onChange,
}: {
  selected: Role[];
  onChange: (roles: Role[]) => void;
}) {
  function toggle(role: Role, checked: boolean) {
    let next = checked
      ? [...selected, role]
      : selected.filter((entry) => entry !== role);
    if (checked && (role === "student" || role === "faculty"))
      next = next.filter((entry) => entry !== (role === "student" ? "faculty" : "student"));
    onChange(next);
  }
  return (
    <fieldset className="account-role-options">
      <legend>Roles</legend>
      <p className="field-hint">Student and faculty are mutually exclusive. Other roles may be combined.</p>
      <div className="account-role-grid">
        {roleOptions.map((role) => (
          <label className="choice" key={role}>
            <input
              type="checkbox"
              checked={selected.includes(role)}
              onChange={(event) => toggle(role, event.target.checked)}
            />
            <span>{roleNames[role]}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function AccountEditor({ mode, user, actorId }: {
  mode: "create" | "edit";
  user?: AccountUserDto;
  actorId: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [department, setDepartment] = useState(user?.department ?? "");
  const [roles, setRoles] = useState<Role[]>(user?.roles ?? ["student"]);
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState<"deactivate" | "reactivate" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [noticeTone, setNoticeTone] = useState<"success" | "warning">("success");
  const heading = mode === "create" ? "Create user" : "Edit user";

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setNoticeTone("success");
    if (name.trim().length < 2 || name.trim().length > 120) {
      setError("Enter a name between 2 and 120 characters.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Enter a valid email address.");
      return;
    }
    if (!roles.length) {
      setError("Select at least one role.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(
        mode === "create" ? "/api/admin/users" : `/api/admin/users/${user?.id}`,
        {
          method: mode === "create" ? "POST" : "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            email: email.trim(),
            department: department.trim(),
            roles,
            ...(mode === "edit" && user
              ? { expectedUpdatedAt: user.updatedAt }
              : {}),
          }),
        },
      );
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(failureMessage(body, "The account could not be saved."));
      const result = body as { user: AccountUserDto };
      setNotice("Account saved.");
      toast.success({
        title: "Changes saved",
        description:
          mode === "create"
            ? "The new user account was created."
            : "The user's account details were updated.",
      });
      if (mode === "create") router.replace(`/users/${result.user.id}`);
      router.refresh();
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "The account could not be saved.";
      setError(message);
      toast.error({ title: "Unable to save changes", description: message });
      if (caught instanceof Error && /not found|changed|already|last active/i.test(caught.message))
        router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function confirmLifecycleAction() {
    if (!user || !confirm || busy) return;
    if (confirm === "deactivate" && !reason.trim()) {
      setError("Enter a reason before deactivating this account.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    setNoticeTone("success");
    try {
      const action = confirm === "deactivate" ? "deactivate" : "reactivate";
      const response = await fetch(`/api/admin/users/${user.id}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(confirm === "deactivate" ? { reason: reason.trim() } : {}),
      });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(failureMessage(body, "The account status could not be changed."));
      const confirmedAction = confirm;
      setNotice(responseBodyMessage(body, confirmedAction === "deactivate" ? "Account deactivated." : "Account reactivated."));
      const sessionsWarning =
        (body as { sessionsRevoked?: unknown }).sessionsRevoked === false;
      if (sessionsWarning) setNoticeTone("warning");
      if (sessionsWarning)
        toast.warning({
          title:
            confirmedAction === "deactivate"
              ? "Account deactivated"
              : "Account reactivated",
          description:
            "The status changed, but existing sessions may still be active. Review session invalidation.",
        });
      else
        toast.success({
          title:
            confirmedAction === "deactivate"
              ? "Account deactivated"
              : "Account reactivated",
          description:
            confirmedAction === "deactivate"
              ? "The account can no longer sign in."
              : "The account can sign in again.",
        });
      setConfirm(null);
      setReason("");
      router.refresh();
      if (confirmedAction === "deactivate" && user.id === actorId) router.replace("/users");
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "The account status could not be changed.";
      setError(message);
      toast.error({ title: "Unable to update account", description: message });
      setConfirm(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeading
        eyebrow="ADMIN / ACCOUNTS"
        title={heading}
        description={mode === "create" ? "Add an account profile and assign its initial roles." : "Update account details, roles, and active status."}
        action={<LinkButton href="/users" variant="outline">Back to users</LinkButton>}
      />
      {error && <Alert title="Action not completed" tone="danger">{error}</Alert>}
      {notice && <Alert title={noticeTone === "warning" ? "Account deactivated; session invalidation needs attention" : "Account updated"} tone={noticeTone}>{notice}</Alert>}
      <Card className="account-editor-card">
        <form className="account-editor form-stack" onSubmit={save}>
          <div className="form-grid">
            <Field id="account-name" label="Full name" required>
              <input id="account-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} autoComplete="name" required />
            </Field>
            <Field id="account-email" label="Email address" required>
              <input id="account-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} autoComplete="email" required />
            </Field>
            <Field id="account-department" label="Department">
              <input id="account-department" value={department} onChange={(event) => setDepartment(event.target.value)} maxLength={200} />
            </Field>
          </div>
          <RoleChoices selected={roles} onChange={setRoles} />
          <div className="account-form-footer">
            <Button type="submit" disabled={busy}>{busy ? "Saving…" : mode === "create" ? "Create account" : "Save changes"}</Button>
            {mode === "create" && <p className="field-hint">No password is created or displayed here.</p>}
          </div>
        </form>
      </Card>
      {mode === "edit" && user && <InvitationControls user={user} />}
      {mode === "edit" && user && (
        <Card title="Account status" className="account-status-card">
          <div className="account-status-content">
            <div>
              <Badge label={user.active ? "Active" : "Deactivated"} tone={user.active ? "success" : "neutral"} />
              {!user.active && user.deactivationReason && <p className="small muted">Reason: {user.deactivationReason}</p>}
            </div>
            {user.active ? (
              <Button variant="danger" onClick={() => { setError(""); setConfirm("deactivate"); }} disabled={busy || user.id === actorId} title={user.id === actorId ? "Administrators cannot deactivate their own account" : undefined}>Deactivate account</Button>
            ) : (
              <Button variant="secondary" onClick={() => { setError(""); setConfirm("reactivate"); }} disabled={busy}>Reactivate account</Button>
            )}
          </div>
          {user.id === actorId && user.active && <p className="field-hint">You cannot deactivate your own administrator account.</p>}
        </Card>
      )}
      {confirm === "deactivate" && (
        <Confirm title="Deactivate this account?" onClose={() => !busy && setConfirm(null)} onConfirm={confirmLifecycleAction} label={busy ? "Deactivating…" : "Deactivate account"} danger busy={busy}>
          <p>{user?.name} will lose access. Existing sessions are invalidated after deactivation; if invalidation fails, access remains blocked and a warning will be shown.</p>
          <Field id="deactivation-reason" label="Reason" required>
            <textarea id="deactivation-reason" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={2000} rows={3} required />
          </Field>
        </Confirm>
      )}
      {confirm === "reactivate" && (
        <Confirm title="Reactivate this account?" onClose={() => !busy && setConfirm(null)} onConfirm={confirmLifecycleAction} label={busy ? "Reactivating…" : "Reactivate account"} busy={busy}>
          <p>Existing sessions will be invalidated before this account is re-enabled. The user will need to sign in again.</p>
        </Confirm>
      )}
    </>
  );
}
