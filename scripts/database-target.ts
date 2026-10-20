import { loadEnvConfig } from "@next/env";

export type DatabaseTarget = "development" | "test" | "preview" | "production";

export type DatabaseTargetOptions = {
  target?: DatabaseTarget;
  confirmProduction: boolean;
};

export type ResolvedCliDatabase = {
  target: DatabaseTarget;
  connectionString: string;
  databaseName: string;
  expectedNeonIdentity?: NeonIdentity;
};

export type NeonIdentity = {
  projectId: string;
  branchId: string;
  endpointId: string;
};

export type ObservedDatabaseIdentity = NeonIdentity & {
  databaseName: string;
};

export function assertPreviewIdentity(
  expected: NeonIdentity,
  observed: ObservedDatabaseIdentity,
  expectedDatabaseName: string,
) {
  if (observed.databaseName !== expectedDatabaseName)
    throw new Error("Preview identity mismatch: database name is not the expected Preview database.");
  if (
    observed.projectId !== expected.projectId ||
    observed.branchId !== expected.branchId ||
    observed.endpointId !== expected.endpointId
  )
    throw new Error(
      "Preview identity mismatch: Neon project, branch, or endpoint does not match the explicit PREVIEW_* expectations.",
    );
}

type ResolveOptions = {
  environment?: Record<string, string | undefined>;
  loadLocalEnvironment?: () => void;
};

const TARGETS = new Set<DatabaseTarget>([
  "development",
  "test",
  "preview",
  "production",
]);

type ParsedEndpoint = {
  protocol: string;
  normalizedHost: string;
  databaseName: string;
};

function parseEndpoint(value: string, variable: string): ParsedEndpoint {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${variable} must be a valid PostgreSQL URL.`);
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:")
    throw new Error(`${variable} must use a PostgreSQL protocol.`);

  let databaseName: string;
  try {
    databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  } catch {
    throw new Error(`${variable} must identify a valid database name.`);
  }
  if (!databaseName)
    throw new Error(`${variable} must identify a database.`);

  const labels = parsed.hostname.toLowerCase().split(".");
  labels[0] = labels[0].replace(/-pooler$/, "");
  const port = parsed.port || "5432";
  return {
    protocol: parsed.protocol,
    normalizedHost: `${labels.join(".")}:${port}`,
    databaseName,
  };
}

function requiredEnvironmentValue(
  environment: Record<string, string | undefined>,
  variable: string,
) {
  const value = environment[variable]?.trim();
  if (!value) throw new Error(`${variable} is required for this database target.`);
  return value;
}

function validateMatchingEndpoints(runtimeUrl: string, migrationUrl: string) {
  const runtime = parseEndpoint(runtimeUrl, "DATABASE_URL");
  const migration = parseEndpoint(
    migrationUrl,
    "DATABASE_MIGRATION_URL",
  );
  if (
    runtime.protocol !== migration.protocol ||
    runtime.normalizedHost !== migration.normalizedHost ||
    runtime.databaseName !== migration.databaseName
  )
    throw new Error(
      "DATABASE_URL and DATABASE_MIGRATION_URL must target the same PostgreSQL protocol, database, and normalized host.",
    );
  return migration.databaseName;
}

function sameEndpoint(left: ParsedEndpoint, right: ParsedEndpoint) {
  return (
    left.protocol === right.protocol &&
    left.normalizedHost === right.normalizedHost &&
    left.databaseName === right.databaseName
  );
}

function rejectPreviewReuse(
  previewRuntimeUrl: string,
  previewMigrationUrl: string,
  environment: Record<string, string | undefined>,
) {
  const previewRuntime = parseEndpoint(previewRuntimeUrl, "PREVIEW_DATABASE_URL");
  const previewMigration = parseEndpoint(
    previewMigrationUrl,
    "PREVIEW_DATABASE_MIGRATION_URL",
  );
  if (!sameEndpoint(previewRuntime, previewMigration))
    throw new Error(
      "PREVIEW_DATABASE_URL and PREVIEW_DATABASE_MIGRATION_URL must target the same PostgreSQL protocol, database, and normalized host.",
    );

  for (const variable of [
    "DATABASE_URL",
    "DATABASE_MIGRATION_URL",
    "TEST_DATABASE_URL",
  ]) {
    const knownUrl = environment[variable]?.trim();
    if (!knownUrl) continue;
    const known = parseEndpoint(knownUrl, variable);
    if (sameEndpoint(previewRuntime, known))
      throw new Error(
        `Refusing Preview target: it reuses the endpoint/database identified by ${variable}.`,
      );
  }
  return previewMigration.databaseName;
}

export function extractDatabaseTargetOptions(argv: string[]) {
  const remaining: string[] = [];
  let target: DatabaseTarget | undefined;
  let confirmProduction = false;

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--database-target") {
      if (target)
        throw new Error("--database-target was supplied more than once.");
      const value = argv[index + 1];
      if (!value || value.startsWith("--"))
        throw new Error("Missing value for --database-target.");
      if (!TARGETS.has(value as DatabaseTarget))
        throw new Error(
          "--database-target must be development, test, preview, or production.",
        );
      target = value as DatabaseTarget;
      index++;
      continue;
    }
    if (argument === "--confirm-production") {
      if (confirmProduction)
        throw new Error("--confirm-production was supplied more than once.");
      confirmProduction = true;
      continue;
    }
    remaining.push(argument);
  }

  return {
    options: { target, confirmProduction } satisfies DatabaseTargetOptions,
    remaining,
  };
}

export function requireDatabaseTarget(options: DatabaseTargetOptions) {
  if (!options.target)
    throw new Error(
      "--database-target is required and must be development, test, preview, or production.",
    );
  if (options.target === "production" && !options.confirmProduction)
    throw new Error(
      "Production operations require the explicit --confirm-production flag.",
    );
  if (options.target !== "production" && options.confirmProduction)
    throw new Error(
      "--confirm-production may only be used with --database-target production.",
    );
  return options.target;
}

export function resolveCliDatabase(
  options: DatabaseTargetOptions,
  resolveOptions: ResolveOptions = {},
): ResolvedCliDatabase {
  const target = requireDatabaseTarget(options);
  const environment = resolveOptions.environment ?? process.env;

  if (target !== "production" && target !== "preview")
    (resolveOptions.loadLocalEnvironment ?? (() => loadEnvConfig(process.cwd())))();

  if (target === "test") {
    const connectionString = requiredEnvironmentValue(
      environment,
      "TEST_DATABASE_URL",
    );
    const endpoint = parseEndpoint(connectionString, "TEST_DATABASE_URL");
    if (!endpoint.databaseName.endsWith("_test"))
      throw new Error(
        "Refusing unsafe test target: database name must end with _test.",
      );
    return { target, connectionString, databaseName: endpoint.databaseName };
  }

  if (target === "preview") {
    const runtimeUrl = requiredEnvironmentValue(
      environment,
      "PREVIEW_DATABASE_URL",
    );
    const migrationUrl = requiredEnvironmentValue(
      environment,
      "PREVIEW_DATABASE_MIGRATION_URL",
    );
    const databaseName = rejectPreviewReuse(
      runtimeUrl,
      migrationUrl,
      environment,
    );
    const expectedDatabase = requiredEnvironmentValue(
      environment,
      "PREVIEW_DATABASE_NAME",
    );
    if (databaseName !== expectedDatabase)
      throw new Error(
        "Refusing Preview target: the connected database name does not match PREVIEW_DATABASE_NAME.",
      );
    return {
      target,
      connectionString: migrationUrl,
      databaseName,
      expectedNeonIdentity: {
        projectId: requiredEnvironmentValue(environment, "PREVIEW_NEON_PROJECT_ID"),
        branchId: requiredEnvironmentValue(environment, "PREVIEW_NEON_BRANCH_ID"),
        endpointId: requiredEnvironmentValue(environment, "PREVIEW_NEON_ENDPOINT_ID"),
      },
    };
  }

  const runtimeUrl = requiredEnvironmentValue(environment, "DATABASE_URL");
  const migrationUrl = requiredEnvironmentValue(
    environment,
    "DATABASE_MIGRATION_URL",
  );
  const databaseName = validateMatchingEndpoints(runtimeUrl, migrationUrl);
  return { target, connectionString: migrationUrl, databaseName };
}
