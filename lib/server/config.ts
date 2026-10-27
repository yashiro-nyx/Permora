import "server-only";
import { buildTrustedOrigins } from "../trusted-origins";

export { buildTrustedOrigins } from "../trusted-origins";

const DEVELOPMENT_URL = "http://localhost:3000";

export const appUrl = process.env.APP_URL ?? DEVELOPMENT_URL;

export const trustedOrigins = buildTrustedOrigins(
  appUrl,
  process.env.BETTER_AUTH_TRUSTED_ORIGINS,
  process.env.VERCEL_URL,
);

export function backendConfigurationErrors() {
  const missing: string[] = [];
  if (process.env.NODE_ENV === "test") {
    if (!process.env.TEST_DATABASE_URL) missing.push("TEST_DATABASE_URL");
  } else if (!process.env.DATABASE_URL) {
    missing.push("DATABASE_URL");
  }
  if (!process.env.AUTH_SECRET || process.env.AUTH_SECRET.length < 32)
    missing.push("AUTH_SECRET (at least 32 characters)");
  if (process.env.NODE_ENV === "production") {
    if (!process.env.APP_URL) missing.push("APP_URL");
    else {
      try {
        if (new URL(process.env.APP_URL).protocol !== "https:")
          missing.push("APP_URL (HTTPS is required in production)");
      } catch {
        missing.push("APP_URL (valid absolute HTTPS origin)");
      }
    }
  }
  return missing;
}

export function assertBackendConfigured() {
  const missing = backendConfigurationErrors();
  if (missing.length) {
    throw new Error(
      `Server configuration is incomplete: ${missing.join(", ")}.`,
    );
  }
}

// Re-export the pure, dependency-free Neon identity guard (defined outside the
// server-only module so it is unit-testable without server-only/pg).
export { identityError, PRODUCTION_IDENTITY } from "../db-identity";
