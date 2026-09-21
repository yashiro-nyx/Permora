import { defineConfig } from "@playwright/test";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl)
  throw new Error("TEST_DATABASE_URL is required for browser tests.");
const parsed = new URL(testDatabaseUrl);
const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
if (
  !["postgres:", "postgresql:"].includes(parsed.protocol) ||
  !databaseName.endsWith("_test")
)
  throw new Error(
    "Refusing browser tests: TEST_DATABASE_URL must name a PostgreSQL database ending in _test.",
  );

const baseURL = "http://127.0.0.1:3200";
const webServerEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  ),
);
delete webServerEnvironment.DATABASE_URL;
delete webServerEnvironment.DATABASE_MIGRATION_URL;
Object.assign(webServerEnvironment, {
  DATABASE_URL: testDatabaseUrl,
  TEST_DATABASE_URL: testDatabaseUrl,
  PERMORA_E2E_DATABASE: "isolated-test",
  APP_URL: baseURL,
  AUTH_SECRET: "permora-e2e-only-secret-at-least-thirty-two-characters",
});

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 60_000 },
  webServer: {
    command: "npm run dev -- --port 3200",
    url: `${baseURL}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: webServerEnvironment,
  },
  use: {
    baseURL,
    channel: "chrome",
    trace: "retain-on-failure",
  },
  reporter: "list",
});
