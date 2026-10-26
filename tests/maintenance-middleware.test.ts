import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { middleware, config } from "../middleware";

function req(
  path: string,
  { method = "GET", accept = "" }: { method?: string; accept?: string } = {},
) {
  const headers = new Headers();
  if (accept) headers.set("accept", accept);
  return new NextRequest(new URL(`https://permora.vercel.app${path}`), {
    method,
    headers,
  });
}

function withMaintenance<T>(value: string | undefined, fn: () => T): T {
  const prev = process.env.PERMORA_MAINTENANCE;
  if (value === undefined) delete process.env.PERMORA_MAINTENANCE;
  else process.env.PERMORA_MAINTENANCE = value;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.PERMORA_MAINTENANCE;
    else process.env.PERMORA_MAINTENANCE = prev;
  }
}

test("maintenance OFF: all requests pass through", () => {
  withMaintenance("0", () => {
    for (const r of [
      req("/dashboard", { accept: "text/html" }),
      req("/api/review/requests/abc/decision", { method: "POST" }),
      req("/api/auth/sign-in/email", { method: "POST" }),
    ]) {
      const res = middleware(r);
      // NextResponse.next() has no 503 status.
      assert.notEqual(res.status, 503);
    }
  });
});

test("maintenance ON: browser GET gets 503 HTML", () => {
  withMaintenance("1", () => {
    const res = middleware(req("/dashboard", { accept: "text/html" }));
    assert.equal(res.status, 503);
    assert.match(res.headers.get("content-type") ?? "", /text\/html/);
    assert.equal(res.headers.get("retry-after"), "1800");
  });
});

test("maintenance ON: API POST gets 503 JSON maintenance_active", async () => {
  await withMaintenance("1", async () => {
    const res = middleware(req("/api/review/requests/abc/decision", { method: "POST" }));
    assert.equal(res.status, 503);
    assert.match(res.headers.get("content-type") ?? "", /application\/json/);
    const body = await res.json();
    assert.equal(body.error.code, "maintenance_active");
  });
});

test("maintenance ON: Better Auth sign-in POST is blocked (503)", () => {
  withMaintenance("1", () => {
    const res = middleware(req("/api/auth/sign-in/email", { method: "POST" }));
    assert.equal(res.status, 503);
  });
});

test("maintenance ON: Server Action POST to a page route is blocked (503)", () => {
  withMaintenance("1", () => {
    const res = middleware(req("/dashboard", { method: "POST", accept: "text/x-component" }));
    assert.equal(res.status, 503);
  });
});

test("maintenance ON: only the DB-free status endpoint passes through", () => {
  withMaintenance("1", () => {
    const res = middleware(req("/api/health/maintenance"));
    assert.notEqual(res.status, 503); // NextResponse.next()
  });
});

test("maintenance ON: encoded path cannot bypass the allowlist", () => {
  withMaintenance("1", () => {
    // Encoded form of a different path must NOT be treated as the allowlist.
    const res = middleware(req("/api/review/%2e%2e/x", { method: "POST" }));
    assert.equal(res.status, 503);
  });
});

test("maintenance INVALID (malformed) fails closed: blocks", () => {
  withMaintenance("maybe", () => {
    const res = middleware(req("/api/review/requests/abc/decision", { method: "POST" }));
    assert.equal(res.status, 503);
  });
});

test("matcher excludes only static assets / _next", () => {
  assert.ok(Array.isArray(config.matcher) && config.matcher.length === 1);
  const m = config.matcher[0];
  assert.match(m, /_next\/static/);
  assert.match(m, /_next\/image/);
});

test("middleware module does not import the server DB layer", async () => {
  // Static guarantee that blocking happens before any DB client could exist.
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../middleware.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /server\/db|database-pool|from "pg"/);
});
