import { spawn, type ChildProcess } from "node:child_process";
import { loadEnvConfig } from "@next/env";
import { preferNeonPooler } from "../lib/database-connection";

function testDatabaseName(connectionString: string) {
  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error("TEST_DATABASE_URL must be a valid PostgreSQL URL.");
  }

  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error("TEST_DATABASE_URL must use the postgres protocol.");
  }

  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!databaseName || !databaseName.endsWith("_test")) {
    throw new Error(
      "Unsafe TEST_DATABASE_URL: the parsed database name must end with _test.",
    );
  }
}

async function main() {
  loadEnvConfig(process.cwd());
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;
  if (!testDatabaseUrl) {
    throw new Error(
      "TEST_DATABASE_URL is required for PostgreSQL integration tests.",
    );
  }
  testDatabaseName(testDatabaseUrl);
  const pooledTestDatabaseUrl = preferNeonPooler(testDatabaseUrl);

  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "test",
    TEST_DATABASE_URL: pooledTestDatabaseUrl,
  };
  delete environment.DATABASE_URL;
  delete environment.DATABASE_MIGRATION_URL;

  for (const file of [
    "tests/stage2a-postgres.integration.test.ts",
    "tests/stage2b-approval.integration.test.ts",
    "tests/stage2b-read-model.integration.test.ts",
    "tests/stage2b-decision-routes.integration.test.ts",
    "tests/stage2b-operations.integration.test.ts",
    "tests/configure-access.integration.test.ts",
    "tests/account-management.integration.test.ts",
  ]) {
    const child: ChildProcess = spawn(
      process.execPath,
      ["--conditions=react-server", "--import", "tsx", "--test", file],
      { env: environment, stdio: "inherit" },
    );
    const exitCode = await new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once(
        "exit",
        (code: number | null, signal: NodeJS.Signals | null) => {
          if (signal)
            reject(new Error(`Integration test process ended by ${signal}.`));
          else resolve(code ?? 1);
        },
      );
    });
    if (exitCode !== 0)
      throw new Error(`${file} failed with exit code ${exitCode}.`);
  }
}

main().catch((error: unknown) => {
  console.error(
    "Integration test setup failed:",
    error instanceof Error ? error.message : "Unknown error.",
  );
  process.exitCode = 1;
});
