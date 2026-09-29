import assert from "node:assert/strict";
import test from "node:test";
import type { Role } from "../lib/model";
import {
  AccountServiceError,
  mapAccountServiceError,
  parseCreateUserInput,
  parseDeactivationReason,
  parseUpdateUserInput,
  parseUserId,
  parseUserListFilters,
  toAccountUserDto,
} from "../lib/account-management";

test("user list filters validate values and bound pagination", () => {
  assert.deepEqual(
    parseUserListFilters(
      new URLSearchParams(
        "search=%20Avery%20&role=admin&status=deactivated&page=4&pageSize=999",
      ),
    ),
    {
      search: "Avery",
      role: "admin",
      status: "deactivated",
      page: 4,
      pageSize: 100,
    },
  );
  assert.deepEqual(parseUserListFilters(new URLSearchParams()), {
    search: undefined,
    role: undefined,
    status: undefined,
    page: 1,
    pageSize: 25,
  });
  assert.throws(
    () => parseUserListFilters(new URLSearchParams("role=owner")),
    AccountServiceError,
  );
  assert.throws(
    () => parseUserListFilters(new URLSearchParams("status=pending")),
    AccountServiceError,
  );
  assert.throws(
    () => parseUserListFilters(new URLSearchParams("page=0")),
    AccountServiceError,
  );
});

test("create and update inputs normalize and validate roles and fields", () => {
  assert.deepEqual(
    parseCreateUserInput({
      name: " Avery Admin ",
      email: " AVERY@example.edu ",
      roles: ["admin", "approver"],
    }),
    {
      name: "Avery Admin",
      email: "avery@example.edu",
      department: "",
      roles: ["admin", "approver"],
    },
  );
  assert.deepEqual(parseUpdateUserInput({ department: " Library " }), {
    department: "Library",
  });
  assert.throws(
    () => parseCreateUserInput({ name: "A", email: "invalid", roles: ["admin"] }),
    AccountServiceError,
  );
  assert.throws(
    () => parseCreateUserInput({ name: "Avery", email: "a@b.edu", roles: ["student", "faculty"] }),
    AccountServiceError,
  );
  assert.throws(() => parseUpdateUserInput({}), AccountServiceError);
  assert.throws(
    () => parseUpdateUserInput({ roles: ["admin"], password: "secret" }),
    AccountServiceError,
  );
  assert.throws(() => parseDeactivationReason("  "), AccountServiceError);
  assert.throws(
    () => parseDeactivationReason("credential token=example-secret"),
    AccountServiceError,
  );
  assert.throws(
    () => parseDeactivationReason("$argon2id$v=19$hash-data"),
    AccountServiceError,
  );
  assert.throws(() => parseUserId("not-an-id"), AccountServiceError);
});

test("account DTO mapping excludes credential, token, and session fields", () => {
  const row = {
    id: "89a3b655-cae2-468c-8934-3ab8686b3cf3",
    name: "Avery Admin",
    email: "avery@example.edu",
    department: "Administration",
    active: false,
    has_credential: false,
    invitation_id: "23653a13-d1cc-4c2c-a1ae-7fe7368c8703",
    invitation_expires_at: "2026-02-03T00:00:00.000Z",
    roles: ["admin" as Role],
    requester_role: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-02-01T00:00:00.000Z",
    deactivated_at: "2026-02-01T00:00:00.000Z",
    deactivation_reason: "Role change approved.",
    deactivated_by_user_id: "d45da30d-b64d-4d7a-b4ce-181eea08ca41",
    deactivated_by_name: "Jordan Admin",
    password: "must-not-copy",
    password_hash: "must-not-copy",
    token: "must-not-copy",
    session: "must-not-copy",
  };
  const dto = toAccountUserDto(row);
  assert.deepEqual(dto, {
    id: row.id,
    name: row.name,
    email: row.email,
    department: row.department,
    active: row.active,
    hasCredential: row.has_credential,
    invitation: {
      id: row.invitation_id,
      expiresAt: row.invitation_expires_at,
    },
    roles: ["admin"],
    requesterRole: null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deactivatedAt: row.deactivated_at,
    deactivationReason: row.deactivation_reason,
    deactivatedBy: { id: row.deactivated_by_user_id, name: row.deactivated_by_name },
  });
  assert.doesNotMatch(JSON.stringify(dto), /must-not-copy/);
});

test("account error mapping returns stable safe responses", () => {
  assert.deepEqual(
    mapAccountServiceError(new AccountServiceError("last_active_admin")),
    {
      status: 409,
      body: {
        error: {
          code: "last_active_admin",
          message: "The last active administrator cannot be deactivated or demoted.",
        },
      },
    },
  );
  assert.equal(
    mapAccountServiceError(
      new AccountServiceError("session_revocation_failed"),
    ).body.error.message,
    "Existing sessions could not be invalidated; the account remains deactivated.",
  );
  const unsafe = new Error("password_hash=secret session_token=secret");
  const mapped = mapAccountServiceError(unsafe);
  assert.equal(mapped.status, 503);
  assert.doesNotMatch(JSON.stringify(mapped), /password_hash|session_token|secret/);
});