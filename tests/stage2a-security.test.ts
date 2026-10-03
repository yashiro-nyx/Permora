import assert from "node:assert/strict";
import test from "node:test";
import { extractRequestInput } from "../lib/request-input";
import { hashPassword, verifyPassword } from "../lib/password-hash";

test("request input drops client-supplied identity and role fields", () => {
  const input = extractRequestInput([
    ["resourceId", "r-library"],
    ["permissionId", "library:subscribed-materials"],
    ["scope:researchProject", "project-id"],
    ["userId", "another-user"],
    ["requesterUserId", "another-user"],
    ["role", "admin"],
    ["status", "active"],
  ]);
  assert.deepEqual(input, {
    resourceId: "r-library",
    permissionId: "library:subscribed-materials",
    "scope:researchProject": "project-id",
  });
});

test("password helper stores Argon2id hashes and verifies without plaintext", async () => {
  const password = "Correct horse battery staple 2026";
  const hash = await hashPassword(password);
  assert.match(hash, /^\$argon2id\$/);
  assert.notEqual(hash, password);
  assert.equal(await verifyPassword(hash, password), true);
  assert.equal(await verifyPassword(hash, "incorrect password"), false);
});
