import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import {
  assertPreviewIdentity,
  extractDatabaseTargetOptions,
  resolveCliDatabase,
} from "../scripts/database-target";

const developmentRuntime =
  "postgresql://app:runtime-secret@ep-permora-pooler.us-east-2.aws.neon.tech/permora_dev?sslmode=require";
const developmentMigration =
  "postgresql://owner:migration-secret@ep-permora.us-east-2.aws.neon.tech/permora_dev?sslmode=require";

function options(args: string[]) {
  return extractDatabaseTargetOptions(args).options;
}

test("mixed development and production endpoints are rejected safely", () => {
  const runtime =
    "postgresql://app:runtime-password@ep-production-pooler.us-east-2.aws.neon.tech/permora";
  const migration =
    "postgresql://owner:migration-password@ep-development.us-east-2.aws.neon.tech/permora_dev";
  assert.throws(
    () =>
      resolveCliDatabase(options(["--database-target", "development"]), {
        environment: {
          DATABASE_URL: runtime,
          DATABASE_MIGRATION_URL: migration,
        },
        loadLocalEnvironment: () => undefined,
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /must target the same PostgreSQL/);
      assert.doesNotMatch(error.message, /runtime-password|migration-password/);
      assert.doesNotMatch(error.message, /postgres(?:ql)?:\/\//i);
      return true;
    },
  );
});

test("pooled and direct URLs for the same Neon branch are accepted", () => {
  const resolved = resolveCliDatabase(
    options(["--database-target", "development"]),
    {
      environment: {
        DATABASE_URL: developmentRuntime,
        DATABASE_MIGRATION_URL: developmentMigration,
      },
      loadLocalEnvironment: () => undefined,
    },
  );
  assert.equal(resolved.target, "development");
  assert.equal(resolved.databaseName, "permora_dev");
  assert.equal(resolved.connectionString, developmentMigration);
});

test("production requires both current-process URLs", () => {
  assert.throws(
    () =>
      resolveCliDatabase(
        options([
          "--database-target",
          "production",
          "--confirm-production",
        ]),
        {
          environment: { DATABASE_URL: developmentRuntime },
          loadLocalEnvironment: () => {
            throw new Error("production must not load .env.local");
          },
        },
      ),
    /DATABASE_MIGRATION_URL is required/,
  );
});

test("production requires explicit confirmation", () => {
  assert.throws(
    () =>
      resolveCliDatabase(options(["--database-target", "production"]), {
        environment: {
          DATABASE_URL: developmentRuntime,
          DATABASE_MIGRATION_URL: developmentMigration,
        },
        loadLocalEnvironment: () => undefined,
      }),
    /explicit --confirm-production flag/,
  );
});

test("test target refuses a database without the _test suffix", () => {
  assert.throws(
    () =>
      resolveCliDatabase(options(["--database-target", "test"]), {
        environment: { TEST_DATABASE_URL: developmentMigration },
        loadLocalEnvironment: () => undefined,
      }),
    /database name must end with _test/,
  );
});

test("development loads local configuration and validates the pair", () => {
  const environment: Record<string, string | undefined> = {};
  let loaded = false;
  const resolved = resolveCliDatabase(
    options(["--database-target", "development"]),
    {
      environment,
      loadLocalEnvironment: () => {
        loaded = true;
        environment.DATABASE_URL = developmentRuntime;
        environment.DATABASE_MIGRATION_URL = developmentMigration;
      },
    },
  );
  assert.equal(loaded, true);
  assert.equal(resolved.databaseName, "permora_dev");
});

test("preview requires explicit Preview variables and never loads local configuration", () => {
  let loaded = false;
  assert.throws(
    () =>
      resolveCliDatabase(options(["--database-target", "preview"]), {
        environment: {},
        loadLocalEnvironment: () => {
          loaded = true;
        },
      }),
    /PREVIEW_DATABASE_URL is required/,
  );
  assert.equal(loaded, false);
});

test("preview rejects reuse of a configured development endpoint", () => {
  assert.throws(
    () =>
      resolveCliDatabase(options(["--database-target", "preview"]), {
        environment: {
          PREVIEW_DATABASE_URL: developmentRuntime,
          PREVIEW_DATABASE_MIGRATION_URL: developmentMigration,
          PREVIEW_DATABASE_NAME: "permora_dev",
          PREVIEW_NEON_PROJECT_ID: "preview-project",
          PREVIEW_NEON_BRANCH_ID: "preview-branch",
          PREVIEW_NEON_ENDPOINT_ID: "preview-endpoint",
          DATABASE_URL: developmentRuntime,
        },
        loadLocalEnvironment: () => {
          throw new Error("preview must not load .env.local");
        },
      }),
    /reuses the endpoint\/database identified by DATABASE_URL/,
  );
});

test("preview requires all explicit identity expectations", () => {
  assert.throws(
    () =>
      resolveCliDatabase(options(["--database-target", "preview"]), {
        environment: {
          PREVIEW_DATABASE_URL:
            "postgresql://app:secret@ep-preview-pooler.us-east-2.aws.neon.tech/neondb",
          PREVIEW_DATABASE_MIGRATION_URL:
            "postgresql://owner:secret@ep-preview.us-east-2.aws.neon.tech/neondb",
          PREVIEW_DATABASE_NAME: "neondb",
          PREVIEW_NEON_PROJECT_ID: "preview-project",
          PREVIEW_NEON_BRANCH_ID: "preview-branch",
        },
      }),
    /PREVIEW_NEON_ENDPOINT_ID is required/,
  );
});

test("preview identity verification rejects a different Neon target", () => {
  assert.throws(
    () =>
      assertPreviewIdentity(
        { projectId: "p", branchId: "b", endpointId: "e" },
        { databaseName: "neondb", projectId: "p", branchId: "other", endpointId: "e" },
        "neondb",
      ),
    /Neon project, branch, or endpoint/,
  );
});

for (const scriptName of [
  "migrate.ts",
  "provision-account.ts",
  "configure-access.ts",
  "reconcile-approval-routing.ts",
  "reconcile-activations.ts",
  "expire-activations.ts",
]) {
  test(`${scriptName} help succeeds without database configuration`, () => {
    const environment = { ...process.env };
    delete environment.DATABASE_URL;
    delete environment.DATABASE_MIGRATION_URL;
    delete environment.TEST_DATABASE_URL;
    const script = path.resolve(process.cwd(), "scripts", scriptName);
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", script, "--help"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: environment,
        timeout: 10_000,
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /database|Database/);
    assert.equal(result.stderr, "");
  });
}
