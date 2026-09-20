import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

const script = path.resolve(process.cwd(), "scripts/provision-account.ts");

function run(args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", script, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      DATABASE_MIGRATION_URL: "",
    },
    timeout: 10_000,
  });
}

for (const flag of ["--help", "-h"]) {
  test(`${flag} prints credential-safe usage without configuration`, () => {
    const result = run([flag, "--unknown-after-help"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Permora account provisioning/);
    assert.match(result.stdout, /One of: admin, approver, student, faculty/);
    assert.match(result.stdout, /--bootstrap-admin/);
    assert.match(result.stdout, /--authorized-admin <internal-uuid>/);
    assert.match(result.stdout, /student_number, staff_number/);
    assert.match(result.stdout, /# First administrator/);
    assert.match(result.stdout, /# Approver/);
    assert.match(result.stdout, /# Student/);
    assert.match(result.stdout, /# Faculty/);
    assert.doesNotMatch(result.stderr, /DATABASE_MIGRATION_URL/);
  });
}

test("unknown arguments fail before environment validation or password input", () => {
  const result = run(["--not-a-supported-flag"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown argument --not-a-supported-flag/);
  assert.doesNotMatch(result.stderr, /DATABASE_MIGRATION_URL/);
  assert.doesNotMatch(result.stdout, /New account password/);
});

test("missing required arguments fail before environment validation or password input", () => {
  const cases = [
    { args: [], expected: /Missing required argument: --email/ },
    {
      args: ["--email", "<student-email>"],
      expected: /Missing required argument: --name/,
    },
    {
      args: ["--email", "<student-email>", "--name", "<student-name>"],
      expected: /Missing required argument: --role/,
    },
    {
      args: [
        "--email",
        "student@example.invalid",
        "--name",
        "Student Example",
        "--role",
        "student",
      ],
      expected: /--authorized-admin is required/,
    },
  ];

  for (const testCase of cases) {
    const result = run(testCase.args);
    assert.equal(result.status, 1);
    assert.match(result.stderr, testCase.expected);
    assert.doesNotMatch(result.stderr, /DATABASE_MIGRATION_URL/);
    assert.doesNotMatch(result.stdout, /New account password/);
  }
});
