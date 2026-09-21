import { loadEnvConfig } from "@next/env";

export type DatabaseTarget = "development" | "test" | "production";

export type DatabaseTargetOptions = {
  target?: DatabaseTarget;
  confirmProduction: boolean;
};

export type ResolvedCliDatabase = {
  target: DatabaseTarget;
  connectionString: string;
  databaseName: string;
};

type ResolveOptions = {
  environment?: Record<string, string | undefined>;
  loadLocalEnvironment?: () => void;
};

const TARGETS = new Set<DatabaseTarget>([
  "development",
  "test",
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
          "--database-target must be development, test, or production.",
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
      "--database-target is required and must be development, test, or production.",
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

  if (target !== "production")
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

  const runtimeUrl = requiredEnvironmentValue(environment, "DATABASE_URL");
  const migrationUrl = requiredEnvironmentValue(
    environment,
    "DATABASE_MIGRATION_URL",
  );
  const databaseName = validateMatchingEndpoints(runtimeUrl, migrationUrl);
  return { target, connectionString: migrationUrl, databaseName };
}
