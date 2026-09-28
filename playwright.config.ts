import { defineConfig } from "@playwright/test";
import { loadEnvConfig } from "@next/env";
import { randomBytes } from "node:crypto";
import { preferNeonPooler } from "./lib/database-connection";

loadEnvConfig(process.cwd());
const configuredTestDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!configuredTestDatabaseUrl)
  throw new Error("TEST_DATABASE_URL is required for browser tests.");
const parsed = new URL(configuredTestDatabaseUrl);
const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
if (
  !["postgres:", "postgresql:"].includes(parsed.protocol) ||
  !databaseName.endsWith("_test")
)
  throw new Error(
    "Refusing browser tests: TEST_DATABASE_URL must name a PostgreSQL database ending in _test.",
  );
const testDatabaseUrl = preferNeonPooler(configuredTestDatabaseUrl);
process.env.TEST_DATABASE_URL = testDatabaseUrl;

function testSecret(name: string, bytes: number, minimumLength: number) {
  const supplied = process.env[name];
  if (supplied) {
    if (supplied.length < minimumLength)
      throw new Error(`${name} is too short for browser tests.`);
    return supplied;
  }
  const generated = randomBytes(bytes).toString("base64url");
  process.env[name] = generated;
  return generated;
}

testSecret("PERMORA_E2E_PASSWORD", 32, 12);
const testAuthSecret = testSecret("PERMORA_E2E_AUTH_SECRET", 48, 32);
const suppliedRunId = process.env.PERMORA_E2E_RUN_ID;
if (suppliedRunId && !/^[a-z0-9]{16,64}$/i.test(suppliedRunId))
  throw new Error("PERMORA_E2E_RUN_ID must contain 16–64 letters or digits.");
process.env.PERMORA_E2E_RUN_ID =
  suppliedRunId ?? randomBytes(12).toString("hex");

const baseURL = "http://127.0.0.1:3200";
const webServerEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  ),
);
delete webServerEnvironment.DATABASE_URL;
delete webServerEnvironment.DATABASE_MIGRATION_URL;
delete webServerEnvironment.PERMORA_E2E_PASSWORD;
delete webServerEnvironment.PERMORA_E2E_AUTH_SECRET;
delete webServerEnvironment.PERMORA_E2E_RUN_ID;
Object.assign(webServerEnvironment, {
  DATABASE_URL: testDatabaseUrl,
  TEST_DATABASE_URL: testDatabaseUrl,
  PERMORA_E2E_DATABASE: "isolated-test",
  APP_URL: baseURL,
  AUTH_SECRET: testAuthSecret,
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
