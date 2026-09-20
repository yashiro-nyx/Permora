import "server-only";
import { randomUUID } from "node:crypto";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { db } from "./db";
import { appUrl } from "./config";
import { hashPassword, verifyPassword } from "./password";

export const auth = betterAuth({
  appName: "Permora",
  baseURL: appUrl,
  secret:
    process.env.AUTH_SECRET ??
    "build-only-placeholder-that-runtime-guards-must-never-serve",
  database: db,
  trustedOrigins: [appUrl],
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
      "/sign-in/email": { window: 60, max: 5 },
    },
  },
  advanced: {
    disableCSRFCheck: false,
    disableOriginCheck: false,
    useSecureCookies: process.env.NODE_ENV === "production",
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
