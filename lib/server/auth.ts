import "server-only";
import { randomUUID } from "node:crypto";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { db } from "./db";
import { appUrl, trustedOrigins } from "./config";
import { hashPassword, verifyPassword } from "./password";

export const auth = betterAuth({
  appName: "Permora",
  baseURL: appUrl,
  secret:
    process.env.AUTH_SECRET ??
    "build-only-placeholder-that-runtime-guards-must-never-serve",
  database: db,
  trustedOrigins,
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
    password: {
      hash: hashPassword,
      verify: ({ hash, password }) => verifyPassword(hash, password),
    },
  },
  session: {
    expiresIn: 60 * 60 * 8,
    updateAge: 60 * 15,
    freshAge: 60 * 30,
    cookieCache: { enabled: false },
  },
  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 60,
    customRules: {
      // Fix for local development: Next.js dev server injects x-forwarded-for: ::
      // (IPv6 unspecified — the raw socket address for all localhost connections).
      // Without trustedProxies, Better Auth normalises :: to all-zeros IPv6 and
      // every demo account shares one rate-limit bucket, blocking all sign-ins
      // after 5 consecutive attempts across any accounts within 60 seconds.
      //
      // trustedProxies (in advanced.ipAddress below) strips the :: loopback hop,
      // falling back to the library's isDevelopment() → "127.0.0.1" path. All
      // local requests still share one 127.0.0.1 bucket — they are just no longer
      // blocked by the spurious all-zeros key that never matched the window logic.
      //
      // max raised to 10: allows sign-in/sign-out cycles across the four demo
      // accounts (student, faculty, approver, admin) in a single 60-second window
      // for manual testing and screenshots. Brute-force protection remains active.
      //
      // PRODUCTION NOTE: trustedProxies only lists loopback/unspecified addresses.
      // If the production reverse proxy injects x-forwarded-for with its own IP
      // before the client IP (e.g. "203.0.113.5, 10.0.0.1"), the proxy's internal
      // IP must also be added to trustedProxies (or the rate limit will key on the
      // proxy IP, not the real client). This requires production topology knowledge
      // and must be approved and added before the production deployment.
      "/sign-in/email": { window: 60, max: 10 },
    },
  },
  advanced: {
    disableCSRFCheck: false,
    disableOriginCheck: false,
    useSecureCookies: process.env.NODE_ENV === "production",
    ipAddress: {
      // Trust localhost/loopback addresses as the forwarding proxy so that
      // x-forwarded-for: :: is correctly identified as the proxy hop rather
      // than the client address. IPv4 loopback, IPv6 loopback, and the
      // all-zeros unspecified address are all included.
      trustedProxies: ["127.0.0.1", "::1", "::ffff:127.0.0.1", "::/128"],
    },
    database: {
      generateId: () => randomUUID(),
      joins: true,
      validateSchema: false,
    },
  },
  databaseHooks: {
    session: {
      create: {
        before: async (session) => {
          const result = await db.query<{ active: boolean }>(
            "SELECT active FROM user_profile WHERE user_id = $1",
            [session.userId],
          );
          return result.rows[0]?.active === true;
        },
      },
    },
  },
  plugins: [nextCookies()],
});
