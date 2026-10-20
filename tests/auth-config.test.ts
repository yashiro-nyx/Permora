import assert from "node:assert/strict";
import test from "node:test";
import { buildTrustedOrigins } from "../lib/trusted-origins";

const production = "https://permora.vercel.app";
const preview = "https://permora-cbamrnm1w-yashiro-nyx.vercel.app";

test("trusted origins preserve production and allow the exact configured Preview origin", () => {
  assert.deepEqual(
    buildTrustedOrigins(
      production,
      `${production}, ${preview}`,
      undefined,
    ),
    [production, preview],
  );
});

test("Vercel deployment URL is added as one exact origin", () => {
  assert.deepEqual(
    buildTrustedOrigins(production, undefined, "permora-cbamrnm1w-yashiro-nyx.vercel.app"),
    [production, preview],
  );
});

test("wildcards, paths, and credentials are rejected", () => {
  assert.throws(
    () => buildTrustedOrigins(production, "https://*.vercel.app", undefined),
    /explicit origins only/,
  );
  assert.throws(
    () => buildTrustedOrigins(production, "https://example.com/login", undefined),
    /without paths or credentials/,
  );
  assert.throws(
    () => buildTrustedOrigins(production, "https://user:pass@example.com", undefined),
    /without paths or credentials/,
  );
});
